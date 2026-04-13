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
import type { TranscriptReplayEntry } from './types.js';
import { groupTranscriptJsonLines, readTranscriptJsonl } from './types.js';

export class TranscriptProvider implements Provider {
  readonly id: string;
  readonly kind = 'transcript' as const;
  readonly targetName: string;

  private entries: TranscriptReplayEntry[];
  private cursor = 0;

  constructor(targetName: string, entries: TranscriptReplayEntry[]) {
    this.targetName = targetName;
    this.id = `transcript:${targetName}`;
    this.entries = entries;
  }

  /**
   * Create a TranscriptProvider from a JSONL file path.
   */
  static async fromFile(filePath: string): Promise<TranscriptProvider> {
    const lines = await readTranscriptJsonl(filePath);
    if (lines.length === 0) {
      throw new Error(`Transcript file is empty: ${filePath}`);
    }
    const entries = groupTranscriptJsonLines(lines);
    const providerName = entries[0]?.source.provider ?? 'transcript';
    return new TranscriptProvider(providerName, entries);
  }

  get lineCount(): number {
    return this.entries.length;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    if (this.cursor >= this.entries.length) {
      throw new Error(
        `Transcript exhausted: ${this.entries.length} entr${this.entries.length === 1 ? 'y' : 'ies'} available but ` +
          `${this.cursor + 1} invocations attempted. Each transcript entry maps to one test case.`,
      );
    }

    const entry = this.entries[this.cursor++];

    return {
      output: entry.messages,
      tokenUsage: entry.tokenUsage
        ? {
            input: entry.tokenUsage.input,
            output: entry.tokenUsage.output,
            cached: entry.tokenUsage.cached,
            reasoning: entry.tokenUsage.reasoning,
          }
        : undefined,
      durationMs: entry.durationMs,
      costUsd: entry.costUsd ?? undefined,
      startTime: entry.source.startedAt,
    };
  }
}
