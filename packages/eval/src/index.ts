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
 * export default defineCodeJudge(({ trace, answer }) => ({
 *   score: trace?.eventCount <= 5 ? 1.0 : 0.5,
 *   hits: ['Efficient tool usage'],
 *   misses: [],
 * }));
 * ```
 *
 * @example Code judge with target access (requires `target` config in YAML)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeJudge, createTargetClient } from '@agentv/eval';
 *
 * export default defineCodeJudge(async ({ question }) => {
 *   const target = createTargetClient();
 *   if (!target) {
 *     return { score: 0, misses: ['Target not available'] };
 *   }
 *
 *   const response = await target.invoke({
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
  MessageSchema,
  ToolCallSchema,
  TokenUsageSchema,
  PromptTemplateInputSchema,
  type CodeJudgeInput,
  type CodeJudgeResult,
  type TraceSummary,
  type Message,
  type ToolCall,
  type TokenUsage,
  type PromptTemplateInput,
} from './schemas.js';

// Re-export target client
export {
  createTargetClient,
  TargetNotAvailableError,
  TargetInvocationError,
  type TargetClient,
  type TargetInfo,
  type TargetInvokeRequest,
  type TargetInvokeResponse,
} from './target-client.js';

// Re-export Zod for typed config support
export { z } from 'zod';

import { type PromptTemplateHandler, runPromptTemplate } from './prompt-template.js';
// Import runtime
import { type CodeJudgeHandler, runCodeJudge } from './runtime.js';

export type { CodeJudgeHandler };
export type { PromptTemplateHandler };

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
 * export default defineCodeJudge(({ trace }) => {
 *   if (!trace) {
 *     return { score: 0.5, reasoning: 'No trace available' };
 *   }
 *
 *   const efficient = trace.eventCount <= 10;
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
 * export default defineCodeJudge(({ trace, config }) => {
 *   const { maxToolCalls } = ConfigSchema.parse(config ?? {});
 *   // Use maxToolCalls...
 * });
 * ```
 */
export function defineCodeJudge(handler: CodeJudgeHandler): void {
  // Run immediately when module is loaded
  runCodeJudge(handler);
}

/**
 * Define a prompt template with automatic stdin/stdout handling.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed input
 * 4. Outputs the generated prompt string to stdout
 * 5. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that generates the prompt string from input
 *
 * @example
 * ```typescript
 * import { definePromptTemplate } from '@agentv/eval';
 *
 * export default definePromptTemplate((ctx) => `
 *   Question: ${ctx.question}
 *   Answer: ${ctx.answer}
 *
 *   ${ctx.referenceAnswer ? `Reference: ${ctx.referenceAnswer}` : ''}
 * `);
 * ```
 *
 * @example With conditional logic
 * ```typescript
 * import { definePromptTemplate } from '@agentv/eval';
 *
 * export default definePromptTemplate((ctx) => {
 *   const rubric = ctx.config?.rubric as string | undefined;
 *   return `
 *     Question: ${ctx.question}
 *     Candidate Answer: ${ctx.answer}
 *     ${rubric ? `\nEvaluation Criteria:\n${rubric}` : ''}
 *   `;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}
