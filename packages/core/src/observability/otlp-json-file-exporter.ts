import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// biome-ignore lint/suspicious/noExplicitAny: OTel ReadableSpan loaded dynamically
type ReadableSpan = any;

/**
 * SpanExporter that writes OTLP JSON (the standard OTel wire format) to a file.
 * The file can be imported by any OTel-compatible backend.
 */
export class OtlpJsonFileExporter {
  // biome-ignore lint/suspicious/noExplicitAny: serialized span data
  private spans: any[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    for (const span of spans) {
      this.spans.push({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanId || undefined,
        name: span.name,
        kind: span.kind,
        startTimeUnixNano: hrTimeToNanos(span.startTime),
        endTimeUnixNano: hrTimeToNanos(span.endTime),
        attributes: convertAttributes(span.attributes),
        status: span.status,
        events: span.events?.map(
          (e: { name: string; time: [number, number]; attributes?: Record<string, unknown> }) => ({
            name: e.name,
            timeUnixNano: hrTimeToNanos(e.time),
            attributes: convertAttributes(e.attributes),
          }),
        ),
      });
    }
    resultCallback({ code: 0 }); // SUCCESS
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }

  async forceFlush(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.spans.length === 0) return;

    await mkdir(dirname(this.filePath), { recursive: true });

    const otlpJson = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              scope: { name: 'agentv', version: '1.0.0' },
              spans: this.spans,
            },
          ],
        },
      ],
    };

    const { writeFile } = await import('node:fs/promises');
    await writeFile(this.filePath, JSON.stringify(otlpJson, null, 2));
  }
}

function hrTimeToNanos(hrTime: [number, number]): string {
  return String(hrTime[0] * 1_000_000_000 + hrTime[1]);
}

function convertAttributes(
  attrs: Record<string, unknown> | undefined,
): Array<{ key: string; value: unknown }> {
  return Object.entries(attrs || {}).map(([key, value]) => ({
    key,
    value: serializeAttributeValue(value),
  }));
}

function serializeAttributeValue(value: unknown): unknown {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(serializeAttributeValue) } };
  return { stringValue: String(value) };
}
