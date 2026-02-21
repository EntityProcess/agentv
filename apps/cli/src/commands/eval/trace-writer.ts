import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { Message, ProviderTokenUsage } from '@agentv/core';
import { Mutex } from 'async-mutex';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';

/**
 * A span within a trace representing a tool invocation.
 */
export interface TraceSpan {
  /** Span type (currently only 'tool') */
  readonly type: 'tool';
  /** Tool name */
  readonly name: string;
  /** ISO 8601 timestamp when the span started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when the span ended */
  readonly endTime?: string;
  /** Duration of the span in milliseconds */
  readonly durationMs?: number;
  /** Tool input arguments */
  readonly input?: unknown;
  /** Tool output result */
  readonly output?: unknown;
}

/**
 * A trace record representing a single eval case execution.
 */
export interface TraceRecord {
  /** Test case identifier */
  readonly testId: string;
  /** ISO 8601 timestamp when execution started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended */
  readonly endTime?: string;
  /** Total execution duration in milliseconds */
  readonly durationMs?: number;
  /** List of spans (tool invocations) in the trace */
  readonly spans: readonly TraceSpan[];
  /** Token usage metrics */
  readonly tokenUsage?: ProviderTokenUsage;
  /** Total cost in USD */
  readonly costUsd?: number;
}

/**
 * Extracts trace spans from output messages.
 * Converts tool calls from the agent execution into TraceSpan objects.
 */
export function extractTraceSpans(output: readonly Message[]): readonly TraceSpan[] {
  const spans: TraceSpan[] = [];

  for (const message of output) {
    if (message.toolCalls && message.toolCalls.length > 0) {
      for (const toolCall of message.toolCalls) {
        spans.push({
          type: 'tool',
          name: toolCall.tool,
          startTime: toolCall.startTime,
          endTime: toolCall.endTime,
          durationMs: toolCall.durationMs,
          input: toolCall.input,
          output: toolCall.output,
        });
      }
    }
  }

  return spans;
}

/**
 * Builds a TraceRecord from an EvaluationResult's output.
 */
export function buildTraceRecord(
  testId: string,
  output: readonly Message[],
  options?: {
    readonly tokenUsage?: ProviderTokenUsage;
    readonly costUsd?: number;
    readonly startTime?: string;
    readonly endTime?: string;
    readonly durationMs?: number;
  },
): TraceRecord {
  const spans = extractTraceSpans(output);

  return {
    testId,
    startTime: options?.startTime,
    endTime: options?.endTime,
    durationMs: options?.durationMs,
    spans,
    tokenUsage: options?.tokenUsage,
    costUsd: options?.costUsd,
  };
}

/**
 * Writer for trace JSONL files.
 * Persists full execution traces for debugging and analysis.
 */
export class TraceWriter {
  private readonly stream: ReturnType<typeof createWriteStream>;
  private readonly mutex = new Mutex();
  private closed = false;

  private constructor(stream: ReturnType<typeof createWriteStream>) {
    this.stream = stream;
  }

  /**
   * Opens a new TraceWriter for the given file path.
   * Creates the directory structure if it doesn't exist.
   */
  static async open(filePath: string): Promise<TraceWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const stream = createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
    return new TraceWriter(stream);
  }

  /**
   * Appends a trace record to the file.
   * Thread-safe via mutex for concurrent writes.
   */
  async append(record: TraceRecord): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.closed) {
        throw new Error('Cannot write to closed trace writer');
      }
      // Convert camelCase keys to snake_case for Python ecosystem compatibility
      const snakeCaseRecord = toSnakeCaseDeep(record);
      const line = `${JSON.stringify(snakeCaseRecord)}\n`;
      if (!this.stream.write(line)) {
        await new Promise<void>((resolve, reject) => {
          this.stream.once('drain', resolve);
          this.stream.once('error', reject);
        });
      }
    });
  }

  /**
   * Closes the writer and finalises the stream.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stream.end();
    await finished(this.stream);
  }
}
