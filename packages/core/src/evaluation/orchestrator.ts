import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import micromatch from 'micromatch';
import pLimit from 'p-limit';

import { readJsonFile } from './file-utils.js';
import {
  type ChildGraderResult,
  DEFAULT_THRESHOLD,
  type EvaluationScore,
  type Grader,
  LlmGrader,
  formatToolCalls,
  negateScore,
  scoreToVerdict,
} from './graders.js';
import { createBuiltinProviderRegistry, createProvider } from './providers/index.js';
import { discoverProviders } from './providers/provider-discovery.js';
import {
  type ResolvedTarget,
  resolveDelegatedTargetDefinition,
  resolveTargetDefinition,
} from './providers/targets.js';
import type {
  ChatMessage,
  ChatMessageRole,
  EnvLookup,
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamCallbacks,
  TargetDefinition,
} from './providers/types.js';
import {
  LLM_GRADER_CAPABLE_KINDS,
  extractLastAssistantContent,
  isAgentProvider,
} from './providers/types.js';
import { createBuiltinRegistry, discoverAssertions, discoverGraders } from './registry/index.js';
import {
  type ReplayRecordingOptions,
  appendReplayFixtureRecord,
  buildReplayFixtureRecord,
} from './replay-fixtures.js';
import type { RunBudgetTracker } from './run-budget-tracker.js';
import {
  type TokenUsage,
  type Trace,
  type TraceSummary,
  appendErrorEventToTrace,
  buildTraceFromMessages,
  computeTraceSummary,
  mergeExecutionMetrics,
} from './trace.js';
import { aggregateTrials } from './trials.js';
import type {
  AssertionEntry,
  ConversationAggregation,
  ConversationTurn,
  DependencyResult,
  EvalTest,
  EvaluationResult,
  EvaluationVerdict,
  ExecutionStatus,
  FailOnError,
  FailureStage,
  GraderConfig,
  GraderKind,
  GraderResult,
  JsonObject,
  JsonValue,
  LlmGraderConfig,
  TestMessage,
  TestMessageRole,
  TrialResult,
  TrialsConfig,
} from './types.js';
import { cleanupEvalWorkspaces, cleanupWorkspace } from './workspace/manager.js';
import type { RepoManager } from './workspace/repo-manager.js';
import {
  type ScriptExecutionContext,
  executeWorkspaceScript,
} from './workspace/script-executor.js';
import {
  type EvalCaseWorkspaceSetup,
  WorkspaceSetupError,
  captureWorkspaceFileChanges,
  caseUsesSharedWorkspaceSetup,
  hasHookCommand,
  hooksEnabled,
  prepareEvalCaseWorkspace,
  prepareSharedWorkspaceSetup,
  releaseSharedWorkspaceSetup,
  resetWorkspaceRoot,
  toScriptConfig,
} from './workspace/setup.js';
import { type PromptInputs, buildPromptInputs, loadTests } from './yaml-parser.js';

type MaybePromise<T> = T | Promise<T>;

function pathFromRoot(root: URL | string): string {
  return root instanceof URL ? fileURLToPath(root) : String(root);
}

function classifyQualityStatus(score: number, threshold = DEFAULT_THRESHOLD): ExecutionStatus {
  return score >= threshold ? 'ok' : 'quality_failure';
}

function buildSkippedEvaluatorError(
  scores: readonly GraderResult[] | undefined,
): string | undefined {
  const skippedScores = scores?.filter((score) => score.verdict === 'skip') ?? [];
  if (skippedScores.length === 0) {
    return undefined;
  }

  const messages = skippedScores.map((score) => {
    const label = score.name || score.type;
    const assertionMessage =
      score.assertions.find((assertion) => !assertion.passed)?.text ?? 'Grader skipped';
    return `${label}: ${assertionMessage}`;
  });

  return messages.length === 1 ? messages[0] : `Graders skipped: ${messages.join(' | ')}`;
}

function usesFileReferencePrompt(provider: Provider): boolean {
  return isAgentProvider(provider) || provider.kind === 'cli';
}

function extractProviderRawLogPath(response: ProviderResponse): string | undefined {
  const raw = response.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const logFile = (raw as Record<string, unknown>).logFile;
  if (typeof logFile !== 'string') {
    return undefined;
  }

  const trimmed = logFile.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface EvaluationRuntimeOptions {
  readonly target: ResolvedTarget;
  readonly targets?: readonly TargetDefinition[];
  readonly env?: EnvLookup;
  readonly providerFactory?: (target: ResolvedTarget) => Provider;
  readonly evalFilePath?: string;
  readonly graderTarget?: string;
  readonly model?: string;
}

interface EvaluationRuntime {
  readonly getOrCreateProvider: (resolved: ResolvedTarget) => Provider;
  readonly resolveGraderProvider: (targetContext: ResolvedTarget) => Promise<Provider | undefined>;
  readonly targetResolver: (name: string) => Provider | undefined;
  readonly availableTargets: readonly string[];
}

function createEvaluationRuntime(options: EvaluationRuntimeOptions): EvaluationRuntime {
  const {
    target,
    targets,
    env,
    providerFactory,
    evalFilePath,
    graderTarget: cliGraderTarget,
    model: cliModel,
  } = options;
  const resolvedTargetsByName = new Map<string, ResolvedTarget>();
  resolvedTargetsByName.set(target.name, target);

  const targetDefinitions = new Map<string, TargetDefinition>();
  for (const definition of targets ?? []) {
    targetDefinitions.set(definition.name, definition);
  }

  const envLookup: EnvLookup = env ?? process.env;
  const providerCache = new Map<string, Provider>();

  const getOrCreateProvider = (resolved: ResolvedTarget): Provider => {
    const existing = providerCache.get(resolved.name);
    if (existing) {
      return existing;
    }
    const factory = providerFactory ?? createProvider;
    const instance = factory(resolved);
    providerCache.set(resolved.name, instance);
    return instance;
  };

  const resolveTargetByName = (name: string): ResolvedTarget | undefined => {
    if (resolvedTargetsByName.has(name)) {
      return resolvedTargetsByName.get(name);
    }
    const definition = resolveDelegatedTargetDefinition(name, targetDefinitions, envLookup);
    if (!definition) {
      return undefined;
    }
    const resolved = resolveTargetDefinition(definition, envLookup, evalFilePath ?? '');
    resolvedTargetsByName.set(name, resolved);
    return resolved;
  };

  const resolveGraderProvider = async (
    targetContext: ResolvedTarget,
  ): Promise<Provider | undefined> => {
    // CLI --grader-target takes highest priority.
    if (cliGraderTarget) {
      if (cliGraderTarget === 'agentv') {
        if (!cliModel) {
          throw new Error('--grader-target "agentv" requires --model (e.g., "openai:gpt-5-mini")');
        }
        const { AgentvProvider } = await import('./providers/agentv-provider.js');
        return new AgentvProvider('agentv', { model: cliModel, temperature: 0 });
      }
      const overrideTarget = resolveTargetByName(cliGraderTarget);
      if (!overrideTarget) {
        throw new Error(`--grader-target "${cliGraderTarget}" not found in targets`);
      }
      return getOrCreateProvider(overrideTarget);
    }

    // TODO: When --model is provided without --grader-target, override the model of
    // whichever grader target is resolved. For now, --model only works with --grader-target agentv.

    const graderName = targetContext.graderTarget ?? targetContext.name;
    const resolvedGrader = resolveTargetByName(graderName);
    if (!resolvedGrader) {
      // Only use the eval target as its own grader if it can return structured JSON.
      // Agent providers, transcript, cli, and copilot-log cannot grade.
      if (!LLM_GRADER_CAPABLE_KINDS.includes(targetContext.kind)) {
        return undefined;
      }
      return getOrCreateProvider(targetContext);
    }
    return getOrCreateProvider(resolvedGrader);
  };

  const targetResolver = (name: string): Provider | undefined => {
    const resolved = resolveTargetByName(name);
    if (!resolved) {
      return undefined;
    }
    return getOrCreateProvider(resolved);
  };

  return {
    getOrCreateProvider,
    resolveGraderProvider,
    targetResolver,
    availableTargets: [target.name, ...Array.from(targetDefinitions.keys())],
  };
}

/**
 * Validate the dependency DAG for a set of eval tests.
 * Rejects circular dependencies and references to missing test IDs.
 * Returns silently when the graph is valid.
 */
function validateDependencyGraph(tests: readonly EvalTest[]): void {
  const ids = new Set<string>();
  for (const test of tests) {
    if (ids.has(test.id)) {
      throw new Error(`Duplicate test ID '${test.id}' — each test must have a unique ID`);
    }
    ids.add(test.id);
  }

  // Check for missing dependency IDs
  for (const test of tests) {
    if (!test.depends_on) continue;
    for (const dep of test.depends_on) {
      if (!ids.has(dep)) {
        throw new Error(
          `Test '${test.id}' depends on '${dep}', but no test with that ID exists in this suite`,
        );
      }
      if (dep === test.id) {
        throw new Error(`Test '${test.id}' depends on itself`);
      }
    }
  }

  // Detect cycles via DFS
  const depMap = new Map<string, readonly string[]>();
  for (const test of tests) {
    if (test.depends_on && test.depends_on.length > 0) {
      depMap.set(test.id, test.depends_on);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      throw new Error(`Circular dependency detected: ${cycle.join(' → ')}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    for (const dep of depMap.get(id) ?? []) {
      visit(dep, path);
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const test of tests) {
    visit(test.id, []);
  }
}

/**
 * Compute execution waves via topological sort.
 * Each wave contains tests whose dependencies have all been satisfied by prior waves.
 * Tests without dependencies land in wave 0.
 */
function computeWaves(tests: readonly EvalTest[]): EvalTest[][] {
  const hasDeps = tests.some((t) => t.depends_on && t.depends_on.length > 0);
  if (!hasDeps) {
    // Fast path: no dependencies, single wave with all tests
    return [tests.slice()];
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const testById = new Map<string, EvalTest>();

  for (const test of tests) {
    testById.set(test.id, test);
    inDegree.set(test.id, 0);
  }

  for (const test of tests) {
    if (!test.depends_on) continue;
    inDegree.set(test.id, test.depends_on.length);
    for (const dep of test.depends_on) {
      const list = dependents.get(dep) ?? [];
      list.push(test.id);
      dependents.set(dep, list);
    }
  }

  const waves: EvalTest[][] = [];
  let ready = tests.filter((t) => (inDegree.get(t.id) ?? 0) === 0);

  while (ready.length > 0) {
    waves.push(ready);
    const nextReady: EvalTest[] = [];
    for (const test of ready) {
      for (const depId of dependents.get(test.id) ?? []) {
        const newDeg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) {
          const depTest = testById.get(depId);
          if (depTest) nextReady.push(depTest);
        }
      }
    }
    ready = nextReady;
  }

  // Defensive: if validation missed a cycle, Kahn's algorithm leaves unscheduled nodes
  const totalScheduled = waves.reduce((sum, w) => sum + w.length, 0);
  if (totalScheduled !== tests.length) {
    throw new Error(
      `Internal error: ${tests.length - totalScheduled} tests were not scheduled (possible undetected cycle)`,
    );
  }

  return waves;
}

export interface EvaluationCache {
  get(key: string): MaybePromise<ProviderResponse | undefined>;
  set(key: string, value: ProviderResponse): MaybePromise<void>;
}

export interface RunEvalCaseOptions {
  readonly evalCase: EvalTest;
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluators: Partial<Record<string, Grader>> & { readonly 'llm-grader': Grader };
  readonly now?: () => Date;
  readonly maxRetries?: number;
  readonly agentTimeoutMs?: number;
  readonly cache?: EvaluationCache;
  readonly useCache?: boolean;
  readonly signal?: AbortSignal;
  readonly graderProvider?: Provider;
  /** Resolver for target override in code graders */
  readonly targetResolver?: (name: string) => Provider | undefined;
  /** List of available target names for code graders */
  readonly availableTargets?: readonly string[];
  /** Unique identifier for the evaluation run (used for workspace management) */
  readonly evalRunId?: string;
  /** Keep workspace on success (default: cleanup on success, keep on failure) */
  readonly keepWorkspaces?: boolean;
  /** Force cleanup of workspaces even on failure */
  readonly cleanupWorkspaces?: boolean;
  /** Retention policy for temp workspaces on successful cases */
  readonly retainOnSuccess?: 'keep' | 'cleanup';
  /** Retention policy for temp workspaces on failed cases */
  readonly retainOnFailure?: 'keep' | 'cleanup';
  /** Pre-created shared workspace path (shared across tests in a suite) */
  readonly sharedWorkspacePath?: string;
  /** Pre-initialized baseline commit for shared workspace */
  readonly sharedBaselineCommit?: string;
  /** Suite-level .code-workspace file (resolved from workspace.template) */
  readonly suiteWorkspaceFile?: string;
  /** Real-time observability callbacks passed to the provider */
  readonly streamCallbacks?: ProviderStreamCallbacks;
  /** Grader type registry (with custom assertions discovered) */
  readonly typeRegistry?: import('./registry/grader-registry.js').GraderRegistry;
  /** RepoManager instance for repo lifecycle (shared workspace mode) */
  readonly repoManager?: RepoManager;
  /** Directory containing the eval YAML file. Used as default cwd for workspace scripts. */
  readonly evalDir?: string;
  /** Include verbose request details in results (e.g. agent input text) */
  readonly verbose?: boolean;
  /** Per-test score threshold for pass/fail (default: 0.8) */
  readonly threshold?: number;
  /** Results from dependency tests (only present when the test has depends_on) */
  readonly dependencyResults?: Readonly<Record<string, import('./types.js').DependencyResult>>;
  /** Per-target hooks from eval file (before_all, before_each, after_each, after_all) */
  readonly targetHooks?: import('./types.js').TargetHooksConfig;
  /** Append live target outputs to a replay JSONL fixture file. */
  readonly replayRecording?: ReplayRecordingOptions;
  /** Eval file path used for replay fixture identity. Required when replayRecording is set. */
  readonly evalFilePath?: string;
  /** Repo root used to serialize replay fixture eval_path as a stable relative path. */
  readonly repoRoot?: string;
}

export interface ProgressEvent {
  readonly workerId: number;
  readonly testId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed';
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
  /** Final score for completed/failed tests */
  readonly score?: number;
  /** Execution status classification for completed/failed tests */
  readonly executionStatus?: ExecutionStatus;
  /** Candidate/agent execution duration in milliseconds */
  readonly durationMs?: number;
  /** Full eval duration in milliseconds, including grading/orchestration */
  readonly evalRunDurationMs?: number;
}

export interface RunEvaluationOptions {
  readonly testFilePath: string;
  readonly repoRoot: URL | string;
  readonly target: ResolvedTarget;
  readonly targets?: readonly TargetDefinition[];
  readonly env?: EnvLookup;
  readonly providerFactory?: (target: ResolvedTarget) => Provider;
  readonly evaluators?: Partial<Record<string, Grader>>;
  readonly maxRetries?: number;
  readonly agentTimeoutMs?: number;
  readonly cache?: EvaluationCache;
  readonly useCache?: boolean;
  readonly now?: () => Date;
  /** Filter tests by ID pattern(s) (glob supported, e.g., "summary-*"). Arrays use OR logic. */
  readonly filter?: string | readonly string[];
  readonly verbose?: boolean;
  readonly maxConcurrency?: number;
  readonly evalCases?: readonly EvalTest[];
  readonly onResult?: (result: EvaluationResult) => MaybePromise<void>;
  readonly onProgress?: (event: ProgressEvent) => MaybePromise<void>;
  /** Keep workspace on success (default: cleanup on success, keep on failure) */
  readonly keepWorkspaces?: boolean;
  /** Force cleanup of workspaces even on failure */
  readonly cleanupWorkspaces?: boolean;
  /** Trial configuration for running eval cases multiple times */
  readonly trials?: TrialsConfig;
  /** Real-time observability callbacks passed to the provider */
  readonly streamCallbacks?: ProviderStreamCallbacks;
  /** Suite-level total cost budget in USD (stops dispatching when exceeded) */
  readonly budgetUsd?: number;
  /** Run-level total cost tracker shared across multiple eval files/targets in one CLI invocation */
  readonly runBudgetTracker?: RunBudgetTracker;
  /** Execution error tolerance: true halts on first error */
  readonly failOnError?: FailOnError;
  /** Workspace pooling: true (default) enables pool, false disables, undefined defaults to true */
  readonly poolWorkspaces?: boolean;
  /** Maximum number of pool slots on disk (default: 10, max: 50) */
  readonly poolMaxSlots?: number;
  /** Pre-existing workspace directory to use directly (skips clone/copy/pool) */
  readonly workspace?: string;
  /** Workspace materialization mode override */
  readonly workspaceMode?: 'pooled' | 'temp' | 'static';
  /** Static workspace path override (used when workspaceMode=static) */
  readonly workspacePath?: string;
  /** Workspace clean policy override for pooled reset */
  readonly workspaceClean?: 'standard' | 'full';
  /** Retention policy override for successful cases */
  readonly retainOnSuccess?: 'keep' | 'cleanup';
  /** Retention policy override for failed cases */
  readonly retainOnFailure?: 'keep' | 'cleanup';
  /** CLI override: grader target name (e.g., "agentv" or a target from targets.yaml) */
  readonly graderTarget?: string;
  /** CLI override: model for grader target (e.g., "openai:gpt-5-mini") */
  readonly model?: string;
  /** Per-test score threshold for pass/fail (default: 0.8) */
  readonly threshold?: number;
  /** Per-target hooks from eval file (before_all, before_each, after_each, after_all) */
  readonly targetHooks?: import('./types.js').TargetHooksConfig;
  /** Append live target outputs to a replay JSONL fixture file. */
  readonly replayRecording?: ReplayRecordingOptions;
}

export interface PreparedAttemptMetadata {
  readonly source: 'manual';
  readonly manifestPath?: string;
  readonly preparedDir?: string;
  readonly workspacePath: string;
  readonly promptPath?: string;
  readonly tracePath?: string;
  readonly target: string;
  readonly preparedAt?: string;
  readonly setupStatus?: string;
  readonly baselineStatus?: 'initialized' | 'unavailable';
  readonly baselineCommit?: string;
}

export interface GradePreparedEvalCaseOptions {
  readonly evalCase: EvalTest;
  readonly target: ResolvedTarget;
  readonly targets?: readonly TargetDefinition[];
  readonly env?: EnvLookup;
  readonly evaluators?: Partial<Record<string, Grader>>;
  readonly providerFactory?: (target: ResolvedTarget) => Provider;
  readonly now?: () => Date;
  readonly agentTimeoutMs?: number;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly evalFilePath?: string;
  readonly workspacePath: string;
  readonly baselineCommit?: string;
  readonly response?: string;
  readonly trace?: Trace;
  readonly verbose?: boolean;
  readonly threshold?: number;
  readonly preparedAttempt: PreparedAttemptMetadata;
}

function createPreparedProvider(target: ResolvedTarget): Provider {
  return {
    id: `prepared:${target.name}`,
    kind: target.kind,
    targetName: target.name,
    async invoke(): Promise<ProviderResponse> {
      throw new Error('Prepared grading does not invoke the target provider');
    },
  };
}

function withPreparedMetadata(
  evalCase: EvalTest,
  preparedAttempt: PreparedAttemptMetadata,
): Record<string, unknown> {
  return {
    ...evalCase.metadata,
    preparedAttempt,
  };
}

export async function gradePreparedEvalCase(
  options: GradePreparedEvalCaseOptions,
): Promise<EvaluationResult> {
  const {
    evalCase,
    target,
    targets,
    env,
    evaluators,
    providerFactory,
    agentTimeoutMs,
    graderTarget,
    model,
    evalFilePath,
    workspacePath,
    baselineCommit,
    response,
    trace: preparedTrace,
    verbose,
    threshold: caseThreshold,
    preparedAttempt,
  } = options;
  const nowFn = options.now ?? (() => new Date());
  const caseStartMs = Date.now();
  const provider = createPreparedProvider(target);
  const formattingMode = usesFileReferencePrompt(provider) ? 'agent' : 'lm';
  const promptInputs = await buildPromptInputs(evalCase, formattingMode);
  const typeRegistry = createBuiltinRegistry();
  const runtime = createEvaluationRuntime({
    target,
    targets,
    env,
    providerFactory,
    evalFilePath,
    graderTarget,
    model,
  });
  const evaluatorRegistry = buildEvaluatorRegistry(evaluators, runtime.resolveGraderProvider);

  const discoveryBaseDir = evalFilePath ? path.dirname(path.resolve(evalFilePath)) : process.cwd();
  await discoverAssertions(typeRegistry, discoveryBaseDir);
  await discoverGraders(typeRegistry, discoveryBaseDir);

  let fileChanges: string | undefined;
  if (baselineCommit) {
    try {
      const diff = await captureWorkspaceFileChanges(workspacePath, baselineCommit);
      if (diff.length > 0) {
        fileChanges = diff;
      }
    } catch (error) {
      if (verbose) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: failed to capture prepared workspace diff: ${message}`);
      }
    }
  }

  const candidate = response ?? extractLastAssistantContent(preparedTrace?.messages ?? []) ?? '';
  const input = buildResultInput(promptInputs);
  const outputMessages: readonly Message[] =
    preparedTrace?.messages ??
    (candidate.length > 0 ? [{ role: 'assistant' as const, content: candidate }] : []);
  const resultTrace =
    preparedTrace ??
    buildTraceFromMessages({
      input,
      output: outputMessages,
      finalOutput: candidate,
      provider: provider.kind,
      target: target.name,
      testId: evalCase.id,
      conversationId: evalCase.conversation_id,
    });

  try {
    const gradeStartedAt = nowFn();
    const { score, scores } = await runEvaluatorsForCase({
      evalCase,
      candidate,
      target,
      provider,
      evaluators: evaluatorRegistry,
      typeRegistry,
      attempt: 0,
      promptInputs,
      now: gradeStartedAt,
      agentTimeoutMs,
      output: preparedTrace ? outputMessages : undefined,
      trace: preparedTrace ? resultTrace : undefined,
      costUsd: preparedTrace ? resultTrace.costUsd : undefined,
      durationMs: preparedTrace ? resultTrace.durationMs : undefined,
      tokenUsage: preparedTrace ? resultTrace.tokenUsage : undefined,
      startTime: preparedTrace ? resultTrace.startTime : undefined,
      endTime: preparedTrace ? resultTrace.endTime : undefined,
      targetResolver: runtime.targetResolver,
      availableTargets: runtime.availableTargets,
      fileChanges,
      workspacePath,
      dockerConfig: evalCase.workspace?.docker,
      threshold: evalCase.threshold ?? caseThreshold,
    });

    const timestamp = nowFn();
    const effectiveThreshold = evalCase.threshold ?? caseThreshold;
    const graderTokens = aggregateEvaluatorTokenUsage(scores);
    const evalRun = {
      durationMs: Date.now() - caseStartMs,
      ...(graderTokens ? { tokenUsage: graderTokens } : {}),
    };
    const skippedEvaluatorError = buildSkippedEvaluatorError(scores);
    const executionStatus: ExecutionStatus = skippedEvaluatorError
      ? 'execution_error'
      : classifyQualityStatus(score.score, effectiveThreshold);
    const baseResult = {
      timestamp: timestamp.toISOString(),
      testId: evalCase.id,
      suite: evalCase.suite,
      category: evalCase.category,
      conversationId: evalCase.conversation_id,
      score: skippedEvaluatorError ? 0 : score.score,
      assertions: score.assertions,
      target: target.name,
      input,
      output: candidate,
      scores,
      trace: resultTrace,
      fileChanges,
      workspacePath,
      evalRun,
      metadata: withPreparedMetadata(evalCase, preparedAttempt),
      executionStatus,
    } satisfies EvaluationResult;

    if (!skippedEvaluatorError) {
      return baseResult;
    }

    return {
      ...baseResult,
      trace: appendErrorEventToTrace(baseResult.trace, skippedEvaluatorError, {
        failure_stage: 'evaluator',
        failure_reason_code: 'evaluator_error',
      }),
      error: skippedEvaluatorError,
      failureStage: 'evaluator',
      failureReasonCode: 'evaluator_error',
      executionError: { message: skippedEvaluatorError, stage: 'evaluator' },
    };
  } catch (error) {
    const evalRun = { durationMs: Date.now() - caseStartMs };
    const errorResult = buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      error,
      promptInputs,
      provider,
      'evaluator',
      'evaluator_error',
      verbose,
    );
    return {
      ...errorResult,
      evalRun,
      fileChanges,
      workspacePath,
      metadata: withPreparedMetadata(evalCase, preparedAttempt),
    };
  }
}

export async function runEvaluation(
  options: RunEvaluationOptions,
): Promise<readonly EvaluationResult[]> {
  const {
    testFilePath: evalFilePath,
    repoRoot,
    target,
    targets,
    env,
    providerFactory,
    evaluators,
    maxRetries,
    agentTimeoutMs,
    cache,
    now,
    filter,
    verbose,
    evalCases: preloadedEvalCases,
    onResult,
    onProgress,
    keepWorkspaces,
    cleanupWorkspaces,
    trials,
    streamCallbacks,
    budgetUsd,
    runBudgetTracker,
    failOnError,
    poolWorkspaces,
    poolMaxSlots: configPoolMaxSlots,
    workspace: legacyWorkspacePath,
    workspaceMode,
    workspacePath,
    workspaceClean,
    retainOnSuccess,
    retainOnFailure,
    graderTarget: cliGraderTarget,
    model: cliModel,
    threshold: scoreThreshold,
    replayRecording,
  } = options;
  const repoRootPath = pathFromRoot(repoRoot);

  // Disable cache when trials > 1 (cache makes trials deterministic = pointless)
  let useCache = options.useCache;
  if (trials && trials.count > 1 && useCache) {
    console.warn(
      'Warning: Caching is disabled when trials.count > 1 (cached responses would make trials deterministic).',
    );
    useCache = false;
  }

  // Generate unique eval run ID for workspace management
  const evalRunId = randomUUID();

  // Use pre-loaded eval cases if provided, otherwise load them
  const evalCases =
    preloadedEvalCases ?? (await loadTests(evalFilePath, repoRoot, { verbose, filter }));

  const filteredEvalCases = filterEvalCases(evalCases, filter);
  if (filteredEvalCases.length === 0) {
    if (filter) {
      throw new Error(`No tests matched filter '${formatFilter(filter)}' in ${evalFilePath}`);
    }
    return [];
  }

  const runtime = createEvaluationRuntime({
    target,
    targets,
    env,
    providerFactory,
    evalFilePath,
    graderTarget: cliGraderTarget,
    model: cliModel,
  });
  const { getOrCreateProvider, resolveGraderProvider, targetResolver, availableTargets } = runtime;

  // Validate grader_target: error if an agent provider would be used as grader.
  // Agent providers can't return structured JSON for grading — they respond with
  // tool calls and markdown, causing silent score-0 failures.
  // CLI --grader-target override also satisfies this requirement.
  if (isAgentProvider(getOrCreateProvider(target)) && !target.graderTarget && !cliGraderTarget) {
    throw new Error(
      `Target "${target.name}" is an agent provider ("${target.kind}") with no grader_target — agent providers cannot return structured JSON for grading. Set grader_target to an LLM provider (e.g., azure-llm).`,
    );
  }

  const evaluatorRegistry = buildEvaluatorRegistry(evaluators, resolveGraderProvider);
  const typeRegistry = createBuiltinRegistry();

  // Discover custom assertions and providers from .agentv/ directory
  const discoveryBaseDir = evalFilePath ? path.dirname(path.resolve(evalFilePath)) : process.cwd();
  // Directory containing the eval YAML file, used as default cwd for workspace scripts
  const evalDir = discoveryBaseDir;
  await discoverAssertions(typeRegistry, discoveryBaseDir);
  await discoverGraders(typeRegistry, discoveryBaseDir);

  // Discover custom providers from .agentv/providers/ directory
  const providerRegistry = createBuiltinProviderRegistry();
  await discoverProviders(providerRegistry, discoveryBaseDir);

  const primaryProvider = getOrCreateProvider(target);
  let providerSupportsBatch =
    target.providerBatching === true &&
    primaryProvider.supportsBatch === true &&
    typeof primaryProvider.invokeBatch === 'function';

  // Disable batch mode when trials > 1 (batch processes all cases at once, incompatible with per-case retries)
  if (trials && trials.count > 1 && providerSupportsBatch) {
    console.warn('Warning: Batch mode is disabled when trials.count > 1. Using per-case dispatch.');
    providerSupportsBatch = false;
  }

  if (target.providerBatching && !providerSupportsBatch && verbose) {
    console.warn(
      `Provider batching requested for target '${target.name}', but provider does not advertise batch support. Using per-case dispatch.`,
    );
  }

  // Notify about total test count before starting
  if (onProgress && filteredEvalCases.length > 0) {
    // Emit initial pending events for all tests
    for (let i = 0; i < filteredEvalCases.length; i++) {
      await onProgress({
        workerId: i + 1,
        testId: filteredEvalCases[i].id,
        status: 'pending',
      });
    }
  }

  if (providerSupportsBatch) {
    try {
      return await runBatchEvaluation({
        evalCases: filteredEvalCases,
        provider: primaryProvider,
        target,
        evaluatorRegistry,
        typeRegistry,
        nowFn: now ?? (() => new Date()),
        onProgress,
        onResult,
        verbose,
        resolveGraderProvider,
        agentTimeoutMs,
        targetResolver,
        availableTargets,
        threshold: scoreThreshold,
        replayRecording,
        evalFilePath,
        repoRoot: repoRootPath,
      });
    } catch (error) {
      if (verbose) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Provider batch execution failed, falling back to per-case dispatch: ${message}`,
        );
      }
    }
  }

  const resolvedRetainOnSuccess = retainOnSuccess ?? (keepWorkspaces ? 'keep' : 'cleanup');
  const resolvedRetainOnFailure = retainOnFailure ?? (cleanupWorkspaces ? 'cleanup' : 'keep');
  const workers = options.maxConcurrency ?? target.workers ?? 1;
  const limit = pLimit(workers);
  const sharedSetup = await prepareSharedWorkspaceSetup({
    evalRunId,
    evalCases: filteredEvalCases,
    targetHooks: options.targetHooks,
    evalDir,
    verbose,
    workers,
    poolMaxSlots: configPoolMaxSlots,
    workspacePath,
    legacyWorkspacePath,
    workspaceMode,
    workspaceClean,
  });
  const {
    suiteWorkspace,
    sharedWorkspacePath,
    sharedBaselineCommit,
    suiteWorkspaceFile,
    beforeAllOutput,
    repoManager,
    poolSlot,
    poolSlots,
    availablePoolSlots,
    poolSlotBaselines,
    useStaticWorkspace,
  } = sharedSetup;
  const targetHooks = options.targetHooks;
  const suiteHooksEnabled = hooksEnabled(suiteWorkspace);

  try {
    // Track worker assignments for progress reporting
    let nextWorkerId = 1;
    const workerIdByEvalId = new Map<string, number>();
    let beforeAllOutputAttached = false;

    // Suite-level budget tracking
    let cumulativeBudgetCost = 0;
    let budgetExhausted = false;

    // fail_on_error tracking (best-effort under concurrency > 1, matching budgetExhausted semantics)
    let failOnErrorTriggered = false;

    // --- Validate dependency graph and compute execution waves ---
    validateDependencyGraph(filteredEvalCases);
    const waves = computeWaves(filteredEvalCases);

    // Track completed test results for dependency injection
    const completedResults = new Map<string, EvaluationResult>();
    const results: EvaluationResult[] = [];

    // Helper: build a DependencyResult from a completed EvaluationResult
    function toDependencyResult(r: EvaluationResult): DependencyResult {
      return {
        score: r.score,
        output: r.output,
        workspace_path: r.workspacePath,
        details: r.scores
          ? (Object.fromEntries(
              r.scores.map((s) => [s.name, { score: s.score, verdict: s.verdict }]),
            ) as JsonObject)
          : undefined,
        status:
          r.executionStatus === 'ok'
            ? 'passed'
            : r.executionStatus === 'execution_error'
              ? 'error'
              : 'failed',
      };
    }

    // Helper: check whether all dependencies passed for a given test
    function checkDependencies(evalCase: EvalTest): {
      ok: boolean;
      depResults: Record<string, DependencyResult>;
    } {
      const depResults: Record<string, DependencyResult> = {};
      if (!evalCase.depends_on || evalCase.depends_on.length === 0) {
        return { ok: true, depResults };
      }
      let allPassed = true;
      for (const depId of evalCase.depends_on) {
        const depResult = completedResults.get(depId);
        if (depResult) {
          depResults[depId] = toDependencyResult(depResult);
          // Only execution errors count as dependency failures — quality failures
          // (low scores) still mean the test ran successfully, just scored poorly.
          if (depResult.executionStatus === 'execution_error') {
            allPassed = false;
          }
        } else {
          // Dependency didn't run (should not happen with valid DAG)
          allPassed = false;
        }
      }
      return { ok: allPassed, depResults };
    }

    function extractEvaluationCostUsd(result: EvaluationResult): number | undefined {
      if (result.trials && result.trials.length > 0) {
        const trialCostSum = result.trials.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
        return trialCostSum > 0 ? trialCostSum : undefined;
      }
      return result.costUsd;
    }

    // Worker function: dispatches a single eval case with dependency context
    async function dispatchTest(
      evalCase: EvalTest,
      depResults?: Record<string, DependencyResult>,
    ): Promise<EvaluationResult> {
      const workerId = nextWorkerId++;
      workerIdByEvalId.set(evalCase.id, workerId);

      // Check run-level budget before dispatching. This shared tracker spans all
      // eval files/targets in the current CLI invocation, so queued cases stop once
      // cumulative spend reaches the cap while already-running cases are allowed to finish.
      if (runBudgetTracker?.isExceeded()) {
        const errorMessage = `Run budget exceeded ($${runBudgetTracker.currentCostUsd.toFixed(4)} / $${runBudgetTracker.budgetCapUsd.toFixed(4)})`;
        const budgetResult: EvaluationResult = {
          timestamp: (now ?? (() => new Date()))().toISOString(),
          testId: evalCase.id,
          suite: evalCase.suite,
          category: evalCase.category,
          score: 0,
          assertions: [],
          output: errorMessage,
          trace: buildTraceFromMessages({
            input: evalCase.input as readonly Message[],
            output: [{ role: 'assistant' as const, content: errorMessage }],
            finalOutput: errorMessage,
            target: target.name,
            testId: evalCase.id,
            conversationId: evalCase.conversation_id,
            error: errorMessage,
          }),
          target: target.name,
          error: errorMessage,
          budgetExceeded: true,
          executionStatus: 'execution_error',
          failureStage: 'setup',
          failureReasonCode: 'budget_exceeded',
          executionError: {
            message: errorMessage,
            stage: 'setup',
          },
        };

        if (onProgress) {
          await onProgress({
            workerId,
            testId: evalCase.id,
            status: 'failed',
            completedAt: Date.now(),
            error: budgetResult.error,
            score: budgetResult.score,
            executionStatus: budgetResult.executionStatus,
          });
        }
        if (onResult) {
          await onResult(budgetResult);
        }
        return budgetResult;
      }

      // Check suite-level budget before dispatching
      if (budgetUsd !== undefined && budgetExhausted) {
        const errorMessage = `Suite budget exceeded ($${cumulativeBudgetCost.toFixed(4)} / $${budgetUsd.toFixed(4)})`;
        const budgetResult: EvaluationResult = {
          timestamp: (now ?? (() => new Date()))().toISOString(),
          testId: evalCase.id,
          suite: evalCase.suite,
          category: evalCase.category,
          score: 0,
          assertions: [],
          output: errorMessage,
          trace: buildTraceFromMessages({
            input: evalCase.input as readonly Message[],
            output: [{ role: 'assistant' as const, content: errorMessage }],
            finalOutput: errorMessage,
            target: target.name,
            testId: evalCase.id,
            conversationId: evalCase.conversation_id,
            error: errorMessage,
          }),
          target: target.name,
          error: errorMessage,
          budgetExceeded: true,
          executionStatus: 'execution_error',
          failureStage: 'setup',
          failureReasonCode: 'budget_exceeded',
          executionError: {
            message: errorMessage,
            stage: 'setup',
          },
        };

        if (onProgress) {
          await onProgress({
            workerId,
            testId: evalCase.id,
            status: 'failed',
            completedAt: Date.now(),
            error: budgetResult.error,
            score: budgetResult.score,
            executionStatus: budgetResult.executionStatus,
          });
        }
        if (onResult) {
          await onResult(budgetResult);
        }
        return budgetResult;
      }

      // Check fail_on_error before dispatching
      if (failOnError === true && failOnErrorTriggered) {
        const errorMsg = 'Halted: execution error encountered with fail_on_error enabled';
        const haltResult: EvaluationResult = {
          timestamp: (now ?? (() => new Date()))().toISOString(),
          testId: evalCase.id,
          suite: evalCase.suite,
          category: evalCase.category,
          score: 0,
          assertions: [],
          output: errorMsg,
          trace: buildTraceFromMessages({
            input: evalCase.input as readonly Message[],
            output: [{ role: 'assistant' as const, content: errorMsg }],
            finalOutput: errorMsg,
            target: target.name,
            testId: evalCase.id,
            conversationId: evalCase.conversation_id,
            error: errorMsg,
          }),
          target: target.name,
          error: errorMsg,
          executionStatus: 'execution_error',
          failureStage: 'setup',
          failureReasonCode: 'error_threshold_exceeded',
          executionError: { message: errorMsg, stage: 'setup' },
        };

        if (onProgress) {
          await onProgress({
            workerId,
            testId: evalCase.id,
            status: 'failed',
            completedAt: Date.now(),
            error: haltResult.error,
            score: haltResult.score,
            executionStatus: haltResult.executionStatus,
          });
        }
        if (onResult) {
          await onResult(haltResult);
        }
        return haltResult;
      }

      if (onProgress) {
        await onProgress({
          workerId,
          testId: evalCase.id,
          status: 'running',
          startedAt: Date.now(),
        });
      }

      // Multi-slot pool: each shared-workspace test grabs its own pool slot.
      // Per-case isolated cases and raw/no-workspace cases outside the selected
      // shared owner prepare without inheriting a child suite's workspace.
      const usesSharedWorkspace = caseUsesSharedWorkspaceSetup(evalCase, sharedSetup);
      const testPoolSlot =
        usesSharedWorkspace && availablePoolSlots.length > 0 ? availablePoolSlots.pop() : undefined;
      const testWorkspacePath = usesSharedWorkspace
        ? (testPoolSlot?.path ?? sharedWorkspacePath)
        : undefined;
      const testBaselineCommit = usesSharedWorkspace
        ? testPoolSlot
          ? poolSlotBaselines.get(testPoolSlot.path)
          : sharedBaselineCommit
        : undefined;

      try {
        const graderProvider = await resolveGraderProvider(target);
        const runCaseOptions: RunEvalCaseOptions = {
          evalCase: evalCase,
          provider: primaryProvider,
          target,
          evaluators: evaluatorRegistry,
          maxRetries,
          agentTimeoutMs,
          cache,
          useCache,
          now,
          graderProvider,
          targetResolver,
          availableTargets,
          evalRunId,
          keepWorkspaces,
          cleanupWorkspaces,
          retainOnSuccess: resolvedRetainOnSuccess,
          retainOnFailure: resolvedRetainOnFailure,
          sharedWorkspacePath: testWorkspacePath,
          sharedBaselineCommit: testBaselineCommit,
          suiteWorkspaceFile,
          streamCallbacks,
          typeRegistry,
          repoManager,
          evalDir,
          verbose,
          threshold: scoreThreshold,
          targetHooks: options.targetHooks,
          replayRecording,
          evalFilePath,
          repoRoot: repoRootPath,
          ...(depResults && Object.keys(depResults).length > 0
            ? { dependencyResults: depResults }
            : {}),
        };
        let result =
          trials && trials.count > 1
            ? await runEvalCaseWithTrials(runCaseOptions, trials)
            : await runEvalCase(runCaseOptions);

        const caseCost = extractEvaluationCostUsd(result);
        if (caseCost !== undefined) {
          if (budgetUsd !== undefined) {
            cumulativeBudgetCost += caseCost;
            if (cumulativeBudgetCost >= budgetUsd) {
              budgetExhausted = true;
            }
          }
          if (runBudgetTracker) {
            runBudgetTracker.add(caseCost);
          }
        }

        // Track fail_on_error
        if (failOnError === true && result.executionStatus === 'execution_error') {
          failOnErrorTriggered = true;
        }

        // Attach beforeAllOutput to first result only
        if (beforeAllOutput && !beforeAllOutputAttached) {
          result = { ...result, beforeAllOutput };
          beforeAllOutputAttached = true;
        }

        // Surface case-level metadata (e.g. governance taxonomies) on the result so
        // it round-trips into the JSONL artifact and downstream consumers (reports,
        // jq pipelines, attestation exports). Already-set metadata wins.
        if (evalCase.metadata && !result.metadata) {
          result = { ...result, metadata: evalCase.metadata };
        }

        if (onProgress) {
          await onProgress({
            workerId,
            testId: evalCase.id,
            status: result.error ? 'failed' : 'completed',
            startedAt: 0, // Not used for completed status
            completedAt: Date.now(),
            error: result.error,
            score: result.score,
            executionStatus: result.executionStatus,
            durationMs: result.durationMs,
            evalRunDurationMs: result.evalRun?.durationMs,
          });
        }

        if (onResult) {
          await onResult(result);
        }
        return result;
      } catch (error) {
        if (onProgress) {
          await onProgress({
            workerId,
            testId: evalCase.id,
            status: 'failed',
            completedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      } finally {
        // Return pool slot for reuse by next test
        if (testPoolSlot) {
          availablePoolSlots.push(testPoolSlot);
        }
      }
    }

    // --- DAG-aware wave dispatch ---
    // Dispatch each wave sequentially; tests within a wave run in parallel via pLimit.
    for (const wave of waves) {
      const wavePromises = wave.map((evalCase) =>
        limit(async () => {
          // Check dependency status for tests with depends_on
          if (evalCase.depends_on && evalCase.depends_on.length > 0) {
            const { ok, depResults } = checkDependencies(evalCase);
            if (!ok) {
              const policy = evalCase.on_dependency_failure ?? 'skip';
              if (policy === 'skip' || policy === 'fail') {
                const failedDeps = evalCase.depends_on.filter(
                  (d) => completedResults.get(d)?.executionStatus === 'execution_error',
                );
                const prefix = policy === 'skip' ? 'Skipped' : 'Failed';
                const errorMsg = `${prefix}: dependency failed (${failedDeps.join(', ')})`;
                const depFailResult: EvaluationResult = {
                  timestamp: (now ?? (() => new Date()))().toISOString(),
                  testId: evalCase.id,
                  suite: evalCase.suite,
                  category: evalCase.category,
                  score: 0,
                  assertions: [],
                  output: errorMsg,
                  trace: buildTraceFromMessages({
                    input: evalCase.input as readonly Message[],
                    output: [{ role: 'assistant' as const, content: errorMsg }],
                    finalOutput: errorMsg,
                    target: target.name,
                    testId: evalCase.id,
                    conversationId: evalCase.conversation_id,
                    error: errorMsg,
                  }),
                  target: target.name,
                  error: errorMsg,
                  executionStatus: 'execution_error',
                  failureStage: 'setup',
                  failureReasonCode: 'dependency_failed',
                  executionError: { message: errorMsg, stage: 'setup' },
                };
                if (onProgress) {
                  await onProgress({
                    workerId: nextWorkerId++,
                    testId: evalCase.id,
                    status: 'failed',
                    completedAt: Date.now(),
                    error: depFailResult.error,
                    score: 0,
                    executionStatus: depFailResult.executionStatus,
                  });
                }
                if (onResult) {
                  await onResult(depFailResult);
                }
                return depFailResult;
              }
              // policy === 'run': fall through to dispatch with dependency results
            }
            return dispatchTest(evalCase, depResults);
          }
          return dispatchTest(evalCase);
        }),
      );

      const settled = await Promise.allSettled(wavePromises);

      // Collect wave results
      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i];
        const evalCase = wave[i];
        if (outcome.status === 'fulfilled') {
          completedResults.set(evalCase.id, outcome.value);
          results.push(outcome.value);
        } else {
          const formattingMode = usesFileReferencePrompt(primaryProvider) ? 'agent' : 'lm';
          const promptInputs = await buildPromptInputs(evalCase, formattingMode);
          const errorResult = buildErrorResult(
            evalCase,
            target.name,
            (now ?? (() => new Date()))(),
            outcome.reason,
            promptInputs,
            primaryProvider,
            'agent',
            'provider_error',
            verbose,
          );
          completedResults.set(evalCase.id, errorResult);
          results.push(errorResult);
          if (onResult) {
            await onResult(errorResult);
          }
        }
      }
    }

    // --- Shared workspace after_all + cleanup ---
    // For multi-slot pool, run after_all on each slot (symmetric with before_all)
    const afterAllWorkspaces =
      poolSlots.length > 1
        ? poolSlots.map((s) => s.path)
        : sharedWorkspacePath
          ? [sharedWorkspacePath]
          : [];

    // Execute target after_all (runs ONCE before workspace after_all)
    const targetAfterAllHook = targetHooks?.after_all;
    if (afterAllWorkspaces.length > 0 && hasHookCommand(targetAfterAllHook)) {
      for (const wsPath of afterAllWorkspaces) {
        const scriptContext: ScriptExecutionContext = {
          workspacePath: wsPath,
          testId: '__target_after_all__',
          evalRunId,
          evalDir,
          workspaceFileDir: suiteWorkspace?.workspaceFileDir,
        };
        try {
          await executeWorkspaceScript(
            toScriptConfig(targetAfterAllHook, 'after_all', 'target hooks'),
            scriptContext,
            'warn',
          );
        } catch {
          // target after_all failures are non-fatal
        }
      }
    }

    const suiteAfterAllHook = suiteWorkspace?.hooks?.after_all;
    if (afterAllWorkspaces.length > 0 && suiteHooksEnabled && hasHookCommand(suiteAfterAllHook)) {
      const afterAllHook = suiteAfterAllHook;
      for (const wsPath of afterAllWorkspaces) {
        const scriptContext: ScriptExecutionContext = {
          workspacePath: wsPath,
          testId: '__after_all__',
          evalRunId,
          evalDir,
          workspaceFileDir: suiteWorkspace?.workspaceFileDir,
        };
        try {
          const afterAllOutput = await executeWorkspaceScript(
            toScriptConfig(afterAllHook, 'after_all', 'suite workspace'),
            scriptContext,
            'warn',
          );
          // Attach afterAllOutput to last result (first slot only)
          if (afterAllOutput && results.length > 0 && wsPath === afterAllWorkspaces[0]) {
            results[results.length - 1] = { ...results[results.length - 1], afterAllOutput };
          }
        } catch {
          // after_all failures are non-fatal
        }
      }
    }

    // Cleanup shared workspace (skip for pooled workspaces and user-provided workspaces)
    if (sharedWorkspacePath && !poolSlot && poolSlots.length === 0 && !useStaticWorkspace) {
      const hasFailure = results.some((r) => !!r.error || r.score < 0.5);
      if (hasFailure) {
        if (resolvedRetainOnFailure === 'cleanup') {
          await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
        }
      } else if (resolvedRetainOnSuccess === 'cleanup') {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
    }

    // Fallback cleanup for any per-case workspaces
    if (cleanupWorkspaces) {
      await cleanupEvalWorkspaces(evalRunId).catch(() => {});
    }

    return results;
  } finally {
    await releaseSharedWorkspaceSetup(sharedSetup);
  }
}

async function runBatchEvaluation(options: {
  readonly evalCases: readonly EvalTest[];
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluatorRegistry: Partial<Record<string, Grader>> & {
    readonly 'llm-grader': Grader;
  };
  readonly typeRegistry: import('./registry/grader-registry.js').GraderRegistry;
  readonly nowFn: () => Date;
  readonly onProgress?: (event: ProgressEvent) => MaybePromise<void>;
  readonly onResult?: (result: EvaluationResult) => MaybePromise<void>;
  readonly verbose?: boolean;
  readonly resolveGraderProvider: (target: ResolvedTarget) => Promise<Provider | undefined>;
  readonly agentTimeoutMs?: number;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly threshold?: number;
  readonly replayRecording?: ReplayRecordingOptions;
  readonly evalFilePath: string;
  readonly repoRoot: string;
}): Promise<readonly EvaluationResult[]> {
  const {
    evalCases,
    provider,
    target,
    evaluatorRegistry,
    typeRegistry,
    nowFn,
    onProgress,
    onResult,
    verbose,
    resolveGraderProvider,
    agentTimeoutMs,
    targetResolver,
    availableTargets,
    threshold: batchThreshold,
    replayRecording,
    evalFilePath,
    repoRoot,
  } = options;

  // Prepare prompt inputs up front so we can reuse them for grading.
  const promptInputsList: PromptInputs[] = [];
  const formattingMode = usesFileReferencePrompt(provider) ? 'agent' : 'lm';

  for (const evalCase of evalCases) {
    const promptInputs = await buildPromptInputs(evalCase, formattingMode);
    promptInputsList.push(promptInputs);
  }

  const batchRequests: ProviderRequest[] = evalCases.map((evalCase, index) => {
    const promptInputs = promptInputsList[index];
    return {
      question: promptInputs.question,
      systemPrompt: promptInputs.systemMessage,
      inputFiles: evalCase.file_paths,
      evalCaseId: evalCase.id,
      suite: evalCase.suite,
      evalFilePath,
    };
  });

  const batchResponse = await provider.invokeBatch?.(batchRequests);
  if (!Array.isArray(batchResponse)) {
    throw new Error('Provider batching failed: invokeBatch did not return an array');
  }
  if (batchResponse.length !== evalCases.length) {
    throw new Error(
      `Provider batching failed: expected ${evalCases.length} responses, received ${batchResponse.length}`,
    );
  }

  if (onProgress) {
    const startedAt = Date.now();
    for (let i = 0; i < evalCases.length; i++) {
      await onProgress({
        workerId: 1,
        testId: evalCases[i].id,
        status: 'running',
        startedAt,
      });
    }
  }

  const results: EvaluationResult[] = [];
  for (let i = 0; i < evalCases.length; i++) {
    const evalCase = evalCases[i];
    const promptInputs = promptInputsList[i];
    const providerResponse = batchResponse[i];
    await maybeRecordReplayFixture({
      replayRecording,
      evalCase,
      evalFilePath,
      repoRoot,
      target,
      attempt: 0,
      response: providerResponse,
      nowFn,
    });

    // Extract output from batch response
    const output = providerResponse.output;
    const hasExecutionMetrics =
      providerResponse.tokenUsage !== undefined ||
      providerResponse.costUsd !== undefined ||
      providerResponse.durationMs !== undefined;

    const computed = output
      ? computeTraceSummary(output)
      : hasExecutionMetrics
        ? { trace: { eventCount: 0, toolCalls: {}, errorCount: 0 } }
        : undefined;
    const merged = computed
      ? mergeExecutionMetrics(computed, {
          tokenUsage: providerResponse.tokenUsage,
          costUsd: providerResponse.costUsd,
          durationMs: providerResponse.durationMs,
          startTime: providerResponse.startTime,
          endTime: providerResponse.endTime,
        })
      : undefined;
    const trace = merged?.trace;
    const costUsd = merged?.costUsd;
    const durationMs = merged?.durationMs;
    const tokenUsage = merged?.tokenUsage;
    const startTime = merged?.startTime;
    const endTime = merged?.endTime;
    const rawProviderLogPath = extractProviderRawLogPath(providerResponse);

    // Extract candidate from last assistant message in output
    const candidate = extractLastAssistantContent(output);

    const providerError = extractProviderError(providerResponse);

    let result: EvaluationResult;
    try {
      result = await evaluateCandidate({
        evalCase,
        candidate,
        target,
        provider,
        evaluators: evaluatorRegistry,
        typeRegistry,
        promptInputs,
        nowFn,
        attempt: 0,
        graderProvider: await resolveGraderProvider(target),
        agentTimeoutMs,
        output,
        trace,
        costUsd,
        durationMs,
        tokenUsage,
        startTime,
        endTime,
        rawProviderLogPath,
        targetResolver,
        availableTargets,
        verbose,
        threshold: evalCase.threshold ?? batchThreshold,
      });

      if (providerError) {
        result = {
          ...result,
          trace: appendErrorEventToTrace(result.trace, providerError, {
            failure_stage: 'agent',
            failure_reason_code: 'provider_error',
          }),
          error: providerError,
          executionStatus: 'execution_error' as const,
          failureStage: 'agent' as const,
          failureReasonCode: 'provider_error',
          executionError: { message: providerError, stage: 'agent' as const },
        };
      }
    } catch (error) {
      const errorResult = buildErrorResult(
        evalCase,
        target.name,
        nowFn(),
        error,
        promptInputs,
        provider,
        'evaluator',
        'evaluator_error',
        verbose,
      );
      results.push(errorResult);
      if (onResult) {
        await onResult(errorResult);
      }
      if (onProgress) {
        await onProgress({
          workerId: 1,
          testId: evalCase.id,
          status: 'failed',
          completedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          score: errorResult.score,
          executionStatus: errorResult.executionStatus,
          evalRunDurationMs: errorResult.evalRun?.durationMs,
        });
      }
      continue;
    }

    results.push(result);
    if (onResult) {
      await onResult(result);
    }

    if (onProgress) {
      await onProgress({
        workerId: 1,
        testId: evalCase.id,
        status: result.error ? 'failed' : 'completed',
        startedAt: 0,
        completedAt: Date.now(),
        error: result.error,
        score: result.score,
        executionStatus: result.executionStatus,
        durationMs: result.durationMs,
        evalRunDurationMs: result.evalRun?.durationMs,
      });
    }
  }

  return results;
}

async function maybeRecordReplayFixture(options: {
  readonly replayRecording?: ReplayRecordingOptions;
  readonly evalCase: EvalTest;
  readonly evalFilePath?: string;
  readonly repoRoot?: string;
  readonly target: ResolvedTarget;
  readonly attempt: number;
  readonly response: ProviderResponse;
  readonly nowFn: () => Date;
}): Promise<void> {
  const { replayRecording, evalCase, evalFilePath, repoRoot, target, attempt, response, nowFn } =
    options;
  if (!replayRecording || target.kind === 'replay') {
    return;
  }
  if (!evalFilePath || !repoRoot) {
    throw new Error('Replay recording requires evalFilePath and repoRoot');
  }

  const record = buildReplayFixtureRecord({
    evalCase,
    evalFilePath,
    repoRoot,
    target,
    sourceTarget: replayRecording.sourceTarget,
    attempt,
    variant: replayRecording.variant,
    response,
    now: nowFn,
  });
  await appendReplayFixtureRecord(replayRecording.fixturesPath, record);
}

export async function runEvalCase(options: RunEvalCaseOptions): Promise<EvaluationResult> {
  const {
    evalCase,
    provider,
    target,
    evaluators,
    now,
    maxRetries,
    agentTimeoutMs,
    cache,
    useCache,
    signal,
    graderProvider,
    targetResolver,
    availableTargets,
    evalRunId,
    keepWorkspaces,
    cleanupWorkspaces: forceCleanup,
    retainOnSuccess,
    retainOnFailure,
    sharedWorkspacePath,
    sharedBaselineCommit,
    suiteWorkspaceFile,
    typeRegistry: providedTypeRegistry,
    repoManager,
    evalDir,
    verbose,
    threshold: caseThreshold,
    dependencyResults,
    replayRecording,
    evalFilePath,
    repoRoot,
  } = options;
  const setupDebug = process.env.AGENTV_SETUP_DEBUG === '1';

  const formattingMode = usesFileReferencePrompt(provider) ? 'agent' : 'lm';
  const promptInputs = await buildPromptInputs(evalCase, formattingMode);
  const typeRegistry = providedTypeRegistry ?? createBuiltinRegistry();

  const cacheKey = useCache ? createCacheKey(provider, target, evalCase, promptInputs) : undefined;
  let cachedResponse: ProviderResponse | undefined;
  if (cacheKey && cache) {
    cachedResponse = await cache.get(cacheKey);
  }

  const nowFn = now ?? (() => new Date());

  let afterEachOutput: string | undefined;
  const caseHooksEnabled = hooksEnabled(evalCase.workspace);
  let workspaceSetup: EvalCaseWorkspaceSetup;
  try {
    workspaceSetup = await prepareEvalCaseWorkspace({
      evalCase,
      targetName: target.name,
      evalRunId,
      sharedWorkspacePath,
      sharedBaselineCommit,
      suiteWorkspaceFile,
      repoManager,
      evalDir,
      cleanupWorkspaces: forceCleanup,
      targetHooks: options.targetHooks,
      setupDebug,
    });
  } catch (error) {
    const setupError = error instanceof WorkspaceSetupError ? error : undefined;
    return buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      error,
      promptInputs,
      provider,
      setupError?.failureStage ?? 'setup',
      setupError?.failureReasonCode ?? 'script_error',
      verbose,
    );
  }

  const {
    workspacePath,
    beforeAllOutput,
    beforeEachOutput,
    baselineCommit,
    isSharedWorkspace,
    caseWorkspaceFile,
  } = workspaceSetup;

  // Conversation mode: turn-by-turn evaluation
  if (evalCase.mode === 'conversation' && evalCase.turns?.length) {
    const conversationResult = await runConversationMode({
      evalCase,
      provider,
      target,
      evaluators,
      typeRegistry,
      graderProvider,
      promptInputs,
      nowFn,
      signal,
      workspacePath,
      caseWorkspaceFile: caseWorkspaceFile ?? suiteWorkspaceFile,
      agentTimeoutMs,
      streamCallbacks: options.streamCallbacks,
      verbose,
      threshold: evalCase.threshold ?? caseThreshold,
      targetResolver,
      availableTargets,
      evalFilePath,
    });

    // Cleanup workspace (same logic as standard path)
    if (workspacePath && !isSharedWorkspace) {
      const shouldRetain =
        conversationResult.executionStatus === 'ok'
          ? retainOnSuccess === 'keep' || keepWorkspaces
          : retainOnFailure === 'keep' || (!forceCleanup && !keepWorkspaces);
      if (!shouldRetain) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
    }

    return conversationResult;
  }

  const caseStartMs = Date.now();
  const attemptBudget = (maxRetries ?? 0) + 1;
  let attempt = 0;
  let providerResponse: ProviderResponse | undefined = cachedResponse;
  let lastError: unknown;
  /** Set when a fallback target actually served the response. */
  let targetUsed: string | undefined;

  while (!providerResponse && attempt < attemptBudget) {
    try {
      providerResponse = await invokeProvider(provider, {
        evalCase: evalCase,
        target,
        promptInputs,
        attempt,
        evalFilePath,
        agentTimeoutMs,
        signal,
        cwd: workspacePath,
        workspaceFile: caseWorkspaceFile ?? suiteWorkspaceFile,
        captureFileChanges: !!baselineCommit,
        streamCallbacks: options.streamCallbacks,
      });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attemptBudget) {
        const delayMs = retryBackoffMs(attempt);
        await sleep(delayMs, signal);
        attempt += 1;
        continue;
      }
      break; // Exhausted retries on primary — try fallback targets below
    }
  }

  // Try fallback targets in order after exhausting retries on the primary
  if (!providerResponse && target.fallbackTargets?.length && targetResolver) {
    for (const fallbackName of target.fallbackTargets) {
      const fallbackProvider = targetResolver(fallbackName);
      if (!fallbackProvider) {
        continue;
      }
      try {
        providerResponse = await invokeProvider(fallbackProvider, {
          evalCase: evalCase,
          target,
          promptInputs,
          attempt: 0,
          evalFilePath,
          agentTimeoutMs,
          signal,
          cwd: workspacePath,
          workspaceFile: caseWorkspaceFile ?? suiteWorkspaceFile,
          captureFileChanges: !!baselineCommit,
          streamCallbacks: options.streamCallbacks,
        });
        targetUsed = fallbackName;
        break; // Fallback succeeded
      } catch (error) {
        lastError = error;
        // Continue to next fallback
      }
    }
  }

  if (!providerResponse) {
    const errorResult = buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      lastError ?? new Error('Provider did not return a response'),
      promptInputs,
      provider,
      'agent',
      'provider_error',
      verbose,
    );
    // On error, keep workspace for debugging (unless forceCleanup is set)
    if (workspacePath) {
      if (forceCleanup) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      return { ...errorResult, workspacePath };
    }
    return errorResult;
  }

  const responseWasCached = cachedResponse !== undefined && providerResponse === cachedResponse;
  if (!responseWasCached) {
    await maybeRecordReplayFixture({
      replayRecording,
      evalCase,
      evalFilePath,
      repoRoot,
      target: targetUsed ? { ...target, name: targetUsed } : target,
      attempt,
      response: providerResponse,
      nowFn,
    });
  }

  if (cacheKey && cache && !cachedResponse) {
    await cache.set(cacheKey, providerResponse);
  }

  // Extract output from provider response
  const output = providerResponse.output;

  const hasExecutionMetrics =
    providerResponse.tokenUsage !== undefined ||
    providerResponse.costUsd !== undefined ||
    providerResponse.durationMs !== undefined;

  // Compute trace summary if output available. If not, still preserve execution metrics.
  const computed = output
    ? computeTraceSummary(output)
    : hasExecutionMetrics
      ? { trace: { eventCount: 0, toolCalls: {}, errorCount: 0 } }
      : undefined;
  const merged = computed
    ? mergeExecutionMetrics(computed, {
        tokenUsage: providerResponse.tokenUsage,
        costUsd: providerResponse.costUsd,
        durationMs: providerResponse.durationMs,
        startTime: providerResponse.startTime,
        endTime: providerResponse.endTime,
      })
    : undefined;
  const trace = merged?.trace;
  const costUsd = merged?.costUsd;
  const durationMs = merged?.durationMs;
  const tokenUsage = merged?.tokenUsage;
  const startTime = merged?.startTime;
  const endTime = merged?.endTime;
  const rawProviderLogPath = extractProviderRawLogPath(providerResponse);

  // Extract candidate from last assistant message in output
  const candidate = extractLastAssistantContent(output);

  // Capture file changes: git diff against baseline, then merge any provider-reported artifacts.
  let fileChanges: string | undefined;
  if (baselineCommit && workspacePath) {
    try {
      const diff = await captureWorkspaceFileChanges(workspacePath, baselineCommit);
      if (diff.length > 0) {
        fileChanges = diff;
      }
    } catch {
      // Non-fatal: file change tracking is best-effort
    }
  }

  // Provider-reported artifacts (files written outside workspace_path,
  // e.g. copilot session-state). Merged on top of any workspace-based diff.
  const providerFileChanges = providerResponse?.fileChanges;
  if (providerFileChanges) {
    fileChanges = fileChanges ? `${fileChanges}\n${providerFileChanges}` : providerFileChanges;
  }

  // Format tool calls for LLM grader template variable
  const toolCalls = formatToolCalls(output);

  const providerError = extractProviderError(providerResponse);

  const runAfterEachHooks = async () => {
    // Execute target after_each hook before workspace after_each/reset.
    const targetAfterEachHook = options.targetHooks?.after_each;
    if (workspacePath && hasHookCommand(targetAfterEachHook)) {
      const scriptContext: ScriptExecutionContext = {
        workspacePath,
        testId: evalCase.id,
        evalRunId: evalRunId ?? '',
        caseInput: evalCase.question,
        caseMetadata: evalCase.metadata,
        evalDir,
        workspaceFileDir: evalCase.workspace?.workspaceFileDir,
      };
      try {
        await executeWorkspaceScript(
          toScriptConfig(targetAfterEachHook, 'after_each', `target hook for '${evalCase.id}'`),
          scriptContext,
          'warn',
        );
      } catch {
        // target after_each failures are non-fatal
      }
    }

    // Reset workspace state before after_each hook (if configured), but only
    // after graders have inspected the agent-modified workspace.
    if (
      caseHooksEnabled &&
      workspacePath &&
      evalCase.workspace?.hooks?.after_each?.reset &&
      evalCase.workspace.hooks.after_each.reset !== 'none'
    ) {
      try {
        if (repoManager && evalCase.workspace.repos?.length) {
          await repoManager.reset(
            evalCase.workspace.repos,
            workspacePath,
            evalCase.workspace.hooks.after_each.reset,
          );
        } else {
          await resetWorkspaceRoot(
            workspacePath,
            evalCase.workspace.hooks.after_each.reset,
            baselineCommit,
          );
        }
      } catch {
        // Reset failures are non-fatal (like after_each)
      }
    }

    // Execute after_each hook (runs after grading, before cleanup)
    const caseAfterEachHook = evalCase.workspace?.hooks?.after_each;
    if (workspacePath && caseHooksEnabled && hasHookCommand(caseAfterEachHook)) {
      const afterEachHook = caseAfterEachHook;
      const scriptContext: ScriptExecutionContext = {
        workspacePath,
        testId: evalCase.id,
        evalRunId: evalRunId ?? '',
        caseInput: evalCase.question,
        caseMetadata: evalCase.metadata,
        evalDir,
        workspaceFileDir: evalCase.workspace?.workspaceFileDir,
      };
      try {
        afterEachOutput = await executeWorkspaceScript(
          toScriptConfig(afterEachHook, 'after_each', `test '${evalCase.id}'`),
          scriptContext,
          'warn',
        );
      } catch {
        // after_each failures are non-fatal
      }
    }
  };

  try {
    const result = await evaluateCandidate({
      evalCase,
      candidate,
      target,
      provider,
      evaluators,
      typeRegistry,
      promptInputs,
      nowFn,
      attempt,
      graderProvider,
      agentTimeoutMs,
      output,
      trace,
      costUsd,
      durationMs,
      tokenUsage,
      startTime,
      endTime,
      rawProviderLogPath,
      targetResolver,
      availableTargets,
      fileChanges,
      toolCalls,
      workspacePath,
      dockerConfig: evalCase.workspace?.docker,
      verbose,
      threshold: evalCase.threshold ?? caseThreshold,
      dependencyResults,
    });
    await runAfterEachHooks();

    const effectiveThreshold = evalCase.threshold ?? caseThreshold;
    const totalDurationMs = Date.now() - caseStartMs;

    // Aggregate grader token usage from individual grader results
    const graderTokens = aggregateEvaluatorTokenUsage(result.scores);
    const evalRunTokenUsage =
      tokenUsage || graderTokens
        ? {
            input: (tokenUsage?.input ?? 0) + (graderTokens?.input ?? 0),
            output: (tokenUsage?.output ?? 0) + (graderTokens?.output ?? 0),
            ...(tokenUsage?.reasoning != null || graderTokens?.reasoning != null
              ? { reasoning: (tokenUsage?.reasoning ?? 0) + (graderTokens?.reasoning ?? 0) }
              : {}),
            ...(tokenUsage?.cached != null || graderTokens?.cached != null
              ? { cached: (tokenUsage?.cached ?? 0) + (graderTokens?.cached ?? 0) }
              : {}),
          }
        : undefined;

    const evalRun = {
      durationMs: totalDurationMs,
      ...(evalRunTokenUsage ? { tokenUsage: evalRunTokenUsage } : {}),
    };

    const skippedEvaluatorError = buildSkippedEvaluatorError(result.scores);
    const executionStatus: ExecutionStatus =
      providerError || skippedEvaluatorError
        ? 'execution_error'
        : classifyQualityStatus(result.score, effectiveThreshold);

    // Include targetUsed only when a fallback target served the response
    const targetUsedField = targetUsed ? { targetUsed } : {};

    const finalResult = providerError
      ? {
          ...result,
          ...targetUsedField,
          evalRun,
          trace: appendErrorEventToTrace(result.trace, providerError, {
            failure_stage: 'agent',
            failure_reason_code: 'provider_error',
          }),
          error: providerError,
          executionStatus,
          failureStage: 'agent' as const,
          failureReasonCode: 'provider_error',
          executionError: { message: providerError, stage: 'agent' as const },
          beforeAllOutput,
          beforeEachOutput,
          afterEachOutput,
        }
      : skippedEvaluatorError
        ? {
            ...result,
            ...targetUsedField,
            score: 0,
            evalRun,
            trace: appendErrorEventToTrace(result.trace, skippedEvaluatorError, {
              failure_stage: 'evaluator',
              failure_reason_code: 'evaluator_error',
            }),
            error: skippedEvaluatorError,
            executionStatus,
            failureStage: 'evaluator' as const,
            failureReasonCode: 'evaluator_error',
            executionError: { message: skippedEvaluatorError, stage: 'evaluator' as const },
            beforeAllOutput,
            beforeEachOutput,
            afterEachOutput,
          }
        : {
            ...result,
            ...targetUsedField,
            evalRun,
            executionStatus,
            beforeAllOutput,
            beforeEachOutput,
            afterEachOutput,
          };

    // Determine if this is a failure (has error or low score)
    const isFailure = !!finalResult.error || finalResult.score < 0.5;

    // Cleanup workspace based on result and flags (only for per-case workspaces)
    if (workspacePath && !isSharedWorkspace) {
      if (forceCleanup) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      } else if (isFailure) {
        if ((retainOnFailure ?? 'keep') === 'cleanup') {
          await cleanupWorkspace(workspacePath).catch(() => {});
        } else {
          return { ...finalResult, workspacePath };
        }
      } else if ((retainOnSuccess ?? (keepWorkspaces ? 'keep' : 'cleanup')) !== 'keep') {
        await cleanupWorkspace(workspacePath).catch(() => {});
      } else {
        return { ...finalResult, workspacePath };
      }
    }

    return finalResult;
  } catch (error) {
    await runAfterEachHooks().catch(() => {});
    const evalRun = { durationMs: Date.now() - caseStartMs };
    const errorResult = buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      error,
      promptInputs,
      provider,
      'evaluator',
      'evaluator_error',
      verbose,
    );
    // On error, keep workspace for debugging (only for per-case workspaces)
    if (workspacePath && !isSharedWorkspace) {
      if (forceCleanup || (retainOnFailure ?? 'keep') === 'cleanup') {
        await cleanupWorkspace(workspacePath).catch(() => {});
      } else {
        return { ...errorResult, evalRun, workspacePath, beforeEachOutput, afterEachOutput };
      }
    }
    return { ...errorResult, evalRun, beforeEachOutput, afterEachOutput };
  }
}

async function runEvalCaseWithTrials(
  options: RunEvalCaseOptions,
  trialsConfig: TrialsConfig,
): Promise<EvaluationResult> {
  const trialResults: TrialResult[] = [];
  const allResults: EvaluationResult[] = [];
  let cumulativeCost = 0;
  let costLimited = false;
  let costWarningEmitted = false;

  for (let attempt = 0; attempt < trialsConfig.count; attempt++) {
    // For intermediate trials, force workspace cleanup.
    // We don't know the declared count's last index because early exit may occur,
    // so treat the current trial as "last" only if it's the final declared iteration.
    // On early exit, the actual last trial gets intermediate cleanup — acceptable since
    // the passing trial's workspace is less important to preserve.
    const isLastDeclaredTrial = attempt === trialsConfig.count - 1;
    const trialOptions: RunEvalCaseOptions = {
      ...options,
      // Disable cache for individual trials (each should be a fresh invocation)
      useCache: false,
      // Force cleanup for intermediate trials
      cleanupWorkspaces: isLastDeclaredTrial ? options.cleanupWorkspaces : true,
      keepWorkspaces: isLastDeclaredTrial ? options.keepWorkspaces : false,
      retainOnSuccess: isLastDeclaredTrial ? options.retainOnSuccess : 'cleanup',
      retainOnFailure: isLastDeclaredTrial ? options.retainOnFailure : 'cleanup',
    };

    const result = await runEvalCase(trialOptions);
    allResults.push(result);

    // Extract cost from trace summary if available
    const trialCost = result.costUsd;

    const trialVerdict = scoreToVerdict(result.score);
    const trial: TrialResult = {
      attempt,
      score: result.score,
      verdict: trialVerdict,
      scores: result.scores,
      error: result.error,
      costUsd: trialCost,
      executionStatus: result.executionStatus,
      failureStage: result.failureStage,
      failureReasonCode: result.failureReasonCode,
      result,
    };
    trialResults.push(trial);

    // Track cumulative cost
    if (trialCost !== undefined) {
      cumulativeCost += trialCost;
    } else if (trialsConfig.costLimitUsd && !costWarningEmitted) {
      console.warn(
        'Warning: cost_limit_usd is set but provider does not report cost. All trials will run.',
      );
      costWarningEmitted = true;
    }

    // Check cost limit
    if (trialsConfig.costLimitUsd && cumulativeCost >= trialsConfig.costLimitUsd) {
      costLimited = true;
      break;
    }

    // pass_at_k early exit: short-circuit after first passing trial
    if (
      trialsConfig.strategy === 'pass_at_k' &&
      trialsConfig.earlyExit !== false &&
      trialVerdict === 'pass'
    ) {
      break;
    }
  }

  // Aggregate trial results
  const { score, aggregation } = aggregateTrials(trialResults, trialsConfig);

  // Use the best-scoring trial's EvaluationResult for metadata (assertions,
  // answer) so that the result's metadata corresponds to the aggregated score.
  const bestTrialIndex = trialResults.reduce(
    (bestIdx, t, idx) => (t.score > trialResults[bestIdx].score ? idx : bestIdx),
    0,
  );
  const baseResult = allResults[bestTrialIndex];

  // Determine aggregate executionStatus from trial results:
  // - If ANY trial succeeded → ok
  // - If ALL trials had execution_error → execution_error
  // - Otherwise → quality_failure
  const hasOk = trialResults.some((t) => t.executionStatus === 'ok');
  const allExecutionError =
    trialResults.length > 0 && trialResults.every((t) => t.executionStatus === 'execution_error');
  const aggregateExecutionStatus: ExecutionStatus = hasOk
    ? 'ok'
    : allExecutionError
      ? 'execution_error'
      : 'quality_failure';

  // When the aggregate status differs from baseResult, clear failure fields that no longer apply
  const aggregateFailureStage =
    aggregateExecutionStatus === 'ok' ? undefined : baseResult.failureStage;
  const aggregateFailureReasonCode =
    aggregateExecutionStatus === 'ok' ? undefined : baseResult.failureReasonCode;
  const aggregateExecutionError =
    aggregateExecutionStatus === 'execution_error' ? baseResult.executionError : undefined;

  return {
    ...baseResult,
    score,
    trials: trialResults,
    aggregation,
    costLimited: costLimited || undefined,
    executionStatus: aggregateExecutionStatus,
    failureStage: aggregateFailureStage,
    failureReasonCode: aggregateFailureReasonCode,
    executionError: aggregateExecutionError,
  };
}

async function evaluateCandidate(options: {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Grader>> & { readonly 'llm-grader': Grader };
  readonly typeRegistry: import('./registry/grader-registry.js').GraderRegistry;
  readonly promptInputs: PromptInputs;
  readonly nowFn: () => Date;
  readonly attempt: number;
  readonly graderProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly rawProviderLogPath?: string;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly toolCalls?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly verbose?: boolean;
  readonly threshold?: number;
  readonly dependencyResults?: Readonly<Record<string, import('./types.js').DependencyResult>>;
}): Promise<EvaluationResult> {
  const {
    evalCase,
    candidate,
    target,
    provider,
    evaluators,
    typeRegistry,
    promptInputs,
    nowFn,
    attempt,
    graderProvider,
    agentTimeoutMs,
    output,
    trace,
    costUsd,
    durationMs,
    tokenUsage,
    startTime,
    endTime,
    rawProviderLogPath,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    threshold: evalThreshold,
    dependencyResults,
  } = options;

  const input = buildResultInput(promptInputs);
  const outputMessages = output ?? [{ role: 'assistant' as const, content: candidate }];
  const evaluationTrace = buildTraceFromMessages({
    input,
    output: outputMessages,
    summary: trace,
    finalOutput: candidate,
    tokenUsage,
    costUsd,
    durationMs,
    startTime,
    endTime,
    provider: provider.kind,
    target: target.name,
    testId: evalCase.id,
    conversationId: evalCase.conversation_id,
  });

  const gradeTimestamp = nowFn();
  const { score, scores } = await runEvaluatorsForCase({
    evalCase,
    candidate,
    target,
    provider,
    evaluators,
    typeRegistry,
    attempt,
    promptInputs,
    now: gradeTimestamp,
    graderProvider,
    agentTimeoutMs,
    output,
    trace: evaluationTrace,
    costUsd,
    durationMs,
    tokenUsage,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    threshold: evalThreshold,
    dependencyResults,
  });

  const completedAt = nowFn();

  let agentRequest: JsonObject | undefined;
  let lmRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentRequest = {
      ...(options.verbose ? { input: promptInputs.question } : {}),
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
      } as JsonObject;
    } else {
      lmRequest = {
        question: promptInputs.question,
      } as JsonObject;
    }
  }

  const evaluatorRequest = scores ? undefined : score.graderRawRequest;
  // Only include agent request if it has content (verbose mode adds the input field)
  const effectiveAgentRequest =
    agentRequest && Object.keys(agentRequest).length > 0 ? agentRequest : undefined;
  const requests =
    effectiveAgentRequest || lmRequest || evaluatorRequest
      ? {
          ...(effectiveAgentRequest ? { agent: effectiveAgentRequest } : {}),
          ...(lmRequest ? { lm: lmRequest } : {}),
          ...(evaluatorRequest ? { evaluator: evaluatorRequest } : {}),
        }
      : undefined;
  return {
    timestamp: completedAt.toISOString(),
    testId: evalCase.id,
    suite: evalCase.suite,
    category: evalCase.category,
    conversationId: evalCase.conversation_id,
    score: score.score,
    assertions: score.assertions,
    target: target.name,
    tokenUsage,
    costUsd,
    durationMs,
    startTime,
    endTime,
    requests,
    input,
    output: candidate,
    scores: scores,
    trace: evaluationTrace,
    rawProviderLogPath,
    fileChanges,
    executionStatus: classifyQualityStatus(score.score, evalThreshold),
  };
}

async function runEvaluatorsForCase(options: {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Grader>> & { readonly 'llm-grader': Grader };
  readonly typeRegistry: import('./registry/grader-registry.js').GraderRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly graderProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: Trace;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly toolCalls?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly threshold?: number;
  readonly dependencyResults?: Readonly<Record<string, import('./types.js').DependencyResult>>;
}): Promise<{ score: EvaluationScore; scores?: GraderResult[] }> {
  const {
    evalCase,
    candidate,
    target,
    provider,
    evaluators,
    typeRegistry,
    attempt,
    promptInputs,
    now,
    graderProvider,
    agentTimeoutMs,
    output,
    trace,
    costUsd,
    durationMs,
    tokenUsage,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    threshold,
    dependencyResults,
  } = options;

  // Declared assertions are the complete grader list for the case. Reference
  // data such as expected_output stays on evalCase for graders that read it,
  // but does not add an implicit llm-grader.
  if (evalCase.assertions && evalCase.assertions.length > 0) {
    return runEvaluatorList({
      evalCase,
      evaluators: evalCase.assertions,
      candidate,
      target,
      provider,
      evaluatorRegistry: evaluators,
      typeRegistry,
      attempt,
      promptInputs,
      now,
      graderProvider,
      agentTimeoutMs,
      output,
      trace,
      costUsd,
      durationMs,
      tokenUsage,
      startTime,
      endTime,
      targetResolver,
      availableTargets,
      fileChanges,
      toolCalls,
      workspacePath,
      dockerConfig,
      threshold,
      dependencyResults,
    });
  }

  const evaluatorKind = evalCase.evaluator ?? 'llm-grader';
  const activeEvaluator = evaluators[evaluatorKind] ?? evaluators['llm-grader'];
  if (!activeEvaluator) {
    throw new Error(`No evaluator registered for kind '${evaluatorKind}'`);
  }
  const implicitEvaluator =
    evaluatorKind === 'llm-grader' && !evalCase.assertions
      ? buildImplicitLlmGraderConfig(evalCase)
      : undefined;

  const score = await activeEvaluator.evaluate({
    evalCase,
    candidate,
    target,
    provider,
    attempt,
    promptInputs,
    now,
    graderProvider,
    output,
    trace,
    tokenUsage,
    costUsd,
    durationMs,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    dependencyResults,
    ...(implicitEvaluator ? { evaluator: implicitEvaluator } : {}),
  });

  return { score };
}

function buildImplicitLlmGraderConfig(evalCase: EvalTest): LlmGraderConfig | undefined {
  if (!evalCase.preprocessors || evalCase.preprocessors.length === 0) {
    return undefined;
  }

  return {
    name: 'llm-grader',
    type: 'llm-grader',
    preprocessors: evalCase.preprocessors,
  };
}

async function runEvaluatorList(options: {
  readonly evalCase: EvalTest;
  readonly evaluators: readonly GraderConfig[];
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluatorRegistry: Partial<Record<string, Grader>> & {
    readonly 'llm-grader': Grader;
  };
  readonly typeRegistry: import('./registry/grader-registry.js').GraderRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly graderProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: Trace;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly toolCalls?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly threshold?: number;
  readonly dependencyResults?: Readonly<Record<string, import('./types.js').DependencyResult>>;
}): Promise<{ score: EvaluationScore; scores: GraderResult[] }> {
  const {
    evalCase,
    evaluators,
    candidate,
    target,
    provider,
    evaluatorRegistry,
    typeRegistry,
    attempt,
    promptInputs,
    now,
    graderProvider,
    agentTimeoutMs,
    output,
    trace,
    costUsd,
    durationMs,
    tokenUsage,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    dependencyResults,
  } = options;

  const scored: Array<{
    readonly score: EvaluationScore;
    readonly name: string;
    readonly type: string;
    readonly weight?: number;
    readonly required?: boolean | number;
    readonly min_score?: number;
  }> = [];
  const scores: GraderResult[] = [];

  // Build the evaluation context (shared across all evaluators for this case)
  const evalContext: import('./graders/types.js').EvaluationContext = {
    evalCase,
    candidate,
    target,
    provider,
    attempt,
    promptInputs,
    now,
    graderProvider,
    output,
    trace,
    tokenUsage,
    costUsd,
    durationMs,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    toolCalls,
    workspacePath,
    dockerConfig,
    dependencyResults,
  };

  // Build the dispatch context for evaluator factories
  const evalFileDir = evalCase.file_paths[0] ? path.dirname(evalCase.file_paths[0]) : process.cwd();
  const dispatchContext: import('./registry/grader-registry.js').GraderDispatchContext = {
    graderProvider,
    targetResolver,
    availableTargets,
    agentTimeoutMs,
    evalFileDir,
    llmGrader: evaluatorRegistry['llm-grader'],
    registry: typeRegistry,
  };

  for (const evaluatorConfig of evaluators ?? []) {
    const startedAt = new Date();
    try {
      // Create evaluator instance via registry
      const evaluatorInstance = await typeRegistry.create(evaluatorConfig, dispatchContext);
      const score = await evaluatorInstance.evaluate(evalContext);
      const endedAt = new Date();

      const weight = evaluatorConfig.weight ?? 1.0;

      scored.push({
        score,
        name: evaluatorConfig.name,
        type: evaluatorConfig.type,
        weight,
        ...(evaluatorConfig.required !== undefined ? { required: evaluatorConfig.required } : {}),
        ...(evaluatorConfig.min_score !== undefined
          ? { min_score: evaluatorConfig.min_score }
          : {}),
      });
      scores.push({
        name: evaluatorConfig.name,
        type: evaluatorConfig.type,
        score: score.score,
        weight,
        verdict: score.verdict,
        assertions: score.assertions,
        input: score.graderRawRequest,
        target: score.graderTarget,
        details: score.details,
        scores: mapChildResults(score.scores),
        tokenUsage: score.tokenUsage,
        durationMs: endedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
    } catch (error) {
      const endedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);
      const fallbackScore: EvaluationScore = {
        score: 0,
        verdict: 'fail',
        assertions: [
          { text: `Grader '${evaluatorConfig.name}' failed: ${message}`, passed: false },
        ],
        expectedAspectCount: 1,
      };
      const weight = evaluatorConfig.weight ?? 1.0;
      scored.push({
        score: fallbackScore,
        name: evaluatorConfig.name ?? 'unknown',
        type: evaluatorConfig.type ?? 'llm-grader',
        weight,
        ...(evaluatorConfig.required !== undefined ? { required: evaluatorConfig.required } : {}),
        ...(evaluatorConfig.min_score !== undefined
          ? { min_score: evaluatorConfig.min_score }
          : {}),
      });
      scores.push({
        name: evaluatorConfig.name ?? 'unknown',
        type: evaluatorConfig.type ?? 'llm-grader',
        score: 0,
        weight,
        verdict: 'fail',
        assertions: [
          {
            text: `Grader '${evaluatorConfig.name ?? 'unknown'}' failed: ${message}`,
            passed: false,
          },
        ],
        durationMs: endedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
    }

    // Apply negation if configured — inverts score and swaps pass/fail verdict
    if (evaluatorConfig.negate === true && scored.length > 0) {
      const lastScoredIdx = scored.length - 1;
      const lastScoresIdx = scores.length - 1;
      const negated = negateScore(scored[lastScoredIdx].score);
      scored[lastScoredIdx] = { ...scored[lastScoredIdx], score: negated };
      if (lastScoresIdx >= 0) {
        scores[lastScoresIdx] = {
          ...scores[lastScoresIdx],
          score: negated.score,
          verdict: negated.verdict,
          assertions: [...negated.assertions],
        };
      }
    }
  }

  // Required gate: if any evaluator with `required` flag fails its threshold, aggregate becomes 0
  const effectiveThreshold = options.threshold ?? DEFAULT_THRESHOLD;
  const hasRequiredFailure = scored.some((entry) => {
    if (!entry.required) return false;
    const minScore =
      entry.min_score ?? (typeof entry.required === 'number' ? entry.required : effectiveThreshold);
    return entry.score.score < minScore;
  });

  // Exclude skipped evaluators from score aggregation
  const scorable = scored.filter((entry) => entry.score.verdict !== 'skip');
  const aggregateScore = hasRequiredFailure
    ? 0
    : scorable.length > 0
      ? computeWeightedMean(
          scorable.map((entry) => ({ score: entry.score.score, weight: entry.weight })),
        )
      : 0;
  const assertions: AssertionEntry[] = scored.flatMap((entry) => entry.score.assertions);
  const expectedAspectCount = assertions.length || 1;

  const score: EvaluationScore = {
    score: aggregateScore,
    verdict: scoreToVerdict(aggregateScore, effectiveThreshold),
    assertions,
    expectedAspectCount,
  };

  return { score, scores };
}

function formatFilter(filter: string | readonly string[]): string {
  return typeof filter === 'string' ? filter : filter.join(', ');
}

function matchesFilter(id: string, filter: string | readonly string[]): boolean {
  return typeof filter === 'string'
    ? micromatch.isMatch(id, filter)
    : filter.some((pattern) => micromatch.isMatch(id, pattern));
}

function filterEvalCases(
  evalCases: readonly EvalTest[],
  filter?: string | readonly string[],
): readonly EvalTest[] {
  if (!filter) {
    return evalCases;
  }
  return evalCases.filter((evalCase) => matchesFilter(evalCase.id, filter));
}

function buildEvaluatorRegistry(
  overrides: Partial<Record<string, Grader>> | undefined,
  resolveGraderProvider: (target: ResolvedTarget) => Promise<Provider | undefined>,
): Partial<Record<string, Grader>> & { readonly 'llm-grader': Grader } {
  const llmGrader =
    overrides?.['llm-grader'] ??
    new LlmGrader({
      resolveGraderProvider: async (context) => {
        if (context.graderProvider) {
          return context.graderProvider;
        }
        return resolveGraderProvider(context.target);
      },
    });

  return {
    ...overrides,
    'llm-grader': llmGrader,
  };
}

// ---------------------------------------------------------------------------
// Conversation mode: turn-by-turn evaluation
// ---------------------------------------------------------------------------

/**
 * Run a multi-turn conversation evaluation.
 * For each turn: append user message → call provider → grade turn → append LLM response.
 * After all turns, run conversation-level assertions on the full transcript.
 * Final score is aggregated from turn scores + conversation scores.
 */
async function runConversationMode(options: {
  readonly evalCase: EvalTest;
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluators: Partial<Record<string, Grader>> & { readonly 'llm-grader': Grader };
  readonly typeRegistry: import('./registry/grader-registry.js').GraderRegistry;
  readonly graderProvider?: Provider;
  readonly promptInputs: PromptInputs;
  readonly nowFn: () => Date;
  readonly signal?: AbortSignal;
  readonly workspacePath?: string;
  readonly caseWorkspaceFile?: string;
  readonly agentTimeoutMs?: number;
  readonly streamCallbacks?: ProviderStreamCallbacks;
  readonly verbose?: boolean;
  readonly threshold?: number;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly evalFilePath?: string;
}): Promise<EvaluationResult> {
  const {
    evalCase,
    provider,
    target,
    evaluators,
    typeRegistry,
    graderProvider,
    promptInputs,
    nowFn,
    signal,
    workspacePath,
    caseWorkspaceFile,
    agentTimeoutMs,
    streamCallbacks,
    verbose,
    threshold,
    targetResolver,
    availableTargets,
    evalFilePath,
  } = options;

  // biome-ignore lint/style/noNonNullAssertion: turns is guaranteed by the caller (conversation mode gate)
  const turns = evalCase.turns!;
  const aggregation = evalCase.aggregation ?? 'mean';
  const onTurnFailure = evalCase.on_turn_failure ?? 'continue';
  const windowSize = evalCase.window_size;

  // Build initial message history from evalCase.input (system prompt + any context)
  const history: ChatMessage[] = [];
  for (const msg of evalCase.input) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    history.push({ role: msg.role as ChatMessageRole, content });
  }

  const turnScores: GraderResult[] = [];
  const allTurnScoreValues: number[] = [];
  let stopped = false;
  const caseStartMs = Date.now();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const turnIndex = i + 1;

    if (stopped) {
      // Turn skipped due to on_turn_failure: stop
      turnScores.push({
        name: `turn-${turnIndex}`,
        type: 'rubrics' as GraderKind,
        score: 0,
        verdict: 'skip' as EvaluationVerdict,
        assertions: [{ text: 'Skipped due to previous turn failure', passed: false }],
      });
      allTurnScoreValues.push(0);
      continue;
    }

    // Append user message to history
    const userContent = typeof turn.input === 'string' ? turn.input : JSON.stringify(turn.input);
    history.push({ role: 'user', content: userContent });

    // Build chatPrompt for provider call (with optional window_size)
    const chatPromptForProvider = windowSize
      ? buildWindowedHistory(history, windowSize)
      : [...history];

    // Call provider with accumulated history
    let response: ProviderResponse;
    try {
      response = await provider.invoke({
        question: userContent,
        chatPrompt: chatPromptForProvider,
        evalCaseId: `${evalCase.id}/turn-${turnIndex}`,
        suite: evalCase.suite,
        evalFilePath,
        signal,
        cwd: workspacePath,
        workspaceFile: caseWorkspaceFile,
        streamCallbacks,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      turnScores.push({
        name: `turn-${turnIndex}`,
        type: 'rubrics' as GraderKind,
        score: 0,
        verdict: 'fail' as EvaluationVerdict,
        assertions: [{ text: `Provider error: ${message}`, passed: false }],
      });
      allTurnScoreValues.push(0);
      if (onTurnFailure === 'stop') stopped = true;
      continue;
    }

    // Extract assistant response
    const assistantContent = extractLastAssistantContent(response.output);

    // Append actual LLM response (NOT expected_output) to history
    history.push({ role: 'assistant', content: assistantContent });

    // Grade this turn
    if (!turn.assertions?.length && !turn.expected_output) {
      // No assertions or expected_output — turn scores 1.0
      turnScores.push({
        name: `turn-${turnIndex}`,
        type: 'rubrics' as GraderKind,
        score: 1.0,
        verdict: 'pass' as EvaluationVerdict,
        assertions: [],
      });
      allTurnScoreValues.push(1.0);
      continue;
    }

    // Build assertions for this turn
    const turnAssertions = buildTurnAssertions(turn);

    // Create a synthetic EvalTest for this turn's grading
    const turnEvalCase: EvalTest = {
      ...evalCase,
      id: `${evalCase.id}/turn-${turnIndex}`,
      assertions: turnAssertions,
      input: buildTurnGraderInput(history, windowSize),
      expected_output: turn.expected_output
        ? [
            typeof turn.expected_output === 'string'
              ? ({ content: turn.expected_output } as JsonObject)
              : (turn.expected_output as JsonObject),
          ]
        : [],
      // Clear conversation fields to prevent recursion
      mode: undefined,
      turns: undefined,
    };

    const turnResult = await evaluateCandidate({
      evalCase: turnEvalCase,
      candidate: assistantContent,
      target,
      provider,
      evaluators,
      typeRegistry,
      promptInputs: {
        question: buildConversationContext(history, windowSize),
        chatPrompt: windowSize ? buildWindowedHistory(history, windowSize) : [...history],
      },
      nowFn,
      attempt: 0,
      graderProvider,
      agentTimeoutMs,
      output: response.output,
      verbose,
      threshold,
      targetResolver,
      availableTargets,
    });

    const turnScore = turnResult.score;
    allTurnScoreValues.push(turnScore);

    turnScores.push({
      name: `turn-${turnIndex}`,
      type: 'rubrics' as GraderKind,
      score: turnScore,
      verdict: scoreToVerdict(turnScore, threshold ?? DEFAULT_THRESHOLD) as EvaluationVerdict,
      assertions: turnResult.assertions ? [...turnResult.assertions] : [],
      scores: turnResult.scores,
    });

    // Check if we should stop on failure
    if (onTurnFailure === 'stop' && turnScore < (threshold ?? DEFAULT_THRESHOLD)) {
      stopped = true;
    }
  }

  // Run conversation-level assertions (top-level assertions on full transcript)
  let conversationScores: GraderResult[] = [];
  if (evalCase.assertions?.length) {
    const conversationEvalCase: EvalTest = {
      ...evalCase,
      id: `${evalCase.id}/conversation`,
      input: history.map((m) => ({
        role: m.role as TestMessageRole,
        content: m.content,
      })),
      expected_output: [],
      mode: undefined,
      turns: undefined,
    };

    const fullTranscript = history
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${m.role}: ${content}`;
      })
      .join('\n\n');

    const conversationResult = await evaluateCandidate({
      evalCase: conversationEvalCase,
      candidate: fullTranscript,
      target,
      provider,
      evaluators,
      typeRegistry,
      promptInputs: {
        question: fullTranscript,
        chatPrompt: [...history],
      },
      nowFn,
      attempt: 0,
      graderProvider,
      agentTimeoutMs,
      verbose,
      threshold,
      targetResolver,
      availableTargets,
    });

    conversationScores = [
      {
        name: 'conversation',
        type: 'rubrics' as GraderKind,
        score: conversationResult.score,
        verdict: scoreToVerdict(
          conversationResult.score,
          threshold ?? DEFAULT_THRESHOLD,
        ) as EvaluationVerdict,
        assertions: conversationResult.assertions ? [...conversationResult.assertions] : [],
        scores: conversationResult.scores,
      },
    ];
  }

  // Aggregate final score
  const allScoreValues = [...allTurnScoreValues, ...conversationScores.map((s) => s.score)];

  const finalScore = aggregateConversationScores(allScoreValues, aggregation);
  const allResultScores = [...turnScores, ...conversationScores];

  // Build output as full conversation transcript
  const outputMessages: Message[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const totalDurationMs = Date.now() - caseStartMs;
  const finalOutput = extractLastAssistantContent(outputMessages);
  const trace = buildTraceFromMessages({
    input: evalCase.input as readonly Message[],
    output: outputMessages,
    finalOutput,
    durationMs: totalDurationMs,
    provider: provider.kind,
    target: target.name,
    testId: evalCase.id,
    conversationId: evalCase.conversation_id,
  });

  const flatAssertions: AssertionEntry[] = allResultScores.flatMap((s) => [...s.assertions]);

  return {
    timestamp: nowFn().toISOString(),
    testId: evalCase.id,
    suite: evalCase.suite,
    category: evalCase.category,
    score: finalScore,
    assertions: flatAssertions,
    target: target.name,
    output: finalOutput,
    trace,
    scores: allResultScores,
    executionStatus: classifyQualityStatus(finalScore, threshold ?? DEFAULT_THRESHOLD),
    input: evalCase.input.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    evalRun: { durationMs: totalDurationMs },
  };
}

/** Include system messages + last windowSize*2 non-system messages */
function buildWindowedHistory(history: readonly ChatMessage[], windowSize: number): ChatMessage[] {
  const systemMessages = history.filter((m) => m.role === 'system');
  const nonSystem = history.filter((m) => m.role !== 'system');
  const windowed = nonSystem.slice(-windowSize * 2);
  return [...systemMessages, ...windowed];
}

/** Build a text representation of the conversation for grader context */
function buildConversationContext(history: readonly ChatMessage[], windowSize?: number): string {
  const msgs = windowSize ? buildWindowedHistory(history, windowSize) : history;
  return msgs
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${content}`;
    })
    .join('\n\n');
}

/** Build TestMessage[] from history for synthetic EvalTest input */
function buildTurnGraderInput(history: readonly ChatMessage[], windowSize?: number): TestMessage[] {
  const msgs = windowSize ? buildWindowedHistory(history, windowSize) : history;
  return msgs.map((m) => ({
    role: m.role as TestMessageRole,
    content: m.content,
  }));
}

/**
 * Convert per-turn assertions to GraderConfig[].
 * String assertions are grouped into a single rubrics evaluator.
 * Structured assertions pass through as-is.
 */
function buildTurnAssertions(turn: ConversationTurn): GraderConfig[] {
  if (!turn.assertions?.length) return [];

  const stringCriteria: string[] = [];
  const structured: GraderConfig[] = [];

  for (const a of turn.assertions) {
    if (typeof a === 'string') {
      stringCriteria.push(a);
    } else {
      structured.push(a);
    }
  }

  const result: GraderConfig[] = [];

  // Group string assertions into a single llm-grader evaluator with rubrics.
  // Uses llm-grader (not rubrics) because 'rubrics' is a YAML shorthand resolved by
  // the grader-parser — at runtime we always dispatch through 'llm-grader'.
  if (stringCriteria.length > 0) {
    result.push({
      name: 'turn-rubrics',
      type: 'llm-grader' as GraderKind,
      rubrics: stringCriteria.map((text, idx) => ({
        id: `criterion-${idx + 1}`,
        outcome: text,
        weight: 1,
      })),
    } as unknown as GraderConfig);
  }

  result.push(...structured);
  return result;
}

/** Aggregate turn scores using the configured strategy */
function aggregateConversationScores(
  scores: readonly number[],
  aggregation: ConversationAggregation,
): number {
  if (scores.length === 0) return 1.0;
  switch (aggregation) {
    case 'min':
      return Math.min(...scores);
    case 'max':
      return Math.max(...scores);
    default:
      return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }
}

async function invokeProvider(
  provider: Provider,
  options: {
    readonly evalCase: EvalTest;
    readonly target: ResolvedTarget;
    readonly promptInputs: PromptInputs;
    readonly attempt: number;
    readonly evalFilePath?: string;
    readonly agentTimeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Working directory override (e.g., from eval-level workspace.template) */
    readonly cwd?: string;
    /** VS Code .code-workspace file (resolved from workspace.template) */
    readonly workspaceFile?: string;
    /** When true, AgentV captures file changes — provider should skip forced diff prompt */
    readonly captureFileChanges?: boolean;
    /** Real-time observability callbacks */
    readonly streamCallbacks?: ProviderStreamCallbacks;
  },
): Promise<ProviderResponse> {
  const {
    evalCase,
    promptInputs,
    attempt,
    evalFilePath,
    agentTimeoutMs,
    signal,
    cwd,
    workspaceFile,
    captureFileChanges,
    streamCallbacks,
  } = options;

  const controller = new AbortController();
  const timeout = agentTimeoutMs ? setTimeout(() => controller.abort(), agentTimeoutMs) : undefined;

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    // Extract Braintrust span IDs for trace bridging (Claude provider only)
    const braintrustSpanIds = streamCallbacks?.getActiveSpanIds?.() ?? undefined;

    return await provider.invoke({
      question: promptInputs.question,
      systemPrompt: promptInputs.systemMessage,
      chatPrompt: promptInputs.chatPrompt,
      inputFiles: evalCase.file_paths,
      evalCaseId: evalCase.id,
      suite: evalCase.suite,
      evalFilePath,
      attempt,
      signal: controller.signal,
      cwd,
      workspaceFile,
      captureFileChanges,
      streamCallbacks,
      braintrustSpanIds: braintrustSpanIds ?? undefined,
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function buildErrorResult(
  evalCase: EvalTest,
  targetName: string,
  timestamp: Date,
  error: unknown,
  promptInputs: PromptInputs,
  provider: Provider | undefined,
  failureStage: FailureStage,
  failureReasonCode: string,
  verbose?: boolean,
): EvaluationResult {
  const message = extractErrorMessage(error);

  let agentRequest: JsonObject | undefined;
  let lmRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentRequest = {
      ...(verbose ? { input: promptInputs.question } : {}),
      error: message,
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
        error: message,
      } as JsonObject;
    } else {
      lmRequest = {
        question: promptInputs.question,
        error: message,
      } as JsonObject;
    }
  }

  const requests =
    agentRequest || lmRequest
      ? {
          ...(agentRequest ? { agent: agentRequest } : {}),
          ...(lmRequest ? { lm: lmRequest } : {}),
        }
      : undefined;
  const input = buildResultInput(promptInputs);
  const output = `Error occurred: ${message}`;
  const trace = buildTraceFromMessages({
    input,
    output: [{ role: 'assistant' as const, content: output }],
    finalOutput: output,
    target: targetName,
    testId: evalCase.id,
    conversationId: evalCase.conversation_id,
    error: message,
  });

  return {
    timestamp: timestamp.toISOString(),
    testId: evalCase.id,
    suite: evalCase.suite,
    category: evalCase.category,
    conversationId: evalCase.conversation_id,
    score: 0,
    assertions: [{ text: `Error: ${message}`, passed: false }],
    target: targetName,
    requests,
    input,
    output,
    trace,
    error: message,
    executionStatus: 'execution_error',
    failureStage,
    failureReasonCode,
    executionError: { message, stage: failureStage },
  } satisfies EvaluationResult;
}

function extractProviderError(response: ProviderResponse): string | undefined {
  const raw = response.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const error = (raw as Record<string, unknown>).error;
  if (typeof error !== 'string') {
    return undefined;
  }

  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createCacheKey(
  provider: Provider,
  target: ResolvedTarget,
  evalCase: EvalTest,
  promptInputs: PromptInputs,
): string {
  const hash = createHash('sha256');
  hash.update(provider.id);
  hash.update(target.name);
  hash.update(evalCase.id);
  hash.update(promptInputs.question);
  hash.update(promptInputs.systemMessage ?? '');
  if (promptInputs.chatPrompt) {
    hash.update(JSON.stringify(promptInputs.chatPrompt));
  }
  return hash.digest('hex');
}

function buildResultInput(promptInputs: PromptInputs): EvaluationResult['input'] {
  if (promptInputs.chatPrompt) {
    return promptInputs.chatPrompt.map((message) => ({
      role: message.role,
      ...(message.name ? { name: message.name } : {}),
      content: message.content,
    }));
  }
  return [{ role: 'user' as const, content: promptInputs.question }];
}

/**
 * Sum token usage across all grader results (including nested children).
 * Returns undefined when no evaluator reported token usage.
 */
function aggregateEvaluatorTokenUsage(scores?: readonly GraderResult[]): TokenUsage | undefined {
  if (!scores || scores.length === 0) return undefined;

  let hasAny = false;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cached = 0;
  let hasReasoning = false;
  let hasCached = false;

  const visit = (items: readonly GraderResult[]): void => {
    for (const item of items) {
      if (item.tokenUsage) {
        hasAny = true;
        input += item.tokenUsage.input;
        output += item.tokenUsage.output;
        if (item.tokenUsage.reasoning != null) {
          hasReasoning = true;
          reasoning += item.tokenUsage.reasoning;
        }
        if (item.tokenUsage.cached != null) {
          hasCached = true;
          cached += item.tokenUsage.cached;
        }
      }
      if (item.scores) {
        visit(item.scores);
      }
    }
  };

  visit(scores);
  if (!hasAny) return undefined;

  return {
    input,
    output,
    ...(hasReasoning ? { reasoning } : {}),
    ...(hasCached ? { cached } : {}),
  };
}

/**
 * Extract a human-readable message from an error of any shape.
 *
 * Handles three cases:
 * 1. Standard Error instances → error.message
 * 2. Plain objects with a `message` property (e.g. JSON-RPC error objects
 *    rejected by @agentclientprotocol/sdk) → obj.message
 * 3. Everything else → String(error)
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === 'string' && obj.message) {
      parts.push(obj.message);
    }
    if (typeof obj.code === 'number') {
      parts.push(`(code ${obj.code})`);
    }
    if (parts.length > 0) {
      return parts.join(' ');
    }
    // Fallback: serialize the object so we never return "[object Object]"
    try {
      return JSON.stringify(error);
    } catch {
      // circular reference or other serialization failure
    }
  }
  return String(error);
}

/** Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s, …), capped at 30s. */
function retryBackoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 30_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function mapChildResults(
  children?: readonly ChildGraderResult[],
): readonly GraderResult[] | undefined {
  if (!children || children.length === 0) {
    return undefined;
  }

  return children.map((child) => ({
    name: child.name,
    type: child.type as GraderKind,
    score: child.score,
    weight: child.weight,
    verdict: child.verdict,
    assertions: child.assertions,
    input: child.graderRawRequest,
    scores: mapChildResults(child.scores),
    details: child.details,
    tokenUsage: child.tokenUsage,
  }));
}

/**
 * Compute weighted mean of scores, defaulting missing weights to 1.0.
 * Returns 0 if total weight is 0.
 */
function computeWeightedMean(
  entries: readonly { readonly score: number; readonly weight?: number }[],
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const entry of entries) {
    const weight = entry.weight ?? 1.0;
    totalWeight += weight;
    weightedSum += entry.score * weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
