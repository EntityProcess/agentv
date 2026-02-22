/**
 * Runtime for custom assertion evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 *
 * Assertions receive the same input as code judges but use a simplified result
 * contract focused on pass/fail with optional score granularity.
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
 * Context provided to assertion handlers.
 * Same shape as CodeJudgeInput — assertions receive full evaluation context.
 */
export type AssertionContext = CodeJudgeInput;

/**
 * Known built-in assertion types. Custom types are extensible via string.
 *
 * Use in EVAL.yaml `assert` blocks:
 * ```yaml
 * assert:
 *   - type: contains
 *     value: "Paris"
 * ```
 *
 * Custom types registered via `.agentv/assertions/` or `defineAssertion()`
 * are also valid — the `string & {}` escape hatch provides autocomplete
 * for known types while accepting any string.
 */
export type AssertionType =
  | 'llm_judge'
  | 'code_judge'
  | 'rubrics'
  | 'composite'
  | 'tool_trajectory'
  | 'field_accuracy'
  | 'latency'
  | 'cost'
  | 'token_usage'
  | 'execution_metrics'
  | 'agent_judge'
  | 'contains'
  | 'equals'
  | 'regex'
  | 'is_json'
  | (string & {});

/**
 * Result returned from an assertion handler.
 *
 * @example Pass with reasoning
 * ```ts
 * { pass: true, reasoning: 'Output contains expected keywords' }
 * ```
 *
 * @example Fail with misses
 * ```ts
 * { pass: false, misses: ['Missing required header'], score: 0.3 }
 * ```
 *
 * @example Granular score (0-1)
 * ```ts
 * { score: 0.75, hits: ['Format correct', 'Content relevant'], misses: ['Missing citation'] }
 * ```
 */
export interface AssertionScore {
  /** Explicit pass/fail. If omitted, derived from score (>= 0.5 = pass). */
  readonly pass?: boolean;
  /** Numeric score between 0 and 1. Defaults to 1 if pass=true, 0 if pass=false. */
  readonly score?: number;
  /** Aspects that passed. */
  readonly hits?: readonly string[];
  /** Aspects that failed. */
  readonly misses?: readonly string[];
  /** Human-readable explanation. */
  readonly reasoning?: string;
  /** Optional structured details for domain-specific metrics. */
  readonly details?: Record<string, unknown>;
}

/**
 * Handler function type for assertions.
 */
export type AssertionHandler = (ctx: AssertionContext) => AssertionScore | Promise<AssertionScore>;

/**
 * Read stdin synchronously.
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Normalize an AssertionScore to a CodeJudgeResult for wire compatibility.
 */
function normalizeScore(result: AssertionScore): CodeJudgeResult {
  let score: number;
  if (result.score !== undefined) {
    score = clampScore(result.score);
  } else if (result.pass !== undefined) {
    score = result.pass ? 1 : 0;
  } else {
    score = 0;
  }

  return {
    score,
    hits: result.hits ? [...result.hits] : [],
    misses: result.misses ? [...result.misses] : [],
    reasoning: result.reasoning,
    details: result.details,
  };
}

/**
 * Run an assertion handler with full stdin/stdout handling.
 * This is the internal implementation called by defineAssertion.
 */
export async function runAssertion(handler: AssertionHandler): Promise<void> {
  try {
    const stdin = readStdin();
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;
    const camelInput = toCamelCaseDeep(rawInput);
    const input = CodeJudgeInputSchema.parse(camelInput);

    // Lazy file-backed output loading
    if (input.outputPath && (input.output === null || input.output === undefined)) {
      let cachedOutput: CodeJudgeInput['output'] | undefined;
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

    const rawResult = await handler(input);
    const normalized = normalizeScore(rawResult);
    const result = CodeJudgeResultSchema.parse(normalized);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorMessage = formatError(error);
    const errorResult: CodeJudgeResult = {
      score: 0,
      hits: [],
      misses: [errorMessage],
      reasoning: `Assertion failed: ${errorMessage}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}
