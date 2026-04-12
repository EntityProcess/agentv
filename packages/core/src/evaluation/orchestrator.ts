import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import pLimit from 'p-limit';

import { getWorkspacePoolRoot } from '../paths.js';
import {
  type ChildEvaluatorResult,
  DEFAULT_THRESHOLD,
  type EvaluationScore,
  type Evaluator,
  LlmGraderEvaluator,
  negateScore,
  scoreToVerdict,
} from './evaluators.js';
import { readJsonFile } from './file-utils.js';
import { createBuiltinProviderRegistry, createProvider } from './providers/index.js';
import { discoverProviders } from './providers/provider-discovery.js';
import {
  type ResolvedTarget,
  resolveDelegatedTargetDefinition,
  resolveTargetDefinition,
} from './providers/targets.js';
import type {
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
  type TokenUsage,
  type TraceSummary,
  computeTraceSummary,
  mergeExecutionMetrics,
} from './trace.js';
import { aggregateTrials } from './trials.js';
import type {
  AssertionEntry,
  EvalTest,
  EvaluationResult,
  EvaluationVerdict,
  EvaluatorConfig,
  EvaluatorKind,
  EvaluatorResult,
  ExecutionStatus,
  FailOnError,
  FailureStage,
  JsonObject,
  JsonValue,
  LlmGraderEvaluatorConfig,
  TrialResult,
  TrialsConfig,
  WorkspaceHookConfig,
  WorkspaceScriptConfig,
} from './types.js';
import {
  captureFileChanges as captureWorkspaceFileChanges,
  initializeBaseline,
} from './workspace/file-changes.js';
import {
  cleanupEvalWorkspaces,
  cleanupWorkspace,
  copyDirectoryRecursive,
  createTempWorkspace,
  getWorkspacePath,
} from './workspace/manager.js';
import { WorkspacePoolManager } from './workspace/pool-manager.js';
import type { PoolSlot } from './workspace/pool-manager.js';
import { RepoManager } from './workspace/repo-manager.js';
import { resolveWorkspaceTemplate } from './workspace/resolve.js';
import {
  type ScriptExecutionContext,
  executeWorkspaceScript,
} from './workspace/script-executor.js';
import { type PromptInputs, buildPromptInputs, loadTests } from './yaml-parser.js';

type MaybePromise<T> = T | Promise<T>;

function classifyQualityStatus(score: number, threshold = DEFAULT_THRESHOLD): ExecutionStatus {
  return score >= threshold ? 'ok' : 'quality_failure';
}

function buildSkippedEvaluatorError(
  scores: readonly EvaluatorResult[] | undefined,
): string | undefined {
  const skippedScores = scores?.filter((score) => score.verdict === 'skip') ?? [];
  if (skippedScores.length === 0) {
    return undefined;
  }

  const messages = skippedScores.map((score) => {
    const label = score.name || score.type;
    const assertionMessage =
      score.assertions.find((assertion) => !assertion.passed)?.text ?? 'Evaluator skipped';
    return `${label}: ${assertionMessage}`;
  });

  return messages.length === 1 ? messages[0] : `Evaluators skipped: ${messages.join(' | ')}`;
}

function usesFileReferencePrompt(provider: Provider): boolean {
  return isAgentProvider(provider) || provider.kind === 'cli';
}

function toScriptConfig(
  hook: WorkspaceHookConfig,
  hookName: string,
  context: string,
): WorkspaceScriptConfig {
  const command = hook.command ?? hook.script;
  if (!command || command.length === 0) {
    throw new Error(`${hookName} hook in ${context} requires command or script`);
  }
  return {
    command,
    ...(hook.timeout_ms !== undefined && { timeout_ms: hook.timeout_ms }),
    ...(hook.timeoutMs !== undefined && { timeoutMs: hook.timeoutMs }),
    ...(hook.cwd !== undefined && { cwd: hook.cwd }),
    ...(hook.script !== undefined && { script: hook.script }),
  };
}

function hasHookCommand(hook: WorkspaceHookConfig | undefined): hook is WorkspaceHookConfig {
  return !!((hook?.command && hook.command.length > 0) || (hook?.script && hook.script.length > 0));
}

/**
 * Check whether hooks are enabled for a workspace config.
 * Returns true when hooks.enabled is undefined (default) or explicitly true.
 */
function hooksEnabled(
  workspace: { readonly hooks?: { readonly enabled?: boolean } } | undefined,
): boolean {
  return workspace?.hooks?.enabled !== false;
}

/**
 * Extract workspaceTemplate from a resolved target's config.
 * Returns undefined if the target doesn't support workspace templates.
 */
function getWorkspaceTemplate(target: ResolvedTarget): string | undefined {
  const config = target.config as Record<string, unknown>;
  if ('workspaceTemplate' in config && typeof config.workspaceTemplate === 'string') {
    return config.workspaceTemplate;
  }
  return undefined;
}

export interface EvaluationCache {
  get(key: string): MaybePromise<ProviderResponse | undefined>;
  set(key: string, value: ProviderResponse): MaybePromise<void>;
}

export interface RunEvalCaseOptions {
  readonly evalCase: EvalTest;
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly 'llm-grader': Evaluator };
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
  /** Evaluator type registry (with custom assertions discovered) */
  readonly typeRegistry?: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  /** RepoManager instance for repo lifecycle (shared workspace mode) */
  readonly repoManager?: RepoManager;
  /** Directory containing the eval YAML file. Used as default cwd for workspace scripts. */
  readonly evalDir?: string;
  /** Include verbose request details in results (e.g. agent input text) */
  readonly verbose?: boolean;
  /** Per-test score threshold for pass/fail (default: 0.8) */
  readonly threshold?: number;
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
}

export interface RunEvaluationOptions {
  readonly testFilePath: string;
  readonly repoRoot: URL | string;
  readonly target: ResolvedTarget;
  readonly targets?: readonly TargetDefinition[];
  readonly env?: EnvLookup;
  readonly providerFactory?: (target: ResolvedTarget) => Provider;
  readonly evaluators?: Partial<Record<string, Evaluator>>;
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
  readonly totalBudgetUsd?: number;
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
    totalBudgetUsd,
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
  } = options;

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
    const resolved = resolveTargetDefinition(definition, envLookup, evalFilePath);
    resolvedTargetsByName.set(name, resolved);
    return resolved;
  };

  const resolveGraderProvider = async (
    targetContext: ResolvedTarget,
  ): Promise<Provider | undefined> => {
    // CLI --grader-target takes highest priority
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

  // Validate grader_target: error if an agent provider would be used as grader.
  // Agent providers can't return structured JSON for grading — they respond with
  // tool calls and markdown, causing silent score-0 failures.
  // CLI --grader-target override also satisfies this requirement.
  if (isAgentProvider(getOrCreateProvider(target)) && !target.graderTarget && !cliGraderTarget) {
    throw new Error(
      `Target "${target.name}" is an agent provider ("${target.kind}") with no grader_target — agent providers cannot return structured JSON for grading. Set grader_target to an LLM provider (e.g., azure-llm).`,
    );
  }

  // Create a target resolver for code graders to support target override
  const targetResolver = (name: string): Provider | undefined => {
    const resolved = resolveTargetByName(name);
    if (!resolved) {
      return undefined;
    }
    return getOrCreateProvider(resolved);
  };

  // Build list of available targets for /info endpoint
  const availableTargets: readonly string[] = [
    target.name,
    ...Array.from(targetDefinitions.keys()),
  ];

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

  // --- Shared workspace lifecycle ---
  // If any test has workspace config, create shared workspace once.
  // Determine workspace config from first test (suite-level config propagates to all).
  const suiteWorkspace = filteredEvalCases[0]?.workspace;
  const rawTemplate = suiteWorkspace?.template ?? getWorkspaceTemplate(target);
  const resolvedTemplate = await resolveWorkspaceTemplate(rawTemplate);
  const workspaceTemplate = resolvedTemplate?.dir;
  let suiteWorkspaceFile = resolvedTemplate?.workspaceFile;
  const setupLog = (message: string): void => {
    if (verbose) {
      console.log(`[setup] ${message}`);
    }
  };

  // Validate local repo source paths upfront before any materialization attempt.
  // Collect repos from all test cases (suite-level + per-case) and check that local paths exist.
  const allRepos = new Map<string, import('./types.js').RepoConfig>();
  for (const ec of filteredEvalCases) {
    if (ec.workspace?.repos) {
      for (const repo of ec.workspace.repos) {
        // Deduplicate by repo path + source path (skip source-less Docker repos)
        if (!repo.source) continue;
        const key = `${repo.path ?? ''}::${repo.source.type === 'local' ? repo.source.path : ''}`;
        if (!allRepos.has(key)) {
          allRepos.set(key, repo);
        }
      }
    }
  }
  if (allRepos.size > 0) {
    const localPathErrors = RepoManager.validateLocalPaths([...allRepos.values()]);
    if (localPathErrors.length > 0) {
      const message = RepoManager.formatValidationErrors(localPathErrors);
      console.warn(`Warning: ${message}`);
      // Store invalid repo paths so affected tests can be failed with execution_error
      const invalidLocalRepoPaths = new Set(localPathErrors.map((e) => e.repoPath));
      // If suite-level repos have invalid paths, fail the entire run early
      if (suiteWorkspace?.repos?.some((r) => r.path && invalidLocalRepoPaths.has(r.path))) {
        throw new Error(message);
      }
    }
  }

  // Resolve worker count and pool mode
  const isPerTestIsolation = suiteWorkspace?.isolation === 'per_test';

  const cliWorkspacePath = workspacePath ?? legacyWorkspacePath;
  const yamlWorkspacePath = suiteWorkspace?.path;
  if (cliWorkspacePath && workspaceMode && workspaceMode !== 'static') {
    throw new Error('--workspace-path requires --workspace-mode static when both are provided');
  }
  const configuredMode = cliWorkspacePath
    ? 'static'
    : (workspaceMode ?? suiteWorkspace?.mode ?? (yamlWorkspacePath ? 'static' : 'pooled'));
  const configuredStaticPath = cliWorkspacePath ?? yamlWorkspacePath;
  const useStaticWorkspace = configuredMode === 'static';

  // static workspace is incompatible with per_test isolation
  if (useStaticWorkspace && isPerTestIsolation) {
    throw new Error(
      'static workspace mode is incompatible with isolation: per_test. Use isolation: shared (default).',
    );
  }
  if (configuredMode === 'static' && !configuredStaticPath) {
    throw new Error('workspace.mode=static requires workspace.path or --workspace-path');
  }
  if (configuredMode !== 'static' && configuredStaticPath) {
    throw new Error('workspace.path requires workspace.mode=static');
  }

  const hasSharedWorkspace = !!(
    useStaticWorkspace ||
    workspaceTemplate ||
    suiteWorkspace?.hooks ||
    (suiteWorkspace?.repos?.length && !isPerTestIsolation)
  );

  // Pool support is mode-based: pooled enables, temp/static disable.
  const poolEnabled = configuredMode === 'pooled';
  const usePool =
    poolEnabled !== false &&
    !!suiteWorkspace?.repos?.length &&
    !isPerTestIsolation &&
    !useStaticWorkspace;

  const resolvedRetainOnSuccess = retainOnSuccess ?? (keepWorkspaces ? 'keep' : 'cleanup');
  const resolvedRetainOnFailure = retainOnFailure ?? (cleanupWorkspaces ? 'cleanup' : 'keep');

  const workers = options.maxConcurrency ?? target.workers ?? 1;
  setupLog(
    `sharedWorkspace=${hasSharedWorkspace} perTestIsolation=${isPerTestIsolation} usePool=${usePool} workers=${workers}`,
  );
  if (hasSharedWorkspace && !usePool && workers > 1 && filteredEvalCases.length > 1) {
    console.warn(
      [
        `Warning: This eval uses a shared workspace with ${workers} workers.`,
        'If the agent under test makes file edits, concurrent runs may corrupt each other.',
        'To limit concurrency, add this to your eval YAML:',
        '',
        '  execution:',
        '    workers: 1',
        '',
        'Or pass --workers 1 on the command line.',
      ].join('\n'),
    );
  }
  const limit = pLimit(workers);
  let sharedWorkspacePath: string | undefined;
  let sharedBaselineCommit: string | undefined;
  let beforeAllOutput: string | undefined;

  let poolManager: WorkspacePoolManager | undefined;
  // Single-slot pool (workers=1 or non-concurrent fallback)
  let poolSlot: PoolSlot | undefined;
  // Multi-slot pool for concurrent workers
  const poolSlots: PoolSlot[] = [];
  const availablePoolSlots: PoolSlot[] = [];
  const poolSlotBaselines = new Map<string, string>();

  // Pool capacity: how many slots can exist on disk (independent of worker count).
  // Workers acquire slots from the pool; the pool itself can be larger than any single run needs.
  const poolMaxSlots = Math.min(configPoolMaxSlots ?? 10, 50);

  // Track whether a static workspace was freshly materialised (needs repo clone + hooks)
  let staticMaterialised = false;
  // YAML-configured static paths support auto-materialisation and per-repo checks.
  // CLI-provided paths (--workspace-path) always reuse the directory as-is.
  const isYamlConfiguredPath = !cliWorkspacePath && !!yamlWorkspacePath;

  // Static workspace: auto-materialise if path is empty or missing, reuse if populated.
  // Auto-materialisation only applies to YAML-configured paths (workspace.path), not CLI flags
  // (--workspace / --workspace-path), which always reuse the directory as-is.
  if (useStaticWorkspace && configuredStaticPath) {
    const dirExists = await stat(configuredStaticPath).then(
      (s) => s.isDirectory(),
      () => false,
    );
    const isEmpty = dirExists ? (await readdir(configuredStaticPath)).length === 0 : false;

    if (isYamlConfiguredPath && (!dirExists || isEmpty)) {
      if (!dirExists) {
        await mkdir(configuredStaticPath, { recursive: true });
      }
      // Copy template contents into the static path
      if (workspaceTemplate) {
        await copyDirectoryRecursive(workspaceTemplate, configuredStaticPath);
        setupLog(`copied template into static workspace: ${configuredStaticPath}`);
      }
      staticMaterialised = true;
      setupLog(`materialised static workspace at: ${configuredStaticPath}`);
    } else {
      setupLog(`reusing existing static workspace: ${configuredStaticPath}`);
    }
    sharedWorkspacePath = configuredStaticPath;
  } else if (usePool && suiteWorkspace?.repos) {
    const slotsNeeded = workers;
    setupLog(`acquiring ${slotsNeeded} workspace pool slot(s) (pool capacity: ${poolMaxSlots})`);
    poolManager = new WorkspacePoolManager(getWorkspacePoolRoot());
    const poolRepoManager = new RepoManager(verbose);

    for (let i = 0; i < slotsNeeded; i++) {
      const slot = await poolManager.acquireWorkspace({
        templatePath: workspaceTemplate,
        repos: suiteWorkspace.repos,
        maxSlots: poolMaxSlots,
        repoManager: poolRepoManager,
        poolReset:
          (workspaceClean === 'full' ? 'strict' : workspaceClean === 'standard' ? 'fast' : null) ??
          'fast',
      });
      poolSlots.push(slot);
      setupLog(`pool slot ${i} acquired at: ${slot.path} (existing=${slot.isExisting})`);
    }

    if (slotsNeeded === 1) {
      // Single-slot: use shared workspace path (existing behavior)
      poolSlot = poolSlots[0];
      sharedWorkspacePath = poolSlot.path;
    } else {
      // Multi-slot: tests will grab slots dynamically
      availablePoolSlots.push(...poolSlots);
    }
  } else if (workspaceTemplate) {
    setupLog(`creating shared workspace from template: ${workspaceTemplate}`);
    try {
      sharedWorkspacePath = await createTempWorkspace(workspaceTemplate, evalRunId, 'shared');
      setupLog(`shared workspace created at: ${sharedWorkspacePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create shared workspace: ${message}`);
    }
  } else if (suiteWorkspace?.hooks || (suiteWorkspace?.repos?.length && !isPerTestIsolation)) {
    // No template but hooks or repos are configured: create empty workspace
    sharedWorkspacePath = getWorkspacePath(evalRunId, 'shared');
    await mkdir(sharedWorkspacePath, { recursive: true });
    setupLog(`created empty shared workspace at: ${sharedWorkspacePath}`);
  }

  // Wrap remaining logic in try/finally to ensure pool slot is always released on error
  try {
    // Re-resolve workspaceFile from the pool/temp workspace so relative paths in
    // .code-workspace resolve against where repos are cloned, not the original template.
    if (suiteWorkspaceFile && sharedWorkspacePath) {
      const copiedWorkspaceFile = path.join(sharedWorkspacePath, path.basename(suiteWorkspaceFile));
      try {
        await stat(copiedWorkspaceFile);
        suiteWorkspaceFile = copiedWorkspaceFile;
      } catch {
        // Keep original if copy doesn't exist
      }
    }

    // Materialize repos into shared workspace (skip for per_test and pool modes).
    // For static workspaces: materialize only repos whose target path is missing (per-repo reuse).
    // For non-static workspaces: materialize all repos when freshly created.
    const hasReposToMaterialize =
      !!suiteWorkspace?.repos?.length && !usePool && !isPerTestIsolation;
    const needsRepoMaterialisation =
      hasReposToMaterialize && (!useStaticWorkspace || staticMaterialised);
    const needsPerRepoCheck =
      hasReposToMaterialize && useStaticWorkspace && !staticMaterialised && isYamlConfiguredPath;
    const repoManager =
      needsRepoMaterialisation || needsPerRepoCheck ? new RepoManager(verbose) : undefined;

    if (repoManager && sharedWorkspacePath && suiteWorkspace?.repos) {
      try {
        if (needsPerRepoCheck) {
          // Static workspace with existing content: materialize only missing repos
          for (const repo of suiteWorkspace.repos) {
            if (!repo.path || !repo.source) continue;
            const targetDir = path.join(sharedWorkspacePath, repo.path);
            if (existsSync(targetDir)) {
              setupLog(`reusing existing repo at: ${targetDir}`);
              continue;
            }
            setupLog(`materializing missing repo: ${repo.path}`);
            await repoManager.materialize(repo, sharedWorkspacePath);
          }
        } else {
          setupLog(
            `materializing ${suiteWorkspace.repos.length} shared repo(s) into ${sharedWorkspacePath}`,
          );
          await repoManager.materializeAll(suiteWorkspace.repos, sharedWorkspacePath);
        }
        setupLog('shared repo materialization complete');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (sharedWorkspacePath && !useStaticWorkspace) {
          await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
        }
        throw new Error(`Failed to materialize repos: ${message}`);
      }
    }

    // --- Docker workspace: pull image once at setup ---
    const suiteDockerConfig = suiteWorkspace?.docker;
    if (suiteDockerConfig) {
      setupLog(`pulling Docker image: ${suiteDockerConfig.image}`);
      const { DockerWorkspaceProvider } = await import('./workspace/docker-workspace.js');
      const dockerSetup = new DockerWorkspaceProvider(suiteDockerConfig);
      if (!(await dockerSetup.isDockerAvailable())) {
        throw new Error(
          'Docker workspace configured but Docker CLI is not available. Install Docker and ensure it is running.',
        );
      }
      await dockerSetup.pullImage();
      setupLog('Docker image pull complete');
    }

    // Execute before_all (runs ONCE before first test per workspace)
    const suiteHooksEnabled = hooksEnabled(suiteWorkspace);
    const suiteBeforeAllHook = suiteWorkspace?.hooks?.before_all;
    if (sharedWorkspacePath && suiteHooksEnabled && hasHookCommand(suiteBeforeAllHook)) {
      const beforeAllHook = suiteBeforeAllHook;
      const beforeAllCommand = (beforeAllHook.command ?? beforeAllHook.script ?? []).join(' ');
      setupLog(
        `running shared before_all in cwd=${beforeAllHook.cwd ?? evalDir} command=${beforeAllCommand}`,
      );
      const scriptContext: ScriptExecutionContext = {
        workspacePath: sharedWorkspacePath,
        testId: '__before_all__',
        evalRunId,
        evalDir,
      };
      try {
        beforeAllOutput = await executeWorkspaceScript(
          toScriptConfig(beforeAllHook, 'before_all', 'suite workspace'),
          scriptContext,
        );
        setupLog('shared before_all completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (sharedWorkspacePath && !useStaticWorkspace) {
          await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
        }
        throw new Error(`before_all script failed: ${message}`);
      }
    }

    // Multi-slot pool: run before_all on each slot and initialize baselines
    if (availablePoolSlots.length > 0 && suiteHooksEnabled && hasHookCommand(suiteBeforeAllHook)) {
      const beforeAllHook = suiteBeforeAllHook;
      for (const slot of availablePoolSlots) {
        setupLog(`running before_all on pool slot ${slot.index}`);
        const scriptContext: ScriptExecutionContext = {
          workspacePath: slot.path,
          testId: '__before_all__',
          evalRunId,
          evalDir,
        };
        try {
          const output = await executeWorkspaceScript(
            toScriptConfig(beforeAllHook, 'before_all', 'suite workspace'),
            scriptContext,
          );
          // Capture first slot's output for result attachment
          if (!beforeAllOutput) beforeAllOutput = output;
          setupLog(`before_all completed on pool slot ${slot.index}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`before_all script failed on pool slot ${slot.index}: ${message}`);
        }
      }
    }

    // Initialize git baseline for shared workspace
    if (sharedWorkspacePath) {
      try {
        sharedBaselineCommit = await initializeBaseline(sharedWorkspacePath);
        setupLog(`shared baseline initialized: ${sharedBaselineCommit}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setupLog(`shared baseline initialization failed (file_changes unavailable): ${message}`);
      }
    }

    // Multi-slot pool: initialize git baselines per slot
    if (availablePoolSlots.length > 0) {
      for (const slot of availablePoolSlots) {
        try {
          const baseline = await initializeBaseline(slot.path);
          poolSlotBaselines.set(slot.path, baseline);
          setupLog(`pool slot ${slot.index} baseline initialized: ${baseline}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setupLog(
            `pool slot ${slot.index} baseline initialization failed (file_changes unavailable): ${message}`,
          );
        }
      }
    }

    // Track worker assignments for progress reporting
    let nextWorkerId = 1;
    const workerIdByEvalId = new Map<string, number>();
    let beforeAllOutputAttached = false;

    // Suite-level budget tracking
    let cumulativeBudgetCost = 0;
    let budgetExhausted = false;

    // fail_on_error tracking (best-effort under concurrency > 1, matching budgetExhausted semantics)
    let failOnErrorTriggered = false;

    // Map test cases to limited promises for parallel execution
    const promises = filteredEvalCases.map((evalCase) =>
      limit(async () => {
        // Assign worker ID when test starts executing
        const workerId = nextWorkerId++;
        workerIdByEvalId.set(evalCase.id, workerId);

        // Check suite-level budget before dispatching
        if (totalBudgetUsd !== undefined && budgetExhausted) {
          const budgetResult: EvaluationResult = {
            timestamp: (now ?? (() => new Date()))().toISOString(),
            testId: evalCase.id,
            suite: evalCase.suite,
            category: evalCase.category,
            score: 0,
            assertions: [],
            output: [],
            target: target.name,
            error: `Suite budget exceeded ($${cumulativeBudgetCost.toFixed(4)} / $${totalBudgetUsd.toFixed(4)})`,
            budgetExceeded: true,
            executionStatus: 'execution_error',
            failureStage: 'setup',
            failureReasonCode: 'budget_exceeded',
            executionError: {
              message: `Suite budget exceeded ($${cumulativeBudgetCost.toFixed(4)} / $${totalBudgetUsd.toFixed(4)})`,
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
            output: [],
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

        // Multi-slot pool: each test grabs its own pool slot
        const testPoolSlot = availablePoolSlots.length > 0 ? availablePoolSlots.pop() : undefined;
        const testWorkspacePath = testPoolSlot?.path ?? sharedWorkspacePath;
        const testBaselineCommit = testPoolSlot
          ? poolSlotBaselines.get(testPoolSlot.path)
          : sharedBaselineCommit;

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
          };
          let result =
            trials && trials.count > 1
              ? await runEvalCaseWithTrials(runCaseOptions, trials)
              : await runEvalCase(runCaseOptions);

          // Track suite-level budget
          if (totalBudgetUsd !== undefined) {
            // Sum all trial costs when trials are used, otherwise use trace cost
            let caseCost: number | undefined;
            if (result.trials && result.trials.length > 0) {
              const trialCostSum = result.trials.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
              if (trialCostSum > 0) {
                caseCost = trialCostSum;
              }
            } else {
              caseCost = result.costUsd;
            }
            if (caseCost !== undefined) {
              cumulativeBudgetCost += caseCost;
              if (cumulativeBudgetCost >= totalBudgetUsd) {
                budgetExhausted = true;
              }
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
      }),
    );

    // Wait for all workers to complete
    const settled = await Promise.allSettled(promises);

    // Extract results, handling both fulfilled and rejected promises
    const results: EvaluationResult[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        // Build error result for rejected promise
        const evalCase = filteredEvalCases[i];
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
        results.push(errorResult);
        if (onResult) {
          await onResult(errorResult);
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

    const suiteAfterAllHook = suiteWorkspace?.hooks?.after_all;
    if (afterAllWorkspaces.length > 0 && suiteHooksEnabled && hasHookCommand(suiteAfterAllHook)) {
      const afterAllHook = suiteAfterAllHook;
      for (const wsPath of afterAllWorkspaces) {
        const scriptContext: ScriptExecutionContext = {
          workspacePath: wsPath,
          testId: '__after_all__',
          evalRunId,
          evalDir,
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
    // Release all workspace pool slots (keep workspaces for future reuse)
    if (poolManager) {
      if (poolSlot) {
        await poolManager.releaseSlot(poolSlot);
      }
      for (const slot of poolSlots) {
        if (slot !== poolSlot) {
          await poolManager.releaseSlot(slot).catch(() => {});
        }
      }
    }
  }
}

async function runBatchEvaluation(options: {
  readonly evalCases: readonly EvalTest[];
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly 'llm-grader': Evaluator;
  };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly nowFn: () => Date;
  readonly onProgress?: (event: ProgressEvent) => MaybePromise<void>;
  readonly onResult?: (result: EvaluationResult) => MaybePromise<void>;
  readonly verbose?: boolean;
  readonly resolveGraderProvider: (target: ResolvedTarget) => Promise<Provider | undefined>;
  readonly agentTimeoutMs?: number;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly threshold?: number;
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
        targetResolver,
        availableTargets,
        verbose,
        threshold: evalCase.threshold ?? batchThreshold,
      });

      if (providerError) {
        result = {
          ...result,
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
      });
    }
  }

  return results;
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

  // Use shared workspace if provided, otherwise create per-case workspace
  let workspacePath: string | undefined = sharedWorkspacePath;
  let beforeAllOutput: string | undefined;
  let beforeEachOutput: string | undefined;
  let afterEachOutput: string | undefined;
  const isSharedWorkspace = !!sharedWorkspacePath;

  let caseWorkspaceFile: string | undefined;
  const caseHooksEnabled = hooksEnabled(evalCase.workspace);

  if (!workspacePath) {
    // Per-case workspace creation (backwards compat for tests without shared workspace)
    const rawCaseTemplate = evalCase.workspace?.template ?? getWorkspaceTemplate(target);
    const resolvedCaseTemplate = await resolveWorkspaceTemplate(rawCaseTemplate);
    const caseWorkspaceTemplate = resolvedCaseTemplate?.dir;
    caseWorkspaceFile = resolvedCaseTemplate?.workspaceFile;
    if (caseWorkspaceTemplate && evalRunId) {
      try {
        workspacePath = await createTempWorkspace(caseWorkspaceTemplate, evalRunId, evalCase.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResult(
          evalCase,
          target.name,
          nowFn(),
          new Error(`Failed to create workspace: ${message}`),
          promptInputs,
          provider,
          'setup',
          'template_error',
          verbose,
        );
      }

      // Re-resolve workspaceFile from the temp workspace
      if (caseWorkspaceFile && workspacePath) {
        const copiedFile = path.join(workspacePath, path.basename(caseWorkspaceFile));
        try {
          await stat(copiedFile);
          caseWorkspaceFile = copiedFile;
        } catch {
          // Keep original if copy doesn't exist
        }
      }
    }

    // If no template but hooks or repos are configured per-case, create empty workspace
    if (
      !workspacePath &&
      (evalCase.workspace?.hooks || evalCase.workspace?.repos?.length) &&
      evalRunId
    ) {
      workspacePath = getWorkspacePath(evalRunId, evalCase.id);
      await mkdir(workspacePath, { recursive: true });
    }

    // Validate local repo paths before per-case materialization
    if (evalCase.workspace?.repos?.length && workspacePath) {
      const localPathErrors = RepoManager.validateLocalPaths(evalCase.workspace.repos);
      if (localPathErrors.length > 0) {
        const message = RepoManager.formatValidationErrors(localPathErrors);
        console.warn(`Warning: test=${evalCase.id} ${message}`);
        return buildErrorResult(
          evalCase,
          target.name,
          nowFn(),
          new Error(message),
          promptInputs,
          provider,
          'repo_setup',
          'local_path_not_found',
          verbose,
        );
      }
    }

    // Materialize repos into per-case workspace
    if (evalCase.workspace?.repos?.length && workspacePath) {
      const perCaseRepoManager = new RepoManager(setupDebug);
      try {
        if (setupDebug) {
          console.log(
            `[setup] test=${evalCase.id} materializing ${evalCase.workspace.repos.length} per-test repo(s) into ${workspacePath}`,
          );
        }
        await perCaseRepoManager.materializeAll(evalCase.workspace.repos, workspacePath);
        if (setupDebug) {
          console.log(`[setup] test=${evalCase.id} per-test repo materialization complete`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResult(
          evalCase,
          target.name,
          nowFn(),
          new Error(`Failed to materialize repos: ${message}`),
          promptInputs,
          provider,
          'repo_setup',
          'clone_error',
          verbose,
        );
      }
    }

    // Copy Agent Skills files into workspace
    if (workspacePath && evalCase.metadata?.agent_skills_files) {
      const baseDir = evalCase.metadata.agent_skills_base_dir as string | undefined;
      const files = evalCase.metadata.agent_skills_files as readonly string[];
      if (baseDir && files.length > 0) {
        for (const relPath of files) {
          const srcPath = path.resolve(baseDir, relPath);
          const destPath = path.resolve(workspacePath, relPath);
          try {
            await mkdir(path.dirname(destPath), { recursive: true });
            await copyFile(srcPath, destPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return buildErrorResult(
              evalCase,
              target.name,
              nowFn(),
              new Error(
                `Agent Skills eval file not found: ${relPath} (resolved from ${baseDir}): ${message}`,
              ),
              promptInputs,
              provider,
              'setup',
              'file_copy_error',
              verbose,
            );
          }
        }
      }
    }

    // Execute per-case before_all (only when not using shared workspace)
    const caseBeforeAllHook = evalCase.workspace?.hooks?.before_all;
    if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeAllHook)) {
      const beforeAllHook = caseBeforeAllHook;
      const beforeAllCommand = (beforeAllHook.command ?? beforeAllHook.script ?? []).join(' ');
      if (setupDebug) {
        console.log(
          `[setup] test=${evalCase.id} running before_all in cwd=${beforeAllHook.cwd ?? evalDir} command=${beforeAllCommand}`,
        );
      }
      const scriptContext: ScriptExecutionContext = {
        workspacePath,
        testId: evalCase.id,
        evalRunId: evalRunId ?? '',
        caseInput: evalCase.question,
        caseMetadata: evalCase.metadata,
        evalDir,
      };
      try {
        beforeAllOutput = await executeWorkspaceScript(
          toScriptConfig(beforeAllHook, 'before_all', `test '${evalCase.id}'`),
          scriptContext,
        );
        if (setupDebug) {
          console.log(`[setup] test=${evalCase.id} before_all completed`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (forceCleanup && workspacePath) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        return buildErrorResult(
          evalCase,
          target.name,
          nowFn(),
          new Error(`before_all script failed: ${message}`),
          promptInputs,
          provider,
          'setup',
          'script_error',
          verbose,
        );
      }
    }
  }

  // Execute before_each hook (runs before each test for any workspace)
  const caseBeforeEachHook = evalCase.workspace?.hooks?.before_each;
  if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeEachHook)) {
    const beforeEachHook = caseBeforeEachHook;
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
      evalDir,
    };
    try {
      beforeEachOutput = await executeWorkspaceScript(
        toScriptConfig(beforeEachHook, 'before_each', `test '${evalCase.id}'`),
        scriptContext,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildErrorResult(
        evalCase,
        target.name,
        nowFn(),
        new Error(`before_each script failed: ${message}`),
        promptInputs,
        provider,
        'setup',
        'script_error',
        verbose,
      );
    }
  }

  // Initialize git baseline for file-change tracking.
  // Runs git init + baseline commit before the agent, then diffs after.
  // Supports nested repos via --submodule=diff.
  let baselineCommit: string | undefined = sharedBaselineCommit;
  if (!baselineCommit && workspacePath) {
    try {
      baselineCommit = await initializeBaseline(workspacePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.warn(`[setup] test=${evalCase.id} baseline initialization failed: ${message}`);
      }
    }
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

  const providerError = extractProviderError(providerResponse);

  // Reset repos before after_each hook (if configured)
  if (
    caseHooksEnabled &&
    repoManager &&
    workspacePath &&
    evalCase.workspace?.hooks?.after_each?.reset &&
    evalCase.workspace.hooks.after_each.reset !== 'none' &&
    evalCase.workspace.repos
  ) {
    try {
      await repoManager.reset(
        evalCase.workspace.repos,
        workspacePath,
        evalCase.workspace.hooks.after_each.reset,
      );
    } catch {
      // Reset failures are non-fatal (like after_each)
    }
  }

  // Execute after_each hook (runs after evaluation, before cleanup)
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
      targetResolver,
      availableTargets,
      fileChanges,
      workspacePath,
      dockerConfig: evalCase.workspace?.docker,
      verbose,
      threshold: evalCase.threshold ?? caseThreshold,
    });

    const effectiveThreshold = evalCase.threshold ?? caseThreshold;
    const totalDurationMs = Date.now() - caseStartMs;

    // Aggregate grader token usage from individual evaluator results
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
      }
    }

    return finalResult;
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
    if (trialsConfig.strategy === 'pass_at_k' && trialVerdict === 'pass') {
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
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly 'llm-grader': Evaluator };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
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
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly verbose?: boolean;
  readonly threshold?: number;
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
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
    dockerConfig,
    threshold: evalThreshold,
  } = options;

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
    trace,
    costUsd,
    durationMs,
    tokenUsage,
    startTime,
    endTime,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
    dockerConfig,
    threshold: evalThreshold,
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

  const evaluatorRequest = scores ? undefined : score.evaluatorRawRequest;
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
  const input = buildResultInput(promptInputs);

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
    output: output ?? [{ role: 'assistant' as const, content: candidate }],
    scores: scores,
    trace: trace,
    fileChanges,
    executionStatus: classifyQualityStatus(score.score, evalThreshold),
  };
}

async function runEvaluatorsForCase(options: {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly 'llm-grader': Evaluator };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly graderProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly threshold?: number;
}): Promise<{ score: EvaluationScore; scores?: EvaluatorResult[] }> {
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
    workspacePath,
    dockerConfig,
    threshold,
  } = options;

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
      workspacePath,
      dockerConfig,
      threshold,
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
    workspacePath,
    dockerConfig,
    ...(implicitEvaluator ? { evaluator: implicitEvaluator } : {}),
  });

  return { score };
}

function buildImplicitLlmGraderConfig(evalCase: EvalTest): LlmGraderEvaluatorConfig | undefined {
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
  readonly evaluators: readonly EvaluatorConfig[];
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly 'llm-grader': Evaluator;
  };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly graderProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
  readonly dockerConfig?: import('./types.js').DockerWorkspaceConfig;
  readonly threshold?: number;
}): Promise<{ score: EvaluationScore; scores: EvaluatorResult[] }> {
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
    workspacePath,
    dockerConfig,
  } = options;

  const scored: Array<{
    readonly score: EvaluationScore;
    readonly name: string;
    readonly type: string;
    readonly weight?: number;
    readonly required?: boolean | number;
    readonly min_score?: number;
  }> = [];
  const scores: EvaluatorResult[] = [];

  // Build the evaluation context (shared across all evaluators for this case)
  const evalContext: import('./evaluators/types.js').EvaluationContext = {
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
    workspacePath,
    dockerConfig,
  };

  // Build the dispatch context for evaluator factories
  const evalFileDir = evalCase.file_paths[0] ? path.dirname(evalCase.file_paths[0]) : process.cwd();
  const dispatchContext: import('./registry/evaluator-registry.js').EvaluatorDispatchContext = {
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
        input: score.evaluatorRawRequest,
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
          { text: `Evaluator '${evaluatorConfig.name}' failed: ${message}`, passed: false },
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
            text: `Evaluator '${evaluatorConfig.name ?? 'unknown'}' failed: ${message}`,
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
  overrides: Partial<Record<string, Evaluator>> | undefined,
  resolveGraderProvider: (target: ResolvedTarget) => Promise<Provider | undefined>,
): Partial<Record<string, Evaluator>> & { readonly 'llm-grader': Evaluator } {
  const llmGrader =
    overrides?.['llm-grader'] ??
    new LlmGraderEvaluator({
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

async function invokeProvider(
  provider: Provider,
  options: {
    readonly evalCase: EvalTest;
    readonly target: ResolvedTarget;
    readonly promptInputs: PromptInputs;
    readonly attempt: number;
    readonly agentTimeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Working directory override (e.g., from workspace_template) */
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
    output: [{ role: 'assistant' as const, content: `Error occurred: ${message}` }],
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
 * Sum token usage across all evaluator results (including nested children).
 * Returns undefined when no evaluator reported token usage.
 */
function aggregateEvaluatorTokenUsage(scores?: readonly EvaluatorResult[]): TokenUsage | undefined {
  if (!scores || scores.length === 0) return undefined;

  let hasAny = false;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cached = 0;
  let hasReasoning = false;
  let hasCached = false;

  const visit = (items: readonly EvaluatorResult[]): void => {
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
  children?: readonly ChildEvaluatorResult[],
): readonly EvaluatorResult[] | undefined {
  if (!children || children.length === 0) {
    return undefined;
  }

  return children.map((child) => ({
    name: child.name,
    type: child.type as EvaluatorKind,
    score: child.score,
    weight: child.weight,
    verdict: child.verdict,
    assertions: child.assertions,
    input: child.evaluatorRawRequest,
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
