/**
 * Zod schemas for code judge input/output validation.
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
  tokenUsage: TokenUsageSchema.optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  toolDurations: z.record(z.string(), z.array(z.number())).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
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
 * Code judge input schema (camelCase, converted from snake_case wire format).
 */
export const CodeJudgeInputSchema = z.object({
  question: z.string(),
  criteria: z.string(),
  expectedMessages: z.array(MessageSchema),
  referenceAnswer: z.string().optional(),
  candidateAnswer: z.string(),
  outputMessages: z.array(MessageSchema).nullable().optional(),
  guidelineFiles: z.array(z.string()),
  inputFiles: z.array(z.string()),
  inputMessages: z.array(MessageSchema),
  traceSummary: TraceSummarySchema.nullable().optional(),
  fileChanges: z.string().nullable().optional(),
  workspacePath: z.string().nullable().optional(),
  config: z.record(z.unknown()).nullable().optional(),
});

/**
 * Code judge result schema (validated before output).
 */
export const CodeJudgeResultSchema = z.object({
  score: z.number().min(0).max(1),
  hits: z.array(z.string()).optional().default([]),
  misses: z.array(z.string()).optional().default([]),
  reasoning: z.string().optional(),
  /** Optional structured details for domain-specific metrics (e.g., TP/TN/FP/FN counts, alignments). */
  details: z.record(z.unknown()).optional(),
});

/**
 * Inferred types from schemas.
 */
export type CodeJudgeInput = z.infer<typeof CodeJudgeInputSchema>;
export type CodeJudgeResult = z.infer<typeof CodeJudgeResultSchema>;
export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Prompt template input schema (camelCase, converted from snake_case wire format).
 * Uses the same schema as CodeJudgeInput since the orchestrator sends identical payloads.
 */
export const PromptTemplateInputSchema = CodeJudgeInputSchema;

export type PromptTemplateInput = CodeJudgeInput;
