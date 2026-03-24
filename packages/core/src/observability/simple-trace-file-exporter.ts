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
  private _shuttingDown = false;
  private spansByTraceId = new Map<string, ReadableSpan[]>();

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
    if (this._shuttingDown) {
      resultCallback({ code: 0 });
      return;
    }
    const rootSpans: ReadableSpan[] = [];
    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      const existing = this.spansByTraceId.get(traceId) ?? [];
      existing.push(span);
      this.spansByTraceId.set(traceId, existing);
      if (span.name === 'agentv.eval') {
        rootSpans.push(span);
      }
    }

    const writePromise = this.ensureStream().then((stream) => {
      for (const root of rootSpans) {
        const traceId = root.spanContext().traceId;
        const traceSpans = this.spansByTraceId.get(traceId) ?? [root];
        const children = traceSpans.filter(
          (span) => span.spanContext().spanId !== root.spanContext().spanId,
        );
        const record = this.buildSimpleRecord(root, children);
        stream.write(`${JSON.stringify(record)}\n`);
        this.spansByTraceId.delete(traceId);
      }
    });
    this.pendingWrites.push(writePromise);

    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {
    this._shuttingDown = true;
    await Promise.all(this.pendingWrites);
    this.pendingWrites = [];
    this.spansByTraceId.clear();
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

  private buildSimpleRecord(root: ReadableSpan, children: ReadableSpan[]): Record<string, unknown> {
    const attrs = root.attributes || {};
    const durationMs =
      typeof attrs['agentv.trace.duration_ms'] === 'number'
        ? attrs['agentv.trace.duration_ms']
        : hrTimeDiffMs(root.startTime, root.endTime);

    let inputTokens = 0;
    let outputTokens = 0;
    for (const child of children) {
      const ca = child.attributes || {};
      if (ca['gen_ai.usage.input_tokens']) inputTokens += ca['gen_ai.usage.input_tokens'];
      if (ca['gen_ai.usage.output_tokens']) outputTokens += ca['gen_ai.usage.output_tokens'];
    }
    const rootInputTokens =
      typeof attrs['agentv.trace.token_input'] === 'number' ? attrs['agentv.trace.token_input'] : 0;
    const rootOutputTokens =
      typeof attrs['agentv.trace.token_output'] === 'number'
        ? attrs['agentv.trace.token_output']
        : 0;
    const rootCachedTokens =
      typeof attrs['agentv.trace.token_cached'] === 'number'
        ? attrs['agentv.trace.token_cached']
        : undefined;

    const llmSpans = children
      .filter((s: ReadableSpan) => s.attributes?.['gen_ai.operation.name'] === 'chat')
      .map((s: ReadableSpan) => ({
        type: 'llm' as const,
        name: s.name,
        duration_ms: hrTimeDiffMs(s.startTime, s.endTime),
      }));

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
        inputTokens || outputTokens || rootInputTokens || rootOutputTokens || rootCachedTokens
          ? {
              input: inputTokens || rootInputTokens,
              output: outputTokens || rootOutputTokens,
              ...(rootCachedTokens ? { cached: rootCachedTokens } : {}),
            }
          : undefined,
      spans: [...llmSpans, ...toolSpans].length > 0 ? [...llmSpans, ...toolSpans] : undefined,
    };
  }
}

function hrTimeDiffMs(start: [number, number], end: [number, number]): number {
  const diffSec = end[0] - start[0];
  const diffNano = end[1] - start[1];
  return Math.round(diffSec * 1000 + diffNano / 1_000_000);
}
