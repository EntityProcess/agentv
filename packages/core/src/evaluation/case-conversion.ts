import { z } from 'zod';
import type { Trace, TraceSummary } from './trace.js';
import type { EvaluationResult } from './types.js';

/**
 * Shared case-conversion and boundary serialization helpers.
 *
 * AgentV internals use camelCase TypeScript objects. Persisted JSON/JSONL and
 * process-boundary payloads use snake_case for portability. This module is the
 * single conversion implementation used by core, SDK, and CLI code.
 */

const JsonObjectSchema = z.object({}).passthrough();
const TokenUsageBoundarySchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cached: z.number().optional(),
    reasoning: z.number().optional(),
  })
  .passthrough();

export const TraceSummaryBoundarySchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    toolCalls: z.record(z.string(), z.number()),
    errorCount: z.number().int().nonnegative(),
    toolDurations: z.record(z.string(), z.array(z.number())).optional(),
    llmCallCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const TraceBoundarySchema = TraceSummaryBoundarySchema.extend({
  messages: z.array(z.unknown()),
  events: z.array(z.unknown()),
  tokenUsage: TokenUsageBoundarySchema.optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const EvaluationResultBoundarySchema = z
  .object({
    timestamp: z.string(),
    testId: z.string(),
    score: z.number(),
    assertions: z.array(z.unknown()),
    target: z.string(),
    output: z.string(),
    trace: TraceBoundarySchema,
    executionStatus: z.enum(['ok', 'quality_failure', 'execution_error']).optional(),
  })
  .passthrough();

export type TraceSummaryWire = Record<string, unknown>;
export type TraceWire = Record<string, unknown>;
export type EvaluationResultWire = Record<string, unknown>;

/**
 * Converts a camelCase string to snake_case.
 * Examples:
 *   testId -> test_id
 *   outputText -> output_text
 *   conversationId -> conversation_id
 *
 * Note: Keys that start with an uppercase letter are treated as proper nouns
 * and returned unchanged (e.g., "Read", "Edit" for tool names).
 */
function toSnakeCase(str: string): string {
  // Don't convert keys that start with uppercase (proper nouns/tool names)
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(str: string): string {
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively converts all keys in an object from camelCase to snake_case.
 * This is used to convert TypeScript internal representations to snake_case
 * for Python ecosystem compatibility in JSON payloads.
 *
 * Conversion rules:
 * - Object keys: camelCase -> snake_case
 * - Array elements: recursively converted
 * - Primitives: returned unchanged
 * - null/undefined: returned unchanged
 *
 * @param obj - The object to convert (can be any JSON-serializable value)
 * @returns A new object with all keys converted to snake_case
 */
export function toSnakeCaseDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toSnakeCaseDeep(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = toSnakeCase(key);
      result[snakeKey] = toSnakeCaseDeep(value);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively converts all keys in an object from snake_case to camelCase.
 * This is used by optional SDK helpers to map wire payloads into TypeScript-friendly
 * shapes.
 *
 * @param obj - The object to convert (can be any JSON-serializable value)
 * @returns A new object with all keys converted to camelCase
 */
export function toCamelCaseDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCaseDeep(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = toCamelCase(key);
      result[camelKey] = toCamelCaseDeep(value);
    }
    return result;
  }

  return obj;
}

export function serializeTraceSummaryWire(summary: TraceSummary): TraceSummaryWire {
  return toSnakeCaseDeep(TraceSummaryBoundarySchema.parse(summary)) as TraceSummaryWire;
}

export function parseTraceSummaryBoundary(value: unknown): TraceSummary {
  return TraceSummaryBoundarySchema.parse(value) as TraceSummary;
}

export function serializeTraceWire(trace: Trace): TraceWire {
  return toSnakeCaseDeep(TraceBoundarySchema.parse(trace)) as TraceWire;
}

export function parseTraceBoundary(value: unknown): Trace {
  return TraceBoundarySchema.parse(value) as Trace;
}

export function serializeEvaluationResultWire(result: EvaluationResult): EvaluationResultWire {
  return toSnakeCaseDeep(EvaluationResultBoundarySchema.parse(result)) as EvaluationResultWire;
}

export function parseEvaluationResultBoundary(value: unknown): EvaluationResult {
  return EvaluationResultBoundarySchema.parse(value) as EvaluationResult;
}

/**
 * Serialize a generic object-shaped process-boundary payload. Use focused
 * serializers above when the payload is an AgentV-owned result or trace model.
 */
export function serializeSnakeCaseBoundaryPayload(value: unknown): unknown {
  return toSnakeCaseDeep(JsonObjectSchema.parse(value));
}
