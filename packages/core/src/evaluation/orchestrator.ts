import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import pLimit from 'p-limit';

import {
  type ChildEvaluatorResult,
  type EvaluationScore,
  type Evaluator,
  LlmJudgeEvaluator,
  isNonEmptyString,
  negateScore,
  scoreToVerdict,
} from './evaluators.js';
import { readJsonFile } from './file-utils.js';
import { createProvider } from './providers/index.js';
import { type ResolvedTarget, resolveTargetDefinition } from './providers/targets.js';
import type {
  EnvLookup,
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamCallbacks,
  TargetDefinition,
} from './providers/types.js';
import { extractLastAssistantContent, isAgentProvider } from './providers/types.js';
import { createBuiltinRegistry } from './registry/index.js';
import { type TraceSummary, computeTraceSummary, mergeExecutionMetrics } from './trace.js';
import { aggregateTrials } from './trials.js';
import type {
  EvalTest,
  EvaluationResult,
  EvaluationVerdict,
  EvaluatorConfig,
  EvaluatorKind,
  EvaluatorResult,
  JsonObject,
  JsonValue,
  TrialResult,
  TrialsConfig,
} from './types.js';
import {
  captureFileChanges as captureWorkspaceFileChanges,
  initializeBaseline,
} from './workspace/file-changes.js';
import {
  cleanupEvalWorkspaces,
  cleanupWorkspace,
  createTempWorkspace,
  getWorkspacePath,
} from './workspace/manager.js';
import { resolveWorkspaceTemplate } from './workspace/resolve.js';
import {
  type ScriptExecutionContext,
  executeWorkspaceScript,
} from './workspace/script-executor.js';
import { type PromptInputs, buildPromptInputs, loadTests } from './yaml-parser.js';

type MaybePromise<T> = T | Promise<T>;

function usesFileReferencePrompt(provider: Provider): boolean {
  return isAgentProvider(provider) || provider.kind === 'cli';
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
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator };
  readonly now?: () => Date;
  readonly maxRetries?: number;
  readonly agentTimeoutMs?: number;
  readonly cache?: EvaluationCache;
  readonly useCache?: boolean;
  readonly signal?: AbortSignal;
  readonly judgeProvider?: Provider;
  /** Resolver for target override in code judges */
  readonly targetResolver?: (name: string) => Provider | undefined;
  /** List of available target names for code judges */
  readonly availableTargets?: readonly string[];
  /** Unique identifier for the evaluation run (used for workspace management) */
  readonly evalRunId?: string;
  /** Keep workspace on success (default: cleanup on success, keep on failure) */
  readonly keepWorkspaces?: boolean;
  /** Force cleanup of workspaces even on failure */
  readonly cleanupWorkspaces?: boolean;
  /** Pre-created shared workspace path (shared across tests in a suite) */
  readonly sharedWorkspacePath?: string;
  /** Pre-initialized baseline commit for shared workspace */
  readonly sharedBaselineCommit?: string;
  /** Suite-level .code-workspace file (resolved from workspace.template) */
  readonly suiteWorkspaceFile?: string;
  /** Real-time observability callbacks passed to the provider */
  readonly streamCallbacks?: ProviderStreamCallbacks;
}

export interface ProgressEvent {
  readonly workerId: number;
  readonly testId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed';
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
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
  /** Filter tests by ID pattern (glob supported, e.g., "summary-*") */
  readonly filter?: string;
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
      throw new Error(`No tests matched filter '${filter}' in ${evalFilePath}`);
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
    const definition = targetDefinitions.get(name);
    if (!definition) {
      return undefined;
    }
    const resolved = resolveTargetDefinition(definition, envLookup, evalFilePath);
    resolvedTargetsByName.set(name, resolved);
    return resolved;
  };

  const resolveJudgeProvider = async (
    targetContext: ResolvedTarget,
  ): Promise<Provider | undefined> => {
    const judgeName = targetContext.judgeTarget ?? targetContext.name;
    const resolvedJudge = resolveTargetByName(judgeName);
    if (!resolvedJudge) {
      return getOrCreateProvider(targetContext);
    }
    return getOrCreateProvider(resolvedJudge);
  };

  // Create a target resolver for code judges to support target override
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

  const evaluatorRegistry = buildEvaluatorRegistry(evaluators, resolveJudgeProvider);
  const typeRegistry = createBuiltinRegistry();

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
        resolveJudgeProvider,
        agentTimeoutMs,
        targetResolver,
        availableTargets,
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
  const suiteWorkspaceFile = resolvedTemplate?.workspaceFile;

  // Resolve worker count: CLI option > target setting > default (1)
  // Force workers=1 when shared workspace is used to prevent data corruption
  const hasSharedWorkspace = !!(workspaceTemplate || suiteWorkspace?.before_all);
  const requestedWorkers = options.maxConcurrency ?? target.workers ?? 1;
  const workers = hasSharedWorkspace ? 1 : requestedWorkers;
  if (hasSharedWorkspace && requestedWorkers > 1) {
    console.warn(
      `Warning: Shared workspace requires sequential execution. Overriding workers from ${requestedWorkers} to 1.`,
    );
  }
  const limit = pLimit(workers);
  let sharedWorkspacePath: string | undefined;
  let sharedBaselineCommit: string | undefined;
  let beforeAllOutput: string | undefined;

  if (workspaceTemplate) {
    try {
      sharedWorkspacePath = await createTempWorkspace(workspaceTemplate, evalRunId, 'shared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create shared workspace: ${message}`);
    }
  } else if (suiteWorkspace?.before_all) {
    // No template but before_all is configured: create empty workspace
    sharedWorkspacePath = getWorkspacePath(evalRunId, 'shared');
    await mkdir(sharedWorkspacePath, { recursive: true });
  }

  // Execute before_all (runs ONCE before first test)
  if (sharedWorkspacePath && suiteWorkspace?.before_all) {
    const scriptContext: ScriptExecutionContext = {
      workspacePath: sharedWorkspacePath,
      testId: '__before_all__',
      evalRunId,
    };
    try {
      beforeAllOutput = await executeWorkspaceScript(suiteWorkspace.before_all, scriptContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sharedWorkspacePath) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new Error(`before_all script failed: ${message}`);
    }
  }

  // Initialize git baseline for shared workspace
  if (sharedWorkspacePath) {
    try {
      sharedBaselineCommit = await initializeBaseline(sharedWorkspacePath);
    } catch {
      // Non-fatal: file change tracking is best-effort
    }
  }

  // Track worker assignments for progress reporting
  let nextWorkerId = 1;
  const workerIdByEvalId = new Map<string, number>();
  let beforeAllOutputAttached = false;

  // Map test cases to limited promises for parallel execution
  const promises = filteredEvalCases.map((evalCase) =>
    limit(async () => {
      // Assign worker ID when test starts executing
      const workerId = nextWorkerId++;
      workerIdByEvalId.set(evalCase.id, workerId);

      if (onProgress) {
        await onProgress({
          workerId,
          testId: evalCase.id,
          status: 'running',
          startedAt: Date.now(),
        });
      }

      try {
        const judgeProvider = await resolveJudgeProvider(target);
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
          judgeProvider,
          targetResolver,
          availableTargets,
          evalRunId,
          keepWorkspaces,
          cleanupWorkspaces,
          sharedWorkspacePath,
          sharedBaselineCommit,
          suiteWorkspaceFile,
          streamCallbacks,
        };
        let result =
          trials && trials.count > 1
            ? await runEvalCaseWithTrials(runCaseOptions, trials)
            : await runEvalCase(runCaseOptions);

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
      );
      results.push(errorResult);
      if (onResult) {
        await onResult(errorResult);
      }
    }
  }

  // --- Shared workspace after_all + cleanup ---
  if (sharedWorkspacePath && suiteWorkspace?.after_all) {
    const scriptContext: ScriptExecutionContext = {
      workspacePath: sharedWorkspacePath,
      testId: '__after_all__',
      evalRunId,
    };
    try {
      const afterAllOutput = await executeWorkspaceScript(
        suiteWorkspace.after_all,
        scriptContext,
        'warn',
      );
      // Attach afterAllOutput to last result
      if (afterAllOutput && results.length > 0) {
        results[results.length - 1] = { ...results[results.length - 1], afterAllOutput };
      }
    } catch {
      // after_all failures are non-fatal
    }
  }

  // Cleanup shared workspace
  if (sharedWorkspacePath) {
    const hasFailure = results.some((r) => !!r.error || r.score < 0.5);
    if (cleanupWorkspaces) {
      await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
    } else if (!hasFailure && !keepWorkspaces) {
      await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
    }
    // If failure and not forceCleanup: keep for debugging
  }

  // Fallback cleanup for any per-case workspaces
  if (cleanupWorkspaces) {
    await cleanupEvalWorkspaces(evalRunId).catch(() => {});
  }

  return results;
}

async function runBatchEvaluation(options: {
  readonly evalCases: readonly EvalTest[];
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly llm_judge: Evaluator;
  };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly nowFn: () => Date;
  readonly onProgress?: (event: ProgressEvent) => MaybePromise<void>;
  readonly onResult?: (result: EvaluationResult) => MaybePromise<void>;
  readonly verbose?: boolean;
  readonly resolveJudgeProvider: (target: ResolvedTarget) => Promise<Provider | undefined>;
  readonly agentTimeoutMs?: number;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
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
    resolveJudgeProvider,
    agentTimeoutMs,
    targetResolver,
    availableTargets,
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
      guidelines: promptInputs.guidelines,
      guideline_patterns: evalCase.guideline_patterns,
      inputFiles: evalCase.file_paths,
      evalCaseId: evalCase.id,
      metadata: {
        systemPrompt: promptInputs.systemMessage ?? '',
      },
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

    const baseSummary = output
      ? computeTraceSummary(output)
      : hasExecutionMetrics
        ? {
            eventCount: 0,
            toolNames: [],
            toolCallsByName: {},
            errorCount: 0,
          }
        : undefined;
    // Merge execution metrics from provider response
    const trace = baseSummary
      ? mergeExecutionMetrics(baseSummary, {
          tokenUsage: providerResponse.tokenUsage,
          costUsd: providerResponse.costUsd,
          durationMs: providerResponse.durationMs,
        })
      : undefined;

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
        judgeProvider: await resolveJudgeProvider(target),
        agentTimeoutMs,
        output,
        trace,
        targetResolver,
        availableTargets,
      });

      if (providerError) {
        result = { ...result, error: providerError };
      }
    } catch (error) {
      const errorResult = buildErrorResult(
        evalCase,
        target.name,
        nowFn(),
        error,
        promptInputs,
        provider,
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
    judgeProvider,
    targetResolver,
    availableTargets,
    evalRunId,
    keepWorkspaces,
    cleanupWorkspaces: forceCleanup,
    sharedWorkspacePath,
    sharedBaselineCommit,
    suiteWorkspaceFile,
  } = options;

  const formattingMode = usesFileReferencePrompt(provider) ? 'agent' : 'lm';
  const promptInputs = await buildPromptInputs(evalCase, formattingMode);
  const typeRegistry = createBuiltinRegistry();

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
        );
      }
    }

    // If no template but before_all is configured per-case, create empty workspace
    if (!workspacePath && evalCase.workspace?.before_all && evalRunId) {
      workspacePath = getWorkspacePath(evalRunId, evalCase.id);
      await mkdir(workspacePath, { recursive: true });
    }

    // Execute per-case before_all (only when not using shared workspace)
    if (workspacePath && evalCase.workspace?.before_all) {
      const scriptContext: ScriptExecutionContext = {
        workspacePath,
        testId: evalCase.id,
        evalRunId: evalRunId ?? '',
        caseInput: evalCase.question,
        caseMetadata: evalCase.metadata,
      };
      try {
        beforeAllOutput = await executeWorkspaceScript(
          evalCase.workspace.before_all,
          scriptContext,
        );
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
        );
      }
    }
  }

  // Execute before_each hook (runs before each test for any workspace)
  if (workspacePath && evalCase.workspace?.before_each) {
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
    };
    try {
      beforeEachOutput = await executeWorkspaceScript(
        evalCase.workspace.before_each,
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
      );
    }
  }

  // Initialize git baseline (use shared baseline or per-case)
  let baselineCommit: string | undefined = sharedBaselineCommit;
  if (!baselineCommit && workspacePath) {
    try {
      baselineCommit = await initializeBaseline(workspacePath);
    } catch {
      // Non-fatal: file change tracking is best-effort
    }
  }

  const attemptBudget = (maxRetries ?? 0) + 1;
  let attempt = 0;
  let providerResponse: ProviderResponse | undefined = cachedResponse;
  let lastError: unknown;

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
      if (isTimeoutLike(error) && attempt + 1 < attemptBudget) {
        attempt += 1;
        continue;
      }
      // On error, keep workspace for debugging (unless forceCleanup is set)
      const errorResult = buildErrorResult(
        evalCase,
        target.name,
        nowFn(),
        error,
        promptInputs,
        provider,
      );
      if (workspacePath) {
        if (forceCleanup) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        return { ...errorResult, workspacePath };
      }
      return errorResult;
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
  const baseSummary = output
    ? computeTraceSummary(output)
    : hasExecutionMetrics
      ? {
          eventCount: 0,
          toolNames: [],
          toolCallsByName: {},
          errorCount: 0,
        }
      : undefined;
  // Merge execution metrics from provider response
  const trace = baseSummary
    ? mergeExecutionMetrics(baseSummary, {
        tokenUsage: providerResponse.tokenUsage,
        costUsd: providerResponse.costUsd,
        durationMs: providerResponse.durationMs,
      })
    : undefined;

  // Extract candidate from last assistant message in output
  const candidate = extractLastAssistantContent(output);

  // Capture file changes from workspace if baseline was initialized
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

  const providerError = extractProviderError(providerResponse);

  // Execute after_each hook (runs after evaluation, before cleanup)
  if (workspacePath && evalCase.workspace?.after_each) {
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
    };
    try {
      afterEachOutput = await executeWorkspaceScript(
        evalCase.workspace.after_each,
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
      judgeProvider,
      agentTimeoutMs,
      output,
      trace,
      targetResolver,
      availableTargets,
      fileChanges,
      workspacePath,
    });

    const finalResult = providerError
      ? { ...result, error: providerError, beforeAllOutput, beforeEachOutput, afterEachOutput }
      : { ...result, beforeAllOutput, beforeEachOutput, afterEachOutput };

    // Determine if this is a failure (has error or low score)
    const isFailure = !!finalResult.error || finalResult.score < 0.5;

    // Cleanup workspace based on result and flags (only for per-case workspaces)
    if (workspacePath && !isSharedWorkspace) {
      if (forceCleanup) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      } else if (isFailure) {
        return { ...finalResult, workspacePath };
      } else if (!keepWorkspaces) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
    }

    return finalResult;
  } catch (error) {
    const errorResult = buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      error,
      promptInputs,
      provider,
    );
    // On error, keep workspace for debugging (only for per-case workspaces)
    if (workspacePath && !isSharedWorkspace) {
      if (forceCleanup) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      return { ...errorResult, workspacePath, beforeEachOutput, afterEachOutput };
    }
    return { ...errorResult, beforeEachOutput, afterEachOutput };
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
    };

    const result = await runEvalCase(trialOptions);
    allResults.push(result);

    // Extract cost from trace summary if available
    const trialCost = result.trace?.costUsd;

    const trialVerdict = scoreToVerdict(result.score);
    const trial: TrialResult = {
      attempt,
      score: result.score,
      verdict: trialVerdict,
      scores: result.scores,
      error: result.error,
      costUsd: trialCost,
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

  // Use the best-scoring trial's EvaluationResult for metadata (hits, misses, reasoning,
  // answer) so that the result's metadata corresponds to the aggregated score.
  const bestTrialIndex = trialResults.reduce(
    (bestIdx, t, idx) => (t.score > trialResults[bestIdx].score ? idx : bestIdx),
    0,
  );
  const baseResult = allResults[bestTrialIndex];

  return {
    ...baseResult,
    score,
    trials: trialResults,
    aggregation,
    costLimited: costLimited || undefined,
  };
}

async function evaluateCandidate(options: {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly promptInputs: PromptInputs;
  readonly nowFn: () => Date;
  readonly attempt: number;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
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
    judgeProvider,
    agentTimeoutMs,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
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
    judgeProvider,
    agentTimeoutMs,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  });

  const completedAt = nowFn();

  let agentRequest: JsonObject | undefined;
  let lmRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentRequest = {
      question: promptInputs.question,
      guideline_paths: evalCase.guideline_paths,
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
      } as JsonObject;
    } else {
      lmRequest = {
        question: promptInputs.question,
        guidelines: promptInputs.guidelines,
      } as JsonObject;
    }
  }

  const evaluatorRequest = scores ? undefined : score.evaluatorRawRequest;
  const requests =
    agentRequest || lmRequest || evaluatorRequest
      ? {
          ...(agentRequest ? { agent: agentRequest } : {}),
          ...(lmRequest ? { lm: lmRequest } : {}),
          ...(evaluatorRequest ? { evaluator: evaluatorRequest } : {}),
        }
      : undefined;
  const input = buildResultInput(promptInputs);

  return {
    timestamp: completedAt.toISOString(),
    testId: evalCase.id,
    dataset: evalCase.dataset,
    conversationId: evalCase.conversation_id,
    score: score.score,
    hits: score.hits,
    misses: score.misses,
    answer: candidate,
    target: target.name,
    reasoning: score.reasoning,
    requests,
    input,
    scores: scores,
    trace: trace,
    output: output,
    fileChanges,
  };
}

async function runEvaluatorsForCase(options: {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
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
    judgeProvider,
    agentTimeoutMs,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  } = options;

  if (evalCase.evaluators && evalCase.evaluators.length > 0) {
    return runEvaluatorList({
      evalCase,
      evaluators: evalCase.evaluators,
      candidate,
      target,
      provider,
      evaluatorRegistry: evaluators,
      typeRegistry,
      attempt,
      promptInputs,
      now,
      judgeProvider,
      agentTimeoutMs,
      output,
      trace,
      targetResolver,
      availableTargets,
      fileChanges,
      workspacePath,
    });
  }

  const evaluatorKind = evalCase.evaluator ?? 'llm_judge';
  const activeEvaluator = evaluators[evaluatorKind] ?? evaluators.llm_judge;
  if (!activeEvaluator) {
    throw new Error(`No evaluator registered for kind '${evaluatorKind}'`);
  }

  const score = await activeEvaluator.evaluate({
    evalCase,
    candidate,
    target,
    provider,
    attempt,
    promptInputs,
    now,
    judgeProvider,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  });

  return { score };
}

async function runEvaluatorList(options: {
  readonly evalCase: EvalTest;
  readonly evaluators: readonly EvaluatorConfig[];
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly llm_judge: Evaluator;
  };
  readonly typeRegistry: import('./registry/evaluator-registry.js').EvaluatorRegistry;
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
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
    judgeProvider,
    agentTimeoutMs,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  } = options;

  const scored: Array<{
    readonly score: EvaluationScore;
    readonly name: string;
    readonly type: string;
    readonly weight?: number;
    readonly required?: boolean | number;
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
    judgeProvider,
    output,
    trace,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  };

  // Build the dispatch context for evaluator factories
  const evalFileDir = evalCase.guideline_paths[0]
    ? path.dirname(evalCase.guideline_paths[0])
    : process.cwd();
  const dispatchContext: import('./registry/evaluator-registry.js').EvaluatorDispatchContext = {
    judgeProvider,
    targetResolver,
    availableTargets,
    agentTimeoutMs,
    evalFileDir,
    llmJudge: evaluatorRegistry.llm_judge,
    registry: typeRegistry,
  };

  for (const evaluatorConfig of evaluators ?? []) {
    try {
      // Create evaluator instance via registry
      const evaluatorInstance = await typeRegistry.create(evaluatorConfig, dispatchContext);
      const score = await evaluatorInstance.evaluate(evalContext);

      // Determine result type (code evaluators report as code_judge)
      const resultType = evaluatorConfig.type === 'code' ? 'code_judge' : evaluatorConfig.type;
      const weight = evaluatorConfig.weight ?? 1.0;

      scored.push({
        score,
        name: evaluatorConfig.name,
        type: resultType,
        weight,
        ...(evaluatorConfig.required !== undefined ? { required: evaluatorConfig.required } : {}),
      });
      scores.push({
        name: evaluatorConfig.name,
        type: resultType,
        score: score.score,
        weight,
        verdict: score.verdict,
        hits: score.hits,
        misses: score.misses,
        reasoning: score.reasoning,
        evaluatorProviderRequest: score.evaluatorRawRequest,
        details: score.details,
        scores: mapChildResults(score.scores),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackScore: EvaluationScore = {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`Evaluator '${evaluatorConfig.name}' failed: ${message}`],
        expectedAspectCount: 1,
        reasoning: message,
      };
      const resultType = evaluatorConfig.type === 'code' ? 'code_judge' : evaluatorConfig.type;
      const weight = evaluatorConfig.weight ?? 1.0;
      scored.push({
        score: fallbackScore,
        name: evaluatorConfig.name ?? 'unknown',
        type: resultType ?? 'llm_judge',
        weight,
        ...(evaluatorConfig.required !== undefined ? { required: evaluatorConfig.required } : {}),
      });
      scores.push({
        name: evaluatorConfig.name ?? 'unknown',
        type: resultType ?? 'llm_judge',
        score: 0,
        weight,
        verdict: 'fail',
        hits: [],
        misses: [`Evaluator '${evaluatorConfig.name ?? 'unknown'}' failed: ${message}`],
        reasoning: message,
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
          hits: [...negated.hits],
          misses: [...negated.misses],
          reasoning: negated.reasoning,
        };
      }
    }
  }

  // Required gate: if any evaluator with `required` flag fails its threshold, aggregate becomes 0
  const PASS_THRESHOLD = 0.8;
  const hasRequiredFailure = scored.some((entry) => {
    if (!entry.required) return false;
    const minScore = typeof entry.required === 'number' ? entry.required : PASS_THRESHOLD;
    return entry.score.score < minScore;
  });

  const aggregateScore = hasRequiredFailure
    ? 0
    : scored.length > 0
      ? computeWeightedMean(
          scored.map((entry) => ({ score: entry.score.score, weight: entry.weight })),
        )
      : 0;
  const hits = scored.flatMap((entry) => entry.score.hits);
  const misses = scored.flatMap((entry) => entry.score.misses);
  const expectedAspectCount = scored.reduce(
    (total, entry) => total + (entry.score.expectedAspectCount ?? 0),
    0,
  );
  const reasoningParts = scored
    .map((entry) => (entry.score.reasoning ? `${entry.name}: ${entry.score.reasoning}` : undefined))
    .filter(isNonEmptyString);
  const reasoning = reasoningParts.length > 0 ? reasoningParts.join(' | ') : undefined;

  const score: EvaluationScore = {
    score: aggregateScore,
    verdict: scoreToVerdict(aggregateScore),
    hits,
    misses,
    expectedAspectCount,
    reasoning,
  };

  return { score, scores };
}

function filterEvalCases(evalCases: readonly EvalTest[], filter?: string): readonly EvalTest[] {
  if (!filter) {
    return evalCases;
  }
  return evalCases.filter((evalCase) => micromatch.isMatch(evalCase.id, filter));
}

function buildEvaluatorRegistry(
  overrides: Partial<Record<string, Evaluator>> | undefined,
  resolveJudgeProvider: (target: ResolvedTarget) => Promise<Provider | undefined>,
): Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator } {
  const llmJudge =
    overrides?.llm_judge ??
    new LlmJudgeEvaluator({
      resolveJudgeProvider: async (context) => {
        if (context.judgeProvider) {
          return context.judgeProvider;
        }
        return resolveJudgeProvider(context.target);
      },
    });

  return {
    ...overrides,
    llm_judge: llmJudge,
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
    return await provider.invoke({
      question: promptInputs.question,
      guidelines: promptInputs.guidelines,
      guideline_patterns: evalCase.guideline_patterns,
      chatPrompt: promptInputs.chatPrompt,
      inputFiles: evalCase.file_paths,
      evalCaseId: evalCase.id,
      attempt,
      metadata: {
        systemPrompt: promptInputs.systemMessage ?? '',
      },
      signal: controller.signal,
      cwd,
      workspaceFile,
      captureFileChanges,
      streamCallbacks,
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
  provider?: Provider,
): EvaluationResult {
  const message = error instanceof Error ? error.message : String(error);

  let agentRequest: JsonObject | undefined;
  let lmRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentRequest = {
      question: promptInputs.question,
      guideline_paths: evalCase.guideline_paths,
      error: message,
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
        guideline_paths: evalCase.guideline_paths,
        error: message,
      } as JsonObject;
    } else {
      lmRequest = {
        question: promptInputs.question,
        guidelines: promptInputs.guidelines,
        guideline_paths: evalCase.guideline_paths,
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
    dataset: evalCase.dataset,
    conversationId: evalCase.conversation_id,
    score: 0,
    hits: [],
    misses: [`Error: ${message}`],
    answer: `Error occurred: ${message}`,
    target: targetName,
    requests,
    input,
    error: message,
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
  hash.update(promptInputs.guidelines);
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
  return promptInputs.question;
}

function isTimeoutLike(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  if (error instanceof Error) {
    const name = error.name?.toLowerCase();
    const message = error.message?.toLowerCase();
    return name.includes('timeout') || message.includes('timeout');
  }
  const value = String(error).toLowerCase();
  return value.includes('timeout');
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
    hits: child.hits,
    misses: child.misses,
    reasoning: child.reasoning,
    evaluatorProviderRequest: child.evaluatorRawRequest,
    scores: mapChildResults(child.scores),
    details: child.details,
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
