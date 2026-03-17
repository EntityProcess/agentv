/**
 * AgentV Evaluation SDK
 *
 * Build custom evaluators for AI agent outputs.
 *
 * @example Custom assertion (simplest way to add evaluation logic)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineAssertion } from '@agentv/eval';
 *
 * export default defineAssertion(({ outputText }) => ({
 *   pass: outputText.includes('hello'),
 *   reasoning: 'Checks greeting',
 * }));
 * ```
 *
 * @example Code grader (full control)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeGrader } from '@agentv/eval';
 *
 * export default defineCodeGrader(({ trace, outputText }) => ({
 *   score: trace?.eventCount <= 5 ? 1.0 : 0.5,
 *   hits: ['Efficient tool usage'],
 *   misses: [],
 * }));
 * ```
 *
 * @example Code grader with target access (requires `target` config in YAML)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeGrader, createTargetClient } from '@agentv/eval';
 *
 * export default defineCodeGrader(async ({ inputText }) => {
 *   const target = createTargetClient();
 *   if (!target) {
 *     return { score: 0, misses: ['Target not available'] };
 *   }
 *
 *   const response = await target.invoke({
 *     question: `Evaluate: ${inputText}`,
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
  CodeGraderInputSchema,
  CodeGraderResultSchema,
  TraceSummarySchema,
  MessageSchema,
  ToolCallSchema,
  TokenUsageSchema,
  PromptTemplateInputSchema,
  type CodeGraderInput,
  type CodeGraderResult,
  type TraceSummary,
  type Message,
  type ToolCall,
  type TokenUsage,
  type PromptTemplateInput,
  // Backward-compat aliases (deprecated)
  CodeJudgeInputSchema,
  CodeJudgeResultSchema,
  type CodeJudgeInput,
  type CodeJudgeResult,
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

// Re-export assertion types
export type {
  AssertionContext,
  AssertionHandler,
  AssertionScore,
  AssertionType,
} from './assertion.js';

import { type AssertionHandler, runAssertion } from './assertion.js';
import { type PromptTemplateHandler, runPromptTemplate } from './prompt-template.js';
import { type CodeGraderHandler, type CodeJudgeHandler, runCodeGrader } from './runtime.js';

export type { CodeGraderHandler };
/** @deprecated Use CodeGraderHandler */
export type { CodeJudgeHandler };
export type { PromptTemplateHandler };

/**
 * Define a code grader evaluator with automatic stdin/stdout handling.
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
 * import { defineCodeGrader } from '@agentv/eval';
 *
 * export default defineCodeGrader(({ trace }) => {
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
 * import { defineCodeGrader, z } from '@agentv/eval';
 *
 * const ConfigSchema = z.object({
 *   maxToolCalls: z.number().default(10),
 * });
 *
 * export default defineCodeGrader(({ trace, config }) => {
 *   const { maxToolCalls } = ConfigSchema.parse(config ?? {});
 *   // Use maxToolCalls...
 * });
 * ```
 */
export function defineCodeGrader(handler: CodeGraderHandler): void {
  // Run immediately when module is loaded
  runCodeGrader(handler);
}

/** @deprecated Use defineCodeGrader */
export const defineCodeJudge = defineCodeGrader;

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
 *   Question: ${ctx.inputText}
 *   Answer: ${ctx.outputText}
 *
 *   ${ctx.expectedOutputText ? `Reference: ${ctx.expectedOutputText}` : ''}
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
 *     Question: ${ctx.inputText}
 *     Candidate Answer: ${ctx.outputText}
 *     ${rubric ? `\nEvaluation Criteria:\n${rubric}` : ''}
 *   `;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}

/**
 * Define a custom assertion evaluator with automatic stdin/stdout handling.
 *
 * Assertions are the simplest way to add custom evaluation logic. They receive
 * the full evaluation context and return a pass/fail result with optional
 * granular scoring.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed context
 * 4. Normalizes the result (pass→score, clamp, etc.)
 * 5. Outputs JSON to stdout
 * 6. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that evaluates the context and returns a result
 *
 * @example Simple pass/fail
 * ```typescript
 * import { defineAssertion } from '@agentv/eval';
 *
 * export default defineAssertion(({ outputText }) => ({
 *   pass: outputText.toLowerCase().includes('hello'),
 *   reasoning: 'Checks for greeting',
 * }));
 * ```
 *
 * @example Granular scoring
 * ```typescript
 * import { defineAssertion } from '@agentv/eval';
 *
 * export default defineAssertion(({ outputText, trace }) => {
 *   const hasContent = outputText.length > 0 ? 0.5 : 0;
 *   const isEfficient = (trace?.eventCount ?? 0) <= 5 ? 0.5 : 0;
 *   return {
 *     score: hasContent + isEfficient,
 *     hits: [
 *       ...(hasContent ? ['Has content'] : []),
 *       ...(isEfficient ? ['Efficient'] : []),
 *     ],
 *   };
 * });
 * ```
 */
export function defineAssertion(handler: AssertionHandler): void {
  runAssertion(handler);
}
