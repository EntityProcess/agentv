/**
 * Runtime for code grader evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 */
import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import { enrichInput } from './deprecation.js';
import {
  type CodeGraderInput,
  CodeGraderInputSchema,
  type CodeGraderResult,
  CodeGraderResultSchema,
  type EnrichedCodeGraderInput,
} from './schemas.js';

/**
 * Handler function type for code graders.
 *
 * The input is enriched at runtime: `inputText`, `outputText`, and
 * `expectedOutputText` are always populated before the handler is called.
 */
export type CodeGraderHandler = (
  input: EnrichedCodeGraderInput,
) => CodeGraderResult | Promise<CodeGraderResult>;

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
 * Run a code grader handler with full stdin/stdout handling.
 * This is the internal implementation called by defineCodeGrader.
 */
export async function runCodeGrader(handler: CodeGraderHandler): Promise<void> {
  try {
    // 1. Read stdin
    const stdin = readStdin();

    // 2. Parse JSON
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;

    // 3. Convert snake_case to camelCase
    const camelInput = toCamelCaseDeep(rawInput);

    // 4. Validate input with Zod
    const input = CodeGraderInputSchema.parse(camelInput);

    // 5. Set up lazy file-backed output loading if applicable
    if (input.outputPath && (input.output === null || input.output === undefined)) {
      let cachedOutput: CodeGraderInput['output'] | undefined;
      const filePath = input.outputPath;
      Object.defineProperty(input, 'output', {
        get() {
          if (cachedOutput === undefined) {
            cachedOutput = JSON.parse(readFileSync(filePath, 'utf8'));
          }
          return cachedOutput;
        },
        configurable: true,
        enumerable: true,
      });
    }

    // 6. Enrich input with text accessors and deprecation warnings
    enrichInput(input);

    // 7. Run handler (input is now enriched with guaranteed text accessors)
    const rawResult = await handler(input as EnrichedCodeGraderInput);

    // 8. Validate and normalize output
    const result = CodeGraderResultSchema.parse({
      ...rawResult,
      score: clampScore(rawResult.score),
    });

    // 9. Output JSON
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Output failure result
    const errorMessage = formatError(error);
    const errorResult: CodeGraderResult = {
      score: 0,
      assertions: [{ text: `Evaluation failed: ${errorMessage}`, passed: false }],
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

// ── Backward-compat aliases (deprecated) ────────────────────────────────────────
/** @deprecated Use CodeGraderHandler */
export type CodeJudgeHandler = CodeGraderHandler;
/** @deprecated Use runCodeGrader */
export const runCodeJudge = runCodeGrader;
