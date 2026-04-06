/**
 * Transcript provider — replays pre-recorded session transcripts through the
 * evaluation pipeline without invoking any live agent.
 *
 * Used by `agentv eval --transcript <file>` to grade imported sessions.
 *
 * How it works:
 *   1. Reads a transcript JSONL file (produced by `agentv import`)
 *   2. Each invocation pops the next line from the transcript
 *   3. Returns a ProviderResponse with pre-populated output, token usage, etc.
 *   4. Evaluators run identically to live eval — they see the same ProviderResponse
 *
 * The provider name in results is set to the source provider from the transcript
 * (e.g., "claude", "codex", "copilot").
 */

import type { Provider, ProviderRequest, ProviderResponse } from '../evaluation/providers/types.js';
import type { TranscriptJsonLine } from './types.js';
import { readTranscriptJsonl } from './types.js';

export class TranscriptProvider implements Provider {
  readonly id: string;
  readonly kind = 'transcript' as const;
  readonly targetName: string;

  private lines: TranscriptJsonLine[];
  private cursor = 0;

  constructor(targetName: string, lines: TranscriptJsonLine[]) {
    this.targetName = targetName;
    this.id = `transcript:${targetName}`;
    this.lines = lines;
  }

  /**
   * Create a TranscriptProvider from a JSONL file path.
   */
  static async fromFile(filePath: string): Promise<TranscriptProvider> {
    const lines = await readTranscriptJsonl(filePath);
    if (lines.length === 0) {
      throw new Error(`Transcript file is empty: ${filePath}`);
    }
    const providerName = lines[0].source.provider ?? 'transcript';
    return new TranscriptProvider(providerName, lines);
  }

  get lineCount(): number {
    return this.lines.length;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    if (this.cursor >= this.lines.length) {
      throw new Error(
        `Transcript exhausted: ${this.lines.length} line(s) available but ` +
          `${this.cursor + 1} invocations attempted. Each transcript line maps to one test case.`,
      );
    }

    const line = this.lines[this.cursor++];

    return {
      output: line.output,
      tokenUsage: line.token_usage
        ? {
            input: line.token_usage.input,
            output: line.token_usage.output,
            cached: line.token_usage.cached,
          }
        : undefined,
      durationMs: line.duration_ms,
      costUsd: line.cost_usd ?? undefined,
      startTime: line.source.timestamp,
    };
  }
}
