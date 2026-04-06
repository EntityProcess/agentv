/**
 * Core types for the transcript import pipeline.
 *
 * A TranscriptEntry is the internal (camelCase) representation of a parsed
 * session. A TranscriptJsonLine is the on-disk (snake_case) wire format
 * written to .agentv/transcripts/*.jsonl files.
 *
 * Flow:
 *   raw session JSONL → parser → TranscriptEntry (internal)
 *   TranscriptEntry → toTranscriptJsonLine() → JSONL on disk
 *   JSONL on disk → readTranscriptJsonl() → TranscriptJsonLine[]
 *
 * To add a new importer: write a parser that returns TranscriptEntry,
 * then use toTranscriptJsonLine() to serialize.
 */

import { readFile } from 'node:fs/promises';

import type { Message, ProviderTokenUsage } from '../evaluation/providers/types.js';

/**
 * A parsed transcript: ordered messages plus session metadata (internal camelCase).
 */
export interface TranscriptEntry {
  readonly messages: Message[];
  readonly source: TranscriptSource;
  readonly tokenUsage?: ProviderTokenUsage;
  readonly durationMs?: number;
  readonly costUsd?: number | null;
}

/**
 * Metadata describing the origin of a transcript (internal camelCase).
 */
export interface TranscriptSource {
  readonly provider: string;
  readonly sessionId: string;
  readonly projectPath?: string;
  readonly startedAt?: string;
  readonly model?: string;
  readonly version?: string;
  readonly gitBranch?: string;
  readonly cwd?: string;
}

/**
 * One line in a transcript JSONL file (snake_case wire format).
 *
 * Each line is a self-contained test case with pre-populated output.
 * The `input` field is the first user message; the `output` field is the
 * full conversation (Message[]).
 */
export interface TranscriptJsonLine {
  readonly input: string;
  readonly output: readonly Message[];
  readonly token_usage?: {
    readonly input: number;
    readonly output: number;
    readonly cached?: number;
  };
  readonly duration_ms?: number;
  readonly cost_usd?: number | null;
  readonly source: {
    readonly provider: string;
    readonly session_id: string;
    readonly model?: string;
    readonly timestamp?: string;
    readonly git_branch?: string;
    readonly cwd?: string;
    readonly version?: string;
  };
}

/**
 * Convert a parsed TranscriptEntry to the on-disk JSONL wire format.
 */
export function toTranscriptJsonLine(entry: TranscriptEntry): TranscriptJsonLine {
  const firstUserMessage = entry.messages.find((m) => m.role === 'user');
  const input = typeof firstUserMessage?.content === 'string' ? firstUserMessage.content : '';

  return {
    input,
    output: entry.messages,
    token_usage: entry.tokenUsage
      ? {
          input: entry.tokenUsage.input,
          output: entry.tokenUsage.output,
          cached: entry.tokenUsage.cached,
        }
      : undefined,
    duration_ms: entry.durationMs,
    cost_usd: entry.costUsd,
    source: {
      provider: entry.source.provider,
      session_id: entry.source.sessionId,
      model: entry.source.model,
      timestamp: entry.source.startedAt,
      git_branch: entry.source.gitBranch,
      cwd: entry.source.cwd ?? entry.source.projectPath,
      version: entry.source.version,
    },
  };
}

/**
 * Read a transcript JSONL file and parse each line into a TranscriptJsonLine.
 */
export async function readTranscriptJsonl(filePath: string): Promise<TranscriptJsonLine[]> {
  const text = await readFile(filePath, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TranscriptJsonLine);
}

/**
 * Read a JSONL transcript file and return its raw text.
 * Throws if the file does not exist or cannot be read.
 */
export async function readTranscriptFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
