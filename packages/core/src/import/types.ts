/**
 * Core types for the transcript import pipeline.
 *
 * A TranscriptEntry is the internal (camelCase) representation of a parsed
 * session. A TranscriptJsonLine is the on-disk (snake_case) wire format
 * written to .agentv/transcripts/*.jsonl files.
 *
 * Flow:
 *   raw session JSONL → parser → TranscriptEntry (internal)
 *   TranscriptEntry → toTranscriptJsonLines() → JSONL on disk
 *   JSONL on disk → readTranscriptJsonl() → TranscriptJsonLine[]
 *
 * To add a new importer: write a parser that returns TranscriptEntry,
 * then use toTranscriptJsonLines() to serialize.
 */

import { readFile } from 'node:fs/promises';

import { toCamelCaseDeep, toSnakeCaseDeep } from '../evaluation/case-conversion.js';
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
 * Each line captures one message within an ordered per-test transcript.
 * Consumers group all rows with the same `test_id` into a replayable session.
 */
export interface TranscriptJsonLine {
  readonly test_id: string;
  readonly target: string;
  readonly message_index: number;
  readonly role: string;
  readonly name?: string;
  readonly content?: unknown;
  readonly tool_calls?: readonly Record<string, unknown>[];
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly metadata?: Record<string, unknown>;
  readonly token_usage?: {
    readonly input: number;
    readonly output: number;
    readonly cached?: number;
    readonly reasoning?: number;
  };
  readonly transcript_token_usage?: {
    readonly input: number;
    readonly output: number;
    readonly cached?: number;
    readonly reasoning?: number;
  };
  readonly transcript_duration_ms?: number;
  readonly transcript_cost_usd?: number | null;
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
 * Grouped replayable transcript reconstructed from per-message rows.
 */
export interface TranscriptReplayEntry {
  readonly testId: string;
  readonly target: string;
  readonly messages: readonly Message[];
  readonly tokenUsage?: ProviderTokenUsage;
  readonly durationMs?: number;
  readonly costUsd?: number | null;
  readonly source: TranscriptSource;
}

/**
 * Convert a parsed TranscriptEntry to per-message JSONL rows.
 */
export function toTranscriptJsonLines(
  entry: TranscriptEntry,
  options?: { testId?: string; target?: string },
): TranscriptJsonLine[] {
  const source = {
    provider: entry.source.provider,
    session_id: entry.source.sessionId,
    model: entry.source.model,
    timestamp: entry.source.startedAt,
    git_branch: entry.source.gitBranch,
    cwd: entry.source.cwd ?? entry.source.projectPath,
    version: entry.source.version,
  };
  const transcriptTokenUsage = entry.tokenUsage
    ? {
        input: entry.tokenUsage.input,
        output: entry.tokenUsage.output,
        cached: entry.tokenUsage.cached,
        reasoning: entry.tokenUsage.reasoning,
      }
    : undefined;
  const testId = options?.testId ?? entry.source.sessionId;
  const target = options?.target ?? entry.source.provider;

  return entry.messages.map((message, index) => ({
    test_id: testId,
    target,
    message_index: index,
    ...(toSnakeCaseDeep(message) as Omit<
      TranscriptJsonLine,
      | 'test_id'
      | 'target'
      | 'message_index'
      | 'source'
      | 'transcript_token_usage'
      | 'transcript_duration_ms'
      | 'transcript_cost_usd'
    >),
    transcript_token_usage: transcriptTokenUsage,
    transcript_duration_ms: entry.durationMs,
    transcript_cost_usd: entry.costUsd,
    source,
  }));
}

function buildReplayMessage(line: TranscriptJsonLine): Message {
  const camelCased = toCamelCaseDeep(line) as {
    role: string;
    name?: string;
    content?: Message['content'];
    toolCalls?: Message['toolCalls'];
    startTime?: string;
    endTime?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
    tokenUsage?: ProviderTokenUsage;
  };

  return {
    role: camelCased.role,
    name: camelCased.name,
    content: camelCased.content,
    toolCalls: camelCased.toolCalls,
    startTime: camelCased.startTime,
    endTime: camelCased.endTime,
    durationMs: camelCased.durationMs,
    metadata: camelCased.metadata,
    tokenUsage: camelCased.tokenUsage,
  };
}

/**
 * Group per-message transcript rows back into replayable conversations.
 */
export function groupTranscriptJsonLines(
  lines: readonly TranscriptJsonLine[],
): TranscriptReplayEntry[] {
  const grouped = new Map<
    string,
    {
      target: string;
      tokenUsage?: ProviderTokenUsage;
      durationMs?: number;
      costUsd?: number | null;
      source: TranscriptSource;
      messages: { index: number; message: Message }[];
    }
  >();

  for (const line of lines) {
    const existing = grouped.get(line.test_id);
    const source: TranscriptSource = {
      provider: line.source.provider,
      sessionId: line.source.session_id,
      startedAt: line.source.timestamp,
      model: line.source.model,
      gitBranch: line.source.git_branch,
      cwd: line.source.cwd,
      version: line.source.version,
    };
    const transcriptTokenUsage = line.transcript_token_usage
      ? {
          input: line.transcript_token_usage.input,
          output: line.transcript_token_usage.output,
          cached: line.transcript_token_usage.cached,
          reasoning: line.transcript_token_usage.reasoning,
        }
      : undefined;

    if (existing) {
      existing.messages.push({ index: line.message_index, message: buildReplayMessage(line) });
      continue;
    }

    grouped.set(line.test_id, {
      target: line.target,
      tokenUsage: transcriptTokenUsage,
      durationMs: line.transcript_duration_ms,
      costUsd: line.transcript_cost_usd,
      source,
      messages: [{ index: line.message_index, message: buildReplayMessage(line) }],
    });
  }

  return [...grouped.entries()].map(([testId, entry]) => ({
    testId,
    target: entry.target,
    tokenUsage: entry.tokenUsage,
    durationMs: entry.durationMs,
    costUsd: entry.costUsd,
    source: entry.source,
    messages: entry.messages
      .sort((first, second) => first.index - second.index)
      .map((item) => item.message),
  }));
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
