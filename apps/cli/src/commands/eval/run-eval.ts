import { constants, existsSync, mkdirSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_THRESHOLD,
  type EvalTest,
  type EvaluationCache,
  type EvaluationResult,
  type ExecutionDefaults,
  type FailOnError,
  type OtelTraceExporter as OtelTraceExporterType,
  type ResolvedTarget,
  ResponseCache,
  RunBudgetTracker,
  type TrialsConfig,
  runEvaluation as defaultRunEvaluation,
  deriveCategory,
  ensureVSCodeSubagents,
  loadConfig,
  loadTestSuite,
  loadTsConfig,
  resolveTargetDefinition,
  runPreRunHook,
  shouldEnableCache,
  shouldSkipCacheForTemperature,
  subscribeToCodexLogEntries,
  subscribeToCopilotCliLogEntries,
  subscribeToCopilotSdkLogEntries,
  subscribeToPiLogEntries,
} from '@agentv/core';

import { enforceRequiredVersion } from '../../version-check.js';
import { maybeAutoExportRunArtifacts } from '../results/remote.js';
import {
  aggregateRunDir,
  buildTestTargetKey,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  writeArtifactsFromResults,
} from './artifact-writer.js';
import { writeBenchmarkJson } from './benchmark-writer.js';
import { loadEnvFromHierarchy } from './env.js';
import { type OutputWriter, createOutputWriter, createWriterFromPath } from './output-writer.js';
import { ProgressDisplay, type Verdict, type WorkerProgress } from './progress-display.js';
import { buildDefaultRunDir, normalizeExperimentName } from './result-layout.js';
import {
  buildExclusionFilter,
  loadErrorTestIds,
  loadFullyCompletedTestIds,
  loadNonErrorResults,
} from './retry-errors.js';
import { saveRunCache } from './run-cache.js';
import { findRepoRoot } from './shared.js';
import {
  calculateEvaluationSummary,
  formatEvaluationSummary,
  formatMatrixSummary,
} from './statistics.js';
import { type TargetSelection, selectMultipleTargets, selectTarget } from './targets.js';

const DEFAULT_WORKERS = 3;

function shouldSkipExistingResultForResume(
  result: Pick<EvaluationResult, 'executionStatus'>,
  rerunFailed: boolean,
): boolean {
  if (rerunFailed) {
    return result.executionStatus === 'ok';
  }
  return result.executionStatus !== 'execution_error';
}

interface RunEvalCommandInput {
  readonly testFiles: readonly string[];
  readonly rawOptions: Record<string, unknown>;
}

interface NormalizedOptions {
  readonly target?: string;
  readonly cliTargets: readonly string[];
  readonly targetsPath?: string;
  readonly filter?: string | readonly string[];
  readonly workers?: number;
  /** --output <dir>: artifact directory (new canonical meaning) */
  readonly outputDir?: string;
  /** Legacy --out <path>: deprecated, treated as artifact dir */
  readonly outPath?: string;
  /** --export <paths...>: additional output files */
  readonly exportPaths: readonly string[];
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
  readonly exportOtel: boolean;
  readonly otelBackend?: string;
  readonly otelCaptureContent: boolean;
  readonly otelGroupTurns: boolean;
  readonly retryErrors?: string;
  readonly resume: boolean;
  readonly rerunFailed: boolean;
  readonly workspaceMode?: 'pooled' | 'temp' | 'static';
  readonly workspacePath?: string;
  readonly keepWorkspaces: boolean;
  /** Deprecated: benchmark.json is always written to artifact dir */
  readonly benchmarkJson?: string;
  /** Deprecated: use --output instead */
  readonly artifacts?: string;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly outputMessages: number | 'all';
  readonly threshold?: number;
  readonly tags: readonly string[];
  readonly excludeTags: readonly string[];
  readonly transcript?: string;
  readonly experiment?: string;
  readonly budgetUsd?: number;
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

function normalizeStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  return [];
}

function normalizeFilter(value: unknown): string | readonly string[] | undefined {
  if (Array.isArray(value)) {
    const filters = normalizeStringArray(value);
    if (filters.length === 0) {
      return undefined;
    }
    return filters.length === 1 ? filters[0] : filters;
  }

  return normalizeString(value);
}

/**
 * Check whether an eval file's tags satisfy --tag / --exclude-tag filters.
 *
 * - `--tag X` means the file must have tag X (AND logic: all specified tags must be present)
 * - `--exclude-tag X` means the file must NOT have tag X (AND logic: none of the specified tags may be present)
 * - When both are used, both conditions must hold.
 * - Files without tags are excluded when --tag is specified, but included when only --exclude-tag is specified.
 */
export function matchesTagFilters(
  fileTags: readonly string[] | undefined,
  includeTags: readonly string[],
  excludeTags: readonly string[],
): boolean {
  const tags = new Set(fileTags ?? []);

  // --tag: every specified tag must be present
  if (includeTags.length > 0) {
    for (const required of includeTags) {
      if (!tags.has(required)) return false;
    }
  }

  // --exclude-tag: none of the specified tags may be present
  for (const excluded of excludeTags) {
    if (tags.has(excluded)) return false;
  }

  return true;
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
  const cliWorkers = normalizeOptionalNumber(rawOptions.workers);
  const configWorkers = config?.execution?.workers;
  const workers = cliWorkers ?? configWorkers ?? 0;

  // --output is now a single optional string (artifact directory)
  const cliOutputDir = normalizeString(rawOptions.output);

  // --export is the new repeatable flag for additional output files
  const rawExportPaths = rawOptions.export;
  const exportPaths: string[] = Array.isArray(rawExportPaths)
    ? rawExportPaths.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
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
    filter: normalizeFilter(rawOptions.filter),
    workers: workers > 0 ? workers : undefined,
    outputDir: cliOutputDir,
    outPath: cliOut ?? configOut,
    exportPaths,
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
    exportOtel: normalizeBoolean(rawOptions.exportOtel) || yamlExecution?.export_otel === true,
    otelBackend: normalizeString(rawOptions.otelBackend) ?? yamlExecution?.otel_backend,
    otelCaptureContent:
      normalizeBoolean(rawOptions.otelCaptureContent) ||
      yamlExecution?.otel_capture_content === true,
    otelGroupTurns:
      normalizeBoolean(rawOptions.otelGroupTurns) || yamlExecution?.otel_group_turns === true,
    retryErrors: normalizeString(rawOptions.retryErrors),
    resume: normalizeBoolean(rawOptions.resume) || normalizeBoolean(rawOptions.rerunFailed),
    rerunFailed: normalizeBoolean(rawOptions.rerunFailed),
    workspaceMode,
    workspacePath,
    // Precedence: CLI > YAML config > TS config
    keepWorkspaces:
      normalizeBoolean(rawOptions.keepWorkspaces) ||
      yamlExecution?.keep_workspaces === true ||
      config?.execution?.keepWorkspaces === true,
    benchmarkJson: normalizeString(rawOptions.benchmarkJson),
    artifacts: normalizeString(rawOptions.artifacts),
    graderTarget: normalizeString(rawOptions.graderTarget),
    model: normalizeString(rawOptions.model),
    outputMessages: normalizeOutputMessages(normalizeString(rawOptions.outputMessages)),
    threshold: normalizeOptionalNumber(rawOptions.threshold),
    tags: normalizeStringArray(rawOptions.tag),
    excludeTags: normalizeStringArray(rawOptions.excludeTag),
    transcript: normalizeString(rawOptions.transcript),
    experiment: normalizeString(rawOptions.experiment),
    budgetUsd: normalizeOptionalNumber(rawOptions.budgetUsd),
  } satisfies NormalizedOptions;
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

function buildDefaultOutputPathForExperiment(cwd: string, experiment?: string): string {
  const runDir = buildDefaultRunDir(cwd, experiment);
  mkdirSync(runDir, { recursive: true });
  return path.join(runDir, 'index.jsonl');
}

type ProgressReporter = {
  readonly isInteractive: boolean;
  start(): void;
  setTotal(total: number): void;
  update(workerId: number, progress: WorkerProgress): void;
  finish(): void;
  addLogPaths(paths: readonly string[]): void;
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
    addLogPaths: (paths: readonly string[]) => display.addLogPaths(paths),
  };
}

function makeTestCaseKey(testFilePath: string, testId: string): string {
  return `${path.resolve(testFilePath)}::${testId}`;
}

/** Show the resolved target name when `default` is a `use_target` redirect. */
function resolveTargetLabel(requestedName: string, resolvedName: string): string {
  if (resolvedName !== requestedName) {
    return `${requestedName} → ${resolvedName}`;
  }
  return requestedName;
}

function createDisplayIdTracker(): { getOrAssign(testCaseKey: string): number } {
  const map = new Map<string, number>();
  let nextId = 1;
  return {
    getOrAssign(testCaseKey: string): number {
      const existing = map.get(testCaseKey);
      if (existing !== undefined) {
        return existing;
      }
      const assigned = nextId++;
      map.set(testCaseKey, assigned);
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
  readonly testIds: readonly string[];
  readonly testCases: readonly EvalTest[];
  readonly selections: readonly { selection: TargetSelection; inlineTargetLabel: string }[];
  readonly trialsConfig?: TrialsConfig;
  readonly suiteTargets?: readonly string[];
  readonly yamlWorkers?: number;
  readonly yamlCache?: boolean;
  readonly yamlCachePath?: string;
  readonly budgetUsd?: number;
  readonly failOnError?: FailOnError;
  readonly threshold?: number;
  readonly tags?: readonly string[];
  readonly providerFactory?: (
    target: import('@agentv/core').ResolvedTarget,
  ) => import('@agentv/core').Provider;
}> {
  const { testFilePath, repoRoot, cwd, options } = params;

  await ensureFileExists(testFilePath, 'Test file');
  await loadEnvFromHierarchy({
    testFilePath,
    repoRoot,
    verbose: options.verbose,
  });

  const relativePath = path.relative(cwd, testFilePath);
  const category = deriveCategory(relativePath);

  const suite = await loadTestSuite(testFilePath, repoRoot, {
    verbose: options.verbose,
    filter: options.filter,
    category,
  });
  const testIds = suite.tests.map((value) => value.id);
  const suiteTargets = suite.targets;

  let selections: { selection: TargetSelection; inlineTargetLabel: string }[];

  if (options.transcript) {
    // --transcript mode: bypass target resolution entirely.
    // Create a synthetic TargetSelection for the transcript provider.
    const transcriptSelection: TargetSelection = {
      definitions: [],
      resolvedTarget: {
        kind: 'transcript',
        name: 'transcript',
        config: {} as Record<string, never>,
      },
      targetName: 'transcript',
      targetSource: 'cli',
      targetsFilePath: options.transcript,
    };
    selections = [
      {
        selection: transcriptSelection,
        inlineTargetLabel: `transcript (${path.basename(options.transcript)})`,
      },
    ];
  } else if (suite.inlineTarget && options.cliTargets.length === 0) {
    const targetDefinition = suite.inlineTarget;
    const resolvedTarget = options.dryRun
      ? ({
          kind: 'mock',
          name: `${targetDefinition.name}-dry-run`,
          graderTarget: undefined,
          config: {
            // Schema-valid grader response so --dry-run works end-to-end with LLM graders.
            // Satisfies freeform (score), rubric (checks, overall_reasoning), and score-range (checks) without real LLM calls.
            response: '{"score":1,"assertions":[],"checks":[],"overall_reasoning":"dry-run mock"}',
            delayMs: options.dryRunDelay,
            delayMinMs: options.dryRunDelayMin,
            delayMaxMs: options.dryRunDelayMax,
          },
        } satisfies ResolvedTarget)
      : resolveTargetDefinition(targetDefinition, process.env, testFilePath, {
          emitDeprecationWarnings: false,
        });
    selections = [
      {
        selection: {
          definitions: [targetDefinition],
          resolvedTarget,
          targetName: targetDefinition.name,
          targetSource: 'test-file',
          targetsFilePath: testFilePath,
        },
        inlineTargetLabel: resolveTargetLabel(targetDefinition.name, resolvedTarget.name),
      },
    ];
  } else if (suite.providerFactory && options.cliTargets.length === 0) {
    const taskTarget: ResolvedTarget = {
      kind: 'mock',
      name: 'custom-task',
      graderTarget: undefined,
      config: {},
    };
    selections = [
      {
        selection: {
          definitions: [],
          resolvedTarget: taskTarget,
          targetName: 'custom-task',
          targetSource: 'test-file',
          targetsFilePath: testFilePath,
        },
        inlineTargetLabel: 'custom-task',
      },
    ];
  } else {
    // Determine target names: CLI --target flags override YAML
    const cliTargets = options.cliTargets;
    const suiteTargets = suite.targets;
    const suiteTargetRefs = suite.targetRefs;

    // Resolve which target names to use (precedence: CLI > suite YAML targets > default)
    let targetNames: readonly string[];
    if (cliTargets.length > 0) {
      targetNames = cliTargets;
    } else if (suiteTargets && suiteTargets.length > 0) {
      targetNames = suiteTargets;
    } else {
      targetNames = [];
    }

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
        targetRefs: suiteTargetRefs,
      });

      selections = multiSelections.map((sel) => ({
        selection: sel,
        inlineTargetLabel: resolveTargetLabel(sel.targetName, sel.resolvedTarget.name),
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

      // Attach target hooks from eval file if available
      const singleTargetHooks = suiteTargetRefs?.find(
        (ref) => ref.name === selection.targetName,
      )?.hooks;
      const augmentedSelection: TargetSelection = singleTargetHooks
        ? { ...selection, targetHooks: singleTargetHooks }
        : selection;

      selections = [
        {
          selection: augmentedSelection,
          inlineTargetLabel: resolveTargetLabel(
            augmentedSelection.targetName,
            augmentedSelection.resolvedTarget.name,
          ),
        },
      ];
    }
  }

  return {
    testIds,
    testCases: suite.tests,
    selections,
    trialsConfig: suite.trials,
    suiteTargets,
    yamlWorkers: suite.workers,
    yamlCache: suite.cacheConfig?.enabled,
    yamlCachePath: suite.cacheConfig?.cachePath,
    budgetUsd: suite.budgetUsd,
    failOnError: suite.failOnError,
    threshold: suite.threshold,
    tags: suite.metadata?.tags,
    providerFactory: suite.providerFactory,
  };
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
  readonly seenTestCases: Set<string>;
  readonly displayIdTracker: { getOrAssign(testCaseKey: string): number };
  readonly selection: TargetSelection;
  readonly inlineTargetLabel: string;
  readonly testCases: readonly EvalTest[];
  readonly trialsConfig?: TrialsConfig;
  readonly matrixMode?: boolean;
  readonly budgetUsd?: number;
  readonly runBudgetTracker?: RunBudgetTracker;
  readonly failOnError?: FailOnError;
  readonly threshold?: number;
  readonly providerFactory?: (
    target: import('@agentv/core').ResolvedTarget,
  ) => import('@agentv/core').Provider;
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
    seenTestCases,
    displayIdTracker,
    selection,
    inlineTargetLabel,
    testCases,
    trialsConfig,
    matrixMode,
    budgetUsd,
    runBudgetTracker,
    failOnError,
    providerFactory,
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
    console.log(`${targetMessage}`);
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
    filter: options.filter,
    evalCases: testCases,
    verbose: options.verbose,
    maxConcurrency: resolvedWorkers,
    workspaceMode: options.workspaceMode,
    workspacePath: options.workspacePath,
    keepWorkspaces: options.keepWorkspaces,
    trials: trialsConfig,
    budgetUsd,
    runBudgetTracker,
    failOnError,
    graderTarget: options.graderTarget,
    model: options.model,
    threshold: options.threshold,
    targetHooks: resolvedTargetSelection.targetHooks,
    providerFactory,
    streamCallbacks: streamingObserver?.getStreamCallbacks(),
    onResult: async (result: EvaluationResult) => {
      (
        streamingObserver as { completeFromResult?: (result: EvaluationResult) => void } | null
      )?.completeFromResult?.(result);
      // Finalize the streaming observer span with score.
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
      const testCaseKeyId = matrixMode ? `${event.testId}@${targetName}` : event.testId;
      const testCaseKey = makeTestCaseKey(testFilePath, testCaseKeyId);
      if (event.status === 'pending' && !seenTestCases.has(testCaseKey)) {
        seenTestCases.add(testCaseKey);
        progressReporter.setTotal(seenTestCases.size);
      }
      const displayId = displayIdTracker.getOrAssign(testCaseKey);

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
  /** True when --threshold is set and mean score is below the threshold */
  readonly thresholdFailed?: boolean;
  /** True when all tests had execution errors and no evaluation was performed */
  readonly allExecutionErrors?: boolean;
  /** True when --budget-usd was set and the run-level budget was exceeded */
  readonly budgetExceeded?: boolean;
}

interface RemoteEvalSummaryInput {
  readonly evalFile: string;
  readonly results: EvaluationResult[];
}

export async function runEvalCommand(
  input: RunEvalCommandInput,
): Promise<RunEvalResult | undefined> {
  const cwd = process.cwd();

  // Set AGENTV_RUN_TIMESTAMP so CLI targets can group artifacts under the same run folder.
  if (!process.env.AGENTV_RUN_TIMESTAMP) {
    process.env.AGENTV_RUN_TIMESTAMP = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\./g, '-');
  }

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

  // Run pre-run hook (YAML config takes precedence; TS config is fallback)
  // Hooks run before normalizeOptions so secrets are available for env interpolation
  const preRunCommand = yamlConfig?.hooks?.pre_run ?? config?.hooks?.preRun;
  if (preRunCommand) {
    runPreRunHook(preRunCommand);
  }

  let options = normalizeOptions(input.rawOptions, config, yamlConfig?.execution);
  if (!process.env.AGENTV_EXPERIMENT) {
    process.env.AGENTV_EXPERIMENT = normalizeExperimentName(options.experiment);
  }

  // Validate --grader-target / --model combinations
  if (options.graderTarget === 'agentv' && !options.model) {
    throw new Error('--grader-target agentv requires --model (e.g., --model openai:gpt-5-mini)');
  }

  // --retry-errors: resume from a previous run by re-running execution_error and missing test cases.
  // Uses an exclusion filter to skip already-completed (non-error) cases, which naturally includes
  // both error cases and cases that never ran (e.g., due to a crash or interrupt).
  // IMPORTANT: JSONL must be fully loaded here, before the output writer is created below,
  // since the retry source and output destination may refer to the same file.
  let retryNonErrorResults: readonly EvaluationResult[] | undefined;
  if (options.retryErrors) {
    const retryPath = path.resolve(options.retryErrors);
    await ensureFileExists(retryPath, 'Retry-errors JSONL file');
    const completedIds = await loadFullyCompletedTestIds(retryPath);
    const errorIds = await loadErrorTestIds(retryPath);
    retryNonErrorResults = await loadNonErrorResults(retryPath);

    if (errorIds.length > 0) {
      console.log(`Found ${errorIds.length} execution-error test(s): ${errorIds.join(', ')}`);
    }
    // Use a negation filter to exclude fully-completed (non-error across all targets) cases.
    // This re-runs error cases, cases missing from the output (crash recovery), and cases
    // that errored on some targets even if they succeeded on others (matrix safety).
    if (completedIds.length > 0) {
      options = { ...options, filter: buildExclusionFilter(completedIds) };
      console.log(`Skipping ${completedIds.length} already-completed test(s).`);
    }
  }

  // --resume / --rerun-failed: skip already-completed tests and append to existing output.
  // IMPORTANT: JSONL must be loaded before the output writer is created (same file).
  let resumeSkipKeys: Set<string> | undefined;
  let isResumeAppend = false;
  if (options.resume && !options.retryErrors) {
    const explicitResumeDir = options.outputDir ?? options.artifacts;
    if (explicitResumeDir) {
      const resumeIndexPath = path.join(path.resolve(explicitResumeDir), 'index.jsonl');
      if (existsSync(resumeIndexPath)) {
        const content = await readFile(resumeIndexPath, 'utf8');
        const existingResults = parseJsonlResults(content);
        resumeSkipKeys = new Set<string>();
        for (const r of existingResults) {
          if (shouldSkipExistingResultForResume(r, options.rerunFailed)) {
            resumeSkipKeys.add(buildTestTargetKey(r.testId, r.target));
          }
        }
        isResumeAppend = true;
        const modeLabel = options.rerunFailed ? 'Rerun-failed' : 'Resume';
        console.log(
          `${modeLabel}: found ${existingResults.length} existing result(s), skipping ${resumeSkipKeys.size} completed.`,
        );
      } else {
        // No existing index.jsonl — behave like a normal run
        console.log('Resume: no existing index.jsonl found, starting fresh run.');
      }
    } else {
      console.warn(
        'Warning: --resume requires --output <dir> to identify the run directory. Ignoring --resume.',
      );
    }
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

  // Emit deprecation warnings for legacy flags
  if (options.outPath) {
    console.warn('Warning: --out is deprecated. Use --output <dir> to set the artifact directory.');
  }
  if (options.artifacts) {
    console.warn(
      'Warning: --artifacts is deprecated. Use --output <dir> to set the artifact directory.',
    );
  }
  if (options.benchmarkJson) {
    console.warn(
      'Warning: --benchmark-json is deprecated. benchmark.json is always written to the artifact directory.',
    );
  }
  if (normalizeString(input.rawOptions.outputFormat)) {
    console.warn(
      'Warning: --output-format is deprecated. The artifact directory always uses JSONL.',
    );
  }

  // Resolve artifact directory (runDir) and primary output path.
  // Precedence: --output > --artifacts (deprecated) > --out (deprecated) > default
  const explicitDir = options.outputDir ?? options.artifacts;
  let runDir: string;
  let outputPath: string;
  let usesDefaultArtifactWorkspace: boolean;

  if (explicitDir) {
    // --output <dir> or --artifacts <dir>: use as artifact directory
    runDir = path.resolve(explicitDir);
    mkdirSync(runDir, { recursive: true });
    outputPath = path.join(runDir, 'index.jsonl');
    usesDefaultArtifactWorkspace = true;
  } else if (options.outPath) {
    // --out <path> (deprecated): use dirname as artifact dir
    outputPath = path.resolve(options.outPath);
    runDir = path.dirname(outputPath);
    mkdirSync(runDir, { recursive: true });
    usesDefaultArtifactWorkspace = false;
  } else {
    // Default: .agentv/results/runs/<experiment>/<timestamp>/
    outputPath = buildDefaultOutputPathForExperiment(cwd, options.experiment);
    runDir = path.dirname(outputPath);
    usesDefaultArtifactWorkspace = true;
  }

  // Initialize OTel exporter if --export-otel flag is set or file export flags are used
  let otelExporter: OtelTraceExporterType | null = null;
  const useFileExport = !!options.otelFile;

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

  const primaryWritePath = outputPath;

  // Resolve --export paths (additional output files)
  const resolvedExportPaths = options.exportPaths.map((p: string) => path.resolve(p));

  console.log(`Artifact directory: ${runDir}`);
  if (resolvedExportPaths.length > 0) {
    console.log('Export files:');
    for (const p of resolvedExportPaths) {
      console.log(`  ${p}`);
    }
  }

  // Log file export paths
  const resolvedTestFiles = input.testFiles.map((file) => path.resolve(file));
  if (options.otelFile) {
    console.log(`OTLP JSON file: ${path.resolve(options.otelFile)}`);
  }

  // Determine cache state after loading file metadata (need YAML config)
  // We defer cache creation until after file metadata is loaded
  const evaluationRunner = await resolveEvaluationRunner();
  const allResults: EvaluationResult[] = [];
  const remoteEvalSummaries: RemoteEvalSummaryInput[] = [];
  const seenTestCases = new Set<string>();
  const displayIdTracker = createDisplayIdTracker();

  // Run-level budget tracker: caps total cost across all eval files in this run.
  const runBudgetTracker = options.budgetUsd ? new RunBudgetTracker(options.budgetUsd) : undefined;
  if (runBudgetTracker) {
    console.log(`Run budget cap: $${runBudgetTracker.budgetCapUsd.toFixed(2)}`);
  }

  // Each file gets the full worker budget — no splitting across files
  const perFileWorkers = options.workers;
  const fileMetadata = new Map<
    string,
    {
      readonly testIds: readonly string[];
      readonly testCases: readonly EvalTest[];
      readonly selections: readonly {
        selection: TargetSelection;
        inlineTargetLabel: string;
      }[];
      readonly trialsConfig?: TrialsConfig;
      readonly suiteTargets?: readonly string[];
      readonly yamlWorkers?: number;
      readonly yamlCache?: boolean;
      readonly yamlCachePath?: string;
      readonly budgetUsd?: number;
      readonly failOnError?: FailOnError;
      readonly threshold?: number;
      readonly tags?: readonly string[];
      readonly providerFactory?: (
        target: import('@agentv/core').ResolvedTarget,
      ) => import('@agentv/core').Provider;
    }
  >();
  for (const testFilePath of resolvedTestFiles) {
    const meta = await prepareFileMetadata({
      testFilePath,
      repoRoot,
      cwd,
      options,
    });
    fileMetadata.set(testFilePath, meta);
  }

  // Apply --tag / --exclude-tag filtering at the eval-file level
  const hasTagFilters = options.tags.length > 0 || options.excludeTags.length > 0;
  if (hasTagFilters) {
    const skippedFiles: string[] = [];
    for (const [testFilePath, meta] of fileMetadata.entries()) {
      if (!matchesTagFilters(meta.tags, options.tags, options.excludeTags)) {
        fileMetadata.delete(testFilePath);
        skippedFiles.push(path.relative(cwd, testFilePath));
      }
    }
    if (skippedFiles.length > 0 && options.verbose) {
      console.log(
        `Skipped ${skippedFiles.length} eval file(s) by tag filter: ${skippedFiles.join(', ')}`,
      );
    }
    if (fileMetadata.size === 0) {
      console.log('No eval files matched the tag filters. Nothing to run.');
      return;
    }
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

  if (cacheEnabled) {
    console.log(`Response cache: enabled${yamlCachePath ? ` (${yamlCachePath})` : ''}`);
  }

  // Resolve suite-level threshold: CLI --threshold takes precedence over YAML execution.threshold.
  const yamlThreshold = firstMeta?.threshold;
  const resolvedThreshold = options.threshold ?? yamlThreshold;
  if (resolvedThreshold !== undefined && (resolvedThreshold < 0 || resolvedThreshold > 1)) {
    throw new Error('--threshold must be between 0 and 1');
  }

  // Build the output writer. Primary output is always JSONL to the artifact directory.
  // Additional --export paths get their own writers that receive all results after the run.
  const writerOptions =
    resolvedThreshold !== undefined ? { threshold: resolvedThreshold } : undefined;
  const outputWriter: OutputWriter = await createOutputWriter(primaryWritePath, 'jsonl', {
    append: isResumeAppend,
  });

  // Detect matrix mode: multiple targets for any file
  const isMatrixMode = Array.from(fileMetadata.values()).some((meta) => meta.selections.length > 1);

  // In matrix mode, total eval count is tests × targets (accounting for per-test target overrides)
  // When resuming, subtract tests that will be skipped
  let totalEvalCount = 0;
  let resumeSkippedCount = 0;
  for (const meta of fileMetadata.values()) {
    const suiteTargetNames = meta.selections.map((s) => s.selection.targetName);
    for (const test of meta.testCases) {
      // Per-test targets override suite-level targets.
      const testTargetNames =
        test.targets && test.targets.length > 0
          ? test.targets.filter((t) => suiteTargetNames.includes(t))
          : suiteTargetNames;
      const effectiveTargets = testTargetNames.length > 0 ? testTargetNames : ['unknown'];
      for (const tn of effectiveTargets) {
        const key = `${test.id}::${tn}`;
        if (resumeSkipKeys?.has(key)) {
          resumeSkippedCount++;
        } else {
          totalEvalCount++;
        }
      }
    }
  }

  if (totalEvalCount === 0) {
    // When using --retry-errors, all tests being filtered means no errors or missing cases remain
    if (options.retryErrors && retryNonErrorResults && retryNonErrorResults.length > 0) {
      console.log('No execution errors or missing cases in the previous run. Nothing to retry.');
      return;
    }
    // When using --resume, all tests being completed means nothing to resume
    if (resumeSkipKeys && resumeSkippedCount > 0) {
      console.log(`Nothing to resume — all ${resumeSkippedCount} test(s) already completed.`);
      return;
    }
    throw new Error('No tests matched the provided filters.');
  }
  const progressReporter = createProgressReporter(options.workers ?? DEFAULT_WORKERS, {
    verbose: options.verbose,
  });
  progressReporter.start();
  progressReporter.setTotal(totalEvalCount);
  const seenCodexLogPaths = new Set<string>();
  const unsubscribeCodexLogs = subscribeToCodexLogEntries((entry) => {
    if (!entry.filePath || seenCodexLogPaths.has(entry.filePath)) {
      return;
    }
    seenCodexLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath]);
  });
  const seenPiLogPaths = new Set<string>();
  const unsubscribePiLogs = subscribeToPiLogEntries((entry) => {
    if (!entry.filePath || seenPiLogPaths.has(entry.filePath)) {
      return;
    }
    seenPiLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath]);
  });
  const seenCopilotLogPaths = new Set<string>();
  const unsubscribeCopilotSdkLogs = subscribeToCopilotSdkLogEntries((entry) => {
    if (!entry.filePath || seenCopilotLogPaths.has(entry.filePath)) {
      return;
    }
    seenCopilotLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath]);
  });
  const unsubscribeCopilotCliLogs = subscribeToCopilotCliLogEntries((entry) => {
    if (!entry.filePath || seenCopilotLogPaths.has(entry.filePath)) {
      return;
    }
    seenCopilotLogPaths.add(entry.filePath);
    progressReporter.addLogPaths([entry.filePath]);
  });
  for (const [testFilePath, meta] of fileMetadata.entries()) {
    for (const { selection, inlineTargetLabel } of meta.selections) {
      for (const testId of meta.testIds) {
        const testCaseKey = makeTestCaseKey(
          testFilePath,
          meta.selections.length > 1 ? `${testId}@${selection.targetName}` : testId,
        );
        seenTestCases.add(testCaseKey);
        const displayId = displayIdTracker.getOrAssign(testCaseKey);
        progressReporter.update(displayId, {
          workerId: displayId,
          testId: meta.selections.length > 1 ? `${testId}@${selection.targetName}` : testId,
          status: 'pending',
          targetLabel: inlineTargetLabel,
        });
      }
    }
  }

  // Use only files that survived tag filtering.
  const activeTestFiles = resolvedTestFiles.filter((f) => fileMetadata.has(f));

  // --transcript: create a shared TranscriptProvider and validate entry count
  let transcriptProviderFactory:
    | ((target: import('@agentv/core').ResolvedTarget) => import('@agentv/core').Provider)
    | undefined;
  if (options.transcript) {
    const { TranscriptProvider } = await import('@agentv/core');
    const transcriptProvider = await TranscriptProvider.fromFile(options.transcript);

    // Validate: transcript entries must match total test cases across all files
    const totalTests = [...fileMetadata.values()].reduce(
      (sum, meta) => sum + meta.testCases.length,
      0,
    );
    if (transcriptProvider.lineCount !== totalTests) {
      throw new Error(
        `Transcript has ${transcriptProvider.lineCount} entr${transcriptProvider.lineCount === 1 ? 'y' : 'ies'} but eval defines ${totalTests} test(s). Each transcript entry maps positionally to one test case.`,
      );
    }

    transcriptProviderFactory = () => transcriptProvider;
    console.log(
      `Using transcript: ${options.transcript} (${transcriptProvider.lineCount} entry(s))`,
    );
  }

  // Eval files run sequentially; within each file, --workers N test cases run in parallel.
  // This matches industry practice (promptfoo, deepeval, OpenAI Evals) and avoids cross-file
  // workspace races without any grouping complexity.
  try {
    for (const testFilePath of activeTestFiles) {
      // Run-level budget check: skip remaining files if budget exceeded
      if (runBudgetTracker?.isExceeded()) {
        const targetPrep = fileMetadata.get(testFilePath);
        if (!targetPrep) continue;
        const budgetMsg = `Run budget exceeded ($${runBudgetTracker.currentCostUsd.toFixed(4)} / $${runBudgetTracker.budgetCapUsd.toFixed(4)})`;
        console.log(`\n⚠ ${budgetMsg} — skipping ${path.basename(testFilePath)}`);
        for (const { selection } of targetPrep.selections) {
          const skippedResults: EvaluationResult[] = targetPrep.testCases.map((testCase) => ({
            timestamp: new Date().toISOString(),
            testId: testCase.id,
            score: 0,
            assertions: [],
            output: [],
            error: budgetMsg,
            budgetExceeded: true,
            executionStatus: 'execution_error' as const,
            failureStage: 'setup' as const,
            failureReasonCode: 'budget_exceeded' as const,
            executionError: { message: budgetMsg, stage: 'setup' as const },
            target: selection.targetName,
          }));
          for (const r of skippedResults) {
            await outputWriter.append(r);
          }
          allResults.push(...skippedResults);
        }
        continue;
      }

      const targetPrep = fileMetadata.get(testFilePath);
      if (!targetPrep) {
        throw new Error(`Missing metadata for ${testFilePath}`);
      }

      // Run all targets concurrently (each target has its own worker limit)
      const targetResults = await Promise.all(
        targetPrep.selections.map(async ({ selection, inlineTargetLabel }) => {
          // Filter test cases to those applicable to this target.
          const targetName = selection.targetName;
          const applicableTestCases =
            targetPrep.selections.length > 1
              ? targetPrep.testCases.filter((test) => {
                  if (test.targets && test.targets.length > 0) {
                    return test.targets.includes(targetName);
                  }
                  return true;
                })
              : targetPrep.testCases;

          // --resume / --rerun-failed: skip tests that are already completed
          const filteredTestCases = resumeSkipKeys
            ? applicableTestCases.filter(
                (test) => !resumeSkipKeys.has(buildTestTargetKey(test.id, targetName)),
              )
            : applicableTestCases;

          if (filteredTestCases.length === 0) {
            return [];
          }

          try {
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
              seenTestCases,
              displayIdTracker,
              selection,
              inlineTargetLabel,
              testCases: filteredTestCases,
              trialsConfig: options.transcript ? undefined : targetPrep.trialsConfig,
              matrixMode: targetPrep.selections.length > 1,
              budgetUsd: targetPrep.budgetUsd,
              runBudgetTracker,
              failOnError: targetPrep.failOnError,
              threshold: resolvedThreshold,
              providerFactory: transcriptProviderFactory ?? targetPrep.providerFactory,
            });
            const evalFile = path.relative(cwd, testFilePath);
            const existingSummary = remoteEvalSummaries.find(
              (summary) => summary.evalFile === evalFile,
            );
            if (existingSummary) {
              existingSummary.results.push(...result.results);
            } else {
              remoteEvalSummaries.push({
                evalFile,
                results: [...result.results],
              });
            }

            return result.results;
          } catch (fileError) {
            // before_all or other setup failures should not abort the entire run.
            // Mark all tests in this file as errors and continue with other files.
            const message = fileError instanceof Error ? fileError.message : String(fileError);
            console.error(
              `\n[ERROR] ⚠ Eval file failed: ${path.basename(testFilePath)} — ${message}\n`,
            );
            const errorResults: EvaluationResult[] = filteredTestCases.map((testCase) => ({
              timestamp: new Date().toISOString(),
              testId: testCase.id,
              score: 0,
              assertions: [],
              output: [],
              scores: [],
              error: message,
              executionStatus: 'execution_error' as const,
              failureStage: 'setup' as const,
              failureReasonCode: 'setup_error' as const,
              durationMs: 0,
              tokenUsage: { input: 0, output: 0, inputTokens: 0, outputTokens: 0 },
              target: selection.targetName,
            }));
            for (const errResult of errorResults) {
              await outputWriter.append(errResult);
            }
            return errorResults;
          }
        }),
      );
      for (const results of targetResults) {
        allResults.push(...results);
      }
    }

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

    // Flush the output writer so all results are on disk before we read back.
    await outputWriter.close().catch(() => undefined);

    // When resuming, compute summary from ALL results (old + new, deduplicated)
    let summaryResults = allResults;
    if (isResumeAppend && usesDefaultArtifactWorkspace) {
      const content = await readFile(outputPath, 'utf8');
      summaryResults = deduplicateByTestIdTarget(parseJsonlResults(content));
    }

    const thresholdOpts =
      resolvedThreshold !== undefined ? { threshold: resolvedThreshold } : undefined;
    const summary = calculateEvaluationSummary(summaryResults, thresholdOpts);
    console.log(formatEvaluationSummary(summary, thresholdOpts));

    // Exit code: 2 when all tests are execution errors (no evaluation performed),
    // 1 when any test scored below threshold.
    const allExecutionErrors = summary.total > 0 && summary.executionErrorCount === summary.total;
    const thresholdFailed = resolvedThreshold !== undefined && summary.qualityFailureCount > 0;

    // Print matrix summary when multiple targets were evaluated
    if (isMatrixMode && summaryResults.length > 0) {
      console.log(formatMatrixSummary(summaryResults));
    }

    // Write Agent Skills benchmark.json if requested (deprecated flag — backward compat)
    if (options.benchmarkJson && allResults.length > 0) {
      const benchmarkPath = path.resolve(options.benchmarkJson);
      await writeBenchmarkJson(benchmarkPath, allResults);
      console.log(`Benchmark written to: ${benchmarkPath}`);
    }

    // Write artifacts to the run directory (always, not conditional on flags)
    if (usesDefaultArtifactWorkspace && allResults.length > 0) {
      const evalFile = activeTestFiles.length === 1 ? activeTestFiles[0] : '';
      if (isResumeAppend) {
        // Resume mode: write per-test artifacts for newly-run tests, then aggregate
        // from the full index.jsonl (old + new results with deduplication)
        const { writePerTestArtifacts } = await import('./artifact-writer.js');
        await writePerTestArtifacts(allResults, runDir, {
          experiment: normalizeExperimentName(options.experiment),
        });
        const { benchmarkPath: workspaceBenchmarkPath, timingPath } = await aggregateRunDir(
          runDir,
          { evalFile, experiment: normalizeExperimentName(options.experiment) },
        );
        const indexPath = path.join(runDir, 'index.jsonl');
        console.log(`Artifact workspace updated: ${runDir}`);
        console.log(`  Index: ${indexPath}`);
        console.log(`  Per-test artifacts: ${runDir} (${allResults.length} new test directories)`);
        console.log(`  Timing: ${timingPath}`);
        console.log(`  Benchmark: ${workspaceBenchmarkPath}`);
      } else {
        const {
          testArtifactDir,
          timingPath,
          benchmarkPath: workspaceBenchmarkPath,
          indexPath,
        } = await writeArtifactsFromResults(allResults, runDir, {
          evalFile,
          experiment: normalizeExperimentName(options.experiment),
        });
        console.log(`Artifact workspace written to: ${runDir}`);
        console.log(`  Index: ${indexPath}`);
        console.log(
          `  Per-test artifacts: ${testArtifactDir} (${allResults.length} test directories)`,
        );
        console.log(`  Timing: ${timingPath}`);
        console.log(`  Benchmark: ${workspaceBenchmarkPath}`);
      }
    }

    // Write --export output files (additional formats)
    if (resolvedExportPaths.length > 0 && allResults.length > 0) {
      for (const exportPath of resolvedExportPaths) {
        const writer = await createWriterFromPath(exportPath, writerOptions);
        for (const result of allResults) {
          await writer.append(result);
        }
        await writer.close();
      }
      console.log(
        `Export file(s) written: ${resolvedExportPaths.map((p) => path.relative(cwd, p)).join(', ')}`,
      );
    }

    // Print workspace paths summary
    const resultsWithWorkspaces = allResults.filter((r) => r.workspacePath);
    const preservedWorkspaces = options.keepWorkspaces
      ? resultsWithWorkspaces
      : resultsWithWorkspaces.filter((r) => r.error || r.score < 0.5);

    if (preservedWorkspaces.length > 0) {
      console.log('\nPreserved workspaces:');
      for (const result of preservedWorkspaces) {
        console.log(`  ${result.testId} -> ${result.workspacePath}`);
      }
    }

    // Hint about --keep-workspaces when workspaces were used but some cleaned up
    const usedWorkspaces =
      resultsWithWorkspaces.length > 0 ||
      (options.workspaceMode && options.workspaceMode !== 'static');
    if (!options.keepWorkspaces && usedWorkspaces) {
      console.log('Use --keep-workspaces to preserve all workspaces for inspection.');
    }

    if (allResults.length > 0) {
      console.log(`\nResults written to: ${outputPath}`);

      // Persist last run path for `agentv results` commands
      await saveRunCache(cwd, outputPath).catch(() => undefined);

      await maybeAutoExportRunArtifacts({
        cwd,
        run_dir: runDir,
        test_files: activeTestFiles,
        results: allResults,
        eval_summaries: remoteEvalSummaries.map((summary) => ({
          eval_file: summary.evalFile,
          total: summary.results.length,
          passed: summary.results.filter((result) => result.score >= DEFAULT_THRESHOLD).length,
          avg_score:
            summary.results.length > 0
              ? summary.results.reduce((sum, result) => sum + result.score, 0) /
                summary.results.length
              : 0,
          results: summary.results.map((result) => ({
            test_id: result.testId,
            score: result.score,
            status:
              result.executionStatus === 'execution_error' || result.error
                ? 'ERROR'
                : result.score >= DEFAULT_THRESHOLD
                  ? 'PASS'
                  : 'FAIL',
          })),
        })),
        experiment: normalizeExperimentName(options.experiment),
      });
    }

    // Suggest resume commands when execution errors are detected
    if (summary.executionErrorCount > 0 && !options.retryErrors && !options.resume) {
      const evalFileArgs = activeTestFiles.map((f) => path.relative(cwd, f)).join(' ');
      const targetFlag = options.target ? ` --target ${options.target}` : '';
      const relativeRunDir = path.relative(cwd, runDir);
      console.log(
        `\nTip: ${summary.executionErrorCount} execution error(s) detected. Re-run failed tests with:\n` +
          `  agentv eval run ${evalFileArgs}${targetFlag} --output ${relativeRunDir} --rerun-failed`,
      );
    }

    // Print run-level budget summary when exceeded
    const runBudgetExceeded = runBudgetTracker?.isExceeded() ?? false;
    if (runBudgetExceeded) {
      console.log(
        `\n⚠ Run budget exceeded: $${runBudgetTracker?.currentCostUsd.toFixed(4)} spent of $${runBudgetTracker?.budgetCapUsd.toFixed(4)} cap`,
      );
    }

    return {
      executionErrorCount: summary.executionErrorCount,
      outputPath,
      testFiles: activeTestFiles,
      target: options.target,
      thresholdFailed,
      allExecutionErrors,
      budgetExceeded: runBudgetExceeded || undefined,
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
