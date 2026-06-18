/**
 * Zod schemas for code grader input/output validation.
 * Provides both compile-time types and runtime validation.
 *
 * ## Content model
 *
 * `Message.content` accepts `string | object[] | object`:
 * - `string` — backward-compatible plain text (most common case)
 * - `object[]` — typed content blocks for multimodal messages, plus AgentV
 *   eval input blocks such as `{ type: "file", value, path, text }`
 * - `object` — structured YAML/JSON content such as expected outputs
 *
 * Content variants:
 * - `ContentText`  — `{ type: 'text', text: string }`
 * - `ContentImage` — `{ type: 'image', media_type: string, path: string }` (file path, not base64)
 * - `ContentFile`  — `{ type: 'file', media_type: string, path: string }`
 *
 * To add a new content variant:
 * 1. Define a new Zod schema with a unique `type` literal
 * 2. Add it to `ContentSchema` discriminated union
 * 3. Re-export from `index.ts`
 */
import { z } from 'zod';

/**
 * Token usage metrics schema.
 */
export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number().optional(),
  reasoning: z.number().optional(),
});

/**
 * Derived trace summary schema (camelCase for TypeScript ergonomics).
 *
 * This is a compact read model for metric-style graders. Full transcript/tool
 * evidence lives in the canonical `Trace` under `messages` and `events`.
 */
export const TraceSummarySchema = z.object({
  eventCount: z.number(),
  toolCalls: z.record(z.string(), z.number()),
  errorCount: z.number(),
  toolDurations: z.record(z.string(), z.array(z.number())).optional(),
  llmCallCount: z.number().optional(),
});

export const NORMALIZED_TRAJECTORY_SCHEMA_VERSION = 'agentv.trajectory.v1' as const;

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
  'final_response',
  'error',
] as const;

export const NORMALIZED_TOOL_STATUSES = ['ok', 'error', 'timeout', 'cancelled', 'unknown'] as const;

export const NORMALIZED_REDACTION_LEVELS = ['none', 'partial', 'full'] as const;

export const TRACE_SCHEMA_VERSION = NORMALIZED_TRAJECTORY_SCHEMA_VERSION;
export const TRACE_SOURCE_KINDS = NORMALIZED_TRACE_SOURCE_KINDS;
export const TRACE_EVENT_TYPES = NORMALIZED_TRACE_EVENT_TYPES;
export const TRACE_TOOL_STATUSES = NORMALIZED_TOOL_STATUSES;
export const TRACE_REDACTION_LEVELS = NORMALIZED_REDACTION_LEVELS;

const MetadataSchema = z.record(z.string(), z.unknown());

export const NormalizedRedactionStateSchema = z.object({
  level: z.enum(NORMALIZED_REDACTION_LEVELS),
  fields: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export const NormalizedTraceErrorSchema = z.object({
  message: z.string(),
  name: z.string().optional(),
  code: z.string().optional(),
  stack: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceSourceSchema = z.object({
  kind: z.enum(NORMALIZED_TRACE_SOURCE_KINDS),
  path: z.string().optional(),
  url: z.string().optional(),
  provider: z.string().optional(),
  format: z.string().optional(),
  version: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceSessionSchema = z.object({
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  cwd: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceBranchSchema = z.object({
  selectedLeafId: z.string().optional(),
  selectedPathIds: z.array(z.string()).optional(),
  includedEventIds: z.array(z.string()).optional(),
  omittedEventIds: z.array(z.string()).optional(),
  selectionReason: z.string().optional(),
});

export const NormalizedTraceSourceRefSchema = z.object({
  eventId: z.string().optional(),
  messageId: z.string().optional(),
  spanId: z.string().optional(),
  traceId: z.string().optional(),
  rawKind: z.string().optional(),
  path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedRawEvidenceSchema = z.object({
  kind: z.string(),
  ref: z.string().optional(),
  mediaType: z.string().optional(),
  content: z.unknown().optional(),
  redacted: z.boolean().optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceMessageSchema = z.object({
  role: z.string(),
  name: z.string().optional(),
  content: z.unknown().optional(),
  redaction: NormalizedRedactionStateSchema.optional(),
  tokenUsage: TokenUsageSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceModelSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  invocationId: z.string().optional(),
  tokenUsage: TokenUsageSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceToolSchema = z.object({
  name: z.string(),
  callId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(NORMALIZED_TOOL_STATUSES).optional(),
  error: NormalizedTraceErrorSchema.optional(),
  redaction: NormalizedRedactionStateSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const NormalizedTraceEventSchema = z.object({
  eventId: z.string(),
  parentEventId: z.string().optional(),
  ordinal: z.number().int().nonnegative(),
  type: z.enum(NORMALIZED_TRACE_EVENT_TYPES),
  timestamp: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  durationInferred: z.boolean().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  message: NormalizedTraceMessageSchema.optional(),
  model: NormalizedTraceModelSchema.optional(),
  tool: NormalizedTraceToolSchema.optional(),
  error: NormalizedTraceErrorSchema.optional(),
  sourceRef: NormalizedTraceSourceRefSchema.optional(),
  rawEvidence: z.array(NormalizedRawEvidenceSchema).optional(),
  redaction: NormalizedRedactionStateSchema.optional(),
  metadata: MetadataSchema.optional(),
});

/**
 * Derived trajectory schema exposed to custom graders.
 *
 * AgentV-owned persisted trajectory artifacts use the snake_case wire schemas
 * and converters in @agentv/core. This SDK schema mirrors the internal
 * camelCase model that grader authors receive.
 */
export const NormalizedTrajectorySchema = z.object({
  schemaVersion: z.literal(NORMALIZED_TRAJECTORY_SCHEMA_VERSION),
  source: NormalizedTraceSourceSchema,
  session: NormalizedTraceSessionSchema,
  branch: NormalizedTraceBranchSchema.optional(),
  events: z.array(NormalizedTraceEventSchema),
  tokenUsage: TokenUsageSchema.optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceRedactionStateSchema = NormalizedRedactionStateSchema;
export const TraceErrorSchema = NormalizedTraceErrorSchema;
export const TraceSourceSchema = NormalizedTraceSourceSchema;
export const TraceSessionSchema = NormalizedTraceSessionSchema;
export const TraceBranchSchema = NormalizedTraceBranchSchema;
export const TraceSourceRefSchema = NormalizedTraceSourceRefSchema;
export const TraceRawEvidenceSchema = NormalizedRawEvidenceSchema;
export const TraceMessageSchema = NormalizedTraceMessageSchema;
export const TraceModelSchema = NormalizedTraceModelSchema;
export const TraceToolSchema = NormalizedTraceToolSchema;
export const TraceEventSchema = NormalizedTraceEventSchema;
export const TraceArtifactSchema = NormalizedTrajectorySchema;

/**
 * Tool call schema.
 */
export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  id: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMs: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Content block schemas (discriminated union on `type`)
// ---------------------------------------------------------------------------

/** Text content block. */
export const ContentTextSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/**
 * Image content block.
 * `path` is a filesystem path — never inline base64.
 */
export const ContentImageSchema = z.object({
  type: z.literal('image'),
  media_type: z.string(),
  path: z.string(),
});

/** File content block. */
export const ContentFileSchema = z.object({
  type: z.literal('file'),
  media_type: z.string(),
  path: z.string(),
});

/** Discriminated union of all content block types. */
export const ContentSchema = z.discriminatedUnion('type', [
  ContentTextSchema,
  ContentImageSchema,
  ContentFileSchema,
]);

const MessageContentBlockSchema = z.union([ContentSchema, z.record(z.unknown())]);

/**
 * Unified message schema for input, expected, and output messages.
 *
 * `content` is a plain string, an array of structured blocks, or a
 * structured object from YAML/JSON eval files. Use `getTextContent()` from
 * `@agentv/core` to extract plain text when the content is textual.
 */
export const MessageSchema = z.object({
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  content: z
    .union([z.string(), z.array(MessageContentBlockSchema), z.record(z.unknown())])
    .optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  name: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMs: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Derived evaluation trace read model exposed to custom graders.
 *
 * Top-level summary fields (`eventCount`, `toolCalls`, `errorCount`) remain
 * available for existing metric graders; full transcript/tool evidence is under
 * `messages` and structured execution events under `events`.
 */
export const TraceSchema = TraceSummarySchema.extend({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  messages: z.array(MessageSchema),
  events: z.array(TraceEventSchema),
  tokenUsage: TokenUsageSchema.optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

/**
 * Code grader input schema (camelCase, converted from snake_case wire format).
 *
 * `output` is the final answer/scored result only. Transcript-aware graders
 * should inspect `messages`, `trace.messages`, or `trace.events`.
 */
export const CodeGraderInputSchema = z.object({
  criteria: z.string(),
  expectedOutput: z.array(MessageSchema),
  output: z.string().nullable().optional(),
  messages: z.array(MessageSchema).optional().default([]),
  /** Path to a temp file containing the output JSON (used for large payloads). */
  outputPath: z.string().optional(),
  inputFiles: z.array(z.string()),
  input: z.array(MessageSchema),
  metadata: z.record(z.unknown()).nullable().optional(),
  trace: TraceSchema.nullable().optional(),
  traceSummary: TraceSummarySchema.nullable().optional(),
  tokenUsage: TokenUsageSchema.nullable().optional(),
  costUsd: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  fileChanges: z.string().nullable().optional(),
  workspacePath: z.string().nullable().optional(),
  config: z.record(z.unknown()).nullable().optional(),
});

/**
 * Code grader result schema (validated before output).
 */
export const CodeGraderResultSchema = z.object({
  score: z.number().min(0).max(1),
  assertions: z
    .array(
      z.object({
        text: z.string(),
        passed: z.boolean(),
        evidence: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  /** Optional structured details for domain-specific metrics (e.g., TP/TN/FP/FN counts, alignments). */
  details: z.record(z.unknown()).optional(),
});

/**
 * Inferred types from schemas.
 */
export type CodeGraderInput = z.infer<typeof CodeGraderInputSchema>;
export type CodeGraderResult = z.infer<typeof CodeGraderResultSchema>;

export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type TraceArtifact = z.infer<typeof TraceArtifactSchema>;
export type TraceSource = z.infer<typeof TraceSourceSchema>;
export type TraceSession = z.infer<typeof TraceSessionSchema>;
export type TraceBranch = z.infer<typeof TraceBranchSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceMessage = z.infer<typeof TraceMessageSchema>;
export type TraceModel = z.infer<typeof TraceModelSchema>;
export type TraceTool = z.infer<typeof TraceToolSchema>;
export type TraceError = z.infer<typeof TraceErrorSchema>;
export type TraceSourceRef = z.infer<typeof TraceSourceRefSchema>;
export type TraceRawEvidence = z.infer<typeof TraceRawEvidenceSchema>;
export type TraceRedactionState = z.infer<typeof TraceRedactionStateSchema>;
/** @deprecated Use TraceArtifact for legacy import/replay artifacts or Trace for evaluation results. */
export type NormalizedTrajectory = TraceArtifact;
/** @deprecated Use TraceSource. */
export type NormalizedTraceSource = TraceSource;
/** @deprecated Use TraceSession. */
export type NormalizedTraceSession = TraceSession;
/** @deprecated Use TraceBranch. */
export type NormalizedTraceBranch = TraceBranch;
/** @deprecated Use TraceEvent. */
export type NormalizedTraceEvent = TraceEvent;
/** @deprecated Use TraceMessage. */
export type NormalizedTraceMessage = TraceMessage;
/** @deprecated Use TraceModel. */
export type NormalizedTraceModel = TraceModel;
/** @deprecated Use TraceTool. */
export type NormalizedTraceTool = TraceTool;
/** @deprecated Use TraceError. */
export type NormalizedTraceError = TraceError;
/** @deprecated Use TraceSourceRef. */
export type NormalizedTraceSourceRef = TraceSourceRef;
/** @deprecated Use TraceRawEvidence. */
export type NormalizedRawEvidence = TraceRawEvidence;
/** @deprecated Use TraceRedactionState. */
export type NormalizedRedactionState = TraceRedactionState;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export type ContentText = z.infer<typeof ContentTextSchema>;
export type ContentImage = z.infer<typeof ContentImageSchema>;
export type ContentFile = z.infer<typeof ContentFileSchema>;
export type Content = z.infer<typeof ContentSchema>;

/**
 * Prompt template input schema (camelCase, converted from snake_case wire format).
 * Uses the same schema as CodeGraderInput since the orchestrator sends identical payloads.
 */
export const PromptTemplateInputSchema = CodeGraderInputSchema;

export type PromptTemplateInput = CodeGraderInput;

// ── Backward-compat aliases (deprecated) ────────────────────────────────────────
/** @deprecated Use CodeGraderInputSchema */
export const CodeJudgeInputSchema = CodeGraderInputSchema;
/** @deprecated Use CodeGraderResultSchema */
export const CodeJudgeResultSchema = CodeGraderResultSchema;
/** @deprecated Use CodeGraderInput */
export type CodeJudgeInput = CodeGraderInput;
/** @deprecated Use CodeGraderResult */
export type CodeJudgeResult = CodeGraderResult;
