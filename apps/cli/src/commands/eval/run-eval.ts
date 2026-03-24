import { constants, mkdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  type EvalTest,
  type EvaluationCache,
  type EvaluationResult,
  type ExecutionDefaults,
  type FailOnError,
  type OtelTraceExporter as OtelTraceExporterType,
  type ResolvedTarget,
  ResponseCache,
  type TrialsConfig,
  runEvaluation as defaultRunEvaluation,
  ensureVSCodeSubagents,
  loadConfig,
  loadTestSuite,
  loadTsConfig,
  shouldEnableCache,
  shouldSkipCacheForTemperature,
  subscribeToCodexLogEntries,
  subscribeToCopilotCliLogEntries,
  subscribeToCopilotSdkLogEntries,
  subscribeToPiLogEntries,
} from '@agentv/core';

import { enforceRequiredVersion } from '../../version-check.js';
import { writeArtifactsFromResults } from './artifact-writer.js';
import { writeBenchmarkJson } from './benchmark-writer.js';
import { loadEnvFromHierarchy } from './env.js';
import {
  type OutputFormat,
  type OutputWriter,
  createMultiWriter,
  createOutputWriter,
} from './output-writer.js';
import { ProgressDisplay, type Verdict, type WorkerProgress } from './progress-display.js';
import { LEGACY_RESULTS_FILENAME, buildDefaultRunDir } from './result-layout.js';
import { loadErrorTestIds, loadNonErrorResults } from './retry-errors.js';
import { saveRunCache } from './run-cache.js';
import { findRepoRoot } from './shared.js';
import {
  calculateEvaluationSummary,
  formatEvaluationSummary,
  formatMatrixSummary,
} from './statistics.js';
import { type TargetSelection, selectMultipleTargets, selectTarget } from './targets.js';

const DEFAULT_WORKERS = 3;

interface RunEvalCommandInput {
  readonly testFiles: readonly string[];
  readonly rawOptions: Record<string, unknown>;
}

interface NormalizedOptions {
  readonly target?: string;
  readonly cliTargets: readonly string[];
  readonly targetsPath?: string;
  readonly filter?: string;
  readonly workers?: number;
  readonly outPath?: string;
  readonly outputPaths: readonly string[];
  readonly format: OutputFormat;
  readonly dryRun: boolean;
  readonly dryRunDelay: number;
  readonly dryRunDelayMin: number;
  readonly dryRunDelayMax: number;
  readonly agentTimeoutSeconds?: number;
  readonly maxRetries: number;
  readonly cache: boolean;
  readonly noCache: boolean;
  readonly verbose: boolean;
  readonly otelFile?: string;
  readonly traceFile?: string;
  readonly exportOtel: boolean;
  readonly otelBackend?: string;
  readonly otelCaptureContent: boolean;
  readonly otelGroupTurns: boolean;
  readonly retryErrors?: string;
  readonly workspaceMode?: 'pooled' | 'temp' | 'static';
  readonly workspacePath?: string;
  readonly benchmarkJson?: string;
  readonly artifacts?: string;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly outputMessages: number | 'all';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveTimestampPlaceholder(value: string): string {
  if (!value.includes('{timestamp}')) {
    return value;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return value.replaceAll('{timestamp}', timestamp);
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeWorkspaceMode(value: unknown): 'pooled' | 'temp' | 'static' | undefined {
  return value === 'pooled' || value === 'temp' || value === 'static' ? value : undefined;
}

/**
 * Normalize --output-messages value. Accepts a number (>= 1) or "all".
 * Defaults to 1 (last assistant message only).
 */
function normalizeOutputMessages(cliValue: string | undefined): number | 'all' {
  if (cliValue === undefined) {
    return 1;
  }
  if (cliValue === 'all') {
    return 'all';
  }
  const parsed = Number.parseInt(cliValue, 10);
  if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    console.warn(
      `Warning: Invalid --output-messages value '${cliValue}'. Must be a positive integer or 'all'. Defaulting to 1.`,
    );
    return 1;
  }
  return parsed;
}

/**
 * Trim output messages for results JSONL.
 * Each message is stripped to { role, content } only.
 *
 * - `1` (default): last assistant message only (legacy behavior)
 * - `N`: last N messages (any role)
 * - `'all'`: all messages
 */
export function trimOutputMessages(
  output: EvaluationResult['output'],
  outputMessages: number | 'all',
): EvaluationResult['output'] {
  const messages = output ?? [];

  if (outputMessages === 'all') {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  if (outputMessages === 1) {
    // Legacy behavior: last assistant message only
    const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1);
    return lastAssistant ? [{ role: lastAssistant.role, content: lastAssistant.content }] : [];
  }

  // Last N messages (any role), trimmed to { role, content }
  const sliced = messages.slice(-outputMessages);
  return sliced.map((m) => ({ role: m.role, content: m.content }));
}

function normalizeOptions(
  rawOptions: Record<string, unknown>,
  config?: Awaited<ReturnType<typeof loadTsConfig>>,
  yamlExecution?: ExecutionDefaults,
): NormalizedOptions {
  const cliFormat = normalizeString(rawOptions.outputFormat);
  const configFormat = config?.output?.format;
  const formatStr = cliFormat ?? configFormat ?? 'jsonl';
  const format: OutputFormat = formatStr === 'yaml' ? 'yaml' : 'jsonl';

  const cliWorkers = normalizeOptionalNumber(rawOptions.workers);
  const configWorkers = config?.execution?.workers;
  const workers = cliWorkers ?? configWorkers ?? 0;

  const rawOutputPaths = rawOptions.output;
  const outputPaths: string[] = Array.isArray(rawOutputPaths)
    ? rawOutputPaths.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];

  // Normalize --target: can be a string (legacy) or string[] (multioption)
  const rawTarget = rawOptions.target;
  let cliTargets: string[] = [];
  let singleTarget: string | undefined;
  if (Array.isArray(rawTarget)) {
    cliTargets = rawTarget.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    singleTarget = cliTargets.length === 1 ? cliTargets[0] : undefined;
  } else if (typeof rawTarget === 'string') {
    const trimmed = rawTarget.trim();
    if (trimmed.length > 0 && trimmed !== 'default') {
      cliTargets = [trimmed];
      singleTarget = trimmed;
    }
  }

  const cliAgentTimeout = normalizeOptionalNumber(rawOptions.agentTimeout);
  const configAgentTimeoutSeconds =
    config?.execution?.agentTimeoutMs != null ? config.execution.agentTimeoutMs / 1000 : undefined;

  const cliMaxRetries = normalizeOptionalNumber(rawOptions.maxRetries);
  const configMaxRetries = config?.execution?.maxRetries;

  // Cache: CLI flags take priority, then config file, then default (true via shouldEnableCache)
  const cliCache = normalizeBoolean(rawOptions.cache);
  const cliNoCache = normalizeBoolean(rawOptions.noCache);
  const configCacheEnabled = config?.cache?.enabled;
  // If neither --cache nor --no-cache was passed, use config value
  const resolvedCache = cliCache || (!cliNoCache && configCacheEnabled === true);
  const resolvedNoCache = cliNoCache;

  // Output dir: CLI --out > config output.dir > auto-generated
  const cliOut = normalizeString(rawOptions.out);
  const configOut = config?.output?.dir;
  const cliWorkspacePath = normalizeString(rawOptions.workspacePath);
  const cliWorkspaceModeRaw = normalizeString(rawOptions.workspaceMode);
  const cliWorkspaceMode = normalizeWorkspaceMode(rawOptions.workspaceMode);
  if (cliWorkspacePath && cliWorkspaceModeRaw && cliWorkspaceMode !== 'static') {
    throw new Error('--workspace-path requires --workspace-mode=static (or omit --workspace-mode)');
  }

  const yamlExecutionRecord = yamlExecution as Record<string, unknown> | undefined;
  const yamlWorkspaceMode = normalizeWorkspaceMode(yamlExecutionRecord?.workspace_mode);
  const yamlWorkspacePath = normalizeString(yamlExecutionRecord?.workspace_path);
  const workspacePath = cliWorkspacePath ?? yamlWorkspacePath;
  const workspaceMode = cliWorkspacePath ? 'static' : (cliWorkspaceMode ?? yamlWorkspaceMode);

  return {
    target: singleTarget,
    cliTargets,
    targetsPath: normalizeString(rawOptions.targets),
    filter: normalizeString(rawOptions.filter),
    workers: workers > 0 ? workers : undefined,
    outPath: cliOut ?? configOut,
    outputPaths,
    format,
    dryRun: normalizeBoolean(rawOptions.dryRun),
    dryRunDelay: normalizeNumber(rawOptions.dryRunDelay, 0),
    dryRunDelayMin: normalizeNumber(rawOptions.dryRunDelayMin, 0),
    dryRunDelayMax: normalizeNumber(rawOptions.dryRunDelayMax, 0),
    agentTimeoutSeconds: cliAgentTimeout ?? configAgentTimeoutSeconds,
    maxRetries: cliMaxRetries ?? configMaxRetries ?? 2,
    cache: resolvedCache,
    noCache: resolvedNoCache,
    // Boolean OR: config `true` cannot be overridden to `false` from CLI.
    // Intentional — there are no --no-verbose / --no-keep-workspaces flags.
    // Precedence: CLI > YAML config > TS config
    verbose:
      normalizeBoolean(rawOptions.verbose) ||
      yamlExecution?.verbose === true ||
      config?.execution?.verbose === true,
    // Precedence: CLI > YAML config > TS config
    otelFile:
      normalizeString(rawOptions.otelFile) ??
      (yamlExecution?.otel_file
        ? resolveTimestampPlaceholder(yamlExecution.otel_file)
        : undefined) ??
      (config?.execution?.otelFile
        ? resolveTimestampPlaceholder(config.execution.otelFile)
        : undefined),
    traceFile:
      normalizeString(rawOptions.traceFile) ??
      (yamlExecution?.trace_file
        ? resolveTimestampPlaceholder(yamlExecution.trace_file)
        : undefined) ??
      (config?.execution?.traceFile
        ? resolveTimestampPlaceholder(config.execution.traceFile)
        : undefined),
    exportOtel: normalizeBoolean(rawOptions.exportOtel) || yamlExecution?.export_otel === true,
    otelBackend: normalizeString(rawOptions.otelBackend) ?? yamlExecution?.otel_backend,
    otelCaptureContent:
      normalizeBoolean(rawOptions.otelCaptureContent) ||
      yamlExecution?.otel_capture_content === true,
    otelGroupTurns:
      normalizeBoolean(rawOptions.otelGroupTurns) || yamlExecution?.otel_group_turns === true,
    retryErrors: normalizeString(rawOptions.retryErrors),
    workspaceMode,
    workspacePath,
    benchmarkJson: normalizeString(rawOptions.benchmarkJson),
    artifacts: normalizeString(rawOptions.artifacts),
    graderTarget: normalizeString(rawOptions.graderTarget),
    model: normalizeString(rawOptions.model),
    outputMessages: normalizeOutputMessages(normalizeString(rawOptions.outputMessages)),
  } satisfies NormalizedOptions;
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

function buildDefaultOutputPath(cwd: string): string {
  const runDir = buildDefaultRunDir(cwd);
  mkdirSync(runDir, { recursive: true });
  return path.join(runDir, 'index.jsonl');
}

type ProgressReporter = {
  readonly isInteractive: boolean;
  start(): void;
  setTotal(total: number): void;
  update(workerId: number, progress: WorkerProgress): void;
  finish(): void;
  addLogPaths(paths: readonly string[], provider?: 'codex' | 'pi' | 'copilot'): void;
};

function createProgressReporter(
  maxWorkers: number,
  options?: { verbose?: boolean },
): ProgressReporter {
  const display = new ProgressDisplay(maxWorkers, options);
  return {
    isInteractive: display.isInteractiveMode(),
    start: () => display.start(),
    setTotal: (total: number) => display.setTotalTests(total),
    update: (workerId: number, progress: WorkerProgress) =>
      display.updateWorker({ ...progress, workerId }),
    finish: () => display.finish(),
    addLogPaths: (paths: readonly string[], provider?: 'codex' | 'pi' | 'copilot') =>
      display.addLogPaths(paths, provider),
  };
}

function makeEvalKey(testFilePath: string, evalId: string): string {
  return `${path.resolve(testFilePath)}::${evalId}`;
}

function createDisplayIdTracker(): { getOrAssign(evalKey: string): number } {
  const map = new Map<string, number>();
  let nextId = 1;
  return {
    getOrAssign(evalKey: string): number {
      const existing = map.get(evalKey);
      if (existing !== undefined) {
        return existing;
      }
      const assigned = nextId++;
      map.set(evalKey, assigned);
      return assigned;
    },
  };
}

/**
 * Extract the model name from a resolved target, if available.
 * Azure uses `deploymentName`; most other providers use `model`.
 * CLI and mock providers have no model field.
 */
function extractModelName(target: ResolvedTarget): string | undefined {
  if (target.kind === 'azure') {
    return target.config.deploymentName;
  }
  if ('model' in target.config && typeof target.config.model === 'string') {
    return target.config.model;
  }
  return undefined;
}

/**
 * Build the inline label suffix (e.g. `[provider=azure, model=gpt-4]`).
 */
function buildTargetLabelSuffix(providerLabel: string, target: ResolvedTarget): string {
  const parts = [`provider=${providerLabel}`];
  const model = extractModelName(target);
  if (model) parts.push(`model=${model}`);
  return `[${parts.join(', ')}]`;
}

/**
 * Override CLI provider verbose setting based on CLI --verbose flag.
 * CLI provider logs should only appear when --verbose is passed.
 */
function applyVerboseOverride(selection: TargetSelection, cliVerbose: boolean): TargetSelection {
  const { resolvedTarget } = selection;

  // Only CLI providers have a verbose setting in their config
  if (resolvedTarget.kind !== 'cli') {
    return selection;
  }

  // Set verbose to match CLI --verbose flag
  return {
    ...selection,
    resolvedTarget: {
      ...resolvedTarget,
      config: {
        ...resolvedTarget.config,
        verbose: cliVerbose,
      },
    },
  };
}

async function prepareFileMetadata(params: {
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly options: NormalizedOptions;
}): Promise<{
  readonly evalIds: readonly string[];
  readonly evalCases: readonly EvalTest[];
  readonly selections: readonly { selection: TargetSelection; inlineTargetLabel: string }[];
  readonly trialsConfig?: TrialsConfig;
  readonly suiteTargets?: readonly string[];
  readonly yamlWorkers?: number;
  readonly yamlCache?: boolean;
  readonly yamlCachePath?: string;
  readonly totalBudgetUsd?: number;
  readonly failOnError?: FailOnError;
}> {
  const { testFilePath, repoRoot, cwd, options } = params;

  await ensureFileExists(testFilePath, 'Test file');
  await loadEnvFromHierarchy({
    testFilePath,
    repoRoot,
    verbose: options.verbose,
  });

  const suite = await loadTestSuite(testFilePath, repoRoot, {
    verbose: options.verbose,
    filter: options.filter,
  });
  const filteredIds = suite.tests.map((value) => value.id);

  // Determine target names: CLI --target flags override YAML
  const cliTargets = options.cliTargets;
  const suiteTargets = suite.targets;

  // Resolve which target names to use (precedence: CLI > YAML targets > YAML target > default)
  let targetNames: readonly string[];
  if (cliTargets.length > 0) {
    targetNames = cliTargets;
  } else if (suiteTargets && suiteTargets.length > 0) {
    targetNames = suiteTargets;
  } else {
    targetNames = [];
  }

  let selections: { selection: TargetSelection; inlineTargetLabel: string }[];

  if (targetNames.length > 1) {
    // Matrix mode: multiple targets
    const multiSelections = await selectMultipleTargets({
      testFilePath,
      repoRoot,
      cwd,
      explicitTargetsPath: options.targetsPath,
      dryRun: options.dryRun,
      dryRunDelay: options.dryRunDelay,
      dryRunDelayMin: options.dryRunDelayMin,
      dryRunDelayMax: options.dryRunDelayMax,
      env: process.env,
      targetNames,
    });

    selections = multiSelections.map((sel) => ({
      selection: sel,
      inlineTargetLabel: sel.targetName,
    }));
  } else {
    // Single target mode (legacy path)
    const selection = await selectTarget({
      testFilePath,
      repoRoot,
      cwd,
      explicitTargetsPath: options.targetsPath,
      cliTargetName: targetNames.length === 1 ? targetNames[0] : options.target,
      dryRun: options.dryRun,
      dryRunDelay: options.dryRunDelay,
      dryRunDelayMin: options.dryRunDelayMin,
      dryRunDelayMax: options.dryRunDelayMax,
      env: process.env,
    });

    selections = [
      {
        selection,
        inlineTargetLabel: selection.targetName,
      },
    ];
  }

  return {
    evalIds: filteredIds,
    evalCases: suite.tests,
    selections,
    trialsConfig: suite.trials,
    suiteTargets,
    yamlWorkers: suite.workers,
    yamlCache: suite.cacheConfig?.enabled,
    yamlCachePath: suite.cacheConfig?.cachePath,
    totalBudgetUsd: suite.totalBudgetUsd,
    failOnError: suite.failOnError,
  };
}

async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const safeLimit = Math.max(1, limit);
  let index = 0;

  const workers = Array.from({ length: safeLimit }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await task(current);
    }
  });

  await Promise.all(workers);
}

async function runSingleEvalFile(params: {
  readonly testFilePath: string;
  readonly cwd: string;
  readonly repoRoot: string;
  readonly options: NormalizedOptions;
  readonly outputWriter: OutputWriter;
  readonly otelExporter?: OtelTraceExporterType | null;
  readonly cache?: EvaluationCache;
  readonly evaluationRunner: typeof defaultRunEvaluation;
  readonly workersOverride?: number;
  readonly yamlWorkers?: number;
  readonly progressReporter: ProgressReporter;
  readonly seenEvalCases: Set<string>;
  readonly displayIdTracker: { getOrAssign(evalKey: string): number };
  readonly selection: TargetSelection;
  readonly inlineTargetLabel: string;
  readonly evalCases: readonly EvalTest[];
  readonly trialsConfig?: TrialsConfig;
  readonly matrixMode?: boolean;
  readonly totalBudgetUsd?: number;
  readonly failOnError?: FailOnError;
}): Promise<{ results: EvaluationResult[] }> {
  const {
    testFilePath,
    cwd,
    repoRoot,
    options,
    outputWriter,
    otelExporter,
    cache,
    evaluationRunner,
    workersOverride,
    yamlWorkers,
    progressReporter,
    seenEvalCases,
    displayIdTracker,
    selection,
    inlineTargetLabel,
    evalCases,
    trialsConfig,
    matrixMode,
    totalBudgetUsd,
    failOnError,
  } = params;

  const targetName = selection.targetName;

  await ensureFileExists(testFilePath, 'Test file');

  // CLI provider verbose logging should only be enabled when --verbose flag is passed
  const resolvedTargetSelection = applyVerboseOverride(selection, options.verbose);
  const providerLabel = options.dryRun
    ? `${resolvedTargetSelection.resolvedTarget.kind} (dry-run)`
    : resolvedTargetSelection.resolvedTarget.kind;
  const targetMessage = options.verbose
    ? `Using target (${resolvedTargetSelection.targetSource}): ${resolvedTargetSelection.targetName} ${buildTargetLabelSuffix(providerLabel, resolvedTargetSelection.resolvedTarget)} via ${resolvedTargetSelection.targetsFilePath}`
    : `Using target: ${inlineTargetLabel}`;
  if (!progressReporter.isInteractive || options.verbose) {
    console.log(targetMessage);
  }

  const agentTimeoutMs =
    options.agentTimeoutSeconds != null
      ? Math.max(0, options.agentTimeoutSeconds) * 1000
      : undefined;

  // Resolve workers: CLI flag > eval YAML execution.workers > target setting > default
  const workerPreference = workersOverride ?? options.workers;
  let resolvedWorkers =
    workerPreference ??
    yamlWorkers ??
    resolvedTargetSelection.resolvedTarget.workers ??
    DEFAULT_WORKERS;
  if (resolvedWorkers < 1 || resolvedWorkers > 50) {
    throw new Error(`Workers must be between 1 and 50, got: ${resolvedWorkers}`);
  }

  // VSCode providers require window focus, so only 1 worker is allowed
  const isVSCodeProvider = ['vscode', 'vscode-insiders'].includes(
    resolvedTargetSelection.resolvedTarget.kind,
  );
  if (isVSCodeProvider && resolvedWorkers > 1) {
    console.warn(
      `Warning: VSCode providers require window focus. Limiting workers from ${resolvedWorkers} to 1 to prevent race conditions.`,
    );
    resolvedWorkers = 1;
  }

  // Auto-provision subagents for VSCode targets
  if (isVSCodeProvider && !options.dryRun) {
    const vsConfig = resolvedTargetSelection.resolvedTarget.config as { executable?: string };
    await ensureVSCodeSubagents({
      kind: resolvedTargetSelection.resolvedTarget.kind as 'vscode' | 'vscode-insiders',
      count: resolvedWorkers,
      verbose: options.verbose,
      vscodeCmd: vsConfig.executable,
    });
  }

  // Use streaming spans only for live remote export. File exports should use
  // post-hoc exportResult(result), which has the complete EvaluationResult and
  // avoids cross-test interleaving issues under parallel execution.
  const useStreamingObserver = !!(otelExporter && options.exportOtel);
  const streamingObserver = useStreamingObserver
    ? (otelExporter?.createStreamingObserver() ?? null)
    : null;
  const results = await evaluationRunner({
    testFilePath,
    repoRoot,
    target: resolvedTargetSelection.resolvedTarget,
    targets: resolvedTargetSelection.definitions,
    env: process.env,
    maxRetries: Math.max(0, options.maxRetries),
    agentTimeoutMs,
    cache,
    useCache: (() => {
      // Skip cache if not enabled
      if (!cache) return false;
      // Skip cache when target has temperature > 0 (non-deterministic)
      const targetConfig = resolvedTargetSelection.resolvedTarget.config as Record<string, unknown>;
      if (shouldSkipCacheForTemperature(targetConfig)) {
        if (options.verbose) {
          console.log('Cache skipped: target temperature > 0');
        }
        return false;
      }
      return true;
    })(),
    evalCases,
    verbose: options.verbose,
    maxConcurrency: resolvedWorkers,
    workspaceMode: options.workspaceMode,
    workspacePath: options.workspacePath,
    trials: trialsConfig,
    totalBudgetUsd,
    failOnError,
    graderTarget: options.graderTarget,
    model: options.model,
    streamCallbacks: streamingObserver?.getStreamCallbacks(),
    onResult: async (result: EvaluationResult) => {
      (
        streamingObserver as { completeFromResult?: (result: EvaluationResult) => void } | null
      )?.completeFromResult?.(result);
      // Finalize streaming observer span with score
      streamingObserver?.finalizeEvalCase(result.score, result.error);

      // Trim output messages for results JSONL based on --output-messages.
      // Each message is trimmed to { role, content } only (no toolCalls, startTime, etc.).
      // Full output with tool calls goes to OTel.
      const trimmedOutput = trimOutputMessages(result.output, options.outputMessages);
      const trimmedResult: EvaluationResult = {
        ...result,
        output: trimmedOutput,
      };
      await outputWriter.append(trimmedResult);

      // Export to OTel if exporter is configured (skip batch export when streaming is active)
      if (otelExporter && !streamingObserver) {
        try {
          await otelExporter.exportResult(result);
        } catch (err) {
          // Export failures don't fail the evaluation
          if (options.verbose) {
            console.warn(
              `OTel export warning: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    },
    onProgress: async (event) => {
      const evalKeyId = matrixMode ? `${event.testId}@${targetName}` : event.testId;
      const evalKey = makeEvalKey(testFilePath, evalKeyId);
      if (event.status === 'pending' && !seenEvalCases.has(evalKey)) {
        seenEvalCases.add(evalKey);
        progressReporter.setTotal(seenEvalCases.size);
      }
      const displayId = displayIdTracker.getOrAssign(evalKey);

      // Start streaming observer when eval case begins execution
      if (event.status === 'running' && streamingObserver) {
        streamingObserver.startEvalCase(event.testId, targetName, testFilePath);
      }

      // Map executionStatus to verdict for display
      let verdict: Verdict | undefined;
      if (event.executionStatus === 'ok') verdict = 'PASS';
      else if (event.executionStatus === 'quality_failure') verdict = 'FAIL';
      else if (event.executionStatus === 'execution_error') verdict = 'ERROR';

      progressReporter.update(displayId, {
        workerId: displayId,
        testId: matrixMode ? `${event.testId}@${targetName}` : event.testId,
        status: event.status,
        startedAt: event.startedAt,
        completedAt: event.completedAt,
        error: event.error,
        targetLabel: inlineTargetLabel,
        score: event.score,
        verdict,
      });
    },
  });

  return { results: [...results] };
}

export interface RunEvalResult {
  readonly executionErrorCount: number;
  readonly outputPath: string;
  readonly testFiles: readonly string[];
  readonly target?: string;
}

export async function runEvalCommand(
  input: RunEvalCommandInput,
): Promise<RunEvalResult | undefined> {
  const cwd = process.cwd();

  // Load agentv.config.ts (if present) for default values
  let config: Awaited<ReturnType<typeof loadTsConfig>> = null;
  try {
    config = await loadTsConfig(cwd);
  } catch (err) {
    console.warn(
      `Warning: Failed to load agentv config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const repoRoot = await findRepoRoot(cwd);

  // Load .agentv/config.yaml for execution defaults.
  // loadConfig expects an eval file path and walks up from its directory.
  // Pass a dummy file in cwd so the search starts from the working directory.
  const yamlConfig = await loadConfig(path.join(cwd, '_'), repoRoot);

  // Check required_version before proceeding with eval
  if (yamlConfig?.required_version) {
    await enforceRequiredVersion(yamlConfig.required_version, {
      strict: normalizeBoolean(input.rawOptions.strict),
    });
  }

  let options = normalizeOptions(input.rawOptions, config, yamlConfig?.execution);

  // Validate --grader-target / --model combinations
  if (options.graderTarget === 'agentv' && !options.model) {
    throw new Error('--grader-target agentv requires --model (e.g., --model openai:gpt-5-mini)');
  }

  // --retry-errors: override filter to only re-run execution_error test cases.
  // IMPORTANT: JSONL must be fully loaded here, before the output writer is created below,
  // since the retry source and output destination may refer to the same file.
  let retryNonErrorResults: readonly EvaluationResult[] | undefined;
  if (options.retryErrors) {
    const retryPath = path.resolve(options.retryErrors);
    await ensureFileExists(retryPath, 'Retry-errors JSONL file');
    const errorIds = await loadErrorTestIds(retryPath);
    if (errorIds.length === 0) {
      console.log('No execution errors found in the previous output. Nothing to retry.');
      return;
    }
    console.log(`Retrying ${errorIds.length} execution-error test(s): ${errorIds.join(', ')}`);
    // Override the filter to match only error test IDs using micromatch brace expansion
    const filterPattern = errorIds.length === 1 ? errorIds[0] : `{${errorIds.join(',')}}`;
    options = { ...options, filter: filterPattern };
    retryNonErrorResults = await loadNonErrorResults(retryPath);
  }

  // Validate static workspace path exists and is a directory
  if (options.workspacePath) {
    const resolvedWorkspace = path.resolve(options.workspacePath);
    try {
      const { stat } = await import('node:fs/promises');
      const stats = await stat(resolvedWorkspace);
      if (!stats.isDirectory()) {
        throw new Error(`--workspace-path is not a directory: ${resolvedWorkspace}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`--workspace-path does not exist: ${resolvedWorkspace}`);
      }
      throw err;
    }
    options = { ...options, workspacePath: resolvedWorkspace };
  }

  if (options.verbose) {
    console.log(`Repository root: ${repoRoot}`);
  }

  const usesDefaultArtifactWorkspace = !options.outPath;
  const outputPath = options.outPath ? path.resolve(options.outPath) : buildDefaultOutputPath(cwd);
  const defaultTraceFile =
    usesDefaultArtifactWorkspace && !options.traceFile
      ? path.join(path.dirname(outputPath), 'trace.jsonl')
      : undefined;
  const traceFilePath = options.traceFile ? path.resolve(options.traceFile) : defaultTraceFile;

  // Initialize OTel exporter if --export-otel flag is set or file export flags are used
  let otelExporter: OtelTraceExporterType | null = null;
  const useFileExport = !!(options.otelFile || traceFilePath);

  if (options.exportOtel || useFileExport) {
    try {
      const { OtelTraceExporter, OTEL_BACKEND_PRESETS } = await import('@agentv/core');

      // Resolve endpoint and headers
      let endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      let headers: Record<string, string> = {};

      if (options.otelBackend) {
        const preset = OTEL_BACKEND_PRESETS[options.otelBackend];
        if (preset) {
          endpoint = preset.endpoint;
          headers = preset.headers(process.env);
        } else {
          console.warn(`Unknown OTel backend preset: ${options.otelBackend}`);
        }
      }

      // Parse OTEL_EXPORTER_OTLP_HEADERS env var
      if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
        for (const pair of process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',')) {
          const [key, ...rest] = pair.split('=');
          if (key) headers[key.trim()] = rest.join('=').trim();
        }
      }

      const captureContent =
        options.otelCaptureContent || process.env.AGENTV_OTEL_CAPTURE_CONTENT === 'true';

      otelExporter = new OtelTraceExporter({
        endpoint,
        headers,
        captureContent,
        groupTurns: options.otelGroupTurns,
        otlpFilePath: options.otelFile ? path.resolve(options.otelFile) : undefined,
        traceFilePath,
      });

      const initialized = await otelExporter.init();
      if (!initialized) {
        console.warn(
          'OTel export requested but @opentelemetry packages not available. Install them to enable export.',
        );
        otelExporter = null;
      }
    } catch (err) {
      console.warn(
        `OTel export initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      otelExporter = null;
    }
  }

  const primaryWritePath = usesDefaultArtifactWorkspace
    ? path.join(path.dirname(outputPath), LEGACY_RESULTS_FILENAME)
    : outputPath;

  // Resolve -o / --output paths (new multi-format support)
  const extraOutputPaths = options.outputPaths.map((p) => path.resolve(p));

  // Build the primary output writer (from --out / default)
  // When extra --output paths are provided, combine all into a multi-writer
  const allOutputPaths =
    extraOutputPaths.length > 0 ? [primaryWritePath, ...extraOutputPaths] : [primaryWritePath];
  const uniqueOutputPaths = [...new Set(allOutputPaths)];
  const reportedOutputPaths =
    extraOutputPaths.length > 0 ? [outputPath, ...extraOutputPaths] : [outputPath];
  const uniqueReportedOutputPaths = [...new Set(reportedOutputPaths)];

  let outputWriter: OutputWriter;
  if (uniqueOutputPaths.length === 1) {
    outputWriter = await createOutputWriter(primaryWritePath, options.format);
    console.log(`Output path: ${outputPath}`);
  } else {
    outputWriter = await createMultiWriter(uniqueOutputPaths);
    console.log('Output paths:');
    for (const p of uniqueReportedOutputPaths) {
      console.log(`  ${p}`);
    }
  }

  // Log file export paths
  const resolvedTestFiles = input.testFiles.map((file) => path.resolve(file));
  if (options.otelFile) {
    console.log(`OTLP JSON file: ${path.resolve(options.otelFile)}`);
  }
  if (traceFilePath) {
    console.log(`Trace file: ${traceFilePath}`);
  }

  // Determine cache state after loading file metadata (need YAML config)
  // We defer cache creation until after file metadata is loaded
  const evaluationRunner = await resolveEvaluationRunner();
  const allResults: EvaluationResult[] = [];
  const seenEvalCases = new Set<string>();
  const displayIdTracker = createDisplayIdTracker();

  // Derive file-level concurrency from worker count (global) when provided
  const totalWorkers = options.workers ?? DEFAULT_WORKERS;
  const fileConcurrency = Math.min(
    Math.max(1, totalWorkers),
    Math.max(1, resolvedTestFiles.length),
  );
  const perFileWorkers = options.workers
    ? Math.max(1, Math.floor(totalWorkers / fileConcurrency))
    : undefined;
  const fileMetadata = new Map<
    string,
    {
      readonly evalIds: readonly string[];
      readonly evalCases: readonly EvalTest[];
      readonly selections: readonly {
        selection: TargetSelection;
        inlineTargetLabel: string;
      }[];
      readonly trialsConfig?: TrialsConfig;
      readonly suiteTargets?: readonly string[];
      readonly yamlWorkers?: number;
      readonly yamlCache?: boolean;
      readonly yamlCachePath?: string;
      readonly totalBudgetUsd?: number;
      readonly failOnError?: FailOnError;
    }
  >();
  // Separate TypeScript/JS eval files from YAML files.
  // TS files are self-contained scripts that call evaluate() directly.
  const tsFiles: string[] = [];
  const yamlFiles: string[] = [];
  for (const testFilePath of resolvedTestFiles) {
    if (/\.(ts|js|mts|mjs)$/.test(testFilePath)) {
      tsFiles.push(testFilePath);
    } else {
      yamlFiles.push(testFilePath);
    }
  }

  // Run TypeScript eval files by importing them.
  // evaluate() runs during import via top-level await and handles its own output.
  for (const tsFile of tsFiles) {
    await ensureFileExists(tsFile, 'TypeScript eval file');
    await import(pathToFileURL(tsFile).href);
  }

  // If only TS files were provided, we're done — evaluate() handled everything.
  if (yamlFiles.length === 0 && tsFiles.length > 0) {
    return;
  }

  for (const testFilePath of yamlFiles) {
    const meta = await prepareFileMetadata({
      testFilePath,
      repoRoot,
      cwd,
      options,
    });
    fileMetadata.set(testFilePath, meta);
  }

  // Resolve cache: combine CLI flags with YAML config
  // Use first file's YAML config for cache settings (consistent across a run)
  const firstMeta = fileMetadata.values().next().value;
  const yamlCacheEnabled = firstMeta?.yamlCache;
  const yamlCachePath = firstMeta?.yamlCachePath;
  const cacheEnabled = shouldEnableCache({
    cliCache: options.cache,
    cliNoCache: options.noCache,
    yamlCache: yamlCacheEnabled,
  });
  const cache = cacheEnabled
    ? new ResponseCache(yamlCachePath ? path.resolve(yamlCachePath) : undefined)
    : undefined;
  const useCache = cacheEnabled;

  if (cacheEnabled) {
    console.log(`Response cache: enabled${yamlCachePath ? ` (${yamlCachePath})` : ''}`);
  }

  // Detect matrix mode: multiple targets for any file
  const isMatrixMode = Array.from(fileMetadata.values()).some((meta) => meta.selections.length > 1);

  // In matrix mode, total eval count is tests × targets (accounting for per-test target overrides)
  let totalEvalCount = 0;
  for (const meta of fileMetadata.values()) {
    const suiteTargetNames = meta.selections.map((s) => s.selection.targetName);
    for (const test of meta.evalCases) {
      // Per-test targets override suite-level targets
      const testTargetNames =
        test.targets && test.targets.length > 0
          ? test.targets.filter((t) => suiteTargetNames.includes(t))
          : suiteTargetNames;
      totalEvalCount += testTargetNames.length > 0 ? testTargetNames.length : 1;
    }
  }

  if (totalEvalCount === 0) {
    throw new Error('No tests matched the provided filters.');
  }
  const progressReporter = createProgressReporter(totalWorkers, { verbose: options.verbose });
  progressReporter.start();
  progressReporter.setTotal(totalEvalCount);
  const seenCodexLogPaths = new Set<string>();
  const unsubscribeCodexLogs = subscribeToCodexLogEntries((entry) => {
    if (!entry.filePath || seenCodexLogPaths.has(entry.filePath)) {
      return;
    }
    seenCodexLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath], 'codex');
  });
  const seenPiLogPaths = new Set<string>();
  const unsubscribePiLogs = subscribeToPiLogEntries((entry) => {
    if (!entry.filePath || seenPiLogPaths.has(entry.filePath)) {
      return;
    }
    seenPiLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath], 'pi');
  });
  const seenCopilotLogPaths = new Set<string>();
  const unsubscribeCopilotSdkLogs = subscribeToCopilotSdkLogEntries((entry) => {
    if (!entry.filePath || seenCopilotLogPaths.has(entry.filePath)) {
      return;
    }
    seenCopilotLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath], 'copilot');
  });
  const unsubscribeCopilotCliLogs = subscribeToCopilotCliLogEntries((entry) => {
    if (!entry.filePath || seenCopilotLogPaths.has(entry.filePath)) {
      return;
    }
    seenCopilotLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath], 'copilot');
  });
  for (const [testFilePath, meta] of fileMetadata.entries()) {
    for (const { selection, inlineTargetLabel } of meta.selections) {
      for (const testId of meta.evalIds) {
        const evalKey = makeEvalKey(
          testFilePath,
          meta.selections.length > 1 ? `${testId}@${selection.targetName}` : testId,
        );
        seenEvalCases.add(evalKey);
        const displayId = displayIdTracker.getOrAssign(evalKey);
        progressReporter.update(displayId, {
          workerId: displayId,
          testId: meta.selections.length > 1 ? `${testId}@${selection.targetName}` : testId,
          status: 'pending',
          targetLabel: inlineTargetLabel,
        });
      }
    }
  }

  try {
    await runWithLimit(resolvedTestFiles, fileConcurrency, async (testFilePath) => {
      const targetPrep = fileMetadata.get(testFilePath);
      if (!targetPrep) {
        throw new Error(`Missing metadata for ${testFilePath}`);
      }

      // Run all targets concurrently (each target has its own worker limit)
      const targetResults = await Promise.all(
        targetPrep.selections.map(async ({ selection, inlineTargetLabel }) => {
          // Filter eval cases to those applicable to this target
          const targetName = selection.targetName;
          const applicableEvalCases =
            targetPrep.selections.length > 1
              ? targetPrep.evalCases.filter((test) => {
                  if (test.targets && test.targets.length > 0) {
                    return test.targets.includes(targetName);
                  }
                  return true;
                })
              : targetPrep.evalCases;

          if (applicableEvalCases.length === 0) {
            return [];
          }

          const result = await runSingleEvalFile({
            testFilePath,
            cwd,
            repoRoot,
            options,
            outputWriter,
            otelExporter,
            cache,
            evaluationRunner,
            workersOverride: perFileWorkers,
            yamlWorkers: targetPrep.yamlWorkers,
            progressReporter,
            seenEvalCases,
            displayIdTracker,
            selection,
            inlineTargetLabel,
            evalCases: applicableEvalCases,
            trialsConfig: targetPrep.trialsConfig,
            matrixMode: targetPrep.selections.length > 1,
            totalBudgetUsd: targetPrep.totalBudgetUsd,
            failOnError: targetPrep.failOnError,
          });

          return result.results;
        }),
      );
      for (const results of targetResults) {
        allResults.push(...results);
      }
    });

    progressReporter.finish();

    // Merge non-error results from previous run when using --retry-errors
    if (retryNonErrorResults && retryNonErrorResults.length > 0) {
      for (const preserved of retryNonErrorResults) {
        await outputWriter.append(preserved);
      }
      allResults.push(...retryNonErrorResults);
      console.log(
        `Merged ${retryNonErrorResults.length} non-error result(s) from previous output.`,
      );
    }

    const summary = calculateEvaluationSummary(allResults);
    console.log(formatEvaluationSummary(summary));

    // Print matrix summary when multiple targets were evaluated
    if (isMatrixMode && allResults.length > 0) {
      console.log(formatMatrixSummary(allResults));
    }

    // Write Agent Skills benchmark.json if requested
    if (options.benchmarkJson && allResults.length > 0) {
      const benchmarkPath = path.resolve(options.benchmarkJson);
      await writeBenchmarkJson(benchmarkPath, allResults);
      console.log(`Benchmark written to: ${benchmarkPath}`);
    }

    if (usesDefaultArtifactWorkspace) {
      const evalFile = resolvedTestFiles.length === 1 ? resolvedTestFiles[0] : '';
      const workspaceDir = path.dirname(outputPath);
      const {
        testArtifactDir,
        timingPath,
        benchmarkPath: workspaceBenchmarkPath,
        indexPath,
        legacyResultsPath,
      } = await writeArtifactsFromResults(allResults, workspaceDir, {
        evalFile,
        writeLegacyResults: true,
      });
      console.log(`Artifact workspace written to: ${workspaceDir}`);
      console.log(`  Index: ${indexPath}`);
      console.log(
        `  Per-test artifacts: ${testArtifactDir} (${allResults.length} test directories)`,
      );
      console.log(`  Timing: ${timingPath}`);
      console.log(`  Benchmark: ${workspaceBenchmarkPath}`);
      if (legacyResultsPath) {
        console.log(`  Compatibility output: ${legacyResultsPath} (deprecated)`);
      }
    }

    // Write companion artifacts (grading, timing, benchmark) if requested
    if (options.artifacts) {
      const artifactsDir = path.resolve(options.artifacts);
      const evalFile = resolvedTestFiles.length === 1 ? resolvedTestFiles[0] : '';
      const {
        testArtifactDir,
        indexPath,
        timingPath,
        benchmarkPath: abp,
      } = await writeArtifactsFromResults(allResults, artifactsDir, {
        evalFile,
        writeLegacyResults: false,
      });
      console.log(`Artifacts written to: ${artifactsDir}`);
      console.log(`  Index: ${indexPath}`);
      console.log(
        `  Per-test artifacts: ${testArtifactDir} (${allResults.length} test directories)`,
      );
      console.log(`  Timing:  ${timingPath}`);
      console.log(`  Benchmark: ${abp}`);
    }

    // Print workspace paths for failed cases (when preserved for debugging)
    const failedWithWorkspaces = allResults.filter(
      (r) => r.workspacePath && (r.error || r.score < 0.5),
    );
    if (failedWithWorkspaces.length > 0) {
      console.log('\nWorkspaces preserved for debugging:');
      for (const result of failedWithWorkspaces) {
        console.log(`  ${result.testId}: ${result.workspacePath}`);
      }
    }

    if (allResults.length > 0) {
      if (uniqueReportedOutputPaths.length === 1) {
        console.log(`\nResults written to: ${outputPath}`);
      } else {
        console.log('\nResults written to:');
        for (const p of uniqueReportedOutputPaths) {
          console.log(`  ${p}`);
        }
      }

      // Persist last run path for `agentv results` commands
      await saveRunCache(cwd, outputPath).catch(() => undefined);
    }

    // Suggest retry-errors command when execution errors are detected
    if (summary.executionErrorCount > 0 && !options.retryErrors) {
      const evalFileArgs = resolvedTestFiles.map((f) => path.relative(cwd, f)).join(' ');
      const targetFlag = options.target ? ` --target ${options.target}` : '';
      const relativeOutputPath = path.relative(cwd, outputPath);
      console.log(
        `\nTip: ${summary.executionErrorCount} execution error(s) detected. Re-run failed tests with:\n` +
          `  agentv eval run ${evalFileArgs}${targetFlag} --retry-errors ${relativeOutputPath}`,
      );
    }

    return {
      executionErrorCount: summary.executionErrorCount,
      outputPath,
      testFiles: resolvedTestFiles,
      target: options.target,
    };
  } finally {
    unsubscribeCodexLogs();
    unsubscribePiLogs();
    unsubscribeCopilotSdkLogs();
    unsubscribeCopilotCliLogs();
    await outputWriter.close().catch(() => undefined);
    if (otelExporter) {
      try {
        await otelExporter.shutdown();
      } catch {
        // Silently ignore shutdown errors
      }
    }
  }
}

async function resolveEvaluationRunner(): Promise<typeof defaultRunEvaluation> {
  const overridePath = process.env.AGENTEVO_CLI_EVAL_RUNNER;
  if (!overridePath) {
    return defaultRunEvaluation;
  }

  const resolved = path.isAbsolute(overridePath)
    ? overridePath
    : path.resolve(process.cwd(), overridePath);

  const moduleUrl = pathToFileURL(resolved).href;
  const mod = await import(moduleUrl);
  const candidate = mod.runEvaluation;
  if (typeof candidate !== 'function') {
    throw new Error(
      `Module '${resolved}' must export a 'runEvaluation' function to override the default implementation`,
    );
  }
  return candidate as typeof defaultRunEvaluation;
}
