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

export const TRACE_SOURCE_KINDS = [
  'agentv_run',
  'otlp',
  'phoenix',
  'langfuse',
  'pi_session',
  'imported_transcript',
  'compact_transcript',
] as const;

export const TRACE_EVENT_TYPES = [
  'message',
  'model_turn',
  'tool_call',
  'tool_result',
  'final_response',
  'error',
] as const;

export const TRACE_TOOL_STATUSES = ['ok', 'error', 'timeout', 'cancelled', 'unknown'] as const;

export const TRACE_REDACTION_LEVELS = ['none', 'partial', 'full'] as const;

const MetadataSchema = z.record(z.string(), z.unknown());

export const TraceRedactionStateSchema = z.object({
  level: z.enum(TRACE_REDACTION_LEVELS),
  fields: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export const TraceErrorSchema = z.object({
  message: z.string(),
  name: z.string().optional(),
  code: z.string().optional(),
  stack: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceSourceSchema = z.object({
  kind: z.enum(TRACE_SOURCE_KINDS),
  path: z.string().optional(),
  url: z.string().optional(),
  provider: z.string().optional(),
  format: z.string().optional(),
  version: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceSessionSchema = z.object({
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  cwd: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceBranchSchema = z.object({
  selectedLeafId: z.string().optional(),
  selectedPathIds: z.array(z.string()).optional(),
  includedEventIds: z.array(z.string()).optional(),
  omittedEventIds: z.array(z.string()).optional(),
  selectionReason: z.string().optional(),
});

export const TraceSourceRefSchema = z.object({
  eventId: z.string().optional(),
  messageId: z.string().optional(),
  spanId: z.string().optional(),
  traceId: z.string().optional(),
  rawKind: z.string().optional(),
  path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceRawEvidenceSchema = z.object({
  kind: z.string(),
  ref: z.string().optional(),
  mediaType: z.string().optional(),
  content: z.unknown().optional(),
  redacted: z.boolean().optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceMessageSchema = z.object({
  role: z.string(),
  name: z.string().optional(),
  content: z.unknown().optional(),
  redaction: TraceRedactionStateSchema.optional(),
  tokenUsage: TokenUsageSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceModelSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  invocationId: z.string().optional(),
  tokenUsage: TokenUsageSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceToolSchema = z.object({
  name: z.string(),
  callId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(TRACE_TOOL_STATUSES).optional(),
  error: TraceErrorSchema.optional(),
  redaction: TraceRedactionStateSchema.optional(),
  metadata: MetadataSchema.optional(),
});

export const TraceEventSchema = z.object({
  eventId: z.string(),
  parentEventId: z.string().optional(),
  ordinal: z.number().int().nonnegative(),
  type: z.enum(TRACE_EVENT_TYPES),
  timestamp: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  durationInferred: z.boolean().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  message: TraceMessageSchema.optional(),
  model: TraceModelSchema.optional(),
  tool: TraceToolSchema.optional(),
  error: TraceErrorSchema.optional(),
  sourceRef: TraceSourceRefSchema.optional(),
  rawEvidence: z.array(TraceRawEvidenceSchema).optional(),
  redaction: TraceRedactionStateSchema.optional(),
  metadata: MetadataSchema.optional(),
});

/**
 * Derived trace artifact shape used by import/replay helpers.
 *
 * This is not a persisted public trace contract. Grader authors normally
 * receive the result-local `Trace` shape below.
 */
export const TraceArtifactSchema = z.object({
  source: TraceSourceSchema,
  session: TraceSessionSchema,
  branch: TraceBranchSchema.optional(),
  events: z.array(TraceEventSchema),
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
