/**
 * AgentV Evaluation SDK
 *
 * Build custom code judges for evaluating AI agent outputs.
 *
 * @example Basic code judge
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeJudge } from '@agentv/eval';
 *
 * export default defineCodeJudge(({ traceSummary, candidateAnswer }) => ({
 *   score: traceSummary?.eventCount <= 5 ? 1.0 : 0.5,
 *   hits: ['Efficient tool usage'],
 *   misses: [],
 * }));
 * ```
 *
 * @example Code judge with judge proxy (requires `judge` config in YAML)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeJudge, createJudgeProxyClientFromEnv } from '@agentv/eval';
 *
 * export default defineCodeJudge(async ({ question }) => {
 *   const judge = createJudgeProxyClientFromEnv();
 *   if (!judge) {
 *     return { score: 0, misses: ['Judge proxy not available'] };
 *   }
 *
 *   const response = await judge.invoke({
 *     question: `Evaluate: ${question}`,
 *     systemPrompt: 'Respond with JSON: { "score": 0-1 }'
 *   });
 *
 *   const result = JSON.parse(response.rawText ?? '{}');
 *   return { score: result.score ?? 0 };
 * });
 * ```
 *
 * @packageDocumentation
 */

// Re-export schemas and types
export {
  CodeJudgeInputSchema,
  CodeJudgeResultSchema,
  TraceSummarySchema,
  OutputMessageSchema,
  ToolCallSchema,
  TokenUsageSchema,
  type CodeJudgeInput,
  type CodeJudgeResult,
  type TraceSummary,
  type OutputMessage,
  type ToolCall,
  type TokenUsage,
} from './schemas.js';

// Re-export judge proxy client
export {
  createJudgeProxyClientFromEnv,
  createJudgeProxyClient,
  JudgeProxyNotAvailableError,
  JudgeInvocationError,
  type JudgeProxyClient,
  type JudgeInvokeRequest,
  type JudgeInvokeResponse,
} from './judge-proxy-client.js';

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
 * import { defineCodeJudge } from '@agentv/eval';
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
 * import { defineCodeJudge, z } from '@agentv/eval';
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
