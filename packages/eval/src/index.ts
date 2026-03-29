/**
 * AgentV Evaluation SDK
 *
 * Build custom graders for AI agent outputs.
 *
 * @example Custom assertion (simplest way to add evaluation logic)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineAssertion } from '@agentv/eval';
 *
 * export default defineAssertion(({ output, criteria }) => {
 *   const text = output?.map(m => String(m.content ?? '')).join(' ') ?? '';
 *   return {
 *     pass: text.includes('hello'),
 *     assertions: [{ text: 'Checks greeting', passed: text.includes('hello') }],
 *   };
 * }));
 * ```
 *
 * @example Code grader (full control)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeGrader } from '@agentv/eval';
 *
 * export default defineCodeGrader(({ trace, output }) => {
 *   const text = output?.map(m => String(m.content ?? '')).join(' ') ?? '';
 *   return {
 *     score: trace?.eventCount <= 5 ? 1.0 : 0.5,
 *     assertions: [{ text: 'Efficient tool usage', passed: trace?.eventCount <= 5 }],
 *   };
 * }));
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
import { type CodeGraderHandler, runCodeGrader } from './runtime.js';

export type { CodeGraderHandler };
export type { PromptTemplateHandler };

/**
 * Define a code grader with automatic stdin/stdout handling.
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
 *     return { score: 0.5, assertions: [{ text: 'No trace available', passed: false }] };
 *   }
 *
 *   const efficient = trace.eventCount <= 10;
 *   return {
 *     score: efficient ? 1.0 : 0.5,
 *     assertions: [{ text: efficient ? 'Efficient execution' : 'Too many tool calls', passed: efficient }],
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
 * export default definePromptTemplate((ctx) => {
 *   const question = ctx.input.map(m => String(m.content ?? '')).join('\n');
 *   const answer = ctx.output?.map(m => String(m.content ?? '')).join('\n') ?? '';
 *   return `Question: ${question}\nAnswer: ${answer}`;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}

/**
 * Define a custom assertion grader with automatic stdin/stdout handling.
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
 * export default defineAssertion(({ output }) => {
 *   const text = output?.map(m => String(m.content ?? '')).join(' ') ?? '';
 *   return {
 *     pass: text.toLowerCase().includes('hello'),
 *     assertions: [{ text: 'Checks for greeting', passed: text.toLowerCase().includes('hello') }],
 *   };
 * }));
 * ```
 *
 * @example Granular scoring
 * ```typescript
 * import { defineAssertion } from '@agentv/eval';
 *
 * export default defineAssertion(({ output, trace }) => {
 *   const text = output?.map(m => String(m.content ?? '')).join(' ') ?? '';
 *   const hasContent = text.length > 0 ? 0.5 : 0;
 *   const isEfficient = (trace?.eventCount ?? 0) <= 5 ? 0.5 : 0;
 *   return {
 *     score: hasContent + isEfficient,
 *     assertions: [
 *       { text: 'Has content', passed: !!hasContent },
 *       { text: 'Efficient', passed: !!isEfficient },
 *     ],
 *   };
 * }));
 * ```
 */
export function defineAssertion(handler: AssertionHandler): void {
  runAssertion(handler);
}
