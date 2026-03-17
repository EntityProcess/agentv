/**
 * Runtime for prompt template evaluators.
 * Handles stdin parsing, validation, error handling, and string output.
 */
import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import { enrichInput } from './deprecation.js';
import {
  type EnrichedCodeGraderInput,
  PromptTemplateInputSchema,
} from './schemas.js';

/**
 * Handler function type for prompt templates.
 * Returns the prompt string to use for evaluation.
 *
 * The input is enriched at runtime: `inputText`, `outputText`, and
 * `expectedOutputText` are always populated before the handler is called.
 */
export type PromptTemplateHandler = (input: EnrichedCodeGraderInput) => string | Promise<string>;

/**
 * Read stdin synchronously (works in both Node.js and Bun).
 */
function readStdin(): string {
  return readFileSync(0, 'utf8');
}

/**
 * Run a prompt template handler with full stdin/stdout handling.
 * This is the internal implementation called by definePromptTemplate.
 */
export async function runPromptTemplate(handler: PromptTemplateHandler): Promise<void> {
  try {
    // 1. Read stdin
    const stdin = readStdin();

    // 2. Parse JSON
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;

    // 3. Convert snake_case to camelCase
    const camelInput = toCamelCaseDeep(rawInput);

    // 4. Validate input with Zod
    const input = PromptTemplateInputSchema.parse(camelInput);

    // 5. Enrich input with text accessors and deprecation warnings
    enrichInput(input);

    // 6. Run handler (input is now enriched with guaranteed text accessors)
    const prompt = await handler(input as EnrichedCodeGraderInput);

    // 6. Output raw string (not JSON) - the prompt itself
    console.log(prompt);
  } catch (error) {
    // Output error to stderr and exit with non-zero code
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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
 *
 * @example Async handler
 * ```typescript
 * import { definePromptTemplate } from '@agentv/eval';
 *
 * export default definePromptTemplate(async (ctx) => {
 *   // Async operations are supported
 *   return `Question: ${ctx.inputText}\nAnswer: ${ctx.outputText}`;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}
