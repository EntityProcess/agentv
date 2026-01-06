/**
 * Runtime for code judge evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 */
import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import {
  type CodeJudgeInput,
  CodeJudgeInputSchema,
  type CodeJudgeResult,
  CodeJudgeResultSchema,
} from './schemas.js';

/**
 * Handler function type for code judges.
 */
export type CodeJudgeHandler = (
  input: CodeJudgeInput,
) => CodeJudgeResult | Promise<CodeJudgeResult>;

/**
 * Read stdin synchronously (works in both Node.js and Bun).
 */
function readStdin(): string {
  return readFileSync(0, 'utf8');
}

/**
 * Clamp a value to the range [0, 1].
 */
function clampScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Format an error for output.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Run a code judge handler with full stdin/stdout handling.
 * This is the internal implementation called by defineCodeJudge.
 */
export async function runCodeJudge(handler: CodeJudgeHandler): Promise<void> {
  try {
    // 1. Read stdin
    const stdin = readStdin();

    // 2. Parse JSON
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;

    // 3. Convert snake_case to camelCase
    const camelInput = toCamelCaseDeep(rawInput);

    // 4. Validate input with Zod
    const input = CodeJudgeInputSchema.parse(camelInput);

    // 5. Run handler
    const rawResult = await handler(input);

    // 6. Validate and normalize output
    const result = CodeJudgeResultSchema.parse({
      ...rawResult,
      score: clampScore(rawResult.score),
    });

    // 7. Output JSON
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Output failure result
    const errorMessage = formatError(error);
    const errorResult: CodeJudgeResult = {
      score: 0,
      hits: [],
      misses: [errorMessage],
      reasoning: `Evaluation failed: ${errorMessage}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}
