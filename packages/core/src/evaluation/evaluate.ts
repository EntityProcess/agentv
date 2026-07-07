/**
 * Programmatic API for running evaluations.
 *
 * Provides `evaluate()` — a high-level function for using AgentV as a library
 * instead of a CLI. The config shape mirrors the YAML structure for easy
 * translation between file-based and programmatic usage.
 *
 * @example Inline tests with config objects
 * ```typescript
 * import { evaluate } from 'agentv';
 *
 * const results = await evaluate({
 *   prompts: ['{{ question }}'],
 *   tests: [
 *     {
 *       id: 'capital',
 *       vars: { question: 'What is the capital of France?' },
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
 * import { evaluate } from 'agentv';
 *
 * const { summary } = await evaluate({
 *   prompts: ['{{ text }}'],
 *   tests: [
 *     {
 *       id: 'echo',
 *       vars: { text: 'hello' },
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
import micromatch from 'micromatch';
import { buildDirectoryChain, findGitRoot } from './file-utils.js';

import type { AssertFn } from './assertions.js';
import {
  ResponseCache,
  shouldEnableCache,
  shouldSkipCacheForTemperature,
} from './cache/response-cache.js';
import { DEFAULT_THRESHOLD } from './graders/scoring.js';
import { interpolateTemplateVars } from './interpolation.js';
import type { EvalMetadata } from './metadata.js';
import { runEvaluation } from './orchestrator.js';
import { createFunctionProvider } from './providers/function-provider.js';
import type { ProviderFactoryFn } from './providers/provider-registry.js';
import { readProviderDefinitions } from './providers/targets-file.js';
import { type ResolvedProviderBackend, resolveProviderDefinition } from './providers/targets.js';
import type { ProviderDefinition } from './providers/types.js';
import { INLINE_ASSERT_FN } from './registry/builtin-graders.js';
import { writeArtifactsFromResults } from './run-artifacts.js';
import type {
  ConversationAggregation,
  ConversationTurn,
  EvalTest,
  EvaluationResult,
  GraderConfig,
  InlineAssertEvaluatorConfig,
  WorkspaceHookConfig,
} from './types.js';
import { loadTestSuite } from './yaml-parser.js';

/**
 * Inline test definition for the programmatic API.
 * Mirrors the YAML test structure.
 */
export interface EvalTestInput {
  /** Unique test identifier */
  readonly id: string;
  /** Optional human-readable test description */
  readonly description?: string;
  /** What the response should accomplish */
  readonly criteria?: string;
  /** Per-test prompt variables used by config.prompts templates. */
  readonly vars?: Record<string, unknown>;
  /** Expected reference output */
  readonly expectedOutput?: string;
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
  /** Per-turn assertions (string criteria or grader config) */
  readonly assert?: readonly AssertEntry[];
}

/**
 * Inline assertion definition for the programmatic API.
 * Matches the YAML `assert` block structure.
 */
export interface EvalAssertionInput {
  /** Assertion type (e.g., 'contains', 'llm-rubric', 'script') */
  readonly type: string;
  /** Score/check metric name */
  readonly metric?: string;
  /** Value for deterministic assertions (contains, equals, regex) */
  readonly value?: string;
  /** Weight for scoring */
  readonly weight?: number;
  /** Whether this assertion is required to pass */
  readonly required?: boolean;
  /** Minimum score (0-1) for this evaluator to pass. Independent of `required` gate. */
  readonly min_score?: number;
  /** Prompt file for LLM rubric assertions */
  readonly prompt?: string;
  /** Command for script grader */
  readonly command?: string | readonly string[];
  /** Additional config passed to the assertion */
  readonly config?: Record<string, unknown>;
  /** Nested assertions for assert-set grouping */
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
  /** Prompt templates for inline tests. Use tests[].vars for per-row values. */
  readonly prompts?: readonly (string | readonly { role: string; content: string }[])[];
  /** Target provider configuration */
  readonly target?: ProviderDefinition;
  /** Custom task function — mutually exclusive with target */
  readonly task?: (input: string) => string | Promise<string>;
  /** Suite-level assert entries applied to all tests */
  readonly assert?: readonly AssertEntry[];
  /** Optional suite metadata used by CLI discovery, tagging, and reporting. */
  readonly metadata?: EvalMetadata;
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
  /** Response cache directory. Requires cache to be enabled. */
  readonly cachePath?: string;
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
  /** Optional run workspace directory for canonical AgentV artifacts. */
  readonly outputDir?: string;
  /** Optional experiment name recorded in summary.json and index.jsonl. */
  readonly experiment?: string;
}

export interface MaterializedEvalConfig {
  readonly testFilePath: string;
  readonly tests: readonly EvalTest[];
  readonly workers?: number;
  readonly cache?: boolean;
  readonly cachePath?: string;
  readonly budgetUsd?: number;
  readonly threshold?: number;
  readonly metadata?: EvalMetadata;
  readonly target?: ProviderDefinition;
  readonly targets?: readonly ProviderDefinition[];
  readonly task?: (input: string) => string | Promise<string>;
  readonly providerFactory?: ProviderFactoryFn;
}

/**
 * Summary statistics for an evaluation run.
 */
export interface EvalSummary {
  /** Total number of test cases */
  readonly total: number;
  /** Number of non-execution-error test cases whose score is >= threshold */
  readonly passed: number;
  /** Number of non-execution-error test cases whose score is < threshold */
  readonly failed: number;
  /** Number of test cases that failed before quality could be evaluated */
  readonly executionErrors: number;
  /** Total duration in milliseconds */
  readonly durationMs: number;
  /** Mean score across non-execution-error cases */
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
  /** Canonical run artifact paths when `outputDir` is provided. */
  readonly artifacts?: EvalRunArtifacts;
}

export interface EvalRunArtifacts {
  readonly runDir: string;
  readonly indexPath: string;
  readonly summaryPath: string;
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
 *   prompts: ['{{ input }}'],
 *   tests: [
 *     {
 *       id: 'greeting',
 *       vars: { input: 'Say hello' },
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

  const materialized = await materializeEvalConfig(config, {
    repoRoot,
    baseDir: process.cwd(),
  });
  const testFilePath = materialized.testFilePath;

  // Load .env files from the eval file hierarchy so nested eval-local .env
  // files participate even when the command is launched from a parent folder.
  await loadEnvHierarchy(repoRoot, testFilePath);

  let resolvedTarget: ResolvedProviderBackend;
  let providerFactory: ProviderFactoryFn | undefined;
  if (config.task || materialized.providerFactory) {
    providerFactory = config.task
      ? () => createFunctionProvider(config.task as (input: string) => string | Promise<string>)
      : materialized.providerFactory;
    resolvedTarget = {
      kind: 'mock',
      name: 'custom-task',
      config: {},
    };
  } else {
    // Resolve target — inline definition or auto-discover from providers.yaml
    let targetDef: ProviderDefinition;
    if (config.target) {
      targetDef = config.target;
    } else if (materialized.target) {
      targetDef = materialized.target;
    } else {
      targetDef = (await discoverDefaultTarget(repoRoot)) ?? { name: 'default', provider: 'mock' };
    }
    resolvedTarget = resolveProviderDefinition(targetDef);
  }

  const collectedResults: EvaluationResult[] = [];
  const cacheEnabled = shouldEnableCache({
    cliCache: config.cache === true,
    cliNoCache: false,
    yamlCache: config.cache === undefined ? materialized.cache : undefined,
  });
  const cache = cacheEnabled
    ? new ResponseCache(materialized.cachePath ? path.resolve(materialized.cachePath) : undefined)
    : undefined;

  const results = await runEvaluation({
    testFilePath,
    repoRoot,
    target: resolvedTarget,
    ...(materialized.targets ? { targets: materialized.targets } : {}),
    ...(providerFactory ? { providerFactory } : {}),
    maxRetries: config.maxRetries ?? 2,
    agentTimeoutMs: config.agentTimeoutMs,
    verbose: config.verbose,
    maxConcurrency: config.workers ?? 3,
    filter: config.filter,
    threshold: config.threshold,
    evalCases: materialized.tests,
    cache,
    useCache:
      !!cache &&
      !shouldSkipCacheForTemperature(resolvedTarget.config as unknown as Record<string, unknown>),
    ...(materialized.budgetUsd !== undefined && { budgetUsd: materialized.budgetUsd }),
    onResult: async (result) => {
      collectedResults.push(result);
      config.onResult?.(result);
    },
  });

  const allResults = collectedResults.length > 0 ? collectedResults : [...results];
  const durationMs = Date.now() - startTime;
  const outputDir = config.outputDir ? path.resolve(config.outputDir) : undefined;
  const artifacts = outputDir
    ? await writeArtifactsFromResults(allResults, outputDir, {
        evalFile: config.specFile ? testFilePath : '',
        experiment: config.experiment,
        sourceTests: materialized.tests,
      }).then(({ summaryPath, indexPath }) => ({
        runDir: outputDir,
        summaryPath,
        indexPath,
      }))
    : undefined;

  return {
    results: allResults,
    summary: computeSummary(allResults, durationMs, config.threshold),
    artifacts,
  };
}

export async function materializeEvalConfig(
  config: EvalConfig,
  options?: {
    readonly repoRoot?: string;
    readonly baseDir?: string;
    readonly filter?: string | readonly string[];
    readonly category?: string;
  },
): Promise<MaterializedEvalConfig> {
  const baseDir = options?.baseDir ?? process.cwd();
  const repoRoot = options?.repoRoot ?? (await findGitRoot(baseDir)) ?? baseDir;
  const testFilePath = config.specFile
    ? path.resolve(baseDir, config.specFile)
    : path.join(baseDir, '__programmatic__.yaml');
  const effectiveFilter = options?.filter ?? config.filter;

  if (config.specFile) {
    const suite = await loadTestSuite(testFilePath, repoRoot, {
      verbose: config.verbose,
      filter: effectiveFilter,
      category: options?.category,
    });
    const tests = applyProgrammaticSuiteOverrides(suite.tests, config);
    const suiteTargetDefinitions = suite.targetRefs
      ?.map((targetRef) => targetRef.definition)
      .filter((definition): definition is ProviderDefinition => definition !== undefined);
    return {
      testFilePath,
      tests,
      workers: config.workers,
      cache: config.cache ?? suite.cacheConfig?.enabled,
      cachePath: config.cachePath ?? suite.cacheConfig?.cachePath,
      budgetUsd: config.budgetUsd ?? suite.budgetUsd,
      threshold: config.threshold ?? suite.threshold,
      metadata: config.metadata ?? suite.metadata,
      target: config.target ?? suite.inlineTarget ?? suiteTargetDefinitions?.[0],
      ...(suiteTargetDefinitions && suiteTargetDefinitions.length > 0
        ? { targets: suiteTargetDefinitions }
        : {}),
      task: config.task,
      providerFactory: suite.providerFactory,
    };
  }

  const tests = buildInlineEvalTests(config, {
    filter: effectiveFilter,
    category: options?.category,
    testFilePath,
  });

  return {
    testFilePath,
    tests,
    workers: config.workers,
    cache: config.cache,
    cachePath: config.cachePath,
    budgetUsd: config.budgetUsd,
    threshold: config.threshold,
    metadata: config.metadata,
    target: config.target,
    task: config.task,
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

function isPromptMessageArray(
  value: unknown,
): value is readonly { role: string; content: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { role?: unknown }).role === 'string' &&
        typeof (entry as { content?: unknown }).content === 'string',
    )
  );
}

function renderInlinePrompt(
  prompt: string | readonly { role: string; content: string }[],
  vars: Readonly<Record<string, unknown>>,
  location: string,
): EvalTest['input'] {
  const rendered = interpolateTemplateVars(prompt, vars);
  if (typeof rendered === 'string' || isPromptMessageArray(rendered)) {
    return toMessageArray(rendered);
  }
  throw new Error(
    `${location}: rendered prompt must be a string or chat message array. Check tests[].vars values used by config.prompts.`,
  );
}

/**
 * Extract the user-facing question string from a flexible input.
 */
function extractQuestion(input: string | readonly { role: string; content: string }[]): string {
  if (typeof input === 'string') return input;
  return input.find((m) => m.role === 'user')?.content ?? '';
}

function extractEvalQuestion(input: EvalTest['input']): string {
  return String(input.find((message) => message.role === 'user')?.content ?? '');
}

/**
 * Convert programmatic API beforeAll (string | string[]) to internal WorkspaceHookConfig.
 * Accepts a shell command string or an array of command tokens.
 */
function toBeforeAllHook(beforeAll: string | readonly string[]): WorkspaceHookConfig {
  const command = typeof beforeAll === 'string' ? ['sh', '-c', beforeAll] : [...beforeAll];
  return { command };
}

const REMOVED_EXPECTED_OUTPUT_KEY = 'expected_output';

function rejectRemovedProgrammaticExpectedOutputKey(value: unknown, location: string): void {
  if (
    value &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, REMOVED_EXPECTED_OUTPUT_KEY)
  ) {
    throw new Error(
      `${location}: 'expected_output' has been removed. Use 'expectedOutput' instead.`,
    );
  }
}

function validateAssertionEntries(
  entries: readonly AssertEntry[] | undefined,
  location: string,
): void {
  entries?.forEach((entry, i) => {
    if (typeof entry === 'function') return;
    validateAssertionEntries(entry.assert, `${location}[${i}].assert`);
  });
}

/**
 * Convert an array of assertion entries (inline functions or config objects) to GraderConfig[].
 */
function convertAssertions(entries: readonly AssertEntry[], location = 'assert'): GraderConfig[] {
  validateAssertionEntries(entries, location);
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
      name: a.metric ?? `${rawType}_${i}`,
      type: mapAssertionType(rawType),
    } as unknown as GraderConfig;
  });
}

function buildInlineEvalTests(
  config: EvalConfig,
  options: {
    readonly filter?: string | readonly string[];
    readonly category?: string;
    readonly testFilePath: string;
  },
): readonly EvalTest[] {
  const suiteWorkspace = config.beforeAll
    ? { hooks: { before_all: toBeforeAllHook(config.beforeAll) } }
    : undefined;
  const derivedSuiteName = path
    .basename(options.testFilePath)
    .replace(/\.eval\.[cm]?ts$/i, '')
    .replace(/\.[cm]?ts$/i, '');
  const suiteName = config.metadata?.name ?? (derivedSuiteName || 'eval');
  const inlinePrompts = config.prompts && config.prompts.length > 0 ? config.prompts : undefined;

  return (config.tests ?? [])
    .filter((test) => !options.filter || matchesFilter(test.id, options.filter))
    .flatMap((test): EvalTest[] => {
      rejectRemovedProgrammaticExpectedOutputKey(test, `Test '${test.id}'`);
      const isConversation = test.mode === 'conversation' || (test.turns && test.turns.length > 0);

      if (!isConversation && Object.prototype.hasOwnProperty.call(test, 'input')) {
        throw new Error(
          `Test '${test.id}': tests[].input has been removed. Use config.prompts with tests[].vars instead.`,
        );
      }
      if (!isConversation && !inlinePrompts) {
        throw new Error(`Test '${test.id}': prompts are required for non-conversation tests`);
      }

      const expectedOutputValue = test.expectedOutput;
      const expectedOutput = expectedOutputValue
        ? ([
            { role: 'assistant' as const, content: expectedOutputValue },
          ] as EvalTest['expected_output'])
        : [];

      const allAssertions = [...(test.assert ?? []), ...(config.assert ?? [])];
      const assertConfigs = convertAssertions(allAssertions, `Test '${test.id}'.assert`);
      const turns: ConversationTurn[] | undefined = test.turns?.map((turn) => {
        rejectRemovedProgrammaticExpectedOutputKey(turn, `Test '${test.id}'.turns[]`);
        const turnExpected = turn.expectedOutput;
        return {
          input: turn.input as ConversationTurn['input'],
          ...(turnExpected !== undefined && {
            expected_output: turnExpected as ConversationTurn['expected_output'],
          }),
          assertions: turn.assert
            ? convertAssertions([...turn.assert], `Test '${test.id}'.turns[].assert`)
            : undefined,
        };
      });

      const prompts =
        !isConversation && inlinePrompts
          ? inlinePrompts.map((prompt, index) => ({
              id: inlinePrompts.length > 1 ? `prompt_${index + 1}` : undefined,
              input: renderInlinePrompt(
                prompt,
                test.vars ?? {},
                `Test '${test.id}' prompt ${index + 1}`,
              ),
            }))
          : [
              {
                id: undefined,
                input: toMessageArray(test.turns?.[0]?.input ?? ''),
              },
            ];

      return prompts.map(({ id: promptId, input }): EvalTest => {
        const question = extractEvalQuestion(input);
        return {
          id: promptId ? `${test.id}__${promptId}` : test.id,
          suite: suiteName,
          category: options.category,
          ...(test.description !== undefined ? { description: test.description } : {}),
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
    });
}

function applyProgrammaticSuiteOverrides(
  tests: readonly EvalTest[],
  config: EvalConfig,
): readonly EvalTest[] {
  if (!config.beforeAll && (!config.assert || config.assert.length === 0)) {
    return tests;
  }

  const suiteWorkspace = config.beforeAll
    ? { hooks: { before_all: toBeforeAllHook(config.beforeAll) } }
    : undefined;
  const suiteAssertions = config.assert
    ? convertAssertions(config.assert, 'evaluate config.assert')
    : [];

  return tests.map((test) => ({
    ...test,
    ...(suiteAssertions.length > 0 && {
      assertions: [...(test.assertions ?? []), ...suiteAssertions],
    }),
    ...(suiteWorkspace && {
      workspace: {
        ...test.workspace,
        hooks: {
          ...test.workspace?.hooks,
          ...(test.workspace?.hooks?.before_all ? {} : suiteWorkspace.hooks),
        },
      },
    }),
  }));
}

function matchesFilter(id: string, filter: string | readonly string[]): boolean {
  return typeof filter === 'string'
    ? micromatch.isMatch(id, filter)
    : filter.some((pattern) => micromatch.isMatch(id, pattern));
}

/** Map user-facing assertion type names to internal grader type names. */
function mapAssertionType(type: string): string {
  return type;
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
  const qualityResults = results.filter((r) => r.executionStatus !== 'execution_error');
  const executionErrors = total - qualityResults.length;
  let passed = 0;
  let scoreSum = 0;

  for (const r of qualityResults) {
    scoreSum += r.score;
    if (r.score >= threshold) {
      passed++;
    }
  }

  return {
    total,
    passed,
    failed: qualityResults.length - passed,
    executionErrors,
    durationMs,
    meanScore: qualityResults.length > 0 ? scoreSum / qualityResults.length : 0,
  };
}

const PROVIDER_FILE_CANDIDATES = ['.agentv/providers.yaml', '.agentv/providers.yml'] as const;

/**
 * Auto-discover the 'default' provider from providers.yaml in the repo tree.
 */
async function discoverDefaultTarget(repoRoot: string): Promise<ProviderDefinition | null> {
  const cwd = process.cwd();
  const chain = buildDirectoryChain(path.join(cwd, '_placeholder'), repoRoot);

  for (const dir of chain) {
    for (const candidate of PROVIDER_FILE_CANDIDATES) {
      const targetsPath = path.join(dir, candidate);
      if (!existsSync(targetsPath)) continue;
      try {
        const definitions = await readProviderDefinitions(targetsPath);
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
