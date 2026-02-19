import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import pLimit from 'p-limit';

import { toSnakeCaseDeep } from './case-conversion.js';
import {
  AgentJudgeEvaluator,
  type ChildEvaluatorResult,
  CodeEvaluator,
  CompositeEvaluator,
  CostEvaluator,
  type EvaluationScore,
  type Evaluator,
  ExecutionMetricsEvaluator,
  FieldAccuracyEvaluator,
  LatencyEvaluator,
  LlmJudgeEvaluator,
  TokenUsageEvaluator,
  ToolTrajectoryEvaluator,
  executeScript,
  isNonEmptyString,
  scoreToVerdict,
} from './evaluators.js';
import { readJsonFile, readTextFile } from './file-utils.js';
import { createProvider } from './providers/index.js';
import { type ResolvedTarget, resolveTargetDefinition } from './providers/targets.js';
import type {
  EnvLookup,
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  TargetDefinition,
} from './providers/types.js';
import { extractLastAssistantContent, isAgentProvider } from './providers/types.js';
import {
  type ToolTrajectoryEvaluatorConfig,
  type TraceSummary,
  computeTraceSummary,
  mergeExecutionMetrics,
} from './trace.js';
import type {
  AgentJudgeEvaluatorConfig,
  CostEvaluatorConfig,
  EvalCase,
  EvaluationResult,
  EvaluationVerdict,
  EvaluatorConfig,
  EvaluatorKind,
  EvaluatorResult,
  ExecutionMetricsEvaluatorConfig,
  FieldAccuracyEvaluatorConfig,
  JsonObject,
  JsonValue,
  LatencyEvaluatorConfig,
  TokenUsageEvaluatorConfig,
} from './types.js';
import {
  captureFileChanges as captureWorkspaceFileChanges,
  initializeBaseline,
} from './workspace/file-changes.js';
import {
  cleanupEvalWorkspaces,
  cleanupWorkspace,
  createTempWorkspace,
} from './workspace/manager.js';
import { type PromptInputs, buildPromptInputs, loadEvalCases } from './yaml-parser.js';

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
  readonly evalCase: EvalCase;
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
}

export interface ProgressEvent {
  readonly workerId: number;
  readonly evalId: string;
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
  /** Filter eval cases by ID pattern (glob supported, e.g., "summary-*") */
  readonly filter?: string;
  readonly verbose?: boolean;
  readonly maxConcurrency?: number;
  readonly evalCases?: readonly EvalCase[];
  readonly onResult?: (result: EvaluationResult) => MaybePromise<void>;
  readonly onProgress?: (event: ProgressEvent) => MaybePromise<void>;
  /** Keep workspace on success (default: cleanup on success, keep on failure) */
  readonly keepWorkspaces?: boolean;
  /** Force cleanup of workspaces even on failure */
  readonly cleanupWorkspaces?: boolean;
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
    useCache,
    now,
    filter,
    verbose,
    evalCases: preloadedEvalCases,
    onResult,
    onProgress,
    keepWorkspaces,
    cleanupWorkspaces,
  } = options;

  // Generate unique eval run ID for workspace management
  const evalRunId = randomUUID();

  // Use pre-loaded eval cases if provided, otherwise load them
  const evalCases =
    preloadedEvalCases ?? (await loadEvalCases(evalFilePath, repoRoot, { verbose, filter }));

  const filteredEvalCases = filterEvalCases(evalCases, filter);
  if (filteredEvalCases.length === 0) {
    if (filter) {
      throw new Error(`No eval cases matched filter '${filter}' in ${evalFilePath}`);
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

  const primaryProvider = getOrCreateProvider(target);
  const providerSupportsBatch =
    target.providerBatching === true &&
    primaryProvider.supportsBatch === true &&
    typeof primaryProvider.invokeBatch === 'function';
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
        evalId: filteredEvalCases[i].id,
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

  // Resolve worker count: CLI option > target setting > default (1)
  const workers = options.maxConcurrency ?? target.workers ?? 1;
  const limit = pLimit(workers);

  // Track worker assignments for progress reporting
  let nextWorkerId = 1;
  const workerIdByEvalId = new Map<string, number>();

  // Map test cases to limited promises for parallel execution
  const promises = filteredEvalCases.map((evalCase) =>
    limit(async () => {
      // Assign worker ID when test starts executing
      const workerId = nextWorkerId++;
      workerIdByEvalId.set(evalCase.id, workerId);

      if (onProgress) {
        await onProgress({
          workerId,
          evalId: evalCase.id,
          status: 'running',
          startedAt: Date.now(),
        });
      }

      try {
        const judgeProvider = await resolveJudgeProvider(target);
        const result = await runEvalCase({
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
        });

        if (onProgress) {
          await onProgress({
            workerId,
            evalId: evalCase.id,
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
            evalId: evalCase.id,
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

  // Cleanup all eval workspaces if forceCleanup is set, or cleanup successful runs
  // Failed runs keep their workspaces for debugging (handled per-case above)
  // This is a fallback to ensure workspace directories are cleaned up
  const workspaceTemplate = getWorkspaceTemplate(target);
  if (workspaceTemplate && cleanupWorkspaces) {
    // Force cleanup: remove all workspaces for this eval run
    await cleanupEvalWorkspaces(evalRunId).catch(() => {});
  }

  return results;
}

async function runBatchEvaluation(options: {
  readonly evalCases: readonly EvalCase[];
  readonly provider: Provider;
  readonly target: ResolvedTarget;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly llm_judge: Evaluator;
  };
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
        evalId: evalCases[i].id,
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

    // Extract outputMessages from batch response
    const outputMessages = providerResponse.outputMessages;
    const hasExecutionMetrics =
      providerResponse.tokenUsage !== undefined ||
      providerResponse.costUsd !== undefined ||
      providerResponse.durationMs !== undefined;

    const baseSummary = outputMessages
      ? computeTraceSummary(outputMessages)
      : hasExecutionMetrics
        ? {
            eventCount: 0,
            toolNames: [],
            toolCallsByName: {},
            errorCount: 0,
          }
        : undefined;
    // Merge execution metrics from provider response
    const traceSummary = baseSummary
      ? mergeExecutionMetrics(baseSummary, {
          tokenUsage: providerResponse.tokenUsage,
          costUsd: providerResponse.costUsd,
          durationMs: providerResponse.durationMs,
        })
      : undefined;

    // Extract candidate from last assistant message in output_messages
    const candidate = extractLastAssistantContent(outputMessages);

    const providerError = extractProviderError(providerResponse);

    let result: EvaluationResult;
    try {
      result = await evaluateCandidate({
        evalCase,
        candidate,
        target,
        provider,
        evaluators: evaluatorRegistry,
        promptInputs,
        nowFn,
        attempt: 0,
        judgeProvider: await resolveJudgeProvider(target),
        agentTimeoutMs,
        outputMessages,
        traceSummary,
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
          evalId: evalCase.id,
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
        evalId: evalCase.id,
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
  } = options;

  const formattingMode = usesFileReferencePrompt(provider) ? 'agent' : 'lm';
  const promptInputs = await buildPromptInputs(evalCase, formattingMode);

  const cacheKey = useCache ? createCacheKey(provider, target, evalCase, promptInputs) : undefined;
  let cachedResponse: ProviderResponse | undefined;
  if (cacheKey && cache) {
    cachedResponse = await cache.get(cacheKey);
  }

  const nowFn = now ?? (() => new Date());

  // Check if workspace_template is configured for this target
  const workspaceTemplate = getWorkspaceTemplate(target);
  let workspacePath: string | undefined;

  // Create temp workspace if template is configured and we have evalRunId
  if (workspaceTemplate && evalRunId) {
    try {
      workspacePath = await createTempWorkspace(workspaceTemplate, evalRunId, evalCase.id);
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

  // Initialize git baseline for file change tracking when workspace is configured
  let baselineCommit: string | undefined;
  if (workspacePath) {
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
        captureFileChanges: !!baselineCommit,
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

  // Extract outputMessages from provider response
  const outputMessages = providerResponse.outputMessages;

  const hasExecutionMetrics =
    providerResponse.tokenUsage !== undefined ||
    providerResponse.costUsd !== undefined ||
    providerResponse.durationMs !== undefined;

  // Compute trace summary if outputMessages available. If not, still preserve execution metrics.
  const baseSummary = outputMessages
    ? computeTraceSummary(outputMessages)
    : hasExecutionMetrics
      ? {
          eventCount: 0,
          toolNames: [],
          toolCallsByName: {},
          errorCount: 0,
        }
      : undefined;
  // Merge execution metrics from provider response
  const traceSummary = baseSummary
    ? mergeExecutionMetrics(baseSummary, {
        tokenUsage: providerResponse.tokenUsage,
        costUsd: providerResponse.costUsd,
        durationMs: providerResponse.durationMs,
      })
    : undefined;

  // Extract candidate from last assistant message in output_messages
  const candidate = extractLastAssistantContent(outputMessages);

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

  try {
    const result = await evaluateCandidate({
      evalCase,
      candidate,
      target,
      provider,
      evaluators,
      promptInputs,
      nowFn,
      attempt,
      judgeProvider,
      agentTimeoutMs,
      outputMessages,
      traceSummary,
      targetResolver,
      availableTargets,
      fileChanges,
      workspacePath,
    });

    const finalResult = providerError ? { ...result, error: providerError } : result;

    // Determine if this is a failure (has error or low score)
    const isFailure = !!finalResult.error || finalResult.score < 0.5;

    // Cleanup workspace based on result and flags
    if (workspacePath) {
      if (forceCleanup) {
        // forceCleanup: always cleanup
        await cleanupWorkspace(workspacePath).catch(() => {});
      } else if (isFailure) {
        // Failure: keep workspace, include path in result
        return { ...finalResult, workspacePath };
      } else if (!keepWorkspaces) {
        // Success and not keeping: cleanup
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
    // On error, keep workspace for debugging (unless forceCleanup is set)
    if (workspacePath) {
      if (forceCleanup) {
        await cleanupWorkspace(workspacePath).catch(() => {});
      }
      return { ...errorResult, workspacePath };
    }
    return errorResult;
  }
}

async function evaluateCandidate(options: {
  readonly evalCase: EvalCase;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator };
  readonly promptInputs: PromptInputs;
  readonly nowFn: () => Date;
  readonly attempt: number;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly outputMessages?: readonly OutputMessage[];
  readonly traceSummary?: TraceSummary;
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
    promptInputs,
    nowFn,
    attempt,
    judgeProvider,
    agentTimeoutMs,
    outputMessages,
    traceSummary,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  } = options;

  const gradeTimestamp = nowFn();
  const { score, evaluatorResults } = await runEvaluatorsForCase({
    evalCase,
    candidate,
    target,
    provider,
    evaluators,
    attempt,
    promptInputs,
    now: gradeTimestamp,
    judgeProvider,
    agentTimeoutMs,
    outputMessages,
    traceSummary,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  });

  const completedAt = nowFn();

  let agentProviderRequest: JsonObject | undefined;
  let lmProviderRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentProviderRequest = {
      question: promptInputs.question,
      guideline_paths: evalCase.guideline_paths,
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmProviderRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
      } as JsonObject;
    } else {
      lmProviderRequest = {
        question: promptInputs.question,
        guidelines: promptInputs.guidelines,
      } as JsonObject;
    }
  }

  return {
    timestamp: completedAt.toISOString(),
    evalId: evalCase.id,
    dataset: evalCase.dataset,
    conversationId: evalCase.conversation_id,
    score: score.score,
    hits: score.hits,
    misses: score.misses,
    candidateAnswer: candidate,
    target: target.name,
    reasoning: score.reasoning,
    agentProviderRequest: agentProviderRequest,
    lmProviderRequest: lmProviderRequest,
    evaluatorProviderRequest: evaluatorResults ? undefined : score.evaluatorRawRequest,
    evaluatorResults: evaluatorResults,
    traceSummary: traceSummary,
    outputMessages: outputMessages,
    fileChanges,
  };
}

async function runEvaluatorsForCase(options: {
  readonly evalCase: EvalCase;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluators: Partial<Record<string, Evaluator>> & { readonly llm_judge: Evaluator };
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly outputMessages?: readonly OutputMessage[];
  readonly traceSummary?: TraceSummary;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
}): Promise<{ score: EvaluationScore; evaluatorResults?: EvaluatorResult[] }> {
  const {
    evalCase,
    candidate,
    target,
    provider,
    evaluators,
    attempt,
    promptInputs,
    now,
    judgeProvider,
    agentTimeoutMs,
    outputMessages,
    traceSummary,
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
      attempt,
      promptInputs,
      now,
      judgeProvider,
      agentTimeoutMs,
      outputMessages,
      traceSummary,
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
    outputMessages,
    traceSummary,
    targetResolver,
    availableTargets,
    fileChanges,
    workspacePath,
  });

  return { score };
}

async function runEvaluatorList(options: {
  readonly evalCase: EvalCase;
  readonly evaluators: readonly EvaluatorConfig[];
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly llm_judge: Evaluator;
  };
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly agentTimeoutMs?: number;
  readonly outputMessages?: readonly OutputMessage[];
  readonly traceSummary?: TraceSummary;
  readonly targetResolver?: (name: string) => Provider | undefined;
  readonly availableTargets?: readonly string[];
  readonly fileChanges?: string;
  readonly workspacePath?: string;
}): Promise<{ score: EvaluationScore; evaluatorResults: EvaluatorResult[] }> {
  const {
    evalCase,
    evaluators,
    candidate,
    target,
    provider,
    evaluatorRegistry,
    attempt,
    promptInputs,
    now,
    judgeProvider,
    agentTimeoutMs,
    outputMessages,
    traceSummary,
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
  }> = [];
  const evaluatorResults: EvaluatorResult[] = [];

  for (const evaluator of evaluators ?? []) {
    try {
      if (evaluator.type === 'llm_judge') {
        const score = await runLlmJudgeEvaluator({
          config: evaluator,
          evalCase,
          candidate,
          target,
          provider,
          evaluatorRegistry,
          attempt,
          promptInputs,
          now,
          judgeProvider,
          outputMessages,
          traceSummary,
          agentTimeoutMs,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
          evaluatorProviderRequest: score.evaluatorRawRequest,
        });
      }

      if (evaluator.type === 'code') {
        const codeEvaluator = new CodeEvaluator({
          script: evaluator.script,
          cwd: evaluator.resolvedCwd ?? evaluator.cwd,
          agentTimeoutMs,
          config: evaluator.config,
          target: evaluator.target,
        });
        const score = await codeEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          judgeProvider,
          outputMessages,
          traceSummary,
          targetResolver,
          availableTargets,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: 'code_judge', weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: 'code_judge',
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
          evaluatorProviderRequest: score.evaluatorRawRequest,
          details: score.details,
        });
      }

      if (evaluator.type === 'composite') {
        const evalFileDir = evalCase.guideline_paths[0]
          ? path.dirname(evalCase.guideline_paths[0])
          : process.cwd();

        const createEvaluator = (memberConfig: import('./types.js').EvaluatorConfig): Evaluator => {
          switch (memberConfig.type) {
            case 'llm_judge':
              return evaluatorRegistry.llm_judge;
            case 'code':
              return new CodeEvaluator({
                script: memberConfig.script,
                cwd: memberConfig.resolvedCwd ?? memberConfig.cwd,
                agentTimeoutMs,
                config: memberConfig.config,
                target: memberConfig.target,
              });
            case 'composite':
              return new CompositeEvaluator({
                config: memberConfig,
                cwd: evalFileDir,
                evaluatorFactory: { create: createEvaluator },
              });
            case 'tool_trajectory':
              return new ToolTrajectoryEvaluator({
                config: memberConfig as ToolTrajectoryEvaluatorConfig,
              });
            case 'field_accuracy':
              return new FieldAccuracyEvaluator({
                config: memberConfig as FieldAccuracyEvaluatorConfig,
              });
            case 'latency':
              return new LatencyEvaluator({
                config: memberConfig as LatencyEvaluatorConfig,
              });
            case 'cost':
              return new CostEvaluator({
                config: memberConfig as CostEvaluatorConfig,
              });
            case 'token_usage':
              return new TokenUsageEvaluator({
                config: memberConfig as TokenUsageEvaluatorConfig,
              });
            case 'execution_metrics':
              return new ExecutionMetricsEvaluator({
                config: memberConfig as ExecutionMetricsEvaluatorConfig,
              });
            case 'agent_judge': {
              const ajConfig = memberConfig as AgentJudgeEvaluatorConfig;
              let ajPrompt: string | undefined;
              if (ajConfig.resolvedPromptPath) {
                try {
                  ajPrompt = readFileSync(ajConfig.resolvedPromptPath, 'utf-8');
                } catch {
                  // Fall through — prompt file not found
                }
              } else if (ajConfig.prompt) {
                ajPrompt = ajConfig.prompt;
              }
              let ajTargetProvider: Provider | undefined;
              if (ajConfig.judge_target && targetResolver) {
                ajTargetProvider = targetResolver(ajConfig.judge_target);
              }
              return new AgentJudgeEvaluator({
                resolveJudgeProvider: async (ctx) => {
                  if (ctx.judgeProvider) return ctx.judgeProvider;
                  return judgeProvider;
                },
                maxSteps: ajConfig.max_steps,
                temperature: ajConfig.temperature,
                evaluatorTemplate: ajPrompt,
                judgeTargetProvider: ajTargetProvider,
              });
            }
            default: {
              const unknownConfig = memberConfig as { type: string };
              throw new Error(`Unsupported evaluator type in composite: ${unknownConfig.type}`);
            }
          }
        };

        const compositeEvaluator = new CompositeEvaluator({
          config: evaluator,
          cwd: evalFileDir,
          evaluatorFactory: { create: createEvaluator },
        });
        const score = await compositeEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          judgeProvider,
          outputMessages,
          traceSummary,
          targetResolver,
          availableTargets,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
          evaluatorProviderRequest: score.evaluatorRawRequest,
          evaluatorResults: mapChildResults(score.evaluatorResults),
        });
      }

      if (evaluator.type === 'tool_trajectory') {
        const trajectoryEvaluator = new ToolTrajectoryEvaluator({
          config: evaluator as ToolTrajectoryEvaluatorConfig,
        });
        const score = trajectoryEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'field_accuracy') {
        const fieldAccuracyEvaluator = new FieldAccuracyEvaluator({
          config: evaluator as FieldAccuracyEvaluatorConfig,
        });
        const score = fieldAccuracyEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'latency') {
        const latencyEvaluator = new LatencyEvaluator({
          config: evaluator as LatencyEvaluatorConfig,
        });
        const score = latencyEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'cost') {
        const costEvaluator = new CostEvaluator({
          config: evaluator as CostEvaluatorConfig,
        });
        const score = costEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'token_usage') {
        const tokenUsageEvaluator = new TokenUsageEvaluator({
          config: evaluator as TokenUsageEvaluatorConfig,
        });
        const score = tokenUsageEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'execution_metrics') {
        const executionMetricsEvaluator = new ExecutionMetricsEvaluator({
          config: evaluator as ExecutionMetricsEvaluatorConfig,
        });
        const score = executionMetricsEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
        });
      }

      if (evaluator.type === 'agent_judge') {
        const agentJudgeConfig = evaluator as AgentJudgeEvaluatorConfig;

        // Resolve custom prompt from file or inline
        let customPrompt: string | undefined;
        if (agentJudgeConfig.resolvedPromptPath) {
          try {
            customPrompt = await readTextFile(agentJudgeConfig.resolvedPromptPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
              `Could not read agent_judge prompt at ${agentJudgeConfig.resolvedPromptPath}: ${message}`,
            );
          }
        } else if (agentJudgeConfig.prompt) {
          customPrompt = agentJudgeConfig.prompt;
        }

        // Resolve judge_target provider if specified
        let judgeTargetProvider: Provider | undefined;
        if (agentJudgeConfig.judge_target && targetResolver) {
          judgeTargetProvider = targetResolver(agentJudgeConfig.judge_target);
          if (!judgeTargetProvider) {
            throw new Error(
              `agent_judge evaluator '${evaluator.name}': judge_target '${agentJudgeConfig.judge_target}' not found in targets`,
            );
          }
        }

        const agentJudgeEvaluator = new AgentJudgeEvaluator({
          resolveJudgeProvider: async (ctx) => {
            if (ctx.judgeProvider) return ctx.judgeProvider;
            return judgeProvider;
          },
          maxSteps: agentJudgeConfig.max_steps,
          temperature: agentJudgeConfig.temperature,
          evaluatorTemplate: customPrompt,
          judgeTargetProvider,
        });

        const score = await agentJudgeEvaluator.evaluate({
          evalCase,
          candidate,
          target,
          provider,
          attempt,
          promptInputs,
          now,
          judgeProvider,
          evaluator: agentJudgeConfig,
          outputMessages,
          traceSummary,
          fileChanges,
          workspacePath,
        });
        const weight = evaluator.weight ?? 1.0;
        scored.push({ score, name: evaluator.name, type: evaluator.type, weight });
        evaluatorResults.push({
          name: evaluator.name,
          type: evaluator.type,
          score: score.score,
          weight,
          verdict: score.verdict,
          hits: score.hits,
          misses: score.misses,
          reasoning: score.reasoning,
          evaluatorProviderRequest: score.evaluatorRawRequest,
          details: score.details,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackScore: EvaluationScore = {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`Evaluator '${evaluator.name}' failed: ${message}`],
        expectedAspectCount: 1,
        reasoning: message,
      };
      const resultType = evaluator.type === 'code' ? 'code_judge' : evaluator.type;
      const weight = evaluator.weight ?? 1.0;
      scored.push({
        score: fallbackScore,
        name: evaluator.name ?? 'unknown',
        type: resultType ?? 'llm_judge',
        weight,
      });
      evaluatorResults.push({
        name: evaluator.name ?? 'unknown',
        type: resultType ?? 'llm_judge',
        score: 0,
        weight,
        verdict: 'fail',
        hits: [],
        misses: [`Evaluator '${evaluator.name ?? 'unknown'}' failed: ${message}`],
        reasoning: message,
      });
    }
  }

  const aggregateScore =
    scored.length > 0
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

  return { score, evaluatorResults };
}

async function runLlmJudgeEvaluator(options: {
  readonly config: import('./types.js').LlmJudgeEvaluatorConfig;
  readonly evalCase: EvalCase;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly evaluatorRegistry: Partial<Record<string, Evaluator>> & {
    readonly llm_judge: Evaluator;
  };
  readonly attempt: number;
  readonly promptInputs: PromptInputs;
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly outputMessages?: readonly OutputMessage[];
  readonly traceSummary?: TraceSummary;
  readonly agentTimeoutMs?: number;
  readonly fileChanges?: string;
  readonly workspacePath?: string;
}): Promise<EvaluationScore> {
  const {
    config,
    evalCase,
    candidate,
    target,
    provider,
    evaluatorRegistry,
    attempt,
    promptInputs,
    now,
    judgeProvider,
    outputMessages,
    traceSummary,
    agentTimeoutMs,
    fileChanges,
    workspacePath,
  } = options;
  const customPrompt = await resolveCustomPrompt(
    config,
    {
      evalCase,
      candidate,
      outputMessages,
      traceSummary,
      config: config.config,
      fileChanges,
      workspacePath,
    },
    agentTimeoutMs,
  );

  return evaluatorRegistry.llm_judge.evaluate({
    evalCase,
    candidate,
    target,
    provider,
    attempt,
    promptInputs,
    now,
    judgeProvider,
    evaluatorTemplateOverride: customPrompt,
    evaluator: config,
    fileChanges,
    workspacePath,
  });
}

interface ResolveCustomPromptContext {
  readonly evalCase: EvalCase;
  readonly candidate: string;
  readonly outputMessages?: readonly OutputMessage[];
  readonly traceSummary?: TraceSummary;
  readonly config?: Record<string, unknown>;
  readonly fileChanges?: string;
  readonly workspacePath?: string;
}

async function resolveCustomPrompt(
  promptConfig: {
    readonly prompt?: string | import('./types.js').PromptScriptConfig;
    readonly promptPath?: string;
    readonly resolvedPromptPath?: string;
    readonly resolvedPromptScript?: readonly string[];
    readonly config?: Record<string, unknown>;
  },
  context?: ResolveCustomPromptContext,
  timeoutMs?: number,
): Promise<string | undefined> {
  // Executable prompt template using script array (matches code_judge pattern)
  if (promptConfig.resolvedPromptScript && promptConfig.resolvedPromptScript.length > 0) {
    if (!context) {
      throw new Error('Context required for executable prompt templates');
    }
    return executePromptTemplate(
      promptConfig.resolvedPromptScript,
      context,
      promptConfig.config,
      timeoutMs,
    );
  }

  const promptPath = promptConfig.resolvedPromptPath ?? promptConfig.promptPath;

  if (promptPath) {
    // Static text file (existing behavior)
    try {
      const content = await readTextFile(promptPath);
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not read custom prompt at ${promptPath}: ${message}`);
    }
  }

  // Handle prompt as string - could be inline or the original prompt value
  const promptValue = promptConfig.prompt;
  if (typeof promptValue === 'string') {
    return promptValue;
  }

  return undefined;
}

async function executePromptTemplate(
  script: readonly string[],
  context: ResolveCustomPromptContext,
  config?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> {
  // Build payload matching code judge input format for consistency
  const payload = {
    question: context.evalCase.question,
    criteria: context.evalCase.criteria,
    expectedMessages: context.evalCase.expected_messages,
    referenceAnswer: context.evalCase.reference_answer,
    candidateAnswer: context.candidate,
    outputMessages: context.outputMessages ?? null,
    guidelineFiles: context.evalCase.guideline_paths,
    inputFiles: context.evalCase.file_paths.filter(
      (p) => !context.evalCase.guideline_paths.includes(p),
    ),
    inputMessages: context.evalCase.input_messages,
    traceSummary: context.traceSummary ?? null,
    fileChanges: context.fileChanges ?? null,
    workspacePath: context.workspacePath ?? null,
    config: config ?? context.config ?? null,
  };

  const inputJson = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

  // Derive cwd from the last element of the script array (the script file path)
  const scriptPath = script[script.length - 1];
  const cwd = path.dirname(scriptPath);

  try {
    const stdout = await executeScript(script, inputJson, timeoutMs, cwd);
    const prompt = stdout.trim();

    if (!prompt) {
      throw new Error('Prompt template produced empty output');
    }

    return prompt;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt template execution failed: ${message}`);
  }
}

function filterEvalCases(evalCases: readonly EvalCase[], filter?: string): readonly EvalCase[] {
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
    readonly evalCase: EvalCase;
    readonly target: ResolvedTarget;
    readonly promptInputs: PromptInputs;
    readonly attempt: number;
    readonly agentTimeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Working directory override (e.g., from workspace_template) */
    readonly cwd?: string;
    /** When true, AgentV captures file changes — provider should skip forced diff prompt */
    readonly captureFileChanges?: boolean;
  },
): Promise<ProviderResponse> {
  const { evalCase, promptInputs, attempt, agentTimeoutMs, signal, cwd, captureFileChanges } =
    options;

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
      captureFileChanges,
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function buildErrorResult(
  evalCase: EvalCase,
  targetName: string,
  timestamp: Date,
  error: unknown,
  promptInputs: PromptInputs,
  provider?: Provider,
): EvaluationResult {
  const message = error instanceof Error ? error.message : String(error);

  let agentProviderRequest: JsonObject | undefined;
  let lmProviderRequest: JsonObject | undefined;

  if (isAgentProvider(provider)) {
    agentProviderRequest = {
      question: promptInputs.question,
      guideline_paths: evalCase.guideline_paths,
      error: message,
    } as JsonObject;
  } else {
    if (promptInputs.chatPrompt) {
      lmProviderRequest = {
        chat_prompt: promptInputs.chatPrompt as unknown as JsonValue,
        guideline_paths: evalCase.guideline_paths,
        error: message,
      } as JsonObject;
    } else {
      lmProviderRequest = {
        question: promptInputs.question,
        guidelines: promptInputs.guidelines,
        guideline_paths: evalCase.guideline_paths,
        error: message,
      } as JsonObject;
    }
  }

  return {
    timestamp: timestamp.toISOString(),
    evalId: evalCase.id,
    dataset: evalCase.dataset,
    conversationId: evalCase.conversation_id,
    score: 0,
    hits: [],
    misses: [`Error: ${message}`],
    candidateAnswer: `Error occurred: ${message}`,
    target: targetName,
    agentProviderRequest: agentProviderRequest,
    lmProviderRequest: lmProviderRequest,
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
  evalCase: EvalCase,
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
    evaluatorResults: mapChildResults(child.evaluatorResults),
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
