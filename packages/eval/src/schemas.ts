/**
 * Zod schemas for code grader input/output validation.
 * Provides both compile-time types and runtime validation.
 *
 * ## Content model
 *
 * `Message.content` accepts `string | Content[]`:
 * - `string` — backward-compatible plain text (most common case)
 * - `Content[]` — typed content blocks for multimodal messages
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
 * Trace summary schema (camelCase for TypeScript ergonomics).
 */
export const TraceSummarySchema = z.object({
  eventCount: z.number(),
  toolCalls: z.record(z.string(), z.number()),
  errorCount: z.number(),
  toolDurations: z.record(z.string(), z.array(z.number())).optional(),
  llmCallCount: z.number().optional(),
});

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
  sourceRef: NormalizedTraceSourceRefSchema.optional(),
  rawEvidence: z.array(NormalizedRawEvidenceSchema).optional(),
  redaction: NormalizedRedactionStateSchema.optional(),
  metadata: MetadataSchema.optional(),
});

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

/**
 * Unified message schema for input, expected, and output messages.
 *
 * `content` is either a plain string or a `Content[]` array of typed blocks.
 * Use `getTextContent()` from `@agentv/core` to extract plain text from either form.
 */
export const MessageSchema = z.object({
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  content: z.union([z.string(), z.array(ContentSchema)]).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  name: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMs: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Code grader input schema (camelCase, converted from snake_case wire format).
 *
 * Structured fields (`input`, `output`, `expectedOutput`) are always `Message[]`.
 * To extract plain text from message content, use `getTextContent()` from `@agentv/core`.
 */
export const CodeGraderInputSchema = z.object({
  criteria: z.string(),
  expectedOutput: z.array(MessageSchema),
  output: z.array(MessageSchema).nullable().optional(),
  /** Path to a temp file containing the output JSON (used for large payloads). */
  outputPath: z.string().optional(),
  inputFiles: z.array(z.string()),
  input: z.array(MessageSchema),
  trace: TraceSummarySchema.nullable().optional(),
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
export type NormalizedTrajectory = z.infer<typeof NormalizedTrajectorySchema>;
export type NormalizedTraceSource = z.infer<typeof NormalizedTraceSourceSchema>;
export type NormalizedTraceSession = z.infer<typeof NormalizedTraceSessionSchema>;
export type NormalizedTraceBranch = z.infer<typeof NormalizedTraceBranchSchema>;
export type NormalizedTraceEvent = z.infer<typeof NormalizedTraceEventSchema>;
export type NormalizedTraceMessage = z.infer<typeof NormalizedTraceMessageSchema>;
export type NormalizedTraceModel = z.infer<typeof NormalizedTraceModelSchema>;
export type NormalizedTraceTool = z.infer<typeof NormalizedTraceToolSchema>;
export type NormalizedTraceError = z.infer<typeof NormalizedTraceErrorSchema>;
export type NormalizedTraceSourceRef = z.infer<typeof NormalizedTraceSourceRefSchema>;
export type NormalizedRawEvidence = z.infer<typeof NormalizedRawEvidenceSchema>;
export type NormalizedRedactionState = z.infer<typeof NormalizedRedactionStateSchema>;
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
