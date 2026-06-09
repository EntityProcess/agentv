/**
 * Trace models for evaluation-time agent behavior.
 *
 * This module has two layers:
 * - TraceSummary is the compact result artifact used by existing graders and CLI output.
 * - NormalizedTrajectory is the full, versioned trajectory contract that importers
 *   and future trajectory-aware graders can share.
 *
 * Keep TypeScript internals camelCase. Persisted trajectory artifacts use the
 * snake_case NormalizedTrajectoryWire shape and must pass through the converters
 * in this file.
 */
import { z } from 'zod';

export const NORMALIZED_TRAJECTORY_SCHEMA_VERSION = 'agentv.trace.v1' as const;

export const NORMALIZED_TRACE_SOURCE_KINDS = [
  'agentv_run',
  'otlp',
  'phoenix',
  'langfuse',
  'pi_session',
  'imported_transcript',
  'compact_transcript',
] as const;

export const NORMALIZED_TRACE_EVENT_TYPES = [
  'message',
  'model_turn',
  'tool_call',
  'tool_result',
] as const;

export const NORMALIZED_TOOL_STATUSES = ['ok', 'error', 'timeout', 'cancelled', 'unknown'] as const;

export const NORMALIZED_REDACTION_LEVELS = ['none', 'partial', 'full'] as const;

export type NormalizedTraceSourceKind = (typeof NORMALIZED_TRACE_SOURCE_KINDS)[number];
export type NormalizedTraceEventType = (typeof NORMALIZED_TRACE_EVENT_TYPES)[number];
export type NormalizedToolStatus = (typeof NORMALIZED_TOOL_STATUSES)[number];
export type NormalizedRedactionLevel = (typeof NORMALIZED_REDACTION_LEVELS)[number];

export interface NormalizedTraceSource {
  readonly kind: NormalizedTraceSourceKind;
  readonly path?: string;
  readonly url?: string;
  readonly provider?: string;
  readonly format?: string;
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceSession {
  readonly sessionId?: string;
  readonly conversationId?: string;
  readonly cwd?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceBranch {
  readonly selectedLeafId?: string;
  readonly selectedPathIds?: readonly string[];
  readonly includedEventIds?: readonly string[];
  readonly omittedEventIds?: readonly string[];
  readonly selectionReason?: string;
}

export interface NormalizedTraceSourceRef {
  readonly eventId?: string;
  readonly messageId?: string;
  readonly spanId?: string;
  readonly traceId?: string;
  readonly rawKind?: string;
  readonly path?: string;
  readonly line?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedRawEvidence {
  readonly kind: string;
  readonly ref?: string;
  readonly mediaType?: string;
  readonly content?: unknown;
  readonly redacted?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedRedactionState {
  readonly level: NormalizedRedactionLevel;
  readonly fields?: readonly string[];
  readonly reason?: string;
}

export interface NormalizedTraceError {
  readonly message: string;
  readonly name?: string;
  readonly code?: string;
  readonly stack?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceMessage {
  readonly role: string;
  readonly name?: string;
  readonly content?: unknown;
  readonly redaction?: NormalizedRedactionState;
  readonly tokenUsage?: TokenUsage;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceModel {
  readonly provider?: string;
  readonly name?: string;
  readonly invocationId?: string;
  readonly tokenUsage?: TokenUsage;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceTool {
  readonly name: string;
  readonly callId?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status?: NormalizedToolStatus;
  readonly error?: NormalizedTraceError;
  readonly redaction?: NormalizedRedactionState;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTraceEvent {
  readonly eventId: string;
  readonly parentEventId?: string;
  readonly ordinal: number;
  readonly type: NormalizedTraceEventType;
  readonly timestamp?: string;
  readonly durationMs?: number;
  readonly durationInferred?: boolean;
  readonly turnIndex?: number;
  readonly message?: NormalizedTraceMessage;
  readonly model?: NormalizedTraceModel;
  readonly tool?: NormalizedTraceTool;
  readonly sourceRef?: NormalizedTraceSourceRef;
  readonly rawEvidence?: readonly NormalizedRawEvidence[];
  readonly redaction?: NormalizedRedactionState;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedTrajectory {
  readonly schemaVersion: typeof NORMALIZED_TRAJECTORY_SCHEMA_VERSION;
  readonly source: NormalizedTraceSource;
  readonly session: NormalizedTraceSession;
  readonly branch?: NormalizedTraceBranch;
  readonly events: readonly NormalizedTraceEvent[];
  readonly tokenUsage?: TokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined),
  ) as T;
}

const MetadataWireSchema = z.record(z.string(), z.unknown());
const TokenUsageWireSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number().optional(),
  reasoning: z.number().optional(),
});

export const NormalizedRedactionStateWireSchema = z.object({
  level: z.enum(NORMALIZED_REDACTION_LEVELS),
  fields: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export const NormalizedTraceErrorWireSchema = z.object({
  message: z.string(),
  name: z.string().optional(),
  code: z.string().optional(),
  stack: z.string().optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceSourceWireSchema = z.object({
  kind: z.enum(NORMALIZED_TRACE_SOURCE_KINDS),
  path: z.string().optional(),
  url: z.string().optional(),
  provider: z.string().optional(),
  format: z.string().optional(),
  version: z.string().optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceSessionWireSchema = z.object({
  session_id: z.string().optional(),
  conversation_id: z.string().optional(),
  cwd: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceBranchWireSchema = z.object({
  selected_leaf_id: z.string().optional(),
  selected_path_ids: z.array(z.string()).optional(),
  included_event_ids: z.array(z.string()).optional(),
  omitted_event_ids: z.array(z.string()).optional(),
  selection_reason: z.string().optional(),
});

export const NormalizedTraceSourceRefWireSchema = z.object({
  event_id: z.string().optional(),
  message_id: z.string().optional(),
  span_id: z.string().optional(),
  trace_id: z.string().optional(),
  raw_kind: z.string().optional(),
  path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedRawEvidenceWireSchema = z.object({
  kind: z.string(),
  ref: z.string().optional(),
  media_type: z.string().optional(),
  content: z.unknown().optional(),
  redacted: z.boolean().optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceMessageWireSchema = z.object({
  role: z.string(),
  name: z.string().optional(),
  content: z.unknown().optional(),
  redaction: NormalizedRedactionStateWireSchema.optional(),
  token_usage: TokenUsageWireSchema.optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceModelWireSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  invocation_id: z.string().optional(),
  token_usage: TokenUsageWireSchema.optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceToolWireSchema = z.object({
  name: z.string(),
  call_id: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(NORMALIZED_TOOL_STATUSES).optional(),
  error: NormalizedTraceErrorWireSchema.optional(),
  redaction: NormalizedRedactionStateWireSchema.optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTraceEventWireSchema = z.object({
  event_id: z.string(),
  parent_event_id: z.string().optional(),
  ordinal: z.number().int().nonnegative(),
  type: z.enum(NORMALIZED_TRACE_EVENT_TYPES),
  timestamp: z.string().optional(),
  duration_ms: z.number().nonnegative().optional(),
  duration_inferred: z.boolean().optional(),
  turn_index: z.number().int().nonnegative().optional(),
  message: NormalizedTraceMessageWireSchema.optional(),
  model: NormalizedTraceModelWireSchema.optional(),
  tool: NormalizedTraceToolWireSchema.optional(),
  source_ref: NormalizedTraceSourceRefWireSchema.optional(),
  raw_evidence: z.array(NormalizedRawEvidenceWireSchema).optional(),
  redaction: NormalizedRedactionStateWireSchema.optional(),
  metadata: MetadataWireSchema.optional(),
});

export const NormalizedTrajectoryWireSchema = z.object({
  schema_version: z.literal(NORMALIZED_TRAJECTORY_SCHEMA_VERSION),
  source: NormalizedTraceSourceWireSchema,
  session: NormalizedTraceSessionWireSchema,
  branch: NormalizedTraceBranchWireSchema.optional(),
  events: z.array(NormalizedTraceEventWireSchema),
  token_usage: TokenUsageWireSchema.optional(),
  cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  metadata: MetadataWireSchema.optional(),
});

export type NormalizedTrajectoryWire = z.infer<typeof NormalizedTrajectoryWireSchema>;
export type NormalizedTraceEventWire = z.infer<typeof NormalizedTraceEventWireSchema>;

export function toNormalizedTrajectoryWire(
  trajectory: NormalizedTrajectory,
): NormalizedTrajectoryWire {
  return NormalizedTrajectoryWireSchema.parse(
    omitUndefinedProperties({
      schema_version: trajectory.schemaVersion,
      source: toNormalizedTraceSourceWire(trajectory.source),
      session: toNormalizedTraceSessionWire(trajectory.session),
      branch: trajectory.branch ? toNormalizedTraceBranchWire(trajectory.branch) : undefined,
      events: trajectory.events.map(toNormalizedTraceEventWire),
      token_usage: trajectory.tokenUsage,
      cost_usd: trajectory.costUsd,
      duration_ms: trajectory.durationMs,
      started_at: trajectory.startedAt,
      ended_at: trajectory.endedAt,
      metadata: trajectory.metadata,
    }),
  );
}

export function fromNormalizedTrajectoryWire(input: unknown): NormalizedTrajectory {
  const wire = NormalizedTrajectoryWireSchema.parse(input);

  return {
    schemaVersion: wire.schema_version,
    source: fromNormalizedTraceSourceWire(wire.source),
    session: fromNormalizedTraceSessionWire(wire.session),
    branch: wire.branch ? fromNormalizedTraceBranchWire(wire.branch) : undefined,
    events: wire.events.map(fromNormalizedTraceEventWire),
    tokenUsage: wire.token_usage,
    costUsd: wire.cost_usd,
    durationMs: wire.duration_ms,
    startedAt: wire.started_at,
    endedAt: wire.ended_at,
    metadata: wire.metadata,
  };
}

function toNormalizedTraceSourceWire(source: NormalizedTraceSource) {
  return omitUndefinedProperties({
    kind: source.kind,
    path: source.path,
    url: source.url,
    provider: source.provider,
    format: source.format,
    version: source.version,
    metadata: source.metadata,
  });
}

function fromNormalizedTraceSourceWire(
  source: z.infer<typeof NormalizedTraceSourceWireSchema>,
): NormalizedTraceSource {
  return {
    kind: source.kind,
    path: source.path,
    url: source.url,
    provider: source.provider,
    format: source.format,
    version: source.version,
    metadata: source.metadata,
  };
}

function toNormalizedTraceSessionWire(session: NormalizedTraceSession) {
  return omitUndefinedProperties({
    session_id: session.sessionId,
    conversation_id: session.conversationId,
    cwd: session.cwd,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    metadata: session.metadata,
  });
}

function fromNormalizedTraceSessionWire(
  session: z.infer<typeof NormalizedTraceSessionWireSchema>,
): NormalizedTraceSession {
  return {
    sessionId: session.session_id,
    conversationId: session.conversation_id,
    cwd: session.cwd,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    metadata: session.metadata,
  };
}

function toNormalizedTraceBranchWire(branch: NormalizedTraceBranch) {
  return omitUndefinedProperties({
    selected_leaf_id: branch.selectedLeafId,
    selected_path_ids: branch.selectedPathIds,
    included_event_ids: branch.includedEventIds,
    omitted_event_ids: branch.omittedEventIds,
    selection_reason: branch.selectionReason,
  });
}

function fromNormalizedTraceBranchWire(
  branch: z.infer<typeof NormalizedTraceBranchWireSchema>,
): NormalizedTraceBranch {
  return {
    selectedLeafId: branch.selected_leaf_id,
    selectedPathIds: branch.selected_path_ids,
    includedEventIds: branch.included_event_ids,
    omittedEventIds: branch.omitted_event_ids,
    selectionReason: branch.selection_reason,
  };
}

function toNormalizedTraceEventWire(event: NormalizedTraceEvent): NormalizedTraceEventWire {
  return NormalizedTraceEventWireSchema.parse(
    omitUndefinedProperties({
      event_id: event.eventId,
      parent_event_id: event.parentEventId,
      ordinal: event.ordinal,
      type: event.type,
      timestamp: event.timestamp,
      duration_ms: event.durationMs,
      duration_inferred: event.durationInferred,
      turn_index: event.turnIndex,
      message: event.message ? toNormalizedTraceMessageWire(event.message) : undefined,
      model: event.model ? toNormalizedTraceModelWire(event.model) : undefined,
      tool: event.tool ? toNormalizedTraceToolWire(event.tool) : undefined,
      source_ref: event.sourceRef ? toNormalizedTraceSourceRefWire(event.sourceRef) : undefined,
      raw_evidence: event.rawEvidence?.map(toNormalizedRawEvidenceWire),
      redaction: event.redaction,
      metadata: event.metadata,
    }),
  );
}

function fromNormalizedTraceEventWire(event: NormalizedTraceEventWire): NormalizedTraceEvent {
  return {
    eventId: event.event_id,
    parentEventId: event.parent_event_id,
    ordinal: event.ordinal,
    type: event.type,
    timestamp: event.timestamp,
    durationMs: event.duration_ms,
    durationInferred: event.duration_inferred,
    turnIndex: event.turn_index,
    message: event.message ? fromNormalizedTraceMessageWire(event.message) : undefined,
    model: event.model ? fromNormalizedTraceModelWire(event.model) : undefined,
    tool: event.tool ? fromNormalizedTraceToolWire(event.tool) : undefined,
    sourceRef: event.source_ref ? fromNormalizedTraceSourceRefWire(event.source_ref) : undefined,
    rawEvidence: event.raw_evidence?.map(fromNormalizedRawEvidenceWire),
    redaction: event.redaction,
    metadata: event.metadata,
  };
}

function toNormalizedTraceMessageWire(message: NormalizedTraceMessage) {
  return omitUndefinedProperties({
    role: message.role,
    name: message.name,
    content: message.content,
    redaction: message.redaction,
    token_usage: message.tokenUsage,
    metadata: message.metadata,
  });
}

function fromNormalizedTraceMessageWire(
  message: z.infer<typeof NormalizedTraceMessageWireSchema>,
): NormalizedTraceMessage {
  return {
    role: message.role,
    name: message.name,
    content: message.content,
    redaction: message.redaction,
    tokenUsage: message.token_usage,
    metadata: message.metadata,
  };
}

function toNormalizedTraceModelWire(model: NormalizedTraceModel) {
  return omitUndefinedProperties({
    provider: model.provider,
    name: model.name,
    invocation_id: model.invocationId,
    token_usage: model.tokenUsage,
    metadata: model.metadata,
  });
}

function fromNormalizedTraceModelWire(
  model: z.infer<typeof NormalizedTraceModelWireSchema>,
): NormalizedTraceModel {
  return {
    provider: model.provider,
    name: model.name,
    invocationId: model.invocation_id,
    tokenUsage: model.token_usage,
    metadata: model.metadata,
  };
}

function toNormalizedTraceToolWire(tool: NormalizedTraceTool) {
  return omitUndefinedProperties({
    name: tool.name,
    call_id: tool.callId,
    input: tool.input,
    output: tool.output,
    status: tool.status,
    error: tool.error,
    redaction: tool.redaction,
    metadata: tool.metadata,
  });
}

function fromNormalizedTraceToolWire(
  tool: z.infer<typeof NormalizedTraceToolWireSchema>,
): NormalizedTraceTool {
  return {
    name: tool.name,
    callId: tool.call_id,
    input: tool.input,
    output: tool.output,
    status: tool.status,
    error: tool.error,
    redaction: tool.redaction,
    metadata: tool.metadata,
  };
}

function toNormalizedTraceSourceRefWire(sourceRef: NormalizedTraceSourceRef) {
  return omitUndefinedProperties({
    event_id: sourceRef.eventId,
    message_id: sourceRef.messageId,
    span_id: sourceRef.spanId,
    trace_id: sourceRef.traceId,
    raw_kind: sourceRef.rawKind,
    path: sourceRef.path,
    line: sourceRef.line,
    metadata: sourceRef.metadata,
  });
}

function fromNormalizedTraceSourceRefWire(
  sourceRef: z.infer<typeof NormalizedTraceSourceRefWireSchema>,
): NormalizedTraceSourceRef {
  return {
    eventId: sourceRef.event_id,
    messageId: sourceRef.message_id,
    spanId: sourceRef.span_id,
    traceId: sourceRef.trace_id,
    rawKind: sourceRef.raw_kind,
    path: sourceRef.path,
    line: sourceRef.line,
    metadata: sourceRef.metadata,
  };
}

function toNormalizedRawEvidenceWire(evidence: NormalizedRawEvidence) {
  return omitUndefinedProperties({
    kind: evidence.kind,
    ref: evidence.ref,
    media_type: evidence.mediaType,
    content: evidence.content,
    redacted: evidence.redacted,
    metadata: evidence.metadata,
  });
}

function fromNormalizedRawEvidenceWire(
  evidence: z.infer<typeof NormalizedRawEvidenceWireSchema>,
): NormalizedRawEvidence {
  return {
    kind: evidence.kind,
    ref: evidence.ref,
    mediaType: evidence.media_type,
    content: evidence.content,
    redacted: evidence.redacted,
    metadata: evidence.metadata,
  };
}

/**
 * Token usage metrics from provider execution.
 */
export interface TokenUsage {
  /** Input/prompt tokens consumed */
  readonly input: number;
  /** Output/completion tokens generated */
  readonly output: number;
  /** Cached tokens (optional, provider-specific) */
  readonly cached?: number;
  /** Reasoning/thinking tokens (optional, provider-specific) */
  readonly reasoning?: number;
}

/**
 * Compact summary of a trace for lightweight persistence.
 * Included in results by default to avoid payload bloat.
 */
export interface TraceSummary {
  /** Total number of events in trace */
  readonly eventCount: number;
  /** Map of tool name to call count */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** Number of error events */
  readonly errorCount: number;
  /** Per-tool duration arrays in milliseconds (optional) */
  readonly toolDurations?: Readonly<Record<string, readonly number[]>>;
  /** Number of LLM calls (assistant messages) */
  readonly llmCallCount?: number;
}

/**
 * Combined result of trace computation + execution metrics merge.
 * Returned by computeTraceSummaryWithMetrics().
 */
export interface TraceComputeResult {
  readonly trace: TraceSummary;
  readonly tokenUsage?: TokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly startTime?: string;
  readonly endTime?: string;
}

/**
 * Argument matching mode for tool-trajectory expected items.
 * - 'exact': bidirectional deep equality, no extra keys allowed (default)
 * - 'superset': actual args must contain all expected keys (extras OK)
 * - 'subset': actual args must be a subset of expected keys (no unexpected keys)
 * - 'ignore': skip argument checking entirely
 */
export type ArgsMatchMode = 'exact' | 'ignore' | 'subset' | 'superset';

/**
 * Configuration for tool-trajectory evaluator.
 */
export interface ToolTrajectoryGraderConfig {
  readonly name: string;
  readonly type: 'tool-trajectory';
  /** Matching mode */
  readonly mode: 'any_order' | 'in_order' | 'exact' | 'subset' | 'superset';
  /** Minimum call counts per tool (for any_order mode) */
  readonly minimums?: Readonly<Record<string, number>>;
  /** Expected tool sequence (for in_order/exact/subset/superset modes) */
  readonly expected?: readonly ToolTrajectoryExpectedItem[];
  /** Optional weight for top-level aggregation (defaults to 1.0) */
  readonly weight?: number;
  readonly required?: boolean | number;
  /** Minimum score (0-1) for this evaluator to pass. Independent of `required` gate. */
  readonly min_score?: number;
  /** When true, inverts the grader score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
  /** Default argument matching mode for all expected items (defaults to 'exact') */
  readonly argsMatch?: ArgsMatchMode | readonly string[];
}

/**
 * Expected tool call item in a trajectory sequence.
 */
export interface ToolTrajectoryExpectedItem {
  readonly tool: string;
  /** Optional argument matching: 'any' skips validation, object performs partial deep equality */
  readonly args?: 'any' | Record<string, unknown>;
  /** Optional maximum duration in milliseconds for latency assertions */
  readonly maxDurationMs?: number;
  /** Per-item argument matching mode override (takes precedence over evaluator-level argsMatch) */
  readonly argsMatch?: ArgsMatchMode | readonly string[];
}

/**
 * Simplified input type for computeTraceSummary.
 * Matches Message structure without requiring full provider/types import.
 */
interface MessageLike {
  readonly role?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly toolCalls?: readonly {
    readonly tool: string;
    readonly startTime?: string;
    readonly endTime?: string;
    readonly durationMs?: number;
  }[];
}

/**
 * Compute a lightweight summary from output messages.
 * Used for default result persistence without payload bloat.
 *
 * Derives timing information from span boundaries:
 * - startTime: earliest startTime across all messages and tool calls
 * - endTime: latest endTime across all messages and tool calls
 * - toolDurations: per-tool duration arrays (from durationMs or computed from start/end)
 * - llmCallCount: count of assistant messages
 */
export function computeTraceSummary(messages: readonly MessageLike[]): TraceComputeResult {
  const toolCallCounts: Record<string, number> = {};
  const toolDurations: Record<string, number[]> = {};
  let totalToolCalls = 0;
  let llmCallCount = 0;
  let earliestStart: Date | undefined;
  let latestEnd: Date | undefined;
  let hasAnyDuration = false;

  for (const message of messages) {
    // Count assistant messages as LLM calls
    if (message.role === 'assistant') {
      llmCallCount++;
    }

    // Track message timing boundaries
    if (message.startTime) {
      const startDate = new Date(message.startTime);
      if (!earliestStart || startDate < earliestStart) {
        earliestStart = startDate;
      }
    }
    if (message.endTime) {
      const endDate = new Date(message.endTime);
      if (!latestEnd || endDate > latestEnd) {
        latestEnd = endDate;
      }
    }

    if (!message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      toolCallCounts[toolCall.tool] = (toolCallCounts[toolCall.tool] ?? 0) + 1;
      totalToolCalls++;

      // Track tool call timing boundaries
      if (toolCall.startTime) {
        const startDate = new Date(toolCall.startTime);
        if (!earliestStart || startDate < earliestStart) {
          earliestStart = startDate;
        }
      }
      if (toolCall.endTime) {
        const endDate = new Date(toolCall.endTime);
        if (!latestEnd || endDate > latestEnd) {
          latestEnd = endDate;
        }
      }

      // Compute tool duration
      let duration: number | undefined = toolCall.durationMs;
      if (duration === undefined && toolCall.startTime && toolCall.endTime) {
        const start = new Date(toolCall.startTime).getTime();
        const end = new Date(toolCall.endTime).getTime();
        duration = end - start;
      }

      if (duration !== undefined) {
        hasAnyDuration = true;
        if (!toolDurations[toolCall.tool]) {
          toolDurations[toolCall.tool] = [];
        }
        toolDurations[toolCall.tool].push(duration);
      }
    }
  }

  return {
    trace: {
      eventCount: totalToolCalls,
      toolCalls: toolCallCounts,
      errorCount: 0,
      llmCallCount,
      ...(hasAnyDuration ? { toolDurations } : {}),
    },
    startTime: earliestStart?.toISOString(),
    endTime: latestEnd?.toISOString(),
  };
}

/**
 * Return the trajectory events selected for grading.
 *
 * Importers should already store the selected branch path in `events`. When a
 * source also carries explicit `branch.includedEventIds`, honor it here so
 * branchable transcripts cannot accidentally grade omitted alternatives.
 */
export function getSelectedTrajectoryEvents(
  trajectory: NormalizedTrajectory,
): readonly NormalizedTraceEvent[] {
  if (!trajectory.branch?.includedEventIds || trajectory.branch.includedEventIds.length === 0) {
    return trajectory.events;
  }

  const includedIds = new Set(trajectory.branch.includedEventIds);
  return trajectory.events.filter((event) => includedIds.has(event.eventId));
}

/**
 * Derive the existing compact TraceSummary shape from a full trajectory.
 *
 * The summary keeps the current lightweight contract: eventCount is the number
 * of tool-call events, toolCalls is counted by tool name, toolDurations carries
 * per-tool milliseconds when present, and llmCallCount counts model turns.
 */
export function computeTraceSummaryFromTrajectory(
  trajectory: NormalizedTrajectory,
): TraceComputeResult {
  const selectedEvents = getSelectedTrajectoryEvents(trajectory);
  const hasModelTurnEvents = selectedEvents.some((event) => event.type === 'model_turn');
  const toolCallCounts: Record<string, number> = {};
  const toolDurations: Record<string, number[]> = {};
  let totalToolCalls = 0;
  let errorCount = 0;
  let llmCallCount = 0;
  let earliestStart: Date | undefined;
  let latestEnd: Date | undefined;
  let hasAnyDuration = false;

  for (const event of selectedEvents) {
    if (
      event.type === 'model_turn' ||
      (!hasModelTurnEvents && event.type === 'message' && event.message?.role === 'assistant')
    ) {
      llmCallCount++;
    }

    const eventStart = parseTimestamp(event.timestamp);
    if (eventStart && (!earliestStart || eventStart < earliestStart)) {
      earliestStart = eventStart;
    }

    const eventEnd = deriveEventEnd(eventStart, event.durationMs);
    if (eventEnd && (!latestEnd || eventEnd > latestEnd)) {
      latestEnd = eventEnd;
    }

    if (event.type !== 'tool_call' || !event.tool) {
      continue;
    }

    toolCallCounts[event.tool.name] = (toolCallCounts[event.tool.name] ?? 0) + 1;
    totalToolCalls++;

    if (isErrorToolEvent(event)) {
      errorCount++;
    }

    if (event.durationMs !== undefined) {
      hasAnyDuration = true;
      if (!toolDurations[event.tool.name]) {
        toolDurations[event.tool.name] = [];
      }
      toolDurations[event.tool.name].push(event.durationMs);
    }
  }

  return {
    trace: {
      eventCount: totalToolCalls,
      toolCalls: toolCallCounts,
      errorCount,
      llmCallCount,
      ...(hasAnyDuration ? { toolDurations } : {}),
    },
    tokenUsage: trajectory.tokenUsage,
    costUsd: trajectory.costUsd,
    durationMs: trajectory.durationMs,
    startTime: trajectory.startedAt ?? earliestStart?.toISOString(),
    endTime: trajectory.endedAt ?? latestEnd?.toISOString(),
  };
}

function parseTimestamp(timestamp: string | undefined): Date | undefined {
  if (!timestamp) return undefined;
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function deriveEventEnd(start: Date | undefined, durationMs: number | undefined): Date | undefined {
  if (!start) return undefined;
  if (durationMs === undefined) return start;
  return new Date(start.getTime() + durationMs);
}

function isErrorToolEvent(event: NormalizedTraceEvent): boolean {
  return Boolean(
    event.tool?.error ||
      event.tool?.status === 'error' ||
      event.tool?.status === 'timeout' ||
      event.tool?.status === 'cancelled',
  );
}

/**
 * Default tool names considered as exploration/read-only operations.
 * Can be overridden per-evaluation via config.
 */
export const DEFAULT_EXPLORATION_TOOLS = [
  'read',
  'grep',
  'glob',
  'search',
  'list',
  'Read',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
] as const;

/**
 * Ratio of exploration tool calls to total tool calls.
 * Returns undefined if there are no tool calls.
 *
 * @param summary - Trace summary with tool call counts
 * @param explorationTools - Tool names considered exploration (defaults to DEFAULT_EXPLORATION_TOOLS)
 * @returns Ratio between 0 and 1, or undefined if no tool calls
 */
export function explorationRatio(
  summary: TraceSummary,
  explorationTools: readonly string[] = DEFAULT_EXPLORATION_TOOLS,
): number | undefined {
  if (summary.eventCount === 0) return undefined;

  const explorationCalls = explorationTools.reduce(
    (sum, tool) => sum + (summary.toolCalls[tool] ?? 0),
    0,
  );

  return explorationCalls / summary.eventCount;
}

/**
 * Average tokens consumed per tool call.
 * Returns undefined if tokenUsage is not available or no tool calls.
 *
 * @param summary - Trace summary with optional token usage
 * @returns Average tokens per tool call, or undefined
 */
export function tokensPerTool(summary: TraceSummary, tokenUsage?: TokenUsage): number | undefined {
  if (!tokenUsage || summary.eventCount === 0) return undefined;

  const totalTokens = tokenUsage.input + tokenUsage.output;
  return totalTokens / summary.eventCount;
}

/**
 * Average tool duration across all tool calls.
 * Returns undefined if toolDurations is not available or empty.
 *
 * @param summary - Trace summary with optional tool durations
 * @returns Average duration in milliseconds, or undefined
 */
export function avgToolDurationMs(summary: TraceSummary): number | undefined {
  if (!summary.toolDurations) return undefined;

  let totalDuration = 0;
  let totalCalls = 0;

  for (const durations of Object.values(summary.toolDurations)) {
    for (const duration of durations) {
      totalDuration += duration;
      totalCalls++;
    }
  }

  if (totalCalls === 0) return undefined;
  return totalDuration / totalCalls;
}

/**
 * Execution metrics from provider response.
 */
export interface ExecutionMetrics {
  readonly tokenUsage?: TokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
  /** ISO 8601 timestamp when execution started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended */
  readonly endTime?: string;
}

/**
 * Merge execution metrics from provider response into a trace compute result.
 * Returns a new TraceComputeResult with metrics fields populated.
 * Provider-level timing takes precedence over span-derived timing.
 *
 * @param computed - Base trace compute result from computeTraceSummary
 * @param metrics - Optional execution metrics from provider
 * @returns TraceComputeResult with merged metrics
 */
export function mergeExecutionMetrics(
  computed: TraceComputeResult,
  metrics?: ExecutionMetrics,
): TraceComputeResult {
  if (!metrics) return computed;

  return {
    trace: computed.trace,
    tokenUsage: metrics.tokenUsage,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    startTime: metrics.startTime ?? computed.startTime,
    endTime: metrics.endTime ?? computed.endTime,
  };
}
