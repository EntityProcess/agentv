import { type WriteStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// biome-ignore lint/suspicious/noExplicitAny: OTel ReadableSpan loaded dynamically
type ReadableSpan = any;

/**
 * SpanExporter that writes human-readable JSONL (one line per root span).
 * Designed for quick debugging and analysis without OTel tooling.
 */
export class SimpleTraceFileExporter {
  private stream: WriteStream | null = null;
  private filePath: string;
  private streamReady: Promise<WriteStream> | null = null;
  private pendingWrites: Promise<void>[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureStream(): Promise<WriteStream> {
    if (!this.streamReady) {
      this.streamReady = (async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.stream = createWriteStream(this.filePath, { flags: 'w' });
        return this.stream;
      })();
    }
    return this.streamReady;
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    const spanMap = new Map<string, ReadableSpan>();
    const childMap = new Map<string, ReadableSpan[]>();

    for (const span of spans) {
      spanMap.set(span.spanContext().spanId, span);
      const parentId = span.parentSpanId;
      if (parentId) {
        if (!childMap.has(parentId)) childMap.set(parentId, []);
        childMap.get(parentId)?.push(span);
      }
    }

    // Root spans: no parent or parent not in this batch
    const rootSpans = spans.filter(
      (s: ReadableSpan) => !s.parentSpanId || !spanMap.has(s.parentSpanId),
    );

    const writePromise = this.ensureStream().then((stream) => {
      for (const root of rootSpans) {
        const children = this.collectChildren(root.spanContext().spanId, childMap);
        const record = this.buildSimpleRecord(root, children);
        stream.write(`${JSON.stringify(record)}\n`);
      }
    });
    this.pendingWrites.push(writePromise);

    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.pendingWrites);
    this.pendingWrites = [];
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.end(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async forceFlush(): Promise<void> {
    await Promise.all(this.pendingWrites);
    this.pendingWrites = [];
  }

  private collectChildren(spanId: string, childMap: Map<string, ReadableSpan[]>): ReadableSpan[] {
    const direct = childMap.get(spanId) || [];
    const all: ReadableSpan[] = [...direct];
    for (const child of direct) {
      all.push(...this.collectChildren(child.spanContext().spanId, childMap));
    }
    return all;
  }

  private buildSimpleRecord(root: ReadableSpan, children: ReadableSpan[]): Record<string, unknown> {
    const attrs = root.attributes || {};
    const durationMs = hrTimeDiffMs(root.startTime, root.endTime);

    let inputTokens = 0;
    let outputTokens = 0;
    for (const child of children) {
      const ca = child.attributes || {};
      if (ca['gen_ai.usage.input_tokens']) inputTokens += ca['gen_ai.usage.input_tokens'];
      if (ca['gen_ai.usage.output_tokens']) outputTokens += ca['gen_ai.usage.output_tokens'];
    }

    const toolSpans = children
      .filter((s: ReadableSpan) => s.attributes?.['gen_ai.tool.name'])
      .map((s: ReadableSpan) => ({
        type: 'tool' as const,
        name: s.attributes['gen_ai.tool.name'],
        duration_ms: hrTimeDiffMs(s.startTime, s.endTime),
      }));

    return {
      test_id: attrs['agentv.test_id'],
      target: attrs['agentv.target'],
      score: attrs['agentv.score'],
      duration_ms: durationMs,
      cost_usd: attrs['agentv.trace.cost_usd'],
      token_usage:
        inputTokens || outputTokens ? { input: inputTokens, output: outputTokens } : undefined,
      spans: toolSpans.length > 0 ? toolSpans : undefined,
    };
  }
}

function hrTimeDiffMs(start: [number, number], end: [number, number]): number {
  const diffSec = end[0] - start[0];
  const diffNano = end[1] - start[1];
  return Math.round(diffSec * 1000 + diffNano / 1_000_000);
}
