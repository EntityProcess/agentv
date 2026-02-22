/**
 * Programmatic API for running evaluations.
 *
 * Provides `evaluate()` — a high-level function for using AgentV as a library
 * instead of a CLI. The config shape mirrors the YAML structure for easy
 * translation between file-based and programmatic usage.
 *
 * @example Inline tests
 * ```typescript
 * import { evaluate } from '@agentv/core';
 *
 * const results = await evaluate({
 *   tests: [
 *     {
 *       id: 'capital',
 *       input: 'What is the capital of France?',
 *       expected_output: 'Paris',
 *       assert: [{ type: 'contains', value: 'Paris' }],
 *     },
 *   ],
 *   target: { provider: 'mock_agent' },
 * });
 *
 * console.log(results.summary.passed, 'passed');
 * ```
 *
 * @example File-based
 * ```typescript
 * const results = await evaluate({
 *   specFile: './evals/EVAL.yaml',
 *   target: { provider: 'claude_agent' },
 * });
 * ```
 *
 * @module
 */

import path from 'node:path';
import { findGitRoot } from './file-utils.js';

import { runEvaluation } from './orchestrator.js';
import { resolveTargetDefinition } from './providers/targets.js';
import type { TargetDefinition } from './providers/types.js';
import type { EvalTest, EvaluationResult, EvaluatorConfig } from './types.js';
import { loadTests } from './yaml-parser.js';

/**
 * Inline test definition for the programmatic API.
 * Mirrors the YAML test structure.
 */
export interface EvalTestInput {
  /** Unique test identifier */
  readonly id: string;
  /** What the response should accomplish */
  readonly criteria?: string;
  /** Input to the agent (string or message array) */
  readonly input: string | readonly { role: string; content: string }[];
  /** Expected reference output */
  readonly expected_output?: string;
  /** Assertion evaluators */
  readonly assert?: readonly EvalAssertionInput[];
  /** Arbitrary metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Inline assertion definition for the programmatic API.
 * Matches the YAML `assert` block structure.
 */
export interface EvalAssertionInput {
  /** Assertion type (e.g., 'contains', 'llm_judge', 'code_judge') */
  readonly type: string;
  /** Display name */
  readonly name?: string;
  /** Value for deterministic assertions (contains, equals, regex) */
  readonly value?: string;
  /** Weight for scoring */
  readonly weight?: number;
  /** Whether this assertion is required to pass */
  readonly required?: boolean | number;
  /** Prompt file for llm_judge */
  readonly prompt?: string;
  /** Script for code_judge */
  readonly script?: string | readonly string[];
  /** Additional config passed to the assertion */
  readonly config?: Record<string, unknown>;
  /** Nested assertions for composite type */
  readonly assert?: readonly EvalAssertionInput[];
  /** Rubric criteria for rubrics type */
  readonly criteria?: readonly (string | { id?: string; outcome: string; weight?: number })[];
  /** Additional properties */
  readonly [key: string]: unknown;
}

/**
 * Configuration for `evaluate()`.
 * Accepts either inline tests or a spec file path.
 */
export interface EvalConfig {
  /** Inline test definitions (mutually exclusive with specFile) */
  readonly tests?: readonly EvalTestInput[];
  /** Path to an EVAL.yaml spec file (mutually exclusive with tests) */
  readonly specFile?: string;
  /** Target provider configuration */
  readonly target?: TargetDefinition;
  /** Suite-level assertions applied to all tests */
  readonly assert?: readonly EvalAssertionInput[];
  /** Filter tests by ID pattern (glob supported) */
  readonly filter?: string;
  /** Maximum concurrent workers (default: 3) */
  readonly workers?: number;
  /** Maximum retries on failure (default: 2) */
  readonly maxRetries?: number;
  /** Agent timeout in milliseconds (default: 120000) */
  readonly agentTimeoutMs?: number;
  /** Enable response caching */
  readonly cache?: boolean;
  /** Verbose logging */
  readonly verbose?: boolean;
  /** Callback for each completed result */
  readonly onResult?: (result: EvaluationResult) => void;
}

/**
 * Summary statistics for an evaluation run.
 */
export interface EvalSummary {
  /** Total number of test cases */
  readonly total: number;
  /** Number of passing test cases (score >= 0.8) */
  readonly passed: number;
  /** Number of failing test cases (score < 0.5) */
  readonly failed: number;
  /** Number of borderline test cases (0.5 <= score < 0.8) */
  readonly borderline: number;
  /** Total duration in milliseconds */
  readonly durationMs: number;
  /** Mean score across all cases */
  readonly meanScore: number;
}

/**
 * Result of an `evaluate()` call.
 */
export interface EvalRunResult {
  /** Individual test case results */
  readonly results: readonly EvaluationResult[];
  /** Aggregate summary statistics */
  readonly summary: EvalSummary;
}

/**
 * Run an evaluation suite against a target provider.
 *
 * Accepts either inline test definitions or a path to an EVAL.yaml spec file.
 * The config shape mirrors the YAML structure — users can translate between
 * file-based and programmatic usage 1:1.
 *
 * @param config - Evaluation configuration
 * @returns Typed evaluation results with summary statistics
 *
 * @example Inline tests with assertions
 * ```typescript
 * const { results, summary } = await evaluate({
 *   tests: [
 *     {
 *       id: 'greeting',
 *       input: 'Say hello',
 *       assert: [{ type: 'contains', value: 'hello' }],
 *     },
 *   ],
 *   target: { provider: 'mock_agent' },
 * });
 * console.log(`${summary.passed}/${summary.total} passed`);
 * ```
 *
 * @example Load from YAML
 * ```typescript
 * const { summary } = await evaluate({
 *   specFile: './evals/my-eval.yaml',
 *   filter: 'greeting-*',
 * });
 * ```
 */
export async function evaluate(config: EvalConfig): Promise<EvalRunResult> {
  const startTime = Date.now();

  if (config.tests && config.specFile) {
    throw new Error('Cannot specify both "tests" and "specFile" — use one or the other.');
  }
  if (!config.tests && !config.specFile) {
    throw new Error('Must specify either "tests" (inline) or "specFile" (YAML path).');
  }

  // Resolve target
  const targetDef: TargetDefinition = config.target ?? {
    name: 'default',
    provider: 'mock_agent',
  };
  const resolvedTarget = resolveTargetDefinition(targetDef);

  // Resolve repo root
  const gitRoot = await findGitRoot(process.cwd());
  const repoRoot = gitRoot ?? process.cwd();

  let evalCases: readonly EvalTest[] | EvalTest[];
  let testFilePath: string;

  if (config.specFile) {
    // File-based mode: load from YAML
    testFilePath = path.resolve(config.specFile);
    evalCases = await loadTests(testFilePath, repoRoot, {
      verbose: config.verbose,
      filter: config.filter,
    });
  } else {
    // Inline mode: convert EvalTestInput[] to EvalTest[]
    testFilePath = path.join(process.cwd(), '__programmatic__.yaml');
    evalCases = (config.tests ?? []).map((test): EvalTest => {
      const input =
        typeof test.input === 'string'
          ? ([{ role: 'user' as const, content: test.input }] as EvalTest['input'])
          : (test.input as unknown as EvalTest['input']);

      const question =
        typeof test.input === 'string'
          ? test.input
          : (test.input.find((m) => m.role === 'user')?.content ?? '');

      const expectedOutput = test.expected_output
        ? ([
            { role: 'assistant' as const, content: test.expected_output },
          ] as EvalTest['expected_output'])
        : [];

      // Convert inline assertions to evaluator config format
      const allAssertions = [...(test.assert ?? []), ...(config.assert ?? [])];
      const assertConfigs = allAssertions.map((a, i) => {
        const { type: rawType, ...rest } = a;
        return {
          ...rest,
          name: a.name ?? `${rawType}_${i}`,
          type: mapAssertionType(rawType),
        } as unknown as EvaluatorConfig;
      });

      return {
        id: test.id,
        criteria: test.criteria ?? '',
        question: String(question),
        input,
        input_segments: [],
        expected_output: expectedOutput,
        reference_answer: test.expected_output,
        guideline_paths: [process.cwd()],
        guideline_patterns: [],
        file_paths: [],
        evaluators: assertConfigs.length > 0 ? assertConfigs : undefined,
        metadata: test.metadata,
      };
    });
  }

  const collectedResults: EvaluationResult[] = [];

  const results = await runEvaluation({
    testFilePath,
    repoRoot,
    target: resolvedTarget,
    maxRetries: config.maxRetries ?? 2,
    agentTimeoutMs: config.agentTimeoutMs ?? 120_000,
    verbose: config.verbose,
    maxConcurrency: config.workers ?? 3,
    filter: config.filter,
    evalCases,
    onResult: async (result) => {
      collectedResults.push(result);
      config.onResult?.(result);
    },
  });

  const allResults = collectedResults.length > 0 ? collectedResults : [...results];
  const durationMs = Date.now() - startTime;

  return {
    results: allResults,
    summary: computeSummary(allResults, durationMs),
  };
}

/**
 * Map user-facing assertion type names to internal evaluator type names.
 */
function mapAssertionType(type: string): string {
  // Most types map 1:1. Handle known aliases.
  switch (type) {
    case 'code_judge':
      return 'code';
    default:
      return type;
  }
}

/**
 * Compute summary statistics from evaluation results.
 */
function computeSummary(results: readonly EvaluationResult[], durationMs: number): EvalSummary {
  const total = results.length;
  let passed = 0;
  let failed = 0;
  let borderline = 0;
  let scoreSum = 0;

  for (const r of results) {
    scoreSum += r.score;
    if (r.score >= 0.8) {
      passed++;
    } else if (r.score < 0.5) {
      failed++;
    } else {
      borderline++;
    }
  }

  return {
    total,
    passed,
    failed,
    borderline,
    durationMs,
    meanScore: total > 0 ? scoreSum / total : 0,
  };
}
