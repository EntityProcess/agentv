/**
 * AgentV execution trace v1: AgentV-owned metadata around an OTel/OpenInference span graph.
 *
 * The `agentv.execution_trace.v1` artifact is the canonical full trace sidecar
 * for eval artifacts. AgentV owns the outer structure, eval/replay identity,
 * capture policy, warnings, artifact pointers, and score provenance. The trace
 * body is a standards-shaped span graph, so attribute keys such as
 * `gen_ai.operation.name` and `openinference.span.kind` are copied exactly and
 * never case-converted.
 *
 * Derived views such as Provider `Message[]`, `outputs/transcript.jsonl`,
 * `TraceSummary`, compact tool trajectories, replay provider responses, and
 * OTLP JSON export bodies must project from this artifact. Transcript JSONL
 * uses AgentV transcript events on the root span so compatibility rows can
 * include input/system turns without changing replay's assistant-only view.
 * Do not introduce a second canonical graph for those compatibility/read
 * models.
 *
 * To extend the wire shape, add snake_case fields to the focused Zod schema,
 * convert them explicitly in the matching to/from helper, and keep opaque maps
 * (`attributes`, `metadata`, `details`, `evidence`) as direct pass-throughs.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Message, ToolCall } from './providers/types.js';
import {
  NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
  type TokenUsage,
  type TraceArtifact,
  type TraceComputeResult,
  type TraceEvent,
  type TraceSourceKind,
  type TraceSummary,
} from './trace.js';
import type { EvaluationResult, EvaluationVerdict, GraderKind } from './types.js';

export const EXECUTION_TRACE_SCHEMA_VERSION = 'agentv.execution_trace.v1' as const;

const TRACE_ENVELOPE_FORMAT = 'otlp_openinference_spans' as const;
const TRANSCRIPT_MESSAGE_EVENT_NAME = 'agentv.transcript.message' as const;

const CAPTURE_CONTENT_VALUES = ['none', 'metadata', 'full'] as const;
const REDACTION_LEVEL_VALUES = ['none', 'partial', 'full'] as const;
const WARNING_SEVERITY_VALUES = ['info', 'warning', 'error'] as const;
const SPAN_STATUS_CODE_VALUES = ['UNSET', 'OK', 'ERROR'] as const;

type CaptureContent = (typeof CAPTURE_CONTENT_VALUES)[number];
type RedactionLevel = (typeof REDACTION_LEVEL_VALUES)[number];
type WarningSeverity = (typeof WARNING_SEVERITY_VALUES)[number];
type SpanStatusCode = (typeof SPAN_STATUS_CODE_VALUES)[number];

export interface TraceEnvelopeEval {
  readonly evalId?: string;
  readonly evalPath?: string;
  readonly suite?: string;
  readonly testId: string;
  readonly target: string;
  readonly sourceTarget?: string;
  readonly attempt?: number;
  readonly variant?: string | null;
  readonly runId?: string;
  readonly category?: string;
  readonly experiment?: string;
}

export interface TraceEnvelopeReplay {
  readonly lookupKey?: Readonly<Record<string, unknown>>;
  readonly fixtureId?: string;
  readonly sourceFixturePath?: string;
}

export interface TraceEnvelopeSpanStatus {
  readonly code: SpanStatusCode;
  readonly message?: string;
}

export interface TraceEnvelopeSpanEvent {
  readonly name: string;
  readonly timeUnixNano?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelopeSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | null;
  readonly name: string;
  readonly kind: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly status: TraceEnvelopeSpanStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events?: readonly TraceEnvelopeSpanEvent[];
}

export interface TraceEnvelopeBody {
  readonly format: typeof TRACE_ENVELOPE_FORMAT;
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly resource?: {
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
  readonly scope?: {
    readonly name?: string;
    readonly version?: string;
  };
  readonly spans: readonly TraceEnvelopeSpan[];
}

export interface TraceEnvelopeSource {
  readonly kind: string;
  readonly path?: string;
  readonly provider?: string;
  readonly format?: string;
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelopeCapture {
  readonly content: CaptureContent;
  readonly redactionLevel: RedactionLevel;
  readonly redactedFields?: readonly string[];
  readonly policy?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelopeSourceRef {
  readonly eventId?: string;
  readonly messageId?: string;
  readonly spanId?: string;
  readonly traceId?: string;
  readonly rawKind?: string;
  readonly path?: string;
  readonly line?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelopeConversionWarning {
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly spanId?: string;
  readonly sourceRef?: TraceEnvelopeSourceRef;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelopeScore {
  readonly name: string;
  readonly type: GraderKind | string;
  readonly score: number;
  readonly weight?: number;
  readonly verdict?: EvaluationVerdict;
  readonly source?: string;
  readonly evaluatedAt?: string;
  readonly targetSpanId?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface TraceEnvelope {
  readonly schemaVersion: typeof EXECUTION_TRACE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly createdAt: string;
  readonly eval: TraceEnvelopeEval;
  readonly replay?: TraceEnvelopeReplay;
  readonly trace: TraceEnvelopeBody;
  readonly source: TraceEnvelopeSource;
  readonly capture: TraceEnvelopeCapture;
  readonly conversionWarnings?: readonly TraceEnvelopeConversionWarning[];
  readonly artifacts?: Readonly<Record<string, string>>;
  readonly scores?: readonly TraceEnvelopeScore[];
}

const AttributeMapWireSchema = z.record(z.string(), z.unknown());

export const TraceEnvelopeEvalWireSchema = z
  .object({
    eval_id: z.string().optional(),
    eval_path: z.string().optional(),
    suite: z.string().optional(),
    test_id: z.string(),
    target: z.string(),
    source_target: z.string().optional(),
    attempt: z.number().int().nonnegative().optional(),
    variant: z.string().nullable().optional(),
    run_id: z.string().optional(),
    category: z.string().optional(),
    experiment: z.string().optional(),
  })
  .strict();

export const TraceEnvelopeReplayWireSchema = z
  .object({
    lookup_key: z.record(z.string(), z.unknown()).optional(),
    fixture_id: z.string().optional(),
    source_fixture_path: z.string().optional(),
  })
  .strict();

export const TraceEnvelopeSpanStatusWireSchema = z
  .object({
    code: z.enum(SPAN_STATUS_CODE_VALUES),
    message: z.string().optional(),
  })
  .strict();

export const TraceEnvelopeSpanEventWireSchema = z
  .object({
    name: z.string(),
    time_unix_nano: z.string().optional(),
    attributes: AttributeMapWireSchema.optional(),
  })
  .strict();

export const TraceEnvelopeSpanWireSchema = z
  .object({
    trace_id: z.string(),
    span_id: z.string(),
    parent_span_id: z.string().nullable().optional(),
    name: z.string(),
    kind: z.string(),
    start_time_unix_nano: z.string(),
    end_time_unix_nano: z.string(),
    status: TraceEnvelopeSpanStatusWireSchema,
    attributes: AttributeMapWireSchema,
    events: z.array(TraceEnvelopeSpanEventWireSchema).optional(),
  })
  .strict();

export const TraceEnvelopeBodyWireSchema = z
  .object({
    format: z.literal(TRACE_ENVELOPE_FORMAT),
    trace_id: z.string(),
    root_span_id: z.string(),
    resource: z
      .object({
        attributes: AttributeMapWireSchema.optional(),
      })
      .strict()
      .optional(),
    scope: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
      })
      .strict()
      .optional(),
    spans: z.array(TraceEnvelopeSpanWireSchema),
  })
  .strict();

export const TraceEnvelopeSourceWireSchema = z
  .object({
    kind: z.string(),
    path: z.string().optional(),
    provider: z.string().optional(),
    format: z.string().optional(),
    version: z.string().optional(),
    metadata: AttributeMapWireSchema.optional(),
  })
  .strict();

export const TraceEnvelopeCaptureWireSchema = z
  .object({
    content: z.enum(CAPTURE_CONTENT_VALUES),
    redaction_level: z.enum(REDACTION_LEVEL_VALUES),
    redacted_fields: z.array(z.string()).optional(),
    policy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const TraceEnvelopeSourceRefWireSchema = z
  .object({
    event_id: z.string().optional(),
    message_id: z.string().optional(),
    span_id: z.string().optional(),
    trace_id: z.string().optional(),
    raw_kind: z.string().optional(),
    path: z.string().optional(),
    line: z.number().int().nonnegative().optional(),
    metadata: AttributeMapWireSchema.optional(),
  })
  .strict();

export const TraceEnvelopeConversionWarningWireSchema = z
  .object({
    code: z.string(),
    severity: z.enum(WARNING_SEVERITY_VALUES),
    span_id: z.string().optional(),
    source_ref: TraceEnvelopeSourceRefWireSchema.optional(),
    message: z.string(),
    details: AttributeMapWireSchema.optional(),
  })
  .strict();

export const TraceEnvelopeScoreWireSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    score: z.number(),
    weight: z.number().optional(),
    verdict: z.string().optional(),
    source: z.string().optional(),
    evaluated_at: z.string().optional(),
    target_span_id: z.string().optional(),
    evidence: AttributeMapWireSchema.optional(),
  })
  .strict();

export const TraceEnvelopeWireSchema = z
  .object({
    schema_version: z.literal(EXECUTION_TRACE_SCHEMA_VERSION),
    artifact_id: z.string(),
    created_at: z.string(),
    eval: TraceEnvelopeEvalWireSchema,
    replay: TraceEnvelopeReplayWireSchema.optional(),
    trace: TraceEnvelopeBodyWireSchema,
    source: TraceEnvelopeSourceWireSchema,
    capture: TraceEnvelopeCaptureWireSchema,
    conversion_warnings: z.array(TraceEnvelopeConversionWarningWireSchema).optional(),
    artifacts: z.record(z.string(), z.string()).optional(),
    scores: z.array(TraceEnvelopeScoreWireSchema).optional(),
  })
  .strict();

export type TraceEnvelopeWire = z.infer<typeof TraceEnvelopeWireSchema>;
export type TraceEnvelopeEvalWire = z.infer<typeof TraceEnvelopeEvalWireSchema>;
export type TraceEnvelopeReplayWire = z.infer<typeof TraceEnvelopeReplayWireSchema>;
export type TraceEnvelopeBodyWire = z.infer<typeof TraceEnvelopeBodyWireSchema>;
export type TraceEnvelopeSpanWire = z.infer<typeof TraceEnvelopeSpanWireSchema>;
export type TraceEnvelopeSourceWire = z.infer<typeof TraceEnvelopeSourceWireSchema>;
export type TraceEnvelopeCaptureWire = z.infer<typeof TraceEnvelopeCaptureWireSchema>;
export type TraceEnvelopeConversionWarningWire = z.infer<
  typeof TraceEnvelopeConversionWarningWireSchema
>;
export type TraceEnvelopeScoreWire = z.infer<typeof TraceEnvelopeScoreWireSchema>;

export interface BuildTraceEnvelopeOptions {
  readonly evalId?: string;
  readonly evalPath?: string;
  readonly sourceTarget?: string;
  readonly attempt?: number;
  readonly variant?: string | null;
  readonly runId?: string;
  readonly experiment?: string;
  readonly source?: Partial<TraceEnvelopeSource>;
  readonly replay?: TraceEnvelopeReplay;
  readonly capture?: Partial<TraceEnvelopeCapture>;
  readonly artifacts?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}

export interface TraceEnvelopeToolTrajectoryItem {
  readonly position: number;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly ancestorSpanIds: readonly string[];
  readonly tool: string;
  readonly toolCallId: string;
  readonly parentToolCallId?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status: 'ok' | 'error';
  readonly startTime?: string;
  readonly endTime?: string;
  readonly durationMs?: number;
}

export interface TraceEnvelopeToolTrajectoryView {
  readonly schemaVersion: typeof EXECUTION_TRACE_SCHEMA_VERSION;
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly tools: readonly TraceEnvelopeToolTrajectoryItem[];
}

export interface TraceEnvelopeOtlpJson {
  readonly resourceSpans: readonly {
    readonly resource: {
      readonly attributes: readonly TraceEnvelopeOtlpAttribute[];
    };
    readonly scopeSpans: readonly {
      readonly scope: {
        readonly name?: string;
        readonly version?: string;
      };
      readonly spans: readonly TraceEnvelopeOtlpSpan[];
    }[];
  }[];
}

export interface TraceEnvelopeOtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly TraceEnvelopeOtlpAttribute[];
  readonly status: TraceEnvelopeOtlpSpanStatus;
  readonly events?: readonly {
    readonly name: string;
    readonly timeUnixNano?: string;
    readonly attributes: readonly TraceEnvelopeOtlpAttribute[];
  }[];
}

export interface TraceEnvelopeOtlpSpanStatus {
  readonly code: number;
  readonly message?: string;
}

export interface TraceEnvelopeOtlpAttribute {
  readonly key: string;
  readonly value: TraceEnvelopeOtlpAnyValue;
}

export type TraceEnvelopeOtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly intValue: number }
  | { readonly doubleValue: number }
  | { readonly boolValue: boolean }
  | { readonly arrayValue: { readonly values: readonly TraceEnvelopeOtlpAnyValue[] } };

interface TraceEnvelopeTranscriptToolCallWire {
  readonly tool: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly id?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
}

interface TraceEnvelopeTranscriptMessageWire {
  readonly role: string;
  readonly name?: string;
  readonly content?: Message['content'];
  readonly tool_calls?: readonly TraceEnvelopeTranscriptToolCallWire[];
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration_ms?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly token_usage?: TokenUsage;
}

interface TraceEnvelopeMessageEntry {
  readonly index: number;
  readonly timeUnixNano?: string;
  readonly message: Message;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function definedStringRecord(
  value: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function hashHex(parts: readonly unknown[], length: number): string {
  const stable = parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join('\0');
  return createHash('sha256').update(stable).digest('hex').slice(0, length);
}

function parseTimeMs(timestamp: string | undefined): number | undefined {
  if (!timestamp) {
    return undefined;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function msToUnixNano(ms: number): string {
  return String(BigInt(Math.round(ms)) * 1_000_000n);
}

function compareUnixNanoStrings(first: string, second: string): number {
  try {
    const left = BigInt(first);
    const right = BigInt(second);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return first.localeCompare(second);
  }
}

function compareSpanTime(first: TraceEnvelopeSpan, second: TraceEnvelopeSpan): number {
  const byStart = compareUnixNanoStrings(first.startTimeUnixNano, second.startTimeUnixNano);
  if (byStart !== 0) {
    return byStart;
  }
  if (first.spanId === second.parentSpanId) {
    return -1;
  }
  if (second.spanId === first.parentSpanId) {
    return 1;
  }
  const byEnd = compareUnixNanoStrings(first.endTimeUnixNano, second.endTimeUnixNano);
  return byEnd !== 0 ? byEnd : first.spanId.localeCompare(second.spanId);
}

function orderedSpans(spans: readonly TraceEnvelopeSpan[]): TraceEnvelopeSpan[] {
  return [...spans].sort(compareSpanTime);
}

function unixNanoToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    return undefined;
  }
}

function durationMsFromSpan(span: TraceEnvelopeSpan): number | undefined {
  try {
    const start = BigInt(span.startTimeUnixNano);
    const end = BigInt(span.endTimeUnixNano);
    if (end < start) {
      return undefined;
    }
    return Number(end - start) / 1_000_000;
  } catch {
    return undefined;
  }
}

function deriveTiming(input: {
  readonly startTime?: string;
  readonly endTime?: string;
  readonly durationMs?: number;
  readonly fallbackStartMs: number;
  readonly fallbackEndMs: number;
}): { readonly startMs: number; readonly endMs: number } {
  const startMs = parseTimeMs(input.startTime) ?? input.fallbackStartMs;
  const endMs =
    parseTimeMs(input.endTime) ??
    (input.durationMs !== undefined ? startMs + input.durationMs : input.fallbackEndMs);
  return { startMs, endMs: Math.max(startMs, endMs) };
}

function tokenUsageAttributes(usage: TokenUsage | undefined): Record<string, unknown> {
  if (!usage) {
    return {};
  }
  return dropUndefined({
    'gen_ai.usage.input_tokens': usage.input,
    'gen_ai.usage.output_tokens': usage.output,
    'gen_ai.usage.cache_read.input_tokens': usage.cached,
    'gen_ai.usage.reasoning.output_tokens': usage.reasoning,
    'llm.token_count.prompt': usage.input,
    'llm.token_count.completion': usage.output,
  });
}

function sourceFromResult(
  result: EvaluationResult,
  options: BuildTraceEnvelopeOptions,
): TraceEnvelopeSource {
  const traceProvider =
    typeof result.trace.metadata?.provider === 'string'
      ? result.trace.metadata.provider
      : undefined;
  return {
    kind: options.source?.kind ?? 'agentv_run',
    path: options.source?.path,
    provider: options.source?.provider ?? traceProvider ?? result.target,
    format: options.source?.format ?? 'agentv_result',
    version: options.source?.version ?? '1',
    metadata: options.source?.metadata,
  };
}

function capturePolicy(options: BuildTraceEnvelopeOptions): TraceEnvelopeCapture {
  return {
    content: options.capture?.content ?? 'metadata',
    redactionLevel: options.capture?.redactionLevel ?? 'partial',
    redactedFields: options.capture?.redactedFields ?? [
      'gen_ai.input.messages',
      'gen_ai.output.messages',
      'gen_ai.tool.call.arguments',
      'gen_ai.tool.call.result',
    ],
    policy: options.capture?.policy ?? {
      tool_arguments: 'metadata',
      tool_results: 'metadata',
      message_text: 'metadata',
      screenshots: 'none',
      thinking: 'none',
    },
  };
}

function assistantMessages(
  messages: readonly Message[],
): readonly { message: Message; index: number }[] {
  return messages
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.message.role === 'assistant');
}

function maybeContentAttributes(
  message: Message,
  capture: TraceEnvelopeCapture,
): Record<string, unknown> {
  if (capture.content !== 'full' || message.content === undefined) {
    return {};
  }
  return { 'gen_ai.output.messages': message.content };
}

function maybeToolContentAttributes(
  toolCall: ToolCall,
  capture: TraceEnvelopeCapture,
): Record<string, unknown> {
  if (capture.content !== 'full') {
    return {};
  }
  return dropUndefined({
    'gen_ai.tool.call.arguments': toolCall.input,
    'gen_ai.tool.call.result': toolCall.output,
  });
}

function toTranscriptToolCallWire(
  toolCall: ToolCall,
  capture: TraceEnvelopeCapture,
): TraceEnvelopeTranscriptToolCallWire {
  return dropUndefined({
    tool: toolCall.tool,
    input: capture.content === 'full' ? toolCall.input : undefined,
    output: capture.content === 'full' ? toolCall.output : undefined,
    id: toolCall.id,
    start_time: toolCall.startTime,
    end_time: toolCall.endTime,
    duration_ms: toolCall.durationMs,
  });
}

function toTranscriptMessageWire(
  message: Message,
  capture: TraceEnvelopeCapture,
): TraceEnvelopeTranscriptMessageWire {
  return dropUndefined({
    role: message.role,
    name: message.name,
    content: capture.content === 'full' ? message.content : undefined,
    tool_calls: message.toolCalls?.map((toolCall) => toTranscriptToolCallWire(toolCall, capture)),
    start_time: message.startTime,
    end_time: message.endTime,
    duration_ms: message.durationMs,
    metadata: message.metadata,
    token_usage: message.tokenUsage,
  });
}

function transcriptMessageEvent(
  message: Message,
  index: number,
  capture: TraceEnvelopeCapture,
): TraceEnvelopeSpanEvent {
  const startMs = parseTimeMs(message.startTime);
  return {
    name: TRANSCRIPT_MESSAGE_EVENT_NAME,
    timeUnixNano: startMs !== undefined ? msToUnixNano(startMs) : undefined,
    attributes: dropUndefined({
      'agentv.transcript.message.index': index,
      'agentv.transcript.message': toTranscriptMessageWire(message, capture),
    }),
  };
}

function spanStatusFromResult(result: EvaluationResult): TraceEnvelopeSpanStatus {
  if (result.executionStatus === 'execution_error' || result.error) {
    return { code: 'ERROR', message: result.error };
  }
  return { code: 'OK' };
}

function scoreSource(type: string): string {
  if (type === 'code-grader') {
    return 'code';
  }
  if (type === 'llm-grader') {
    return 'llm';
  }
  return 'agentv';
}

function scoresFromResult(
  result: EvaluationResult,
  targetSpanId: string,
): readonly TraceEnvelopeScore[] | undefined {
  if (!result.scores || result.scores.length === 0) {
    return undefined;
  }
  return result.scores.map((score) => ({
    name: score.name,
    type: score.type,
    score: score.score,
    weight: score.weight,
    verdict: score.verdict,
    source: scoreSource(score.type),
    evaluatedAt: score.endedAt ?? score.startedAt ?? result.timestamp,
    targetSpanId,
    evidence: dropUndefined({
      span_ids: [targetSpanId],
      assertions: score.assertions.map((assertion) =>
        dropUndefined({
          text: assertion.text,
          passed: assertion.passed,
          evidence: assertion.evidence,
        }),
      ),
      details: score.details,
    }),
  }));
}

export function buildTraceEnvelopeFromEvaluationResult(
  result: EvaluationResult,
  options: BuildTraceEnvelopeOptions = {},
): TraceEnvelope {
  const now = options.now?.() ?? new Date();
  const capture = capturePolicy(options);
  const source = sourceFromResult(result, options);
  const traceId = hashHex(
    [
      'execution-trace',
      result.timestamp,
      result.suite,
      result.testId,
      result.target,
      options.runId,
    ],
    32,
  );
  const rootSpanId = hashHex([traceId, 'root'], 16);
  const rootStartMs =
    parseTimeMs(result.startTime ?? result.trace.startTime ?? result.timestamp) ?? 0;
  const rootEndMs =
    parseTimeMs(result.endTime ?? result.trace.endTime) ??
    (result.durationMs !== undefined ? rootStartMs + result.durationMs : rootStartMs);
  const rootStatus = spanStatusFromResult(result);
  const conversionWarnings: TraceEnvelopeConversionWarning[] = [];
  const spans: TraceEnvelopeSpan[] = [];
  const rootEvents: TraceEnvelopeSpanEvent[] = result.trace.messages.map((message, index) =>
    transcriptMessageEvent(message, index, capture),
  );

  const rootAttributes = dropUndefined({
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.provider.name': 'agentv',
    'gen_ai.agent.name': result.target,
    'openinference.span.kind': 'AGENT',
    'agentv.test_id': result.testId,
    'agentv.target': result.target,
    'agentv.suite': result.suite,
    'agentv.category': result.category,
    'agentv.eval_path': options.evalPath,
    'agentv.run_id': options.runId,
    'agentv.attempt': options.attempt,
    'agentv.variant': options.variant ?? undefined,
    'agentv.execution_status': result.executionStatus,
    'agentv.failure_stage': result.failureStage,
    'agentv.failure_reason_code': result.failureReasonCode,
    'agentv.trace.duration_ms': result.durationMs,
    'agentv.trace.cost_usd': result.costUsd,
    ...tokenUsageAttributes(result.tokenUsage),
  });

  spans.push({
    traceId,
    spanId: rootSpanId,
    parentSpanId: null,
    name: `invoke_agent ${result.target}`,
    kind: 'INTERNAL',
    startTimeUnixNano: msToUnixNano(rootStartMs),
    endTimeUnixNano: msToUnixNano(Math.max(rootStartMs, rootEndMs)),
    status: rootStatus,
    attributes: rootAttributes,
    events: result.error
      ? [
          ...rootEvents,
          {
            name: 'exception',
            timeUnixNano: msToUnixNano(Math.max(rootStartMs, rootEndMs)),
            attributes: { 'exception.message': result.error },
          },
        ]
      : rootEvents,
  });

  const assistantEntries = assistantMessages(result.trace.messages);
  const chatEntries =
    assistantEntries.length > 0
      ? assistantEntries
      : result.output.length > 0
        ? [{ message: { role: 'assistant', content: result.output } as Message, index: 0 }]
        : [];

  for (const [chatOrdinal, entry] of chatEntries.entries()) {
    const { message, index: messageIndex } = entry;
    const model =
      typeof message.metadata?.model === 'string'
        ? message.metadata.model
        : typeof result.trace.metadata?.model === 'string'
          ? result.trace.metadata.model
          : result.target;
    const chatSpanId = hashHex([traceId, 'chat', messageIndex, chatOrdinal], 16);
    const chatTiming = deriveTiming({
      startTime: message.startTime,
      endTime: message.endTime,
      durationMs: message.durationMs,
      fallbackStartMs: rootStartMs,
      fallbackEndMs: rootEndMs,
    });
    const tokenUsage =
      message.tokenUsage ??
      (chatEntries.length === 1 || chatOrdinal === chatEntries.length - 1
        ? result.tokenUsage
        : undefined);

    spans.push({
      traceId,
      spanId: chatSpanId,
      parentSpanId: rootSpanId,
      name: `chat ${model}`,
      kind: 'INTERNAL',
      startTimeUnixNano: msToUnixNano(chatTiming.startMs),
      endTimeUnixNano: msToUnixNano(chatTiming.endMs),
      status: { code: 'OK' },
      attributes: dropUndefined({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': source.provider,
        'gen_ai.request.model': model,
        'gen_ai.response.model': model,
        'openinference.span.kind': 'LLM',
        'agentv.message.index': messageIndex,
        'agentv.turn_index': chatOrdinal,
        ...tokenUsageAttributes(tokenUsage),
        ...maybeContentAttributes(message, capture),
      }),
      events: [],
    });

    for (const [toolIndex, toolCall] of (message.toolCalls ?? []).entries()) {
      const toolSpanId = hashHex([traceId, 'tool', messageIndex, toolIndex, toolCall.tool], 16);
      const toolTiming = deriveTiming({
        startTime: toolCall.startTime,
        endTime: toolCall.endTime,
        durationMs: toolCall.durationMs,
        fallbackStartMs: chatTiming.startMs,
        fallbackEndMs: chatTiming.endMs,
      });
      const generatedToolCallId =
        toolCall.id ??
        `agentv-tool-${hashHex([result.testId, result.target, messageIndex, toolIndex], 12)}`;

      if (!toolCall.id) {
        conversionWarnings.push({
          code: 'missing_tool_call_id',
          severity: 'warning',
          spanId: toolSpanId,
          sourceRef: {
            eventId: `message-${messageIndex}-tool-${toolIndex}`,
          },
          message: 'Deterministic tool call id generated from source order.',
        });
      }

      spans.push({
        traceId,
        spanId: toolSpanId,
        parentSpanId: chatSpanId,
        name: `execute_tool ${toolCall.tool}`,
        kind: 'INTERNAL',
        startTimeUnixNano: msToUnixNano(toolTiming.startMs),
        endTimeUnixNano: msToUnixNano(toolTiming.endMs),
        status: { code: 'OK' },
        attributes: dropUndefined({
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': toolCall.tool,
          'gen_ai.tool.call.id': generatedToolCallId,
          'openinference.span.kind': 'TOOL',
          'tool.name': toolCall.tool,
          'tool.id': generatedToolCallId,
          'agentv.message.index': messageIndex,
          'agentv.tool.index': toolIndex,
          'agentv.generated_tool_call_id': toolCall.id ? undefined : true,
          ...maybeToolContentAttributes(toolCall, capture),
        }),
        events: [],
      });
    }
  }

  const artifactId = `execution-trace-${hashHex([traceId, result.timestamp, result.score], 20)}`;
  const evalIdentity: TraceEnvelopeEval = {
    evalId: options.evalId,
    evalPath: options.evalPath,
    suite: result.suite,
    testId: result.testId,
    target: result.target,
    sourceTarget: options.sourceTarget,
    attempt: options.attempt,
    variant: options.variant,
    runId: options.runId,
    category: result.category,
    experiment: options.experiment,
  };

  return {
    schemaVersion: EXECUTION_TRACE_SCHEMA_VERSION,
    artifactId,
    createdAt: now.toISOString(),
    eval: evalIdentity,
    replay: options.replay,
    trace: {
      format: TRACE_ENVELOPE_FORMAT,
      traceId,
      rootSpanId,
      resource: { attributes: { 'service.name': 'agentv' } },
      scope: { name: 'agentv' },
      spans,
    },
    source,
    capture,
    conversionWarnings: conversionWarnings.length > 0 ? conversionWarnings : undefined,
    artifacts: definedStringRecord(options.artifacts),
    scores: scoresFromResult(result, rootSpanId),
  };
}

export function toTraceEnvelopeWire(envelope: TraceEnvelope): TraceEnvelopeWire {
  return TraceEnvelopeWireSchema.parse(
    dropUndefined({
      schema_version: envelope.schemaVersion,
      artifact_id: envelope.artifactId,
      created_at: envelope.createdAt,
      eval: toTraceEnvelopeEvalWire(envelope.eval),
      replay: envelope.replay ? toTraceEnvelopeReplayWire(envelope.replay) : undefined,
      trace: toTraceEnvelopeBodyWire(envelope.trace),
      source: toTraceEnvelopeSourceWire(envelope.source),
      capture: toTraceEnvelopeCaptureWire(envelope.capture),
      conversion_warnings: envelope.conversionWarnings?.map(toTraceEnvelopeConversionWarningWire),
      artifacts: envelope.artifacts,
      scores: envelope.scores?.map(toTraceEnvelopeScoreWire),
    }),
  );
}

export function fromTraceEnvelopeWire(input: unknown): TraceEnvelope {
  const wire = TraceEnvelopeWireSchema.parse(input);
  return {
    schemaVersion: wire.schema_version,
    artifactId: wire.artifact_id,
    createdAt: wire.created_at,
    eval: fromTraceEnvelopeEvalWire(wire.eval),
    replay: wire.replay ? fromTraceEnvelopeReplayWire(wire.replay) : undefined,
    trace: fromTraceEnvelopeBodyWire(wire.trace),
    source: fromTraceEnvelopeSourceWire(wire.source),
    capture: fromTraceEnvelopeCaptureWire(wire.capture),
    conversionWarnings: wire.conversion_warnings?.map(fromTraceEnvelopeConversionWarningWire),
    artifacts: wire.artifacts,
    scores: wire.scores?.map(fromTraceEnvelopeScoreWire),
  };
}

function toTraceEnvelopeEvalWire(evaluation: TraceEnvelopeEval): TraceEnvelopeEvalWire {
  return TraceEnvelopeEvalWireSchema.parse(
    dropUndefined({
      eval_id: evaluation.evalId,
      eval_path: evaluation.evalPath,
      suite: evaluation.suite,
      test_id: evaluation.testId,
      target: evaluation.target,
      source_target: evaluation.sourceTarget,
      attempt: evaluation.attempt,
      variant: evaluation.variant,
      run_id: evaluation.runId,
      category: evaluation.category,
      experiment: evaluation.experiment,
    }),
  );
}

function fromTraceEnvelopeEvalWire(evaluation: TraceEnvelopeEvalWire): TraceEnvelopeEval {
  return {
    evalId: evaluation.eval_id,
    evalPath: evaluation.eval_path,
    suite: evaluation.suite,
    testId: evaluation.test_id,
    target: evaluation.target,
    sourceTarget: evaluation.source_target,
    attempt: evaluation.attempt,
    variant: evaluation.variant,
    runId: evaluation.run_id,
    category: evaluation.category,
    experiment: evaluation.experiment,
  };
}

function toTraceEnvelopeReplayWire(replay: TraceEnvelopeReplay): TraceEnvelopeReplayWire {
  return TraceEnvelopeReplayWireSchema.parse(
    dropUndefined({
      lookup_key: replay.lookupKey,
      fixture_id: replay.fixtureId,
      source_fixture_path: replay.sourceFixturePath,
    }),
  );
}

function fromTraceEnvelopeReplayWire(replay: TraceEnvelopeReplayWire): TraceEnvelopeReplay {
  return {
    lookupKey: replay.lookup_key,
    fixtureId: replay.fixture_id,
    sourceFixturePath: replay.source_fixture_path,
  };
}

function toTraceEnvelopeBodyWire(trace: TraceEnvelopeBody): TraceEnvelopeBodyWire {
  return TraceEnvelopeBodyWireSchema.parse(
    dropUndefined({
      format: trace.format,
      trace_id: trace.traceId,
      root_span_id: trace.rootSpanId,
      resource: trace.resource,
      scope: trace.scope,
      spans: trace.spans.map(toTraceEnvelopeSpanWire),
    }),
  );
}

function fromTraceEnvelopeBodyWire(trace: TraceEnvelopeBodyWire): TraceEnvelopeBody {
  return {
    format: trace.format,
    traceId: trace.trace_id,
    rootSpanId: trace.root_span_id,
    resource: trace.resource,
    scope: trace.scope,
    spans: trace.spans.map(fromTraceEnvelopeSpanWire),
  };
}

function toTraceEnvelopeSpanWire(span: TraceEnvelopeSpan): TraceEnvelopeSpanWire {
  return TraceEnvelopeSpanWireSchema.parse(
    dropUndefined({
      trace_id: span.traceId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      start_time_unix_nano: span.startTimeUnixNano,
      end_time_unix_nano: span.endTimeUnixNano,
      status: span.status,
      attributes: span.attributes,
      events: span.events?.map(toTraceEnvelopeSpanEventWire),
    }),
  );
}

function fromTraceEnvelopeSpanWire(span: TraceEnvelopeSpanWire): TraceEnvelopeSpan {
  return {
    traceId: span.trace_id,
    spanId: span.span_id,
    parentSpanId: span.parent_span_id,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.start_time_unix_nano,
    endTimeUnixNano: span.end_time_unix_nano,
    status: span.status,
    attributes: span.attributes,
    events: span.events?.map(fromTraceEnvelopeSpanEventWire),
  };
}

function toTraceEnvelopeSpanEventWire(event: TraceEnvelopeSpanEvent) {
  return TraceEnvelopeSpanEventWireSchema.parse(
    dropUndefined({
      name: event.name,
      time_unix_nano: event.timeUnixNano,
      attributes: event.attributes,
    }),
  );
}

function fromTraceEnvelopeSpanEventWire(
  event: z.infer<typeof TraceEnvelopeSpanEventWireSchema>,
): TraceEnvelopeSpanEvent {
  return {
    name: event.name,
    timeUnixNano: event.time_unix_nano,
    attributes: event.attributes,
  };
}

function toTraceEnvelopeSourceWire(source: TraceEnvelopeSource): TraceEnvelopeSourceWire {
  return TraceEnvelopeSourceWireSchema.parse(
    dropUndefined({
      kind: source.kind,
      path: source.path,
      provider: source.provider,
      format: source.format,
      version: source.version,
      metadata: source.metadata,
    }),
  );
}

function fromTraceEnvelopeSourceWire(source: TraceEnvelopeSourceWire): TraceEnvelopeSource {
  return {
    kind: source.kind,
    path: source.path,
    provider: source.provider,
    format: source.format,
    version: source.version,
    metadata: source.metadata,
  };
}

function toTraceEnvelopeCaptureWire(capture: TraceEnvelopeCapture): TraceEnvelopeCaptureWire {
  return TraceEnvelopeCaptureWireSchema.parse(
    dropUndefined({
      content: capture.content,
      redaction_level: capture.redactionLevel,
      redacted_fields: capture.redactedFields,
      policy: capture.policy,
    }),
  );
}

function fromTraceEnvelopeCaptureWire(capture: TraceEnvelopeCaptureWire): TraceEnvelopeCapture {
  return {
    content: capture.content,
    redactionLevel: capture.redaction_level,
    redactedFields: capture.redacted_fields,
    policy: capture.policy,
  };
}

function toTraceEnvelopeSourceRefWire(sourceRef: TraceEnvelopeSourceRef) {
  return TraceEnvelopeSourceRefWireSchema.parse(
    dropUndefined({
      event_id: sourceRef.eventId,
      message_id: sourceRef.messageId,
      span_id: sourceRef.spanId,
      trace_id: sourceRef.traceId,
      raw_kind: sourceRef.rawKind,
      path: sourceRef.path,
      line: sourceRef.line,
      metadata: sourceRef.metadata,
    }),
  );
}

function fromTraceEnvelopeSourceRefWire(
  sourceRef: z.infer<typeof TraceEnvelopeSourceRefWireSchema>,
): TraceEnvelopeSourceRef {
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

function toTraceEnvelopeConversionWarningWire(
  warning: TraceEnvelopeConversionWarning,
): TraceEnvelopeConversionWarningWire {
  return TraceEnvelopeConversionWarningWireSchema.parse(
    dropUndefined({
      code: warning.code,
      severity: warning.severity,
      span_id: warning.spanId,
      source_ref: warning.sourceRef ? toTraceEnvelopeSourceRefWire(warning.sourceRef) : undefined,
      message: warning.message,
      details: warning.details,
    }),
  );
}

function fromTraceEnvelopeConversionWarningWire(
  warning: TraceEnvelopeConversionWarningWire,
): TraceEnvelopeConversionWarning {
  return {
    code: warning.code,
    severity: warning.severity,
    spanId: warning.span_id,
    sourceRef: warning.source_ref ? fromTraceEnvelopeSourceRefWire(warning.source_ref) : undefined,
    message: warning.message,
    details: warning.details,
  };
}

function toTraceEnvelopeScoreWire(score: TraceEnvelopeScore): TraceEnvelopeScoreWire {
  return TraceEnvelopeScoreWireSchema.parse(
    dropUndefined({
      name: score.name,
      type: score.type,
      score: score.score,
      weight: score.weight,
      verdict: score.verdict,
      source: score.source,
      evaluated_at: score.evaluatedAt,
      target_span_id: score.targetSpanId,
      evidence: score.evidence,
    }),
  );
}

function fromTraceEnvelopeScoreWire(score: TraceEnvelopeScoreWire): TraceEnvelopeScore {
  return {
    name: score.name,
    type: score.type,
    score: score.score,
    weight: score.weight,
    verdict: score.verdict as EvaluationVerdict | undefined,
    source: score.source,
    evaluatedAt: score.evaluated_at,
    targetSpanId: score.target_span_id,
    evidence: score.evidence,
  };
}

function isToolSpan(span: TraceEnvelopeSpan): boolean {
  return (
    span.attributes['gen_ai.operation.name'] === 'execute_tool' ||
    span.attributes['openinference.span.kind'] === 'TOOL'
  );
}

function isChatSpan(span: TraceEnvelopeSpan): boolean {
  return (
    span.attributes['gen_ai.operation.name'] === 'chat' ||
    span.attributes['openinference.span.kind'] === 'LLM'
  );
}

function stringAttribute(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === 'string' ? value : undefined;
}

function numberAttribute(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function tokenUsageFromAttributes(
  attributes: Readonly<Record<string, unknown>>,
): TokenUsage | undefined {
  const input = numberAttribute(attributes, 'gen_ai.usage.input_tokens');
  const output = numberAttribute(attributes, 'gen_ai.usage.output_tokens');
  if (input === undefined || output === undefined) {
    return undefined;
  }
  return {
    input,
    output,
    cached: numberAttribute(attributes, 'gen_ai.usage.cache_read.input_tokens'),
    reasoning: numberAttribute(attributes, 'gen_ai.usage.reasoning.output_tokens'),
  };
}

function toolCallFromSpan(span: TraceEnvelopeSpan): ToolCall {
  const attributes = span.attributes;
  return {
    tool:
      stringAttribute(attributes, 'gen_ai.tool.name') ??
      stringAttribute(attributes, 'tool.name') ??
      span.name.replace(/^execute_tool\s+/, ''),
    id:
      stringAttribute(attributes, 'gen_ai.tool.call.id') ??
      stringAttribute(attributes, 'tool.id') ??
      span.spanId,
    input: attributes['gen_ai.tool.call.arguments'],
    output: attributes['gen_ai.tool.call.result'],
    startTime: unixNanoToIso(span.startTimeUnixNano),
    endTime: unixNanoToIso(span.endTimeUnixNano),
    durationMs: durationMsFromSpan(span),
  };
}

function buildSpanMap(spans: readonly TraceEnvelopeSpan[]): ReadonlyMap<string, TraceEnvelopeSpan> {
  return new Map(spans.map((span) => [span.spanId, span]));
}

function ancestorSpanIds(
  span: TraceEnvelopeSpan,
  spansById: ReadonlyMap<string, TraceEnvelopeSpan>,
): readonly string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let parentSpanId = span.parentSpanId ?? undefined;

  while (parentSpanId && !seen.has(parentSpanId)) {
    seen.add(parentSpanId);
    ancestors.push(parentSpanId);
    parentSpanId = spansById.get(parentSpanId)?.parentSpanId ?? undefined;
  }

  return ancestors;
}

function nearestAncestorToolCallId(
  ancestorIds: readonly string[],
  spansById: ReadonlyMap<string, TraceEnvelopeSpan>,
): string | undefined {
  for (const ancestorId of ancestorIds) {
    const ancestor = spansById.get(ancestorId);
    if (ancestor && isToolSpan(ancestor)) {
      return toolCallFromSpan(ancestor).id;
    }
  }
  return undefined;
}

function fromTranscriptToolCallWire(wire: unknown): ToolCall | undefined {
  if (!isRecord(wire) || typeof wire.tool !== 'string') {
    return undefined;
  }
  return {
    tool: wire.tool,
    input: wire.input,
    output: wire.output,
    id: typeof wire.id === 'string' ? wire.id : undefined,
    startTime: typeof wire.start_time === 'string' ? wire.start_time : undefined,
    endTime: typeof wire.end_time === 'string' ? wire.end_time : undefined,
    durationMs: numberAttribute(wire, 'duration_ms'),
  };
}

function fromTranscriptMessageWire(wire: unknown): Message | undefined {
  if (!isRecord(wire) || typeof wire.role !== 'string') {
    return undefined;
  }
  const toolCalls = Array.isArray(wire.tool_calls)
    ? wire.tool_calls
        .map(fromTranscriptToolCallWire)
        .filter((toolCall): toolCall is ToolCall => toolCall !== undefined)
    : undefined;
  return dropUndefined({
    role: wire.role,
    name: typeof wire.name === 'string' ? wire.name : undefined,
    content: wire.content as Message['content'],
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    startTime: typeof wire.start_time === 'string' ? wire.start_time : undefined,
    endTime: typeof wire.end_time === 'string' ? wire.end_time : undefined,
    durationMs: numberAttribute(wire, 'duration_ms'),
    metadata: isRecord(wire.metadata) ? wire.metadata : undefined,
    tokenUsage: isRecord(wire.token_usage)
      ? tokenUsageFromAttributes({
          'gen_ai.usage.input_tokens': wire.token_usage.input,
          'gen_ai.usage.output_tokens': wire.token_usage.output,
          'gen_ai.usage.cache_read.input_tokens': wire.token_usage.cached,
          'gen_ai.usage.reasoning.output_tokens': wire.token_usage.reasoning,
        })
      : undefined,
  });
}

function traceEnvelopeToMessageEntries(
  envelope: TraceEnvelope,
): readonly TraceEnvelopeMessageEntry[] {
  const spans = orderedSpans(envelope.trace.spans);
  const spansById = buildSpanMap(spans);
  const toolSpansByParent = new Map<string, TraceEnvelopeSpan[]>();
  for (const span of spans.filter(isToolSpan)) {
    const parentSpanId = span.parentSpanId ?? envelope.trace.rootSpanId;
    const existing = toolSpansByParent.get(parentSpanId) ?? [];
    existing.push(span);
    toolSpansByParent.set(parentSpanId, existing);
  }

  return spans.filter(isChatSpan).map((span, fallbackIndex) => ({
    index: numberAttribute(span.attributes, 'agentv.message.index') ?? fallbackIndex,
    timeUnixNano: span.startTimeUnixNano,
    message: {
      role: 'assistant',
      content: span.attributes['gen_ai.output.messages'] as Message['content'],
      toolCalls: toolSpansByParent.get(span.spanId)?.map(toolCallFromSpan),
      startTime: unixNanoToIso(span.startTimeUnixNano),
      endTime: unixNanoToIso(span.endTimeUnixNano),
      durationMs: durationMsFromSpan(span),
      tokenUsage: tokenUsageFromAttributes(span.attributes),
      metadata: dropUndefined({
        span_id: span.spanId,
        trace_id: span.traceId,
        parent_span_id: span.parentSpanId ?? undefined,
        parent_tool_call_id: nearestAncestorToolCallId(ancestorSpanIds(span, spansById), spansById),
      }),
    },
  }));
}

export function traceEnvelopeToMessages(envelope: TraceEnvelope): readonly Message[] {
  return traceEnvelopeToMessageEntries(envelope).map((entry) => entry.message);
}

function transcriptMessageEntries(envelope: TraceEnvelope): readonly TraceEnvelopeMessageEntry[] {
  const entries: TraceEnvelopeMessageEntry[] = [];
  for (const span of orderedSpans(envelope.trace.spans)) {
    for (const event of span.events ?? []) {
      if (event.name !== TRANSCRIPT_MESSAGE_EVENT_NAME) {
        continue;
      }
      const attributes = event.attributes ?? {};
      const message = fromTranscriptMessageWire(attributes['agentv.transcript.message']);
      if (!message) {
        continue;
      }
      entries.push({
        index: numberAttribute(attributes, 'agentv.transcript.message.index') ?? entries.length,
        timeUnixNano: event.timeUnixNano,
        message,
      });
    }
  }
  return entries;
}

export function traceEnvelopeToTranscriptMessages(envelope: TraceEnvelope): readonly Message[] {
  const entries = transcriptMessageEntries(envelope);
  if (entries.length === 0) {
    return traceEnvelopeToMessages(envelope);
  }
  return [...entries]
    .sort((first, second) => {
      const byIndex = first.index - second.index;
      if (byIndex !== 0) {
        return byIndex;
      }
      if (first.timeUnixNano && second.timeUnixNano) {
        return compareUnixNanoStrings(first.timeUnixNano, second.timeUnixNano);
      }
      return 0;
    })
    .map((entry) => entry.message);
}

export function traceEnvelopeToToolTrajectoryView(
  envelope: TraceEnvelope,
): TraceEnvelopeToolTrajectoryView {
  const spans = orderedSpans(envelope.trace.spans);
  const spansById = buildSpanMap(spans);
  const tools = spans.filter(isToolSpan).map((span, position) => {
    const toolCall = toolCallFromSpan(span);
    const toolCallId = toolCall.id ?? span.spanId;
    const ancestorIds = ancestorSpanIds(span, spansById);
    return {
      position,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId ?? undefined,
      ancestorSpanIds: ancestorIds,
      tool: toolCall.tool,
      toolCallId,
      parentToolCallId: nearestAncestorToolCallId(ancestorIds, spansById),
      input: toolCall.input,
      output: toolCall.output,
      status: span.status.code === 'ERROR' ? 'error' : 'ok',
      startTime: toolCall.startTime,
      endTime: toolCall.endTime,
      durationMs: toolCall.durationMs,
    } satisfies TraceEnvelopeToolTrajectoryItem;
  });

  return {
    schemaVersion: envelope.schemaVersion,
    traceId: envelope.trace.traceId,
    rootSpanId: envelope.trace.rootSpanId,
    tools,
  };
}

export function traceEnvelopeToTraceSummary(envelope: TraceEnvelope): TraceComputeResult {
  const toolCallCounts: Record<string, number> = {};
  const toolDurations: Record<string, number[]> = {};
  let totalToolCalls = 0;
  let errorCount = 0;
  let llmCallCount = 0;
  let hasAnyDuration = false;

  for (const span of envelope.trace.spans) {
    if (isChatSpan(span)) {
      llmCallCount++;
    }
    if (!isToolSpan(span)) {
      continue;
    }
    const toolName =
      stringAttribute(span.attributes, 'gen_ai.tool.name') ??
      stringAttribute(span.attributes, 'tool.name') ??
      span.name.replace(/^execute_tool\s+/, '');
    toolCallCounts[toolName] = (toolCallCounts[toolName] ?? 0) + 1;
    totalToolCalls++;
    if (span.status.code === 'ERROR') {
      errorCount++;
    }
    const durationMs = durationMsFromSpan(span);
    if (durationMs !== undefined) {
      hasAnyDuration = true;
      if (!toolDurations[toolName]) {
        toolDurations[toolName] = [];
      }
      toolDurations[toolName].push(durationMs);
    }
  }

  const rootSpan = envelope.trace.spans.find((span) => span.spanId === envelope.trace.rootSpanId);
  const rootTokenUsage = rootSpan ? tokenUsageFromAttributes(rootSpan.attributes) : undefined;
  const rootCost = rootSpan
    ? numberAttribute(rootSpan.attributes, 'agentv.trace.cost_usd')
    : undefined;
  const rootDuration = rootSpan
    ? (numberAttribute(rootSpan.attributes, 'agentv.trace.duration_ms') ??
      durationMsFromSpan(rootSpan))
    : undefined;

  return {
    trace: {
      eventCount: totalToolCalls,
      toolCalls: toolCallCounts,
      errorCount,
      llmCallCount,
      ...(hasAnyDuration ? { toolDurations } : {}),
    },
    tokenUsage: rootTokenUsage,
    costUsd: rootCost,
    durationMs: rootDuration,
    startTime: rootSpan ? unixNanoToIso(rootSpan.startTimeUnixNano) : undefined,
    endTime: rootSpan ? unixNanoToIso(rootSpan.endTimeUnixNano) : undefined,
  };
}

export function traceEnvelopeToTraceArtifact(envelope: TraceEnvelope): TraceArtifact {
  const events: TraceEvent[] = [];
  let ordinal = 0;
  for (const span of orderedSpans(envelope.trace.spans)) {
    if (isChatSpan(span)) {
      events.push({
        eventId: `span-${span.spanId}`,
        parentEventId: span.parentSpanId ? `span-${span.parentSpanId}` : undefined,
        ordinal: ordinal++,
        type: 'model_turn',
        timestamp: unixNanoToIso(span.startTimeUnixNano),
        durationMs: durationMsFromSpan(span),
        model: {
          provider: stringAttribute(span.attributes, 'gen_ai.provider.name'),
          name:
            stringAttribute(span.attributes, 'gen_ai.response.model') ??
            stringAttribute(span.attributes, 'gen_ai.request.model'),
          tokenUsage: tokenUsageFromAttributes(span.attributes),
        },
        sourceRef: {
          spanId: span.spanId,
          traceId: span.traceId,
        },
      });
    }
    if (isToolSpan(span)) {
      const toolCall = toolCallFromSpan(span);
      events.push({
        eventId: `span-${span.spanId}`,
        parentEventId: span.parentSpanId ? `span-${span.parentSpanId}` : undefined,
        ordinal: ordinal++,
        type: 'tool_call',
        timestamp: unixNanoToIso(span.startTimeUnixNano),
        durationMs: durationMsFromSpan(span),
        tool: {
          name: toolCall.tool,
          callId: toolCall.id,
          input: toolCall.input,
          output: toolCall.output,
          status: span.status.code === 'ERROR' ? 'error' : 'ok',
        },
        sourceRef: {
          spanId: span.spanId,
          traceId: span.traceId,
        },
      });
    }
  }

  const summary = traceEnvelopeToTraceSummary(envelope);
  return {
    schemaVersion: NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
    source: {
      kind: envelope.source.kind as TraceSourceKind,
      path: envelope.source.path,
      provider: envelope.source.provider,
      format: envelope.source.format,
      version: envelope.source.version,
      metadata: envelope.source.metadata,
    },
    session: {
      sessionId: envelope.eval.runId,
      conversationId: envelope.eval.evalId,
    },
    events,
    tokenUsage: summary.tokenUsage,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs,
    startedAt: summary.startTime,
    endedAt: summary.endTime,
  };
}

export function getTraceEnvelopeSummary(envelope: TraceEnvelope): TraceSummary {
  return traceEnvelopeToTraceSummary(envelope).trace;
}

export function traceEnvelopeToOtlpJson(envelope: TraceEnvelope): TraceEnvelopeOtlpJson {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: attributesToOtlp(envelope.trace.resource?.attributes),
        },
        scopeSpans: [
          {
            scope: dropUndefined({
              name: envelope.trace.scope?.name,
              version: envelope.trace.scope?.version,
            }),
            spans: orderedSpans(envelope.trace.spans).map((span) =>
              dropUndefined({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId ?? undefined,
                name: span.name,
                kind: spanKindToOtlp(span.kind),
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: attributesToOtlp(span.attributes),
                status: spanStatusToOtlp(span.status),
                events: span.events?.map((event) =>
                  dropUndefined({
                    name: event.name,
                    timeUnixNano: event.timeUnixNano,
                    attributes: attributesToOtlp(event.attributes),
                  }),
                ),
              }),
            ),
          },
        ],
      },
    ],
  };
}

function spanKindToOtlp(kind: string): number {
  if (kind === 'SERVER') {
    return 1;
  }
  if (kind === 'CLIENT') {
    return 2;
  }
  if (kind === 'PRODUCER') {
    return 3;
  }
  if (kind === 'CONSUMER') {
    return 4;
  }
  return 0;
}

function spanStatusToOtlp(status: TraceEnvelopeSpanStatus): TraceEnvelopeOtlpSpanStatus {
  const code = status.code === 'OK' ? 1 : status.code === 'ERROR' ? 2 : 0;
  return dropUndefined({ code, message: status.message });
}

function attributesToOtlp(
  attributes: Readonly<Record<string, unknown>> | undefined,
): readonly TraceEnvelopeOtlpAttribute[] {
  return Object.entries(attributes ?? {}).map(([key, value]) => ({
    key,
    value: toOtlpAnyValue(value),
  }));
}

function toOtlpAnyValue(value: unknown): TraceEnvelopeOtlpAnyValue {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toOtlpAnyValue) } };
  }
  return { stringValue: stringifyOtlpAttribute(value) };
}

function stringifyOtlpAttribute(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
