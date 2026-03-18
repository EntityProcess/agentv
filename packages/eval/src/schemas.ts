/**
 * Zod schemas for code grader input/output validation.
 * Provides both compile-time types and runtime validation.
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
  toolNames: z.array(z.string()),
  toolCallsByName: z.record(z.string(), z.number()),
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

/**
 * Unified message schema for input, expected, and output messages.
 */
export const MessageSchema = z.object({
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  content: z.union([z.string(), z.record(z.unknown()), z.array(z.record(z.unknown()))]).optional(),
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
 * Text convenience accessors (`inputText`, `outputText`, `expectedOutputText`) are always
 * strings. Structured fields (`input`, `output`, `expectedOutput`) are always `Message[]`.
 */
export const CodeGraderInputSchema = z.object({
  /** @deprecated Use `inputText` instead. First user message content as string. */
  question: z.string(),
  criteria: z.string(),
  expectedOutput: z.array(MessageSchema),
  /** @deprecated Use `expectedOutputText` instead. Expected output content as string. */
  referenceAnswer: z.string().optional(),
  /** @deprecated Use `outputText` instead. Last assistant message content as string. */
  answer: z.string(),
  output: z.array(MessageSchema).nullable().optional(),
  /** Path to a temp file containing the output JSON (used for large payloads). */
  outputPath: z.string().optional(),
  guidelineFiles: z.array(z.string()),
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
  /** First user message content as string. Replaces `question`. */
  inputText: z.string().optional(),
  /** Last assistant message content as string. Replaces `answer`. */
  outputText: z.string().optional(),
  /** Expected output content as string. Replaces `referenceAnswer`. */
  expectedOutputText: z.string().optional(),
});

/**
 * Code grader result schema (validated before output).
 */
export const CodeGraderResultSchema = z.object({
  score: z.number().min(0).max(1),
  assertions: z.array(z.object({
    text: z.string(),
    passed: z.boolean(),
    evidence: z.string().optional(),
  })).optional().default([]),
  /** Optional structured details for domain-specific metrics (e.g., TP/TN/FP/FN counts, alignments). */
  details: z.record(z.unknown()).optional(),
});

/**
 * Inferred types from schemas.
 */
export type CodeGraderInput = z.infer<typeof CodeGraderInputSchema>;
export type CodeGraderResult = z.infer<typeof CodeGraderResultSchema>;

/**
 * CodeGraderInput after `enrichInput()` has run.
 *
 * The text convenience accessors (`inputText`, `outputText`, `expectedOutputText`)
 * are always populated by the runtime before the handler is called, so they are
 * guaranteed to be `string` (never `undefined`).
 *
 * Handler function signatures (`CodeGraderHandler`, `AssertionHandler`) use this
 * type so that user code can destructure `{ outputText }` without null-checks.
 */
export type EnrichedCodeGraderInput = Omit<
  CodeGraderInput,
  'inputText' | 'outputText' | 'expectedOutputText'
> & {
  /** First user message content as string. Replaces `question`. */
  readonly inputText: string;
  /** Last assistant message content as string. Replaces `answer`. */
  readonly outputText: string;
  /** Expected output content as string. Replaces `referenceAnswer`. */
  readonly expectedOutputText: string;
};
export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

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
