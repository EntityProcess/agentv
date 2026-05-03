/**
 * Runtime for custom assertion evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 *
 * Assertions receive the same input as code graders but use a simplified result
 * contract focused on pass/fail with optional score granularity.
 */
import { readFileSync } from 'node:fs';

import { toCamelCaseDeep } from './case-conversion.js';
import { enrichInput } from './deprecation.js';
import {
  type CodeGraderInput,
  CodeGraderInputSchema,
  type CodeGraderResult,
  CodeGraderResultSchema,
} from './schemas.js';

/**
 * Context provided to assertion handlers.
 */
export type AssertionContext = CodeGraderInput;

/**
 * Known built-in assertion types. Custom types are extensible via string.
 *
 * Use in EVAL.yaml `assertions` blocks:
 * ```yaml
 * assertions:
 *   - type: contains
 *     value: "Paris"
 * ```
 *
 * Custom types registered via `.agentv/assertions/` or `defineAssertion()`
 * are also valid — the `string & {}` escape hatch provides autocomplete
 * for known types while accepting any string.
 */
export type AssertionType =
  // kebab-case (canonical internal form)
  | 'llm-grader'
  | 'code-grader'
  | 'rubrics'
  | 'composite'
  | 'tool-trajectory'
  | 'field-accuracy'
  | 'latency'
  | 'cost'
  | 'token-usage'
  | 'execution-metrics'
  | 'skill-trigger'
  | 'contains'
  | 'contains-any'
  | 'contains-all'
  | 'icontains'
  | 'icontains-any'
  | 'icontains-all'
  | 'starts-with'
  | 'ends-with'
  | 'equals'
  | 'regex'
  | 'is-json'
  // legacy snake_case aliases (still accepted)
  | 'llm_grader'
  | 'code_grader'
  | 'tool_trajectory'
  | 'field_accuracy'
  | 'token_usage'
  | 'execution_metrics'
  | 'contains_any'
  | 'contains_all'
  | 'icontains_any'
  | 'icontains_all'
  | 'starts_with'
  | 'ends_with'
  | 'is_json'
  | (string & {});

/**
 * Result returned from an assertion handler.
 *
 * @example Pass with score
 * ```ts
 * { pass: true, assertions: [{ text: 'Output contains expected keywords', passed: true }] }
 * ```
 *
 * @example Fail with evidence
 * ```ts
 * { pass: false, score: 0.3, assertions: [{ text: 'Missing required header', passed: false }] }
 * ```
 *
 * @example Granular score (0-1)
 * ```ts
 * { score: 0.75, assertions: [
 *   { text: 'Format correct', passed: true },
 *   { text: 'Content relevant', passed: true },
 *   { text: 'Missing citation', passed: false },
 * ] }
 * ```
 */
export interface AssertionScore {
  /** Explicit pass/fail. If omitted, derived from score (>= 0.5 = pass). */
  readonly pass?: boolean;
  /** Numeric score between 0 and 1. Defaults to 1 if pass=true, 0 if pass=false. */
  readonly score?: number;
  /** Per-assertion verdicts with optional evidence. */
  readonly assertions?: readonly {
    readonly text: string;
    readonly passed: boolean;
    readonly evidence?: string;
  }[];
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
 * Normalize an AssertionScore to a CodeGraderResult for wire compatibility.
 */
function normalizeScore(result: AssertionScore): CodeGraderResult {
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
    assertions: result.assertions ? [...result.assertions] : [],
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
    const input = CodeGraderInputSchema.parse(camelInput);

    // Lazy file-backed output loading
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

    // Enrich input — no-op pass-through
    enrichInput(input);

    // Run handler
    const rawResult = await handler(input);
    const normalized = normalizeScore(rawResult);
    const result = CodeGraderResultSchema.parse(normalized);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorMessage = formatError(error);
    const errorResult: CodeGraderResult = {
      score: 0,
      assertions: [{ text: `Assertion failed: ${errorMessage}`, passed: false }],
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}
