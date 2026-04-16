/**
 * Programmatic API for running evaluations.
 *
 * Provides `evaluate()` — a high-level function for using AgentV as a library
 * instead of a CLI. The config shape mirrors the YAML structure for easy
 * translation between file-based and programmatic usage.
 *
 * @example Inline tests with config objects
 * ```typescript
 * import { evaluate } from '@agentv/core';
 *
 * const results = await evaluate({
 *   tests: [
 *     {
 *       id: 'capital',
 *       input: 'What is the capital of France?',
 *       expectedOutput: 'Paris',
 *       assert: [{ type: 'contains', value: 'Paris' }],
 *     },
 *   ],
 *   target: { provider: 'mock_agent' },
 * });
 *
 * console.log(results.summary.passed, 'passed');
 * ```
 *
 * @example Inline tests with task function and custom assertion
 * ```typescript
 * import { evaluate } from '@agentv/core';
 *
 * const { summary } = await evaluate({
 *   tests: [
 *     {
 *       id: 'echo',
 *       input: 'hello',
 *       expectedOutput: 'Echo: hello',
 *       assert: [
 *         { type: 'contains', value: 'hello' },
 *         { type: 'equals' },
 *         ({ output }) => ({ name: 'custom', score: output.length > 0 ? 1 : 0 }),
 *       ],
 *     },
 *   ],
 *   task: async (input) => `Echo: ${input}`,
 * });
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

import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildDirectoryChain, findGitRoot } from './file-utils.js';

import type { AssertFn } from './assertions.js';
import { DEFAULT_THRESHOLD } from './graders/scoring.js';
import { runEvaluation } from './orchestrator.js';
import { createFunctionProvider } from './providers/function-provider.js';
import { readTargetDefinitions } from './providers/targets-file.js';
import { type ResolvedTarget, resolveTargetDefinition } from './providers/targets.js';
import type { TargetDefinition } from './providers/types.js';
import { INLINE_ASSERT_FN } from './registry/builtin-graders.js';
import type {
  ConversationAggregation,
  ConversationTurn,
  EvalTest,
  EvaluationResult,
  GraderConfig,
  InlineAssertEvaluatorConfig,
  WorkspaceHookConfig,
} from './types.js';
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
  /** Input to the agent (string or message array). Omit when using turns[]. */
  readonly input?: string | readonly { role: string; content: string }[];
  /** Expected reference output (camelCase preferred) */
  readonly expectedOutput?: string;
  /** @deprecated Use `expectedOutput` instead */
  readonly expected_output?: string;
  /** Assertion graders — accepts factory functions, config objects, or inline functions */
  readonly assert?: readonly AssertEntry[];
  /** Arbitrary metadata */
  readonly metadata?: Record<string, unknown>;
  /** Enable multi-turn conversation mode. Inferred automatically when turns[] is provided. */
  readonly mode?: 'conversation';
  /** Ordered turns for conversation evaluation. Each turn generates a fresh LLM call. */
  readonly turns?: readonly ConversationTurnInput[];
  /** Score aggregation across turns: 'mean' (default), 'min', or 'max'. */
  readonly aggregation?: ConversationAggregation;
}

/**
 * A single turn in a multi-turn conversation evaluation (programmatic API).
 * Mirrors the YAML `turns` structure with camelCase naming.
 */
export interface ConversationTurnInput {
  /** Input for this turn (string or message array) */
  readonly input: string | readonly { role: string; content: string }[];
  /** Expected reference output for this turn */
  readonly expectedOutput?: string;
  /** @deprecated Use `expectedOutput` instead */
  readonly expected_output?: string;
  /** Per-turn assertions (string criteria or grader config) */
  readonly assert?: readonly AssertEntry[];
}

/**
 * Inline assertion definition for the programmatic API.
 * Matches the YAML `assert` block structure.
 */
export interface EvalAssertionInput {
  /** Assertion type (e.g., 'contains', 'llm-grader', 'code-grader') */
  readonly type: string;
  /** Display name */
  readonly name?: string;
  /** Value for deterministic assertions (contains, equals, regex) */
  readonly value?: string;
  /** Weight for scoring */
  readonly weight?: number;
  /** Whether this assertion is required to pass */
  readonly required?: boolean | number;
  /** Minimum score (0-1) for this evaluator to pass. Independent of `required` gate. */
  readonly min_score?: number;
  /** Prompt file for llm_grader */
  readonly prompt?: string;
  /** Script for code_grader */
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

/** Assert entry: inline function or config object */
export type AssertEntry = AssertFn | EvalAssertionInput;

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
  /** Custom task function — mutually exclusive with target */
  readonly task?: (input: string) => string | Promise<string>;
  /** Suite-level assertions applied to all tests */
  readonly assert?: readonly AssertEntry[];
  /** Filter tests by ID pattern(s) (glob supported). Arrays use OR logic. */
  readonly filter?: string | readonly string[];
  /** Maximum concurrent workers (default: 3) */
  readonly workers?: number;
  /** Maximum retries on failure (default: 2) */
  readonly maxRetries?: number;
  /** Agent timeout in milliseconds. No timeout if not set. */
  readonly agentTimeoutMs?: number;
  /** Enable response caching */
  readonly cache?: boolean;
  /** Verbose logging */
  readonly verbose?: boolean;
  /** Callback for each completed result */
  readonly onResult?: (result: EvaluationResult) => void;
  /** Score threshold for pass/fail (0-1). Default: 0.8 (DEFAULT_THRESHOLD). */
  readonly threshold?: number;
  /** Command(s) to run once before the suite starts. Same semantics as YAML before_all. */
  readonly beforeAll?: string | readonly string[];
  /** Suite-level cost cap in USD. Stops dispatching new tests when exceeded. */
  readonly budgetUsd?: number;
}

/**
 * Summary statistics for an evaluation run.
 */
export interface EvalSummary {
  /** Total number of test cases */
  readonly total: number;
  /** Number of passing test cases (score >= threshold) */
  readonly passed: number;
  /** Number of failing test cases (score < threshold) */
  readonly failed: number;
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

  if (config.task && config.target) {
    throw new Error('Cannot specify both "task" and "target" — use one or the other.');
  }

  // Resolve repo root
  const gitRoot = await findGitRoot(process.cwd());
  const repoRoot = gitRoot ?? process.cwd();

  const testFilePath = config.specFile
    ? path.resolve(config.specFile)
    : path.join(process.cwd(), '__programmatic__.yaml');

  // Load .env files from the eval file hierarchy so nested eval-local .env
  // files participate even when the command is launched from a parent folder.
  await loadEnvHierarchy(repoRoot, testFilePath);

  let resolvedTarget: ResolvedTarget;
  let taskProvider: ReturnType<typeof createFunctionProvider> | undefined;
  if (config.task) {
    // Wrap task function as a Provider
    taskProvider = createFunctionProvider(config.task);
    resolvedTarget = {
      kind: 'mock',
      name: 'custom-task',
      config: {},
    };
  } else {
    // Resolve target — inline definition or auto-discover from targets.yaml
    let targetDef: TargetDefinition;
    if (config.target) {
      targetDef = config.target;
    } else {
      targetDef = (await discoverDefaultTarget(repoRoot)) ?? { name: 'default', provider: 'mock' };
    }
    resolvedTarget = resolveTargetDefinition(targetDef);
  }

  let evalCases: readonly EvalTest[] | EvalTest[];

  if (config.specFile) {
    // File-based mode: load from YAML
    evalCases = await loadTests(testFilePath, repoRoot, {
      verbose: config.verbose,
      filter: config.filter,
    });
  } else {
    // Build workspace config with before_all hook if beforeAll is provided
    const suiteWorkspace = config.beforeAll
      ? { hooks: { before_all: toBeforeAllHook(config.beforeAll) } }
      : undefined;

    // Inline mode: convert EvalTestInput[] to EvalTest[]
    evalCases = (config.tests ?? []).map((test): EvalTest => {
      // Conversation mode: use turns[] for input/question derivation
      const isConversation = test.mode === 'conversation' || (test.turns && test.turns.length > 0);

      if (!isConversation && !test.input) {
        throw new Error(`Test '${test.id}': input is required for non-conversation tests`);
      }

      const input = isConversation
        ? toMessageArray(test.turns?.[0]?.input ?? '')
        : toMessageArray(test.input ?? '');

      const question = isConversation
        ? extractQuestion(test.turns?.[0]?.input ?? '')
        : extractQuestion(test.input ?? '');

      const expectedOutputValue = test.expectedOutput ?? test.expected_output;
      const expectedOutput = expectedOutputValue
        ? ([
            { role: 'assistant' as const, content: expectedOutputValue },
          ] as EvalTest['expected_output'])
        : [];

      // Convert inline assertions to evaluator config format
      const allAssertions = [...(test.assert ?? []), ...(config.assert ?? [])];
      const assertConfigs = convertAssertions(allAssertions);

      // Convert conversation turns if present — keep input/expected_output as
      // TestMessageContent (matching YAML parser behavior), not wrapped in message arrays.
      const turns: ConversationTurn[] | undefined = test.turns?.map((turn) => {
        const turnExpected = turn.expectedOutput ?? turn.expected_output;
        return {
          input: turn.input as ConversationTurn['input'],
          ...(turnExpected !== undefined && {
            expected_output: turnExpected as ConversationTurn['expected_output'],
          }),
          assertions: turn.assert ? convertAssertions([...turn.assert]) : undefined,
        };
      });

      return {
        id: test.id,
        criteria: test.criteria ?? '',
        question: String(question),
        input,
        expected_output: expectedOutput,
        reference_answer: expectedOutputValue,
        file_paths: [],
        assertions: assertConfigs.length > 0 ? assertConfigs : undefined,
        metadata: test.metadata,
        ...(suiteWorkspace && { workspace: suiteWorkspace }),
        ...(isConversation && { mode: 'conversation' as const }),
        ...(turns && { turns }),
        ...(test.aggregation && { aggregation: test.aggregation }),
      };
    });
  }

  const collectedResults: EvaluationResult[] = [];

  const results = await runEvaluation({
    testFilePath,
    repoRoot,
    target: resolvedTarget,
    ...(taskProvider ? { providerFactory: () => taskProvider } : {}),
    maxRetries: config.maxRetries ?? 2,
    agentTimeoutMs: config.agentTimeoutMs,
    verbose: config.verbose,
    maxConcurrency: config.workers ?? 3,
    filter: config.filter,
    threshold: config.threshold,
    evalCases,
    ...(config.budgetUsd !== undefined && { budgetUsd: config.budgetUsd }),
    onResult: async (result) => {
      collectedResults.push(result);
      config.onResult?.(result);
    },
  });

  const allResults = collectedResults.length > 0 ? collectedResults : [...results];
  const durationMs = Date.now() - startTime;

  return {
    results: allResults,
    summary: computeSummary(allResults, durationMs, config.threshold),
  };
}

/**
 * Convert a flexible input (string or message array) to the internal TestMessage[] format.
 */
function toMessageArray(
  input: string | readonly { role: string; content: string }[],
): EvalTest['input'] {
  if (typeof input === 'string') {
    return [{ role: 'user' as const, content: input }] as EvalTest['input'];
  }
  return input as unknown as EvalTest['input'];
}

/**
 * Extract the user-facing question string from a flexible input.
 */
function extractQuestion(input: string | readonly { role: string; content: string }[]): string {
  if (typeof input === 'string') return input;
  return input.find((m) => m.role === 'user')?.content ?? '';
}

/**
 * Convert programmatic API beforeAll (string | string[]) to internal WorkspaceHookConfig.
 * Accepts a shell command string or an array of command tokens.
 */
function toBeforeAllHook(beforeAll: string | readonly string[]): WorkspaceHookConfig {
  const command = typeof beforeAll === 'string' ? ['sh', '-c', beforeAll] : [...beforeAll];
  return { command };
}

/**
 * Convert an array of assert entries (inline functions or config objects) to GraderConfig[].
 */
function convertAssertions(entries: readonly AssertEntry[]): GraderConfig[] {
  return entries.map((entry, i) => {
    if (typeof entry === 'function') {
      const base: InlineAssertEvaluatorConfig = {
        type: 'inline-assert',
        name: `inline-assert-${i}`,
      };
      return Object.assign(base, {
        [INLINE_ASSERT_FN]: entry as AssertFn,
      }) as unknown as GraderConfig;
    }
    const a = entry as EvalAssertionInput;
    const { type: rawType, ...rest } = a;
    return {
      ...rest,
      name: a.name ?? `${rawType}_${i}`,
      type: mapAssertionType(rawType),
    } as unknown as GraderConfig;
  });
}

/**
 * Map user-facing assertion type names to internal grader type names.
 * Handles snake_case to kebab-case normalization (e.g., 'llm_grader' -> 'llm-grader').
 */
function mapAssertionType(type: string): string {
  return type.replace(/_/g, '-');
}

/**
 * Compute summary statistics from evaluation results.
 */
function computeSummary(
  results: readonly EvaluationResult[],
  durationMs: number,
  threshold = DEFAULT_THRESHOLD,
): EvalSummary {
  const total = results.length;
  let passed = 0;
  let scoreSum = 0;

  for (const r of results) {
    scoreSum += r.score;
    if (r.score >= threshold) {
      passed++;
    }
  }

  return {
    total,
    passed,
    failed: total - passed,
    durationMs,
    meanScore: total > 0 ? scoreSum / total : 0,
  };
}

const TARGET_FILE_CANDIDATES = ['.agentv/targets.yaml', '.agentv/targets.yml'] as const;

/**
 * Auto-discover the 'default' target from targets.yaml in the repo tree.
 */
async function discoverDefaultTarget(repoRoot: string): Promise<TargetDefinition | null> {
  const cwd = process.cwd();
  const chain = buildDirectoryChain(path.join(cwd, '_placeholder'), repoRoot);

  for (const dir of chain) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const targetsPath = path.join(dir, candidate);
      if (!existsSync(targetsPath)) continue;
      try {
        const definitions = await readTargetDefinitions(targetsPath);
        const defaultTarget = definitions.find((d) => d.name === 'default');
        if (defaultTarget) return defaultTarget;
      } catch {
        // Skip invalid targets files
      }
    }
  }
  return null;
}

/**
 * Load .env files from the directory hierarchy so the closest file wins while
 * parent files still contribute missing keys. Existing process.env values are
 * preserved.
 */
async function loadEnvHierarchy(repoRoot: string, startPath: string): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const chain = buildDirectoryChain(startPath, repoRoot);

  // Collect .env files from closest to root
  const envFiles: string[] = [];
  for (const dir of chain) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) envFiles.push(envPath);
  }

  // buildDirectoryChain returns directories from closest to farthest. Loading in
  // that same order means nearer .env files set shared keys first, while parent
  // .env files loaded afterward only backfill keys that are still missing.
  for (let i = 0; i < envFiles.length; i++) {
    try {
      const content = readFileSync(envFiles[i], 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // Skip unreadable .env files
    }
  }
}
