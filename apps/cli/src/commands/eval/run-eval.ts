import { constants, existsSync, mkdirSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createRequire as createNodeRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_THRESHOLD,
  type EvalRunOverride,
  type EvalTargetRef,
  type EvalTest,
  type EvaluationCache,
  type EvaluationResult,
  type ExecutionDefaults,
  type ExperimentArtifactMetadata,
  type ExperimentConfig,
  type FailOnError,
  type OtelTraceExporter as OtelTraceExporterType,
  type ResolvedTarget,
  ResponseCache,
  RunBudgetTracker,
  type RunRuntimeSourceMetadata,
  type TrialsConfig,
  buildExperimentArtifactMetadata,
  buildTraceFromMessages,
  runEvaluation as defaultRunEvaluation,
  deriveCategory,
  ensureVSCodeSubagents,
  loadConfig,
  loadTestSuite,
  loadTsConfig,
  resolveTargetDefinition,
  shouldEnableCache,
  shouldSkipCacheForTemperature,
  subscribeToCodexLogEntries,
  subscribeToCopilotCliLogEntries,
  subscribeToCopilotSdkLogEntries,
  subscribeToPiLogEntries,
} from '@agentv/core';

import {
  type VersionCheckResult,
  enforceRequiredVersion,
  formatRequiredVersionFailureNote,
} from '../../version-check.js';
import {
  type RemoteExportStatus,
  type ResultsPublishOverrides,
  getRelativeRunPath,
  loadNormalizedResultsConfig,
  maybeAutoExportRunArtifacts,
} from '../results/remote.js';
import {
  aggregateRunDir,
  buildTestTargetKey,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  writeArtifactsFromResults,
  writeInitialRunSummaryArtifact,
} from './artifact-writer.js';
import { loadEnvFromHierarchy } from './env.js';
import { resolveOtelBackend } from './otel-backends.js';
import { type OutputWriter, createOutputWriter } from './output-writer.js';
import { ProgressDisplay, type Verdict, type WorkerProgress } from './progress-display.js';
import {
  buildDefaultRunDirFromName,
  createRunDirName,
  normalizeExperimentName,
} from './result-layout.js';
import {
  buildExclusionFilter,
  loadErrorTestIds,
  loadFullyCompletedTestIds,
  loadNonErrorResults,
} from './retry-errors.js';
import { resolveCachedRunDir, saveRunCache } from './run-cache.js';
import { findRepoRoot, resolveEvalPaths } from './shared.js';
import {
  calculateEvaluationSummary,
  formatEvaluationSummary,
  formatMatrixSummary,
} from './statistics.js';
import { type TargetSelection, selectMultipleTargets, selectTarget } from './targets.js';
import type { TaskBundleTargetSelection } from './task-bundle.js';
import { WipCheckpointLoop } from './wip-checkpoint.js';

const DEFAULT_WORKERS = 3;
const loadCjsModule = createNodeRequire(import.meta.url);
const micromatch = loadCjsModule('micromatch') as {
  isMatch(id: string, pattern: string): boolean;
};

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
  /** --output <dir>: canonical artifact directory */
  readonly outputDir?: string;
  /** Removed: use --output for run directories */
  readonly removedOut?: string;
  readonly agentTimeoutSeconds?: number;
  readonly cliAgentTimeoutSeconds?: number;
  readonly maxRetries: number;
  readonly cache: boolean;
  readonly cachePath?: string;
  readonly noCache: boolean;
  readonly tsConfigCache?: boolean;
  readonly tsConfigCachePath?: string;
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
  /** Removed: use --output instead */
  readonly artifacts?: string;
  /** Removed: the run directory always uses index.jsonl */
  readonly outputFormat?: string;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly outputMessages: number | 'all';
  readonly threshold?: number;
  readonly cliThreshold?: number;
  readonly tags: readonly string[];
  readonly excludeTags: readonly string[];
  readonly transcript?: string;
  readonly recordReplay?: string;
  readonly recordReplayVariant?: string;
  readonly experiment?: string;
  readonly experimentConfig?: ExperimentConfig;
  readonly experimentMetadata?: ExperimentArtifactMetadata;
  readonly experimentTargetRefs?: readonly EvalTargetRef[];
  readonly experimentTrialsConfig?: TrialsConfig;
  readonly budgetUsd?: number;
  readonly cliBudgetUsd?: number;
  readonly sourceMetadataByEvalFile?: ReadonlyMap<string, Record<string, unknown>>;
  readonly resultsOverrides?: ResultsPublishOverrides;
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

function resultsRepoOverride(
  value: string | undefined,
): Pick<ResultsPublishOverrides, 'repo' | 'repo_path'> {
  if (!value) {
    return {};
  }
  if (
    value === 'current' ||
    value === '.' ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('~\\') ||
    /^[A-Za-z]:[/\\]/.test(value)
  ) {
    return { repo_path: value === 'current' ? '.' : value };
  }
  return { repo: value };
}

export function resolveTimestampPlaceholder(value: string): string {
  if (!value.includes('{timestamp}')) {
    return value;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return value.replaceAll('{timestamp}', timestamp);
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

function normalizeSourceMetadataByEvalFile(
  value: unknown,
): ReadonlyMap<string, Record<string, unknown>> | undefined {
  if (value instanceof Map) {
    const entries = [...value.entries()].filter(
      (entry): entry is [string, Record<string, unknown>] =>
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'object' &&
        entry[1] !== null &&
        !Array.isArray(entry[1]),
    );
    return entries.length > 0
      ? new Map(entries.map(([key, metadata]) => [path.resolve(key), metadata]))
      : undefined;
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1]),
    );
    return entries.length > 0
      ? new Map(entries.map(([key, metadata]) => [path.resolve(key), metadata]))
      : undefined;
  }

  return undefined;
}

const LEGACY_OUTPUT_FILE_EXTENSIONS = new Set([
  '.jsonl',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
]);

function looksLikeLegacyOutputFilePath(value: string): boolean {
  return LEGACY_OUTPUT_FILE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function outputFileMigrationMessage(value: string): string {
  const ext = path.extname(value).toLowerCase();
  const removalHint =
    ext === '.xml'
      ? 'JUnit XML export from agentv eval has been removed.'
      : 'Flat result file export from agentv eval has been removed.';
  return `--output expects a run directory, not a file path: ${value}\n${removalHint} Set --output <dir> for the canonical run artifacts; AgentV always writes <dir>/index.jsonl.`;
}

function artifactsMigrationMessage(artifactsDir: string, outputDir?: string): string {
  const lines = [`--artifacts was removed from agentv eval. Use --output ${artifactsDir} instead.`];
  if (outputDir && looksLikeLegacyOutputFilePath(outputDir)) {
    const ext = path.extname(outputDir).toLowerCase();
    lines.push(
      ext === '.xml'
        ? 'JUnit XML export from agentv eval has been removed.'
        : 'Flat result file export from agentv eval has been removed.',
    );
    lines.push(`Migration example: --output ${artifactsDir}`);
  }
  return lines.join('\n');
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
 * Deprecated compatibility hook for the old output-as-messages JSONL surface.
 * Result `output` is now the final answer string; full transcript data stays
 * under `trace.messages` and is intentionally not trimmed here.
 */
export function trimOutputMessages(
  output: EvaluationResult['output'],
  _outputMessages: number | 'all',
): EvaluationResult['output'] {
  return output;
}

export function prepareResultForJsonl(
  result: EvaluationResult,
  options: { readonly outputMessages: number | 'all' },
): EvaluationResult {
  return {
    ...result,
    output: trimOutputMessages(result.output, options.outputMessages),
  };
}

function normalizeOptions(
  rawOptions: Record<string, unknown>,
  config?: Awaited<ReturnType<typeof loadTsConfig>>,
  yamlExecution?: ExecutionDefaults,
): NormalizedOptions {
  const cliWorkers = normalizeOptionalNumber(rawOptions.workers);
  const configWorkers = config?.execution?.workers;
  const workers = cliWorkers ?? configWorkers ?? 0;

  const cliOutputDir = normalizeString(rawOptions.output);

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
  const cliThreshold = normalizeOptionalNumber(rawOptions.threshold);
  const cliBudgetUsd = normalizeOptionalNumber(rawOptions.budgetUsd);
  const configAgentTimeoutSeconds =
    config?.execution?.agentTimeoutMs != null ? config.execution.agentTimeoutMs / 1000 : undefined;

  const cliMaxRetries = normalizeOptionalNumber(rawOptions.maxRetries);
  const configMaxRetries = config?.execution?.maxRetries;

  // Response cache: CLI request/path, then eval YAML, then TypeScript config, then default off.
  const cliCachePath = normalizeString(rawOptions.cachePath);
  const cliCache = normalizeBoolean(rawOptions.cache) || cliCachePath !== undefined;
  const cliNoCache = normalizeBoolean(rawOptions.noCache);
  const configCacheEnabled = config?.cache?.enabled;
  const configCachePath = normalizeString(config?.cache?.path);

  // Output dir: CLI --output > config output.dir > auto-generated
  const cliOut = normalizeString(rawOptions.out);
  const configOutputDir = normalizeString(config?.output?.dir);
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
  const resultsRepo = normalizeString(rawOptions.resultsRepo);
  const resultsPush = normalizeBoolean(rawOptions.resultsPush);
  const resultsNoPush = normalizeBoolean(rawOptions.noResultsPush);
  const resultsRequirePush = normalizeBoolean(rawOptions.resultsRequirePush);
  const resultsOverrides: ResultsPublishOverrides = {
    ...resultsRepoOverride(resultsRepo),
    ...(normalizeString(rawOptions.resultsBranch) !== undefined && {
      branch: normalizeString(rawOptions.resultsBranch),
    }),
    ...(normalizeString(rawOptions.resultsRemote) !== undefined && {
      remote: normalizeString(rawOptions.resultsRemote),
    }),
    ...(resultsPush || resultsNoPush ? { auto_push: resultsPush && !resultsNoPush } : {}),
    ...(resultsRequirePush ? { require_push: true } : {}),
  };

  return {
    target: singleTarget,
    cliTargets,
    targetsPath: normalizeString(rawOptions.targets),
    filter: normalizeFilter(rawOptions.filter),
    workers: workers > 0 ? workers : undefined,
    outputDir: cliOutputDir ?? configOutputDir,
    removedOut: cliOut,
    agentTimeoutSeconds: cliAgentTimeout ?? configAgentTimeoutSeconds,
    cliAgentTimeoutSeconds: cliAgentTimeout,
    maxRetries: cliMaxRetries ?? configMaxRetries ?? 2,
    cache: cliCache,
    cachePath: cliCachePath,
    noCache: cliNoCache,
    tsConfigCache: configCacheEnabled,
    tsConfigCachePath: configCachePath,
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
    artifacts: normalizeString(rawOptions.artifacts),
    outputFormat: normalizeString(rawOptions.outputFormat),
    graderTarget: normalizeString(rawOptions.graderTarget),
    model: normalizeString(rawOptions.model),
    outputMessages: normalizeOutputMessages(normalizeString(rawOptions.outputMessages)),
    threshold: cliThreshold,
    cliThreshold,
    tags: normalizeStringArray(rawOptions.tag),
    excludeTags: normalizeStringArray(rawOptions.excludeTag),
    transcript: normalizeString(rawOptions.transcript),
    recordReplay: normalizeString(rawOptions.recordReplay),
    recordReplayVariant: normalizeString(rawOptions.recordReplayVariant),
    experiment: normalizeString(rawOptions.experiment),
    budgetUsd: cliBudgetUsd,
    cliBudgetUsd,
    sourceMetadataByEvalFile: normalizeSourceMetadataByEvalFile(
      rawOptions.sourceMetadataByEvalFile,
    ),
    resultsOverrides: Object.keys(resultsOverrides).length > 0 ? resultsOverrides : undefined,
  } satisfies NormalizedOptions;
}

function withSourceMetadata(
  result: EvaluationResult,
  testFilePath: string,
  options: NormalizedOptions,
): EvaluationResult {
  const sourceMetadata = options.sourceMetadataByEvalFile?.get(path.resolve(testFilePath));
  if (!sourceMetadata) {
    return result;
  }
  return {
    ...result,
    metadata: {
      ...result.metadata,
      ...sourceMetadata,
    },
  };
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

function buildDefaultOutputPathForExperiment(
  cwd: string,
  resultGroup: string | undefined,
  runDirName: string,
): string {
  const runDir = buildDefaultRunDirFromName(cwd, resultGroup, runDirName);
  mkdirSync(runDir, { recursive: true });
  return path.join(runDir, 'index.jsonl');
}

function deriveEvalResultGroupName(evalFilePath: string | undefined): string {
  if (!evalFilePath) {
    return 'eval';
  }
  return (
    path
      .basename(evalFilePath)
      .replace(/\.eval\.ya?ml$/i, '')
      .replace(/\.ya?ml$/i, '')
      .replace(/[^A-Za-z0-9._-]/g, '-') || 'eval'
  );
}

const CLI_RUNTIME_SOURCE_OPTION_KEYS = [
  'target',
  'targets',
  'filter',
  'tag',
  'excludeTag',
  'workers',
  'dryRun',
  'dryRunDelay',
  'dryRunDelayMin',
  'dryRunDelayMax',
  'agentTimeout',
  'maxRetries',
  'cache',
  'cachePath',
  'noCache',
  'graderTarget',
  'model',
  'threshold',
  'budgetUsd',
  'transcript',
  'recordReplay',
  'recordReplayVariant',
  'workspacePath',
  'workspaceMode',
] as const;

function hasCliRuntimeSource(rawOptions: Record<string, unknown>): boolean {
  return CLI_RUNTIME_SOURCE_OPTION_KEYS.some((key) => {
    const value = rawOptions[key];
    if (Array.isArray(value)) {
      return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string') {
      return value.trim().length > 0 && value.trim() !== 'default';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value !== 0;
    }
    return value === true;
  });
}

function toRuntimeSourcePath(cwd: string, filePath: string | undefined): string | undefined {
  const trimmed = filePath?.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  const relative = path.relative(cwd, resolved);
  const displayPath =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : trimmed;
  return displayPath.split(path.sep).join('/');
}

function uniqueRuntimeSourcePaths(values: Iterable<string | undefined>): readonly string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))].sort();
}

function testSourceEvalPath(cwd: string, test: EvalTest): string | undefined {
  return (
    toRuntimeSourcePath(cwd, test.source?.evalFileRepoPath) ??
    toRuntimeSourcePath(cwd, test.source?.evalFileAbsolutePath) ??
    toRuntimeSourcePath(cwd, test.source?.evalFilePath)
  );
}

function testSourceEvalPathForComparison(test: EvalTest): string | undefined {
  const sourcePath = test.source?.evalFileAbsolutePath ?? test.source?.evalFilePath;
  return sourcePath ? path.resolve(sourcePath) : undefined;
}

function buildRuntimeConfigSource(params: {
  readonly activeTestFiles: readonly string[];
  readonly fileMetadata: ReadonlyMap<string, { readonly options: NormalizedOptions }>;
  readonly hasCliRuntimeConfig: boolean;
}): RunRuntimeSourceMetadata['config_source'] {
  const inlineFingerprints = new Set<string>();
  let hasInlineExperiment = false;
  let hasDefaultRuntime = false;

  for (const activeTestFile of params.activeTestFiles) {
    const experimentMetadata = params.fileMetadata.get(activeTestFile)?.options.experimentMetadata;
    if (experimentMetadata) {
      hasInlineExperiment = true;
      inlineFingerprints.add(experimentMetadata.fingerprint ?? activeTestFile);
    } else {
      hasDefaultRuntime = true;
    }
  }

  if (
    (hasInlineExperiment && params.hasCliRuntimeConfig) ||
    (hasInlineExperiment && hasDefaultRuntime) ||
    inlineFingerprints.size > 1
  ) {
    return 'mixed';
  }
  if (params.hasCliRuntimeConfig) {
    return 'cli_flags';
  }
  if (hasInlineExperiment) {
    return 'inline_experiment';
  }
  return 'defaults';
}

function buildRuntimeSourceMetadata(params: {
  readonly cwd: string;
  readonly activeTestFiles: readonly string[];
  readonly sourceTests: readonly EvalTest[];
  readonly fileMetadata: ReadonlyMap<string, { readonly options: NormalizedOptions }>;
  readonly experimentNamespace: string;
  readonly experimentNamespaceSource: RunRuntimeSourceMetadata['experiment_namespace_source'];
  readonly hasCliRuntimeConfig: boolean;
}): RunRuntimeSourceMetadata {
  const evalFiles = uniqueRuntimeSourcePaths(
    params.activeTestFiles.map((filePath) => toRuntimeSourcePath(params.cwd, filePath)),
  );
  const activeResolvedFiles = new Set(
    params.activeTestFiles.map((filePath) => path.resolve(filePath)),
  );
  const sourceEvalFiles = uniqueRuntimeSourcePaths(
    params.sourceTests.map((test) => testSourceEvalPath(params.cwd, test)),
  );
  const hasImportedSuite = params.sourceTests.some((test) => test.source?.importedSuiteName);
  const hasNonActiveSourceFile = params.sourceTests.some((test) => {
    const sourceFile = testSourceEvalPathForComparison(test);
    return sourceFile ? !activeResolvedFiles.has(sourceFile) : false;
  });
  const kind =
    params.activeTestFiles.length > 1
      ? 'multi_eval'
      : hasImportedSuite || hasNonActiveSourceFile
        ? 'wrapper_eval'
        : 'direct_suite';
  const wrapperEvalFile =
    kind === 'wrapper_eval'
      ? toRuntimeSourcePath(params.cwd, params.activeTestFiles[0])
      : undefined;

  return {
    schema_version: 'agentv.runtime_source.v1',
    kind,
    config_source: buildRuntimeConfigSource({
      activeTestFiles: params.activeTestFiles,
      fileMetadata: params.fileMetadata,
      hasCliRuntimeConfig: params.hasCliRuntimeConfig,
    }),
    experiment_namespace: params.experimentNamespace,
    experiment_namespace_source: params.experimentNamespaceSource,
    eval_files: evalFiles,
    ...(wrapperEvalFile && { wrapper_eval_file: wrapperEvalFile }),
    ...(sourceEvalFiles.length > 0 && { source_eval_files: sourceEvalFiles }),
  };
}

type ResolvedExperimentForRun = {
  readonly name?: string;
};

function resolveExperimentForRun(explicitExperiment?: string): ResolvedExperimentForRun {
  return explicitExperiment ? { name: explicitExperiment } : {};
}

function applyExperimentOptions(
  options: NormalizedOptions,
  experiment: ExperimentConfig | undefined,
): NormalizedOptions {
  if (!experiment) {
    return options;
  }

  const experimentTargetRefs = buildExperimentTargetRefs(experiment);
  const experimentTargetNames = experimentTargetRefs?.map((target) => target.name) ?? [];
  const experimentTarget =
    experiment.target && experiment.target.trim().length > 0 ? experiment.target : undefined;
  const nextCliTargets =
    options.cliTargets.length > 0
      ? options.cliTargets
      : experimentTargetNames.length > 0
        ? experimentTargetNames
        : experimentTarget
          ? [experimentTarget]
          : options.cliTargets;

  const workspaceMode =
    options.workspaceMode ?? readExperimentWorkspaceMode(experiment.workspace?.mode);
  const workspacePath = options.workspacePath ?? readExperimentWorkspacePath(experiment.workspace);
  return {
    ...options,
    target: options.target ?? (nextCliTargets.length === 1 ? nextCliTargets[0] : undefined),
    cliTargets: nextCliTargets,
    agentTimeoutSeconds: options.agentTimeoutSeconds ?? experiment.timeoutSeconds,
    workers: options.workers ?? experiment.workers,
    workspaceMode: workspacePath ? 'static' : workspaceMode,
    workspacePath,
    budgetUsd: options.budgetUsd ?? experiment.budgetUsd,
    threshold: options.threshold ?? experiment.threshold,
    experimentConfig: experiment,
    experimentMetadata: buildExperimentArtifactMetadata(experiment),
    experimentTargetRefs: options.cliTargets.length === 0 ? experimentTargetRefs : undefined,
    experimentTrialsConfig: buildExperimentTrialsConfig(experiment),
  };
}

function buildExperimentTargetRefs(
  experiment: ExperimentConfig,
): readonly EvalTargetRef[] | undefined {
  if (!experiment.targets || experiment.targets.length === 0) {
    return undefined;
  }
  return experiment.targets.map((target) => {
    if (typeof target === 'string') {
      return { name: target };
    }
    return {
      name: target.name,
      ...(target.useTarget !== undefined && { use_target: target.useTarget }),
      ...(target.hooks !== undefined && {
        hooks: target.hooks as EvalTargetRef['hooks'],
      }),
    };
  });
}

function buildExperimentTrialsConfig(experiment: ExperimentConfig): TrialsConfig | undefined {
  if (experiment.repeat) {
    if (experiment.repeat.count <= 1) {
      return undefined;
    }
    return {
      count: experiment.repeat.count,
      strategy: experiment.repeat.strategy,
      ...(experiment.repeat.costLimitUsd !== undefined && {
        costLimitUsd: experiment.repeat.costLimitUsd,
      }),
      ...(experiment.earlyExit !== undefined && { earlyExit: experiment.earlyExit }),
    };
  }
  if (!experiment.runs || experiment.runs <= 1) {
    return undefined;
  }
  return {
    count: experiment.runs,
    strategy: 'pass_at_k',
    ...(experiment.earlyExit !== undefined && { earlyExit: experiment.earlyExit }),
  };
}

type EffectiveRunPolicy = {
  readonly trialsConfig?: TrialsConfig;
  readonly threshold?: number;
  readonly timeoutSeconds?: number;
  readonly budgetUsd?: number;
  readonly hasScopedOverride: boolean;
};

function buildRunOverrideTrialsConfig(run: EvalRunOverride | undefined): TrialsConfig | undefined {
  const repeat = run?.repeat;
  if (!repeat || repeat.count <= 1) {
    return undefined;
  }
  return {
    count: repeat.count,
    strategy: repeat.strategy,
    ...(repeat.costLimitUsd !== undefined && { costLimitUsd: repeat.costLimitUsd }),
    ...(repeat.earlyExit !== undefined && { earlyExit: repeat.earlyExit }),
  };
}

function resolveEffectiveRunPolicy(params: {
  readonly test: EvalTest;
  readonly options: NormalizedOptions;
  readonly defaultTrialsConfig?: TrialsConfig;
  readonly defaultThreshold?: number;
  readonly defaultTimeoutSeconds?: number;
  readonly defaultBudgetUsd?: number;
}): EffectiveRunPolicy {
  const { test, options, defaultTrialsConfig, defaultThreshold, defaultTimeoutSeconds } = params;
  const run = test.run;
  const threshold = options.cliThreshold ?? run?.threshold ?? test.threshold ?? defaultThreshold;
  const timeoutSeconds =
    options.cliAgentTimeoutSeconds ?? run?.timeoutSeconds ?? defaultTimeoutSeconds;
  const budgetUsd = run?.budgetUsd ?? params.defaultBudgetUsd;
  const trialsConfig = buildRunOverrideTrialsConfig(run) ?? defaultTrialsConfig;
  return {
    ...(trialsConfig !== undefined && { trialsConfig }),
    ...(threshold !== undefined && { threshold }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(budgetUsd !== undefined && { budgetUsd }),
    hasScopedOverride: run !== undefined || test.threshold !== undefined,
  };
}

function runPolicyKey(policy: EffectiveRunPolicy): string {
  return JSON.stringify({
    trialsConfig: policy.trialsConfig,
    threshold: policy.threshold,
    timeoutSeconds: policy.timeoutSeconds,
    budgetUsd: policy.budgetUsd,
  });
}

function groupTestsByRunPolicy(params: {
  readonly tests: readonly EvalTest[];
  readonly options: NormalizedOptions;
  readonly defaultTrialsConfig?: TrialsConfig;
  readonly defaultThreshold?: number;
  readonly defaultTimeoutSeconds?: number;
  readonly defaultBudgetUsd?: number;
}): readonly { readonly policy: EffectiveRunPolicy; readonly tests: readonly EvalTest[] }[] {
  const groups = new Map<string, { policy: EffectiveRunPolicy; tests: EvalTest[] }>();
  for (const test of params.tests) {
    const policy = resolveEffectiveRunPolicy({
      test,
      options: params.options,
      defaultTrialsConfig: params.defaultTrialsConfig,
      defaultThreshold: params.defaultThreshold,
      defaultTimeoutSeconds: params.defaultTimeoutSeconds,
      defaultBudgetUsd: params.defaultBudgetUsd,
    });
    const key = runPolicyKey(policy);
    const existing = groups.get(key);
    if (existing) {
      existing.tests.push(test);
    } else {
      groups.set(key, { policy, tests: [test] });
    }
  }
  return [...groups.values()];
}

function readExperimentWorkspaceMode(value: unknown): 'pooled' | 'temp' | 'static' | undefined {
  return value === 'pooled' || value === 'temp' || value === 'static' ? value : undefined;
}

function readExperimentWorkspacePath(
  workspace: Record<string, unknown> | undefined,
): string | undefined {
  const value = workspace?.path;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function matchesTestFilter(id: string, filter: string | readonly string[]): boolean {
  return typeof filter === 'string'
    ? micromatch.isMatch(id, filter)
    : filter.some((pattern) => micromatch.isMatch(id, pattern));
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
  readonly suiteFilter?: string | readonly string[];
}): Promise<{
  readonly options: NormalizedOptions;
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
  const { testFilePath, repoRoot, cwd, options, suiteFilter } = params;

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
    filter: suiteFilter ?? options.filter,
    category,
  });
  const effectiveOptions = applyExperimentOptions(options, suite.experimentConfig);
  const testCases =
    suiteFilter && effectiveOptions.filter
      ? suite.tests.filter((testCase) =>
          matchesTestFilter(testCase.id, effectiveOptions.filter ?? ''),
        )
      : suite.tests;
  const testIds = testCases.map((value) => value.id);
  const suiteTargets = suite.targets;
  const defaultBudgetUsd =
    effectiveOptions.cliBudgetUsd === undefined
      ? (effectiveOptions.budgetUsd ?? suite.budgetUsd)
      : suite.budgetUsd;

  if (testCases.length === 0) {
    return {
      options: effectiveOptions,
      testIds,
      testCases,
      selections: [],
      trialsConfig: effectiveOptions.experimentTrialsConfig,
      suiteTargets,
      yamlWorkers: suite.workers,
      yamlCache: suite.cacheConfig?.enabled,
      yamlCachePath: suite.cacheConfig?.cachePath,
      budgetUsd: defaultBudgetUsd,
      failOnError: suite.failOnError,
      threshold: suite.threshold,
      tags: suite.metadata?.tags,
      providerFactory: suite.providerFactory,
    };
  }

  let selections: { selection: TargetSelection; inlineTargetLabel: string }[];

  if (effectiveOptions.transcript) {
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
      targetsFilePath: effectiveOptions.transcript,
    };
    selections = [
      {
        selection: transcriptSelection,
        inlineTargetLabel: `transcript (${path.basename(effectiveOptions.transcript)})`,
      },
    ];
  } else if (suite.inlineTarget && effectiveOptions.cliTargets.length === 0) {
    const targetDefinition = suite.inlineTarget;
    const resolvedTarget = resolveTargetDefinition(targetDefinition, process.env, testFilePath, {
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
  } else if (suite.providerFactory && effectiveOptions.cliTargets.length === 0) {
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
    const cliTargets = effectiveOptions.cliTargets;
    const suiteTargets = suite.targets;
    const suiteTargetRefs = suite.targetRefs;
    const experimentTargetRefs = effectiveOptions.experimentTargetRefs;

    // Resolve which target names to use (precedence: CLI/experiment > suite YAML targets > default)
    let targetNames: readonly string[];
    let targetRefs: readonly EvalTargetRef[] | undefined;
    if (cliTargets.length > 0) {
      targetNames = cliTargets;
      targetRefs = experimentTargetRefs;
    } else if (suiteTargets && suiteTargets.length > 0) {
      targetNames = suiteTargets;
      targetRefs = suiteTargetRefs;
    } else {
      targetNames = [];
      targetRefs = undefined;
    }

    if (targetNames.length > 1 || (targetNames.length === 1 && targetRefs)) {
      // Matrix mode: multiple targets
      const multiSelections = await selectMultipleTargets({
        testFilePath,
        repoRoot,
        cwd,
        explicitTargetsPath: effectiveOptions.targetsPath,
        env: process.env,
        targetNames,
        targetRefs,
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
        explicitTargetsPath: effectiveOptions.targetsPath,
        cliTargetName: targetNames.length === 1 ? targetNames[0] : effectiveOptions.target,
        env: process.env,
      });

      // Attach target hooks from eval file if available
      const singleTargetHooks = targetRefs?.find((ref) => ref.name === selection.targetName)?.hooks;
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
    options: effectiveOptions,
    testIds,
    testCases,
    selections,
    trialsConfig: effectiveOptions.experimentTrialsConfig,
    suiteTargets,
    yamlWorkers: suite.workers,
    yamlCache: suite.cacheConfig?.enabled,
    yamlCachePath: suite.cacheConfig?.cachePath,
    budgetUsd: defaultBudgetUsd,
    failOnError: suite.failOnError,
    threshold: suite.threshold,
    tags: suite.metadata?.tags,
    providerFactory: suite.providerFactory,
  };
}

function buildTaskBundleTargetSelections(
  activeTestFiles: readonly string[],
  fileMetadata: ReadonlyMap<
    string,
    { readonly selections: readonly { readonly selection: TargetSelection }[] }
  >,
): readonly TaskBundleTargetSelection[] {
  return activeTestFiles.flatMap((testFilePath) => {
    const meta = fileMetadata.get(testFilePath);
    if (!meta) {
      return [];
    }
    return meta.selections.map(({ selection }) => ({
      evalFileAbsolutePath: testFilePath,
      targetName: selection.targetName,
      resolvedTargetName: selection.resolvedTarget.name,
      definitions: selection.definitions,
    }));
  });
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
  readonly agentTimeoutSeconds?: number;
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
    agentTimeoutSeconds,
    matrixMode,
    budgetUsd,
    runBudgetTracker,
    failOnError,
    providerFactory,
  } = params;

  const targetName = selection.targetName;
  const replayRecording = options.recordReplay
    ? {
        fixturesPath: path.resolve(options.recordReplay),
        sourceTarget: targetName,
        variant: options.recordReplayVariant,
      }
    : undefined;

  await ensureFileExists(testFilePath, 'Test file');

  // CLI provider verbose logging should only be enabled when --verbose flag is passed
  const resolvedTargetSelection = applyVerboseOverride(selection, options.verbose);
  const providerLabel = resolvedTargetSelection.resolvedTarget.kind;
  const targetMessage = options.verbose
    ? `Using target (${resolvedTargetSelection.targetSource}): ${resolvedTargetSelection.targetName} ${buildTargetLabelSuffix(providerLabel, resolvedTargetSelection.resolvedTarget)} via ${resolvedTargetSelection.targetsFilePath}`
    : `Using target: ${inlineTargetLabel}`;
  if (!progressReporter.isInteractive || options.verbose) {
    console.log(`${targetMessage}`);
  }

  // Hint about pipeline for CLI agent targets
  const targetKind = resolvedTargetSelection.resolvedTarget.kind;
  if (targetKind === 'claude-cli' || targetKind === 'copilot-cli') {
    console.log('');
    console.log('  TIP: For subagent-mode evals, use `agentv pipeline` instead of `eval run`.');
    console.log('  The agent orchestrates executor + grader subagents directly.');
    console.log('  Run: agentv pipeline --help');
    console.log('');
  }

  const agentTimeoutMs =
    agentTimeoutSeconds != null ? Math.max(0, agentTimeoutSeconds) * 1000 : undefined;

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
  if (isVSCodeProvider) {
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
    threshold: params.threshold,
    targetHooks: resolvedTargetSelection.targetHooks,
    replayRecording,
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
      const resultWithMetadata = withSourceMetadata(result, testFilePath, options);
      const trimmedResult = prepareResultForJsonl(resultWithMetadata, options);
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
        durationMs: event.durationMs,
        totalDurationMs: event.evalRunDurationMs,
      });
    },
  });

  return { results: results.map((result) => withSourceMetadata(result, testFilePath, options)) };
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

  // Check required_version before proceeding with eval. A mismatch is advisory
  // unless the user explicitly opts into --strict.
  let requiredVersionCheck: VersionCheckResult | undefined;
  if (yamlConfig?.required_version) {
    requiredVersionCheck = await enforceRequiredVersion(yamlConfig.required_version, {
      strict: normalizeBoolean(input.rawOptions.strict),
    });
  }

  let options = normalizeOptions(input.rawOptions, config, yamlConfig?.execution);
  const resolvedExperiment = resolveExperimentForRun(options.experiment);
  const evalPathInputs = input.testFiles.length > 0 ? [...input.testFiles] : [];
  if (evalPathInputs.length === 0 && process.stdin.isTTY) {
    const { launchInteractiveWizard } = await import('./interactive.js');
    await launchInteractiveWizard();
    return undefined;
  }
  const resolvedTestFiles = await resolveEvalPaths(evalPathInputs, cwd);
  const fallbackResultGroupName =
    resolvedTestFiles.length === 1 ? deriveEvalResultGroupName(resolvedTestFiles[0]) : 'multi-eval';
  const primarySuite =
    resolvedTestFiles.length > 0
      ? await loadTestSuite(resolvedTestFiles[0], repoRoot, {
          verbose: options.verbose,
          filter: options.filter,
          category: deriveCategory(path.relative(cwd, resolvedTestFiles[0])),
        })
      : undefined;
  const resultGroupName =
    resolvedTestFiles.length === 1
      ? (primarySuite?.metadata?.name ?? fallbackResultGroupName)
      : fallbackResultGroupName;
  const experimentNamespaceSource: RunRuntimeSourceMetadata['experiment_namespace_source'] =
    resolvedExperiment.name
      ? 'cli'
      : resolvedTestFiles.length > 1
        ? 'multi_eval'
        : primarySuite?.metadata?.name
          ? 'eval_metadata'
          : 'eval_filename';
  options = {
    ...options,
    experiment: resolvedExperiment.name ?? resultGroupName,
  };
  const hasCliRuntimeConfig = hasCliRuntimeSource(input.rawOptions);

  if (!process.env.AGENTV_EXPERIMENT) {
    process.env.AGENTV_EXPERIMENT = normalizeExperimentName(options.experiment);
  }

  // Validate --grader-target / --model combinations
  if (options.graderTarget === 'agentv' && !options.model) {
    throw new Error('--grader-target agentv requires --model (e.g., --model openai:gpt-5-mini)');
  }

  if (options.removedOut) {
    throw new Error(
      [
        '--out was removed from agentv eval. Use --output <dir> for the canonical run directory.',
        'Flat result file export from agentv eval has been removed.',
        `Migration example: --out ${options.removedOut} -> --output <dir>`,
      ].join('\n'),
    );
  }
  if (options.outputFormat) {
    throw new Error(
      '--output-format was removed from agentv eval. The run directory always writes index.jsonl.',
    );
  }
  if (options.artifacts) {
    throw new Error(artifactsMigrationMessage(options.artifacts, options.outputDir));
  }
  if (options.outputDir && looksLikeLegacyOutputFilePath(options.outputDir)) {
    throw new Error(outputFileMigrationMessage(options.outputDir));
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

  // --resume / --rerun-failed without an explicit --output: default to the
  // last-known run dir for this cwd from .agentv/cache.json. Matches promptfoo's
  // `--resume [evalId]` and OpenCompass's `-r [timestamp]` "latest by default"
  // convention. The cache pointer is written by saveRunCache after every eval.
  if (options.resume && !options.retryErrors && !options.outputDir) {
    const cachedDir = await resolveCachedRunDir(cwd);
    if (cachedDir) {
      options = { ...options, outputDir: cachedDir };
      const flagLabel = options.rerunFailed ? 'rerun-failed' : 'resume';
      const displayDir = path.relative(cwd, cachedDir) || cachedDir;
      console.log(`Auto-detected last run dir for --${flagLabel}: ${displayDir}`);
    }
  }

  // --resume / --rerun-failed: skip already-completed tests and append to existing output.
  // IMPORTANT: JSONL must be loaded before the output writer is created (same file).
  let resumeSkipKeys: Set<string> | undefined;
  let isResumeAppend = false;
  if (options.resume && !options.retryErrors) {
    const explicitResumeDir = options.outputDir;
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
        'Warning: --resume requires --output <dir> (or a cached last run) to identify the run directory. Ignoring --resume.',
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

  // Resolve artifact directory (runDir) and primary output path.
  // Precedence: --output > config output.dir > default
  const explicitDir = options.outputDir;
  let runDir: string;
  let outputPath: string;
  const runDirName = process.env.AGENTV_RUN_TIMESTAMP?.trim() || createRunDirName();

  if (explicitDir) {
    runDir = path.resolve(explicitDir);
    mkdirSync(runDir, { recursive: true });
    outputPath = path.join(runDir, 'index.jsonl');
  } else {
    // Default: .agentv/results/<eval-name>/<timestamp>/.
    outputPath = buildDefaultOutputPathForExperiment(cwd, resultGroupName, runDirName);
    runDir = path.dirname(outputPath);
  }
  if (!process.env.AGENTV_RUN_TIMESTAMP) {
    process.env.AGENTV_RUN_TIMESTAMP = path.basename(runDir);
  }
  process.env.AGENTV_RUN_DIR = runDir;

  // Initialize OTel exporter if --export-otel or --otel-file is set
  let otelExporter: OtelTraceExporterType | null = null;
  const useFileExport = !!options.otelFile;

  if (options.exportOtel || useFileExport) {
    try {
      const { OtelTraceExporter } = await import('@agentv/core');

      // Resolve endpoint and headers
      let endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      let headers: Record<string, string> = {};
      let resourceAttributes: Record<string, string | number | boolean> = {};

      if (options.otelBackend) {
        const resolvedBackend = await resolveOtelBackend(options.otelBackend, {
          env: process.env,
          cwd,
        });

        if (resolvedBackend) {
          endpoint = resolvedBackend.endpoint;
          headers = { ...headers, ...resolvedBackend.headers };
          resourceAttributes = { ...resourceAttributes, ...resolvedBackend.resourceAttributes };
          for (const warning of resolvedBackend.warnings ?? []) {
            console.warn(warning);
          }
        } else {
          console.warn(`Unknown OTel backend resolver: ${options.otelBackend}`);
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
        resourceAttributes,
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

  console.log(`Artifact directory: ${runDir}`);

  // Log file export paths
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

  // CLI --budget-usd is invocation-wide. Inline experiment.budget_usd is handled per eval file.
  const runBudgetTracker = options.cliBudgetUsd
    ? new RunBudgetTracker(options.cliBudgetUsd)
    : undefined;
  if (runBudgetTracker) {
    console.log(`Run budget cap: $${runBudgetTracker.budgetCapUsd.toFixed(2)}`);
  }

  // Each file gets its own worker policy from CLI/config or that file's experiment block.
  const fileMetadata = new Map<
    string,
    {
      readonly options: NormalizedOptions;
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
      suiteFilter: undefined,
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
    tsConfigCache: options.tsConfigCache,
  });
  const activeCachePath = options.cachePath ?? yamlCachePath ?? options.tsConfigCachePath;
  const cache = cacheEnabled
    ? new ResponseCache(activeCachePath ? path.resolve(activeCachePath) : undefined)
    : undefined;

  if (cache) {
    console.log(`Response cache: enabled (${cache.cachePath})`);
  }
  if (options.recordReplay) {
    console.log(`Replay recording: ${path.resolve(options.recordReplay)}`);
  }

  // Resolve a global summary threshold only when the CLI supplies one or the first
  // active eval file is the only source of runtime policy. Multi-file runs with
  // inline thresholds are summarized from per-result execution status instead.
  const yamlThreshold = firstMeta?.threshold;
  const resolvedThreshold = options.threshold ?? yamlThreshold;
  if (resolvedThreshold !== undefined && (resolvedThreshold < 0 || resolvedThreshold > 1)) {
    throw new Error('--threshold must be between 0 and 1');
  }

  // Build the output writer. Primary output is always JSONL to the artifact directory.
  const outputWriter: OutputWriter = await createOutputWriter(primaryWritePath, {
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
  const activeSourceTests = activeTestFiles.flatMap(
    (activeTestFile) => fileMetadata.get(activeTestFile)?.testCases ?? [],
  );
  const singleActiveFileMetadata =
    activeTestFiles.length === 1 ? fileMetadata.get(activeTestFiles[0]) : undefined;
  const runExperimentMetadata = singleActiveFileMetadata?.options.experimentMetadata;
  const runtimeSourceMetadata = buildRuntimeSourceMetadata({
    cwd,
    activeTestFiles,
    sourceTests: activeSourceTests,
    fileMetadata,
    experimentNamespace: normalizeExperimentName(options.experiment),
    experimentNamespaceSource,
    hasCliRuntimeConfig,
  });
  const hasPerFileRuntimeThresholds =
    options.cliThreshold === undefined &&
    activeTestFiles.some(
      (activeTestFile) => fileMetadata.get(activeTestFile)?.options.threshold !== undefined,
    );

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

  // Write a stub summary.json before dispatching tests, carrying the planned
  // execution count so an interrupted run can still surface as resumable in
  // Dashboard (results.length < planned_test_count) even when every recorded row
  // has execution_status: ok. The end-of-run write preserves this value via
  // readPlannedTestCount inside aggregateRunDir / writeArtifactsFromResults.
  // Skip on resume — we want to preserve the *original* planned count.
  if (!isResumeAppend && totalEvalCount > 0) {
    const evalFile = activeTestFiles.length === 1 ? activeTestFiles[0] : '';
    await writeInitialRunSummaryArtifact(runDir, {
      evalFile,
      plannedTestCount: totalEvalCount,
      experiment: normalizeExperimentName(options.experiment),
      experimentMetadata: runExperimentMetadata,
      runtimeSource: runtimeSourceMetadata,
    });
  }

  // Periodic WIP checkpoint loop: push partial results to a unique non-default
  // branch every ~60s so pod loss doesn't discard completed-test output.
  // Only active when a results repo with auto_push is configured; otherwise a no-op.
  let wipLoop: WipCheckpointLoop | undefined;
  let wipCleanedUp = false;
  let finalExportStatus: RemoteExportStatus = 'disabled';
  {
    const wipConfig = await loadNormalizedResultsConfig(
      cwd,
      undefined,
      options.resultsOverrides,
    ).catch(() => undefined);
    if (wipConfig?.auto_push) {
      wipLoop = new WipCheckpointLoop({
        config: wipConfig,
        runDir,
        destinationPath: getRelativeRunPath(cwd, runDir),
      });
      await wipLoop.start();
    }
  }

  // Eval files run sequentially; within each file, --workers N test cases run in parallel.
  // This matches industry practice (promptfoo, deepeval, OpenAI Evals) and avoids cross-file
  // workspace races without any grouping complexity.
  let hasScopedRunPolicies = false;
  try {
    for (const testFilePath of activeTestFiles) {
      const targetPrep = fileMetadata.get(testFilePath);
      if (!targetPrep) {
        throw new Error(`Missing metadata for ${testFilePath}`);
      }
      const fileOptions = targetPrep.options;
      const fileBudgetTracker =
        runBudgetTracker ??
        (fileOptions.budgetUsd !== undefined
          ? new RunBudgetTracker(fileOptions.budgetUsd)
          : undefined);
      // Run-level budget check: skip remaining files if budget exceeded
      if (fileBudgetTracker?.isExceeded()) {
        const budgetMsg = `Run budget exceeded ($${fileBudgetTracker.currentCostUsd.toFixed(4)} / $${fileBudgetTracker.budgetCapUsd.toFixed(4)})`;
        console.log(`\n⚠ ${budgetMsg} — skipping ${path.basename(testFilePath)}`);
        for (const { selection } of targetPrep.selections) {
          const skippedResults: EvaluationResult[] = targetPrep.testCases.map((testCase) => ({
            timestamp: new Date().toISOString(),
            testId: testCase.id,
            score: 0,
            assertions: [],
            output: budgetMsg,
            trace: buildTraceFromMessages({
              input: testCase.input as EvaluationResult['input'],
              output: [{ role: 'assistant' as const, content: budgetMsg }],
              finalOutput: budgetMsg,
              target: selection.targetName,
              testId: testCase.id,
              conversationId: testCase.conversation_id,
              error: budgetMsg,
            }),
            error: budgetMsg,
            budgetExceeded: true,
            executionStatus: 'execution_error' as const,
            failureStage: 'setup' as const,
            failureReasonCode: 'budget_exceeded' as const,
            executionError: { message: budgetMsg, stage: 'setup' as const },
            target: selection.targetName,
          }));
          for (const r of skippedResults) {
            await outputWriter.append(withSourceMetadata(r, testFilePath, fileOptions));
          }
          allResults.push(
            ...skippedResults.map((r) => withSourceMetadata(r, testFilePath, fileOptions)),
          );
        }
        continue;
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
            const runGroups = groupTestsByRunPolicy({
              tests: filteredTestCases,
              options: fileOptions,
              defaultTrialsConfig: fileOptions.transcript ? undefined : targetPrep.trialsConfig,
              defaultThreshold: fileOptions.threshold ?? targetPrep.threshold,
              defaultTimeoutSeconds: fileOptions.agentTimeoutSeconds,
              defaultBudgetUsd: targetPrep.budgetUsd,
            });
            const groupResults: EvaluationResult[] = [];
            for (const group of runGroups) {
              hasScopedRunPolicies ||= group.policy.hasScopedOverride;
              const result = await runSingleEvalFile({
                testFilePath,
                cwd,
                repoRoot,
                options: fileOptions,
                outputWriter,
                otelExporter,
                cache,
                evaluationRunner,
                workersOverride: fileOptions.workers,
                yamlWorkers: targetPrep.yamlWorkers,
                progressReporter,
                seenTestCases,
                displayIdTracker,
                selection,
                inlineTargetLabel,
                testCases: group.tests,
                trialsConfig: fileOptions.transcript ? undefined : group.policy.trialsConfig,
                agentTimeoutSeconds: group.policy.timeoutSeconds,
                matrixMode: targetPrep.selections.length > 1,
                budgetUsd: group.policy.budgetUsd,
                runBudgetTracker: fileBudgetTracker,
                failOnError: targetPrep.failOnError,
                threshold: group.policy.threshold,
                providerFactory: transcriptProviderFactory ?? targetPrep.providerFactory,
              });
              groupResults.push(...result.results);
            }
            const evalFile = path.relative(cwd, testFilePath);
            const existingSummary = remoteEvalSummaries.find(
              (summary) => summary.evalFile === evalFile,
            );
            if (existingSummary) {
              existingSummary.results.push(...groupResults);
            } else {
              remoteEvalSummaries.push({
                evalFile,
                results: [...groupResults],
              });
            }

            return groupResults;
          } catch (fileError) {
            // before_all or other setup failures should not abort the entire run.
            // Mark all tests in this file as errors and continue with other files.
            const message = fileError instanceof Error ? fileError.message : String(fileError);
            console.error(
              `\n[ERROR] ⚠ Eval file failed: ${path.basename(testFilePath)} — ${message}\n`,
            );
            const errorResults: EvaluationResult[] = filteredTestCases.map((testCase) =>
              withSourceMetadata(
                {
                  timestamp: new Date().toISOString(),
                  testId: testCase.id,
                  score: 0,
                  assertions: [],
                  output: message,
                  trace: buildTraceFromMessages({
                    input: testCase.input as EvaluationResult['input'],
                    output: [{ role: 'assistant' as const, content: message }],
                    finalOutput: message,
                    target: selection.targetName,
                    testId: testCase.id,
                    conversationId: testCase.conversation_id,
                    error: message,
                  }),
                  scores: [],
                  error: message,
                  executionStatus: 'execution_error' as const,
                  failureStage: 'setup' as const,
                  failureReasonCode: 'setup_error' as const,
                  durationMs: 0,
                  tokenUsage: { input: 0, output: 0 },
                  target: selection.targetName,
                },
                testFilePath,
                fileOptions,
              ),
            );
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
    if (isResumeAppend) {
      const content = await readFile(outputPath, 'utf8');
      summaryResults = deduplicateByTestIdTarget(parseJsonlResults(content));
    }

    const thresholdOpts =
      hasScopedRunPolicies || hasPerFileRuntimeThresholds
        ? { thresholdLabel: 'configured threshold(s)', useExecutionStatus: true }
        : resolvedThreshold !== undefined
          ? { threshold: resolvedThreshold }
          : undefined;
    const summary = calculateEvaluationSummary(summaryResults, thresholdOpts);
    console.log(formatEvaluationSummary(summary, thresholdOpts));
    if (
      requiredVersionCheck &&
      !requiredVersionCheck.satisfied &&
      (summary.qualityFailureCount > 0 || summary.executionErrorCount > 0)
    ) {
      console.log(`\n${formatRequiredVersionFailureNote(requiredVersionCheck)}`);
    }

    // Exit code: 2 when all tests are execution errors (no evaluation performed),
    // 1 when any test scored below threshold.
    const allExecutionErrors = summary.total > 0 && summary.executionErrorCount === summary.total;
    const thresholdFailed =
      (thresholdOpts?.useExecutionStatus === true || resolvedThreshold !== undefined) &&
      summary.qualityFailureCount > 0;

    // Print matrix summary when multiple targets were evaluated
    if (isMatrixMode && summaryResults.length > 0) {
      console.log(formatMatrixSummary(summaryResults));
    }

    // Write artifacts to the run directory (always, not conditional on flags)
    if (allResults.length > 0) {
      const evalFile = activeTestFiles.length === 1 ? activeTestFiles[0] : '';
      const sourceTests = activeSourceTests;
      const taskBundleTargets = buildTaskBundleTargetSelections(activeTestFiles, fileMetadata);
      if (isResumeAppend) {
        // Resume mode: write per-test artifacts for newly-run tests, then aggregate
        // from the full index.jsonl (old + new results with deduplication)
        const { writePerTestArtifacts } = await import('./artifact-writer.js');
        await writePerTestArtifacts(allResults, runDir, {
          experiment: normalizeExperimentName(options.experiment),
          resultGroup: resultGroupName,
          cwd,
          repoRoot,
          sourceTests,
          taskBundleTargets,
          runtimeSource: runtimeSourceMetadata,
        });
        const { summaryPath } = await aggregateRunDir(runDir, {
          evalFile,
          experiment: normalizeExperimentName(options.experiment),
          experimentMetadata: runExperimentMetadata,
          runtimeSource: runtimeSourceMetadata,
        });
        const indexPath = path.join(runDir, 'index.jsonl');
        console.log(`Artifact workspace updated: ${runDir}`);
        console.log(`  Index: ${indexPath}`);
        console.log(`  Per-test artifacts: ${runDir} (${allResults.length} new test directories)`);
        console.log(`  Summary: ${summaryPath}`);
      } else {
        const { testArtifactDir, summaryPath, indexPath } = await writeArtifactsFromResults(
          allResults,
          runDir,
          {
            evalFile,
            experiment: normalizeExperimentName(options.experiment),
            experimentMetadata: runExperimentMetadata,
            resultGroup: resultGroupName,
            cwd,
            repoRoot,
            sourceTests,
            taskBundleTargets,
            runtimeSource: runtimeSourceMetadata,
          },
        );
        console.log(`Artifact workspace written to: ${runDir}`);
        console.log(`  Index: ${indexPath}`);
        console.log(
          `  Per-test artifacts: ${testArtifactDir} (${allResults.length} test directories)`,
        );
        console.log(`  Summary: ${summaryPath}`);
      }
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

      finalExportStatus = await maybeAutoExportRunArtifacts({
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
        results_overrides: options.resultsOverrides,
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

    // WIP cleanup on success: remove the WIP branch only after the final
    // results branch is confirmed published (or confirmed already up to date).
    // If export failed, leave the remote WIP checkpoint as the durable copy.
    if (
      wipLoop &&
      (finalExportStatus === 'published' || finalExportStatus === 'already_published')
    ) {
      wipCleanedUp = true;
      await wipLoop.stopAndDeleteWipBranch();
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
    // WIP cleanup on failure/interrupt: stop the loop but leave the remote
    // WIP branch intact for manual recovery.
    if (wipLoop && !wipCleanedUp) {
      await wipLoop.stop().catch(() => undefined);
    }
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
