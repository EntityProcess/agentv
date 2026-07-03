/**
 * Runtime for script grader evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 */
import { readFileSync } from 'node:fs';
import { toCamelCaseDeep } from '@agentv/core';

import { enrichInput } from './deprecation.js';
import {
  type ScriptGraderInput,
  ScriptGraderInputSchema,
  type ScriptGraderResult,
  ScriptGraderResultSchema,
} from './schemas.js';

/**
 * Handler function type for script graders.
 */
export type ScriptGraderHandler = (
  input: ScriptGraderInput,
) => ScriptGraderResult | Promise<ScriptGraderResult>;

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
 * Run a script grader handler with full stdin/stdout handling.
 * This is the internal implementation called by defineScriptGrader.
 */
export async function runScriptGrader(handler: ScriptGraderHandler): Promise<void> {
  try {
    // 1. Read stdin
    const stdin = readStdin();

    // 2. Parse JSON
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;

    // 3. Convert snake_case to camelCase
    const camelInput = toCamelCaseDeep(rawInput);

    // 4. Validate input with Zod
    const input = ScriptGraderInputSchema.parse(camelInput);

    // 5. Set up lazy file-backed output loading if applicable
    if (input.outputPath && (input.output === null || input.output === undefined)) {
      let cachedOutput: ScriptGraderInput['output'] | undefined;
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

    // 6. Enrich input — no-op pass-through
    enrichInput(input);

    // 7. Run handler
    const rawResult = await handler(input);

    // 8. Validate and normalize output
    const result = ScriptGraderResultSchema.parse({
      ...rawResult,
      score: clampScore(rawResult.score),
    });

    // 9. Output JSON
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Output failure result
    const errorMessage = formatError(error);
    const errorResult: ScriptGraderResult = {
      score: 0,
      assertions: [{ text: `Evaluation failed: ${errorMessage}`, passed: false }],
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

/** @deprecated Use ScriptGraderHandler. */
export type CodeGraderHandler = ScriptGraderHandler;

/** @deprecated Use runScriptGrader. */
export const runCodeGrader = runScriptGrader;
