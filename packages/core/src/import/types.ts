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

import type { Message, ProviderTokenUsage, ToolCall } from '../evaluation/providers/types.js';
import { type Trace, buildTraceFromMessages } from '../evaluation/trace.js';

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

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function toTranscriptTokenUsage(
  usage: ProviderTokenUsage | undefined,
): TranscriptJsonLine['token_usage'] | undefined {
  if (!usage) {
    return undefined;
  }
  return dropUndefined({
    input: usage.input,
    output: usage.output,
    cached: usage.cached,
    reasoning: usage.reasoning,
  }) as TranscriptJsonLine['token_usage'];
}

function toTranscriptToolCall(toolCall: ToolCall): Record<string, unknown> {
  return dropUndefined({
    tool: toolCall.tool,
    input: toolCall.input,
    output: toolCall.output,
    id: toolCall.id,
    start_time: toolCall.startTime,
    end_time: toolCall.endTime,
    duration_ms: toolCall.durationMs,
  });
}

function toTranscriptMessageFields(
  message: Message,
): Omit<
  TranscriptJsonLine,
  | 'test_id'
  | 'target'
  | 'message_index'
  | 'source'
  | 'transcript_token_usage'
  | 'transcript_duration_ms'
  | 'transcript_cost_usd'
> {
  return dropUndefined({
    role: message.role,
    name: message.name,
    content: message.content,
    tool_calls: message.toolCalls?.map(toTranscriptToolCall),
    start_time: message.startTime,
    end_time: message.endTime,
    duration_ms: message.durationMs,
    metadata: message.metadata,
    token_usage: toTranscriptTokenUsage(message.tokenUsage),
  }) as Omit<
    TranscriptJsonLine,
    | 'test_id'
    | 'target'
    | 'message_index'
    | 'source'
    | 'transcript_token_usage'
    | 'transcript_duration_ms'
    | 'transcript_cost_usd'
  >;
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
    ...toTranscriptMessageFields(message),
    transcript_token_usage: transcriptTokenUsage,
    transcript_duration_ms: entry.durationMs,
    transcript_cost_usd: entry.costUsd,
    source,
  }));
}

/**
 * Convert a canonical evaluation trace to transcript JSONL rows.
 */
export function traceToTranscriptJsonLines(
  trace: Trace,
  options?: { testId?: string; target?: string },
): TranscriptJsonLine[] {
  const provider =
    (typeof trace.metadata?.provider === 'string' ? trace.metadata.provider : undefined) ??
    options?.target ??
    'agentv';
  const sessionId =
    (typeof trace.metadata?.provider_session_id === 'string'
      ? trace.metadata.provider_session_id
      : undefined) ??
    (typeof trace.metadata?.eval_case_id === 'string' ? trace.metadata.eval_case_id : undefined) ??
    options?.testId ??
    'trace';

  return toTranscriptJsonLines(
    {
      messages: [...trace.messages],
      source: {
        provider,
        sessionId,
        startedAt: trace.startTime,
      },
      tokenUsage: trace.tokenUsage,
      durationMs: trace.durationMs,
      costUsd: trace.costUsd,
    },
    options,
  );
}

/**
 * Reconstruct a canonical trace/messages representation from transcript JSONL
 * rows. Transcript-aware graders can use this for offline replay parity.
 */
export function traceFromTranscriptJsonLines(lines: readonly TranscriptJsonLine[]): Trace {
  const [entry] = groupTranscriptJsonLines(lines);
  if (!entry) {
    return buildTraceFromMessages();
  }

  return buildTraceFromMessages({
    output: entry.messages,
    tokenUsage: entry.tokenUsage,
    durationMs: entry.durationMs,
    costUsd: entry.costUsd ?? undefined,
    startTime: entry.source.startedAt,
    provider: entry.source.provider,
    target: entry.target,
    testId: entry.testId,
    conversationId: entry.source.sessionId,
  });
}

function fromTranscriptTokenUsage(
  usage: TranscriptJsonLine['token_usage'],
): ProviderTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    input: usage.input,
    output: usage.output,
    cached: usage.cached,
    reasoning: usage.reasoning,
  };
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function fromTranscriptToolCall(wire: Record<string, unknown>): ToolCall | undefined {
  const tool = readOptionalString(wire, 'tool');
  if (!tool) {
    return undefined;
  }
  return {
    tool,
    input: wire.input,
    output: wire.output,
    id: readOptionalString(wire, 'id'),
    startTime: readOptionalString(wire, 'start_time'),
    endTime: readOptionalString(wire, 'end_time'),
    durationMs: readOptionalNumber(wire, 'duration_ms'),
  };
}

function buildReplayMessage(line: TranscriptJsonLine): Message {
  return {
    role: line.role,
    name: line.name,
    content: line.content as Message['content'],
    toolCalls: line.tool_calls
      ?.map(fromTranscriptToolCall)
      .filter((toolCall): toolCall is ToolCall => toolCall !== undefined),
    startTime: line.start_time,
    endTime: line.end_time,
    durationMs: line.duration_ms,
    metadata: line.metadata,
    tokenUsage: fromTranscriptTokenUsage(line.token_usage),
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
