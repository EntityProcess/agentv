/**
 * Runtime for custom assertion evaluators.
 * Handles stdin parsing, validation, error handling, and output formatting.
 *
 * Assertions receive the same input as script graders but use a simplified result
 * contract focused on pass/fail with optional score granularity.
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
 * Context provided to assertion handlers.
 */
export type AssertionContext = ScriptGraderInput;

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
  // kebab-case (canonical internal form)
  | 'llm-grader'
  | 'llm-rubric'
  | 'script'
  | 'assert-set'
  /** @deprecated Authored eval YAML rejects this compatibility-only runtime type. */
  | 'tool-trajectory'
  | 'skill-used'
  | 'not-skill-used'
  | 'trajectory:tool-used'
  | 'trajectory:tool-args-match'
  | 'trajectory:tool-sequence'
  | 'trajectory:step-count'
  | 'trajectory:goal-success'
  | 'field-accuracy'
  | 'latency'
  | 'cost'
  | 'token-usage'
  | 'execution-metrics'
  /** @deprecated Authored eval YAML rejects this compatibility-only runtime type. */
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
  | 'javascript'
  | 'python'
  | 'webhook'
  | 'similar'
  | (string & {});

/**
 * Check returned from an assertion handler.
 */
export interface AssertionCheck {
  readonly id?: string;
  readonly text: string;
  readonly pass: boolean;
  readonly score?: number;
  readonly reason: string;
  readonly evidence?: string;
}

/**
 * Result returned from an assertion handler.
 *
 * @example Pass with score
 * ```ts
 * { pass: true, score: 1, reason: 'Output contains expected keywords' }
 * ```
 *
 * @example Fail with checks
 * ```ts
 * { pass: false, score: 0.3, reason: 'Missing required header', checks: [
 *   { text: 'Header present', pass: false, reason: 'No header found' },
 * ] }
 * ```
 *
 * @example Granular score (0-1)
 * ```ts
 * { score: 0.75, reason: 'Two of three checks passed', checks: [
 *   { text: 'Format correct', pass: true, reason: 'Matches expected format' },
 *   { text: 'Content relevant', pass: true, reason: 'Addresses the request' },
 *   { text: 'Citation present', pass: false, reason: 'Missing citation' },
 * ] }
 * ```
 */
export interface AssertionScore {
  /** Explicit pass/fail. If omitted, derived from score (>= 0.5 = pass). */
  readonly pass?: boolean;
  /** Numeric score between 0 and 1. Defaults to 1 if pass=true, 0 if pass=false. */
  readonly score?: number;
  /** Explanation for the aggregate pass/fail decision. */
  readonly reason?: string;
  /** Per-check verdicts with optional score and evidence. */
  readonly checks?: readonly AssertionCheck[];
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
 * Normalize an AssertionScore to a ScriptGraderResult for wire compatibility.
 */
function normalizeScore(result: AssertionScore): ScriptGraderResult {
  let score: number;
  if (result.score !== undefined) {
    score = clampScore(result.score);
  } else if (result.pass !== undefined) {
    score = result.pass ? 1 : 0;
  } else {
    score = 0;
  }
  const pass = result.pass ?? score >= 0.5;

  return {
    pass,
    score,
    reason: result.reason ?? (pass ? 'Assertion passed' : 'Assertion failed'),
    checks: result.checks
      ? result.checks.map((check) => ({
          ...check,
          ...(check.score !== undefined ? { score: clampScore(check.score) } : {}),
        }))
      : [],
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
    const input = ScriptGraderInputSchema.parse(camelInput);

    // Lazy file-backed output loading
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

    // Enrich input — no-op pass-through
    enrichInput(input);

    // Run handler
    const rawResult = await handler(input);
    const normalized = normalizeScore(rawResult);
    const result = ScriptGraderResultSchema.parse(normalized);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorMessage = formatError(error);
    const errorResult: ScriptGraderResult = {
      pass: false,
      score: 0,
      reason: `Assertion failed: ${errorMessage}`,
      checks: [{ text: 'Assertion execution', pass: false, reason: errorMessage }],
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}
