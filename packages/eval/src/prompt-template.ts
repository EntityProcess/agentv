/**
 * Runtime for prompt template evaluators.
 * Handles stdin parsing, validation, error handling, and string output.
 */
import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import { enrichInput } from './deprecation.js';
import { type CodeGraderInput, PromptTemplateInputSchema } from './schemas.js';

/**
 * Handler function type for prompt templates.
 * Returns the prompt string to use for evaluation.
 */
export type PromptTemplateHandler = (input: CodeGraderInput) => string | Promise<string>;

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

    // 5. Enrich input — no-op pass-through
    enrichInput(input);

    // 6. Run handler
    const prompt = await handler(input);

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
 * import { definePromptTemplate, type CodeGraderInput } from '@agentv/eval';
 * import { getTextContent } from '@agentv/core';
 *
 * export default definePromptTemplate((ctx: CodeGraderInput) => {
 *   const question = ctx.input.map(m => getTextContent(m.content)).join('\n');
 *   const answer = ctx.output?.map(m => getTextContent(m.content)).join('\n') ?? '';
 *   return `Question: ${question}\nAnswer: ${answer}`;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}
