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
import {
  EXECUTION_TRACE_SCHEMA_VERSION,
  type TraceEnvelope,
  traceEnvelopeToToolTrajectoryView,
  traceEnvelopeToTraceSummary,
  traceEnvelopeToTranscriptMessages,
} from '../evaluation/trace-envelope.js';
import { type Trace, buildTraceFromMessages } from '../evaluation/trace.js';

export const TRANSCRIPT_ROW_SCHEMA_VERSION = 'agentv.transcript.v1' as const;

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
  readonly kind?: string;
  readonly provider: string;
  readonly sessionId: string;
  readonly path?: string;
  readonly format?: string;
  readonly projectPath?: string;
  readonly startedAt?: string;
  readonly model?: string;
  readonly version?: string;
  readonly gitBranch?: string;
  readonly cwd?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TranscriptCaptureState {
  readonly content: 'none' | 'metadata' | 'full';
  readonly redaction_level: 'none' | 'partial' | 'full';
  readonly redacted_fields?: readonly string[];
}

export interface TranscriptTraceRef {
  readonly schema_version?: typeof EXECUTION_TRACE_SCHEMA_VERSION;
  readonly artifact_id?: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly parent_span_id?: string;
}

export interface TranscriptToolCallJsonLine {
  readonly tool: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly id?: string;
  readonly status?: 'ok' | 'error' | 'unknown';
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly trace?: TranscriptTraceRef;
}

/**
 * One line in a transcript JSONL file (snake_case wire format).
 *
 * Each line captures one message within an ordered per-test transcript.
 * Consumers group all rows with the same `test_id` into a replayable session.
 */
export interface TranscriptJsonLine {
  readonly schema_version?: typeof TRANSCRIPT_ROW_SCHEMA_VERSION;
  readonly test_id: string;
  readonly target: string;
  readonly message_index: number;
  readonly role: string;
  readonly name?: string;
  readonly content?: unknown;
  readonly tool_calls?: readonly TranscriptToolCallJsonLine[];
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
  readonly capture?: TranscriptCaptureState;
  readonly trace?: TranscriptTraceRef;
  readonly source: {
    readonly kind?: string;
    readonly provider: string;
    readonly session_id: string;
    readonly path?: string;
    readonly format?: string;
    readonly model?: string;
    readonly timestamp?: string;
    readonly git_branch?: string;
    readonly cwd?: string;
    readonly version?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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

function toTranscriptCaptureState(
  capture: TranscriptCaptureState | undefined,
): TranscriptCaptureState {
  return {
    content: capture?.content ?? 'full',
    redaction_level: capture?.redaction_level ?? 'none',
    ...(capture?.redacted_fields ? { redacted_fields: capture.redacted_fields } : {}),
  };
}

function toTranscriptToolCall(
  toolCall: ToolCall,
  projection?: Partial<TranscriptToolCallJsonLine>,
): TranscriptToolCallJsonLine {
  const status =
    projection?.status ??
    (toolCall.status ? toTranscriptToolCallStatus(toolCall.status) : undefined);
  return {
    tool: projection?.tool ?? toolCall.tool,
    ...(toolCall.input !== undefined || projection?.input !== undefined
      ? { input: toolCall.input !== undefined ? toolCall.input : projection?.input }
      : {}),
    ...(toolCall.output !== undefined || projection?.output !== undefined
      ? { output: toolCall.output !== undefined ? toolCall.output : projection?.output }
      : {}),
    ...(toolCall.id || projection?.id ? { id: toolCall.id ?? projection?.id } : {}),
    ...(status ? { status } : {}),
    ...(toolCall.startTime || projection?.start_time
      ? { start_time: toolCall.startTime ?? projection?.start_time }
      : {}),
    ...(toolCall.endTime || projection?.end_time
      ? { end_time: toolCall.endTime ?? projection?.end_time }
      : {}),
    ...(toolCall.durationMs !== undefined || projection?.duration_ms !== undefined
      ? { duration_ms: toolCall.durationMs ?? projection?.duration_ms }
      : {}),
    ...(projection?.trace ? { trace: projection.trace } : {}),
  };
}

function toTranscriptToolCallStatus(
  status: NonNullable<ToolCall['status']>,
): TranscriptToolCallJsonLine['status'] {
  if (status === 'timeout' || status === 'cancelled') {
    return 'error';
  }
  return status === 'unknown' ? 'unknown' : status;
}

function toTranscriptMessageFields(
  message: Message,
): Omit<
  TranscriptJsonLine,
  | 'test_id'
  | 'target'
  | 'message_index'
  | 'schema_version'
  | 'source'
  | 'capture'
  | 'trace'
  | 'transcript_token_usage'
  | 'transcript_duration_ms'
  | 'transcript_cost_usd'
> {
  return dropUndefined({
    role: message.role,
    name: message.name,
    content: message.content,
    tool_calls: message.toolCalls?.map((toolCall) => toTranscriptToolCall(toolCall)),
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
    | 'schema_version'
    | 'source'
    | 'capture'
    | 'trace'
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
    kind: entry.source.kind ?? 'imported_transcript',
    provider: entry.source.provider,
    session_id: entry.source.sessionId,
    path: entry.source.path,
    format: entry.source.format,
    model: entry.source.model,
    timestamp: entry.source.startedAt,
    git_branch: entry.source.gitBranch,
    cwd: entry.source.cwd ?? entry.source.projectPath,
    version: entry.source.version,
    metadata: entry.source.metadata,
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
  const capture = toTranscriptCaptureState(undefined);

  return entry.messages.map((message, index) => ({
    schema_version: TRANSCRIPT_ROW_SCHEMA_VERSION,
    test_id: testId,
    target,
    message_index: index,
    ...toTranscriptMessageFields(message),
    transcript_token_usage: transcriptTokenUsage,
    transcript_duration_ms: entry.durationMs,
    transcript_cost_usd: entry.costUsd,
    capture,
    source: dropUndefined(source) as TranscriptJsonLine['source'],
  }));
}

function traceRefFromEnvelope(
  envelope: TraceEnvelope,
  spanId?: string,
  parentSpanId?: string,
): TranscriptTraceRef {
  return dropUndefined({
    schema_version: EXECUTION_TRACE_SCHEMA_VERSION,
    artifact_id: envelope.artifactId,
    trace_id: envelope.trace.traceId,
    span_id: spanId ?? envelope.trace.rootSpanId,
    parent_span_id: parentSpanId,
  }) as TranscriptTraceRef;
}

function sourceFromEnvelope(
  envelope: TraceEnvelope,
  summary: ReturnType<typeof traceEnvelopeToTraceSummary>,
): TranscriptJsonLine['source'] {
  const metadata = envelope.source.metadata;
  const sessionId =
    optionalString(metadata?.provider_session_id) ??
    optionalString(metadata?.session_id) ??
    optionalString(metadata?.conversation_id) ??
    envelope.eval.runId ??
    envelope.eval.testId;

  return dropUndefined({
    kind: envelope.source.kind,
    provider: envelope.source.provider ?? envelope.eval.target,
    session_id: sessionId,
    path: envelope.source.path,
    format: envelope.source.format,
    model: optionalString(metadata?.model),
    timestamp: summary.startTime ?? envelope.createdAt,
    cwd: optionalString(metadata?.cwd),
    version: envelope.source.version,
    metadata,
  }) as TranscriptJsonLine['source'];
}

function captureFromEnvelope(envelope: TraceEnvelope): TranscriptCaptureState {
  return toTranscriptCaptureState({
    content: envelope.capture.content,
    redaction_level: envelope.capture.redactionLevel,
    redacted_fields: envelope.capture.redactedFields,
  });
}

function messageTraceRefs(envelope: TraceEnvelope): Map<number, TranscriptTraceRef> {
  const refs = new Map<number, TranscriptTraceRef>();
  for (const span of envelope.trace.spans) {
    if (
      span.attributes['gen_ai.operation.name'] !== 'chat' &&
      span.attributes['openinference.span.kind'] !== 'LLM'
    ) {
      continue;
    }
    const index = span.attributes['agentv.message.index'];
    if (typeof index === 'number' && Number.isInteger(index)) {
      refs.set(index, traceRefFromEnvelope(envelope, span.spanId, span.parentSpanId ?? undefined));
    }
  }
  return refs;
}

function toolProjections(envelope: TraceEnvelope): TranscriptToolCallJsonLine[] {
  return traceEnvelopeToToolTrajectoryView(envelope).tools.map(
    (tool) =>
      dropUndefined({
        tool: tool.tool,
        input: tool.input,
        output: tool.output,
        id: tool.toolCallId,
        status: tool.status,
        start_time: tool.startTime,
        end_time: tool.endTime,
        duration_ms: tool.durationMs,
        trace: traceRefFromEnvelope(envelope, tool.spanId, tool.parentSpanId),
      }) as unknown as TranscriptToolCallJsonLine,
  );
}

function projectedToolCalls(
  message: Message,
  projections: readonly TranscriptToolCallJsonLine[],
  usedProjectionIndexes: Set<number>,
): readonly TranscriptToolCallJsonLine[] | undefined {
  if (!message.toolCalls || message.toolCalls.length === 0) {
    return undefined;
  }

  return message.toolCalls.map((toolCall) => {
    const projectionIndex = projections.findIndex((candidate, index) => {
      if (usedProjectionIndexes.has(index)) {
        return false;
      }
      if (toolCall.id && candidate.id) {
        return candidate.id === toolCall.id;
      }
      return candidate.tool === toolCall.tool;
    });
    const projection = projectionIndex >= 0 ? projections[projectionIndex] : undefined;
    if (projectionIndex >= 0) {
      usedProjectionIndexes.add(projectionIndex);
    }
    return toTranscriptToolCall(toolCall, projection);
  });
}

export function traceEnvelopeToTranscriptJsonLines(
  envelope: TraceEnvelope,
  options?: { testId?: string; target?: string },
): TranscriptJsonLine[] {
  const messages = traceEnvelopeToTranscriptMessages(envelope);
  const summary = traceEnvelopeToTraceSummary(envelope);
  const source = sourceFromEnvelope(envelope, summary);
  const capture = captureFromEnvelope(envelope);
  const transcriptTokenUsage = summary.tokenUsage
    ? {
        input: summary.tokenUsage.input,
        output: summary.tokenUsage.output,
        cached: summary.tokenUsage.cached,
        reasoning: summary.tokenUsage.reasoning,
      }
    : undefined;
  const refsByMessageIndex = messageTraceRefs(envelope);
  const toolRows = toolProjections(envelope);
  const usedToolIndexes = new Set<number>();

  return messages.map((message, index) => {
    const trace = refsByMessageIndex.get(index) ?? traceRefFromEnvelope(envelope);
    return dropUndefined({
      schema_version: TRANSCRIPT_ROW_SCHEMA_VERSION,
      test_id: options?.testId ?? envelope.eval.testId,
      target: options?.target ?? envelope.eval.target,
      message_index: index,
      ...toTranscriptMessageFields({ ...message, toolCalls: undefined }),
      tool_calls: projectedToolCalls(message, toolRows, usedToolIndexes),
      transcript_token_usage: transcriptTokenUsage,
      transcript_duration_ms: summary.durationMs,
      transcript_cost_usd: summary.costUsd,
      capture,
      trace,
      source,
    }) as unknown as TranscriptJsonLine;
  });
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
        kind: 'agentv_run',
        provider,
        sessionId,
        startedAt: trace.startTime,
        metadata: isRecord(trace.metadata) ? trace.metadata : undefined,
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

function fromTranscriptToolCall(wire: unknown): ToolCall | undefined {
  if (!isRecord(wire)) {
    return undefined;
  }
  const tool = readOptionalString(wire, 'tool');
  if (!tool) {
    return undefined;
  }
  return {
    tool,
    input: wire.input,
    output: wire.output,
    id: readOptionalString(wire, 'id'),
    status:
      wire.status === 'ok' ||
      wire.status === 'error' ||
      wire.status === 'timeout' ||
      wire.status === 'cancelled' ||
      wire.status === 'unknown'
        ? wire.status
        : undefined,
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
      kind: line.source.kind,
      provider: line.source.provider,
      sessionId: line.source.session_id,
      path: line.source.path,
      format: line.source.format,
      startedAt: line.source.timestamp,
      model: line.source.model,
      gitBranch: line.source.git_branch,
      cwd: line.source.cwd,
      version: line.source.version,
      metadata: line.source.metadata,
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
