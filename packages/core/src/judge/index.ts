/**
 * Declarative SDK for code judge evaluators.
 *
 * @example
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeJudge } from '@agentv/core/judge';
 *
 * export default defineCodeJudge(({ traceSummary, candidateAnswer }) => ({
 *   score: traceSummary?.eventCount <= 5 ? 1.0 : 0.5,
 *   hits: ['Efficient tool usage'],
 *   misses: [],
 * }));
 * ```
 *
 * @packageDocumentation
 */

// Re-export schemas (for validation)
export {
  CodeJudgeInputSchema,
  CodeJudgeResultSchema,
  TraceSummarySchema,
  OutputMessageSchema,
  ToolCallSchema,
  TokenUsageSchema,
  type CodeJudgeInput,
  type CodeJudgeResult,
} from './schemas.js';

// Re-export canonical types from core (for type safety)
export type { TraceSummary, TokenUsage } from '../evaluation/trace.js';
export type { OutputMessage, ToolCall } from '../evaluation/providers/types.js';

// Re-export Zod for typed config support
export { z } from 'zod';

// Import runtime
import { type CodeJudgeHandler, runCodeJudge } from './runtime.js';

export type { CodeJudgeHandler };

/**
 * Define a code judge evaluator with automatic stdin/stdout handling.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed input
 * 4. Validates the result and outputs JSON to stdout
 * 5. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that evaluates the input and returns a result
 *
 * @example
 * ```typescript
 * import { defineCodeJudge } from '@agentv/core/judge';
 *
 * export default defineCodeJudge(({ traceSummary }) => {
 *   if (!traceSummary) {
 *     return { score: 0.5, reasoning: 'No trace available' };
 *   }
 *
 *   const efficient = traceSummary.eventCount <= 10;
 *   return {
 *     score: efficient ? 1.0 : 0.5,
 *     hits: efficient ? ['Efficient execution'] : [],
 *     misses: efficient ? [] : ['Too many tool calls'],
 *   };
 * });
 * ```
 *
 * @example With typed config
 * ```typescript
 * import { defineCodeJudge, z } from '@agentv/core/judge';
 *
 * const ConfigSchema = z.object({
 *   maxToolCalls: z.number().default(10),
 * });
 *
 * export default defineCodeJudge(({ traceSummary, config }) => {
 *   const { maxToolCalls } = ConfigSchema.parse(config ?? {});
 *   // Use maxToolCalls...
 * });
 * ```
 */
export function defineCodeJudge(handler: CodeJudgeHandler): void {
  // Run immediately when module is loaded
  runCodeJudge(handler);
}
