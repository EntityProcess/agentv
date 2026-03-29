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
