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
});

/**
 * Tool call schema for output messages.
 */
export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
});

/**
 * Output message schema.
 */
export const OutputMessageSchema = z.object({
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  // Optional message name (e.g., agent name) used by some providers for multi-agent transcripts.
  name: z.string().optional(),
  content: z.union([z.string(), z.record(z.unknown()), z.array(z.record(z.unknown()))]).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  timestamp: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Test message schema.
 */
export const TestMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.record(z.unknown()), z.array(z.record(z.unknown()))]),
});

/**
 * Code judge input schema (camelCase, converted from snake_case wire format).
 */
export const CodeJudgeInputSchema = z.object({
  question: z.string(),
  expectedOutcome: z.string(),
  expectedMessages: z.array(z.record(z.unknown())),
  referenceAnswer: z.string().optional(),
  candidateAnswer: z.string(),
  outputMessages: z.array(OutputMessageSchema).nullable().optional(),
  guidelineFiles: z.array(z.string()),
  inputFiles: z.array(z.string()),
  inputMessages: z.array(TestMessageSchema),
  codeSnippets: z.array(z.string()).optional().default([]),
  traceSummary: TraceSummarySchema.nullable().optional(),
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
});

/**
 * Inferred types from schemas.
 */
export type CodeJudgeInput = z.infer<typeof CodeJudgeInputSchema>;
export type CodeJudgeResult = z.infer<typeof CodeJudgeResultSchema>;
export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type OutputMessage = z.infer<typeof OutputMessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
