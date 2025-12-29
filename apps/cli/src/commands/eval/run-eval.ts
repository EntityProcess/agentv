import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type EvalCase,
  type EvaluationCache,
  type EvaluationResult,
  type ProviderResponse,
  runEvaluation as defaultRunEvaluation,
  ensureVSCodeSubagents,
  loadEvalCases,
  subscribeToCodexLogEntries,
} from '@agentv/core';

import { loadEnvFromHierarchy } from './env.js';
import {
  type OutputFormat,
  type OutputWriter,
  createOutputWriter,
  getDefaultExtension,
} from './output-writer.js';
import { ProgressDisplay, type WorkerProgress } from './progress-display.js';
import { calculateEvaluationSummary, formatEvaluationSummary } from './statistics.js';
import { type TargetSelection, selectTarget } from './targets.js';

const DEFAULT_WORKERS = 3;

interface RunEvalCommandInput {
  readonly testFiles: readonly string[];
  readonly rawOptions: Record<string, unknown>;
}

interface NormalizedOptions {
  readonly target?: string;
  readonly targetsPath?: string;
  readonly evalId?: string;
  readonly workers?: number;
  readonly outPath?: string;
  readonly format: OutputFormat;
  readonly dryRun: boolean;
  readonly dryRunDelay: number;
  readonly dryRunDelayMin: number;
  readonly dryRunDelayMax: number;
  readonly agentTimeoutSeconds: number;
  readonly maxRetries: number;
  readonly cache: boolean;
  readonly verbose: boolean;
  readonly dumpPrompts?: string | boolean;
  readonly dumpTraces: boolean;
  readonly includeTrace: boolean;
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

function normalizeOptions(rawOptions: Record<string, unknown>): NormalizedOptions {
  const formatStr = normalizeString(rawOptions.outputFormat) ?? 'jsonl';
  const format: OutputFormat = formatStr === 'yaml' ? 'yaml' : 'jsonl';

  const workers = normalizeNumber(rawOptions.workers, 0);

  return {
    target: normalizeString(rawOptions.target),
    targetsPath: normalizeString(rawOptions.targets),
    evalId: normalizeString(rawOptions.evalId),
    workers: workers > 0 ? workers : undefined,
    outPath: normalizeString(rawOptions.out),
    format,
    dryRun: normalizeBoolean(rawOptions.dryRun),
    dryRunDelay: normalizeNumber(rawOptions.dryRunDelay, 0),
    dryRunDelayMin: normalizeNumber(rawOptions.dryRunDelayMin, 0),
    dryRunDelayMax: normalizeNumber(rawOptions.dryRunDelayMax, 0),
    agentTimeoutSeconds: normalizeNumber(rawOptions.agentTimeout, 120),
    maxRetries: normalizeNumber(rawOptions.maxRetries, 2),
    cache: normalizeBoolean(rawOptions.cache),
    verbose: normalizeBoolean(rawOptions.verbose),
    dumpPrompts: rawOptions.dumpPrompts as string | boolean | undefined,
    dumpTraces: normalizeBoolean(rawOptions.dumpTraces),
    includeTrace: normalizeBoolean(rawOptions.includeTrace),
  } satisfies NormalizedOptions;
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

async function findRepoRoot(start: string): Promise<string> {
  const fallback = path.resolve(start);
  let current: string | undefined = fallback;

  while (current !== undefined) {
    const candidate = path.join(current, '.git');
    try {
      await access(candidate, constants.F_OK);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return fallback;
}

function buildDefaultOutputPath(cwd: string, format: OutputFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = 'eval';
  const extension = getDefaultExtension(format);
  return path.join(cwd, '.agentv', 'results', `${baseName}_${timestamp}${extension}`);
}

function resolvePromptDirectory(
  option: string | boolean | undefined,
  cwd: string,
): string | undefined {
  if (option === undefined) {
    return undefined;
  }
  if (typeof option === 'string' && option.trim().length > 0) {
    return path.resolve(cwd, option);
  }
  return path.join(cwd, '.agentv', 'prompts');
}

function createEvaluationCache(): EvaluationCache {
  const store = new Map<string, ProviderResponse>();
  return {
    async get(key: string) {
      return store.get(key);
    },
    async set(key: string, value: ProviderResponse) {
      store.set(key, value);
    },
  } satisfies EvaluationCache;
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
  readonly evalCases: readonly EvalCase[];
  readonly selection: TargetSelection;
  readonly inlineTargetLabel: string;
}> {
  const { testFilePath, repoRoot, cwd, options } = params;

  await ensureFileExists(testFilePath, 'Test file');
  await loadEnvFromHierarchy({
    testFilePath,
    repoRoot,
    verbose: options.verbose,
  });

  const selection = await selectTarget({
    testFilePath,
    repoRoot,
    cwd,
    explicitTargetsPath: options.targetsPath,
    cliTargetName: options.target,
    dryRun: options.dryRun,
    dryRunDelay: options.dryRunDelay,
    dryRunDelayMin: options.dryRunDelayMin,
    dryRunDelayMax: options.dryRunDelayMax,
    env: process.env,
  });

  const providerLabel = options.dryRun
    ? `${selection.resolvedTarget.kind} (dry-run)`
    : selection.resolvedTarget.kind;
  const inlineTargetLabel = `${selection.targetName} [provider=${providerLabel}]`;

  const evalCases = await loadEvalCases(testFilePath, repoRoot, {
    verbose: options.verbose,
    evalId: options.evalId,
  });
  const filteredIds = options.evalId
    ? evalCases.filter((value) => value.id === options.evalId).map((value) => value.id)
    : evalCases.map((value) => value.id);

  return { evalIds: filteredIds, evalCases, selection, inlineTargetLabel };
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
  readonly cache?: EvaluationCache;
  readonly evaluationRunner: typeof defaultRunEvaluation;
  readonly workersOverride?: number;
  readonly progressReporter: ProgressReporter;
  readonly seenEvalCases: Set<string>;
  readonly displayIdTracker: { getOrAssign(evalKey: string): number };
  readonly selection: TargetSelection;
  readonly inlineTargetLabel: string;
  readonly evalCases: readonly EvalCase[];
}): Promise<{ results: EvaluationResult[]; promptDumpDir?: string }> {
  const {
    testFilePath,
    cwd,
    repoRoot,
    options,
    outputWriter,
    cache,
    evaluationRunner,
    workersOverride,
    progressReporter,
    seenEvalCases,
    displayIdTracker,
    selection,
    inlineTargetLabel,
    evalCases,
  } = params;

  await ensureFileExists(testFilePath, 'Test file');

  // CLI provider verbose logging should only be enabled when --verbose flag is passed
  const resolvedTargetSelection = applyVerboseOverride(selection, options.verbose);
  const providerLabel = options.dryRun
    ? `${resolvedTargetSelection.resolvedTarget.kind} (dry-run)`
    : resolvedTargetSelection.resolvedTarget.kind;
  const targetMessage = options.verbose
    ? `Using target (${resolvedTargetSelection.targetSource}): ${resolvedTargetSelection.targetName} [provider=${providerLabel}] via ${resolvedTargetSelection.targetsFilePath}`
    : `Using target: ${inlineTargetLabel}`;
  if (!progressReporter.isInteractive || options.verbose) {
    console.log(targetMessage);
  }

  const promptDumpDir = resolvePromptDirectory(options.dumpPrompts, cwd);
  if (promptDumpDir) {
    await mkdir(promptDumpDir, { recursive: true });
    if (options.verbose) {
      console.log(`Prompt dumps enabled at: ${promptDumpDir}`);
    }
  }

  const agentTimeoutMs = Math.max(0, options.agentTimeoutSeconds) * 1000;

  // Resolve workers: CLI flag (adjusted per-file) > target setting > default (1)
  const workerPreference = workersOverride ?? options.workers;
  let resolvedWorkers =
    workerPreference ?? resolvedTargetSelection.resolvedTarget.workers ?? DEFAULT_WORKERS;
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
    await ensureVSCodeSubagents({
      kind: resolvedTargetSelection.resolvedTarget.kind as 'vscode' | 'vscode-insiders',
      count: resolvedWorkers,
      verbose: options.verbose,
    });
  }

  const results = await evaluationRunner({
    testFilePath,
    repoRoot,
    target: resolvedTargetSelection.resolvedTarget,
    targets: resolvedTargetSelection.definitions,
    env: process.env,
    maxRetries: Math.max(0, options.maxRetries),
    agentTimeoutMs,
    promptDumpDir,
    cache,
    useCache: options.cache,
    evalId: options.evalId,
    evalCases,
    verbose: options.verbose,
    maxConcurrency: resolvedWorkers,
    onResult: async (result: EvaluationResult) => {
      await outputWriter.append(result);
    },
    onProgress: async (event) => {
      const evalKey = makeEvalKey(testFilePath, event.evalId);
      if (event.status === 'pending' && !seenEvalCases.has(evalKey)) {
        seenEvalCases.add(evalKey);
        progressReporter.setTotal(seenEvalCases.size);
      }
      const displayId = displayIdTracker.getOrAssign(evalKey);

      progressReporter.update(displayId, {
        workerId: displayId,
        evalId: event.evalId,
        status: event.status,
        startedAt: event.startedAt,
        completedAt: event.completedAt,
        error: event.error,
        targetLabel: inlineTargetLabel,
      });
    },
  });

  return { results: [...results], promptDumpDir };
}

export async function runEvalCommand(input: RunEvalCommandInput): Promise<void> {
  const options = normalizeOptions(input.rawOptions);
  const cwd = process.cwd();
  const repoRoot = await findRepoRoot(cwd);

  if (options.verbose) {
    console.log(`Repository root: ${repoRoot}`);
  }

  const outputPath = options.outPath
    ? path.resolve(options.outPath)
    : buildDefaultOutputPath(cwd, options.format);
  console.log(`Output path: ${outputPath}`);

  const outputWriter = await createOutputWriter(outputPath, options.format);
  const cache = options.cache ? createEvaluationCache() : undefined;
  const evaluationRunner = await resolveEvaluationRunner();
  const allResults: EvaluationResult[] = [];
  let lastPromptDumpDir: string | undefined;
  const seenEvalCases = new Set<string>();
  const resolvedTestFiles = input.testFiles.map((file) => path.resolve(file));
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
      readonly evalCases: readonly EvalCase[];
      readonly selection: TargetSelection;
      readonly inlineTargetLabel: string;
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
  const totalEvalCount = Array.from(fileMetadata.values()).reduce(
    (sum, meta) => sum + meta.evalIds.length,
    0,
  );
  if (totalEvalCount === 0) {
    throw new Error('No eval cases matched the provided filters.');
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
    progressReporter.addLogPaths([entry.filePath]);
  });
  for (const [testFilePath, meta] of fileMetadata.entries()) {
    for (const evalId of meta.evalIds) {
      const evalKey = makeEvalKey(testFilePath, evalId);
      seenEvalCases.add(evalKey);
      const displayId = displayIdTracker.getOrAssign(evalKey);
      progressReporter.update(displayId, {
        workerId: displayId,
        evalId,
        status: 'pending',
        targetLabel: meta.inlineTargetLabel,
      });
    }
  }

  try {
    await runWithLimit(resolvedTestFiles, fileConcurrency, async (testFilePath) => {
      const targetPrep = fileMetadata.get(testFilePath);
      if (!targetPrep) {
        throw new Error(`Missing metadata for ${testFilePath}`);
      }
      const result = await runSingleEvalFile({
        testFilePath,
        cwd,
        repoRoot,
        options,
        outputWriter,
        cache,
        evaluationRunner,
        workersOverride: perFileWorkers,
        progressReporter,
        seenEvalCases,
        displayIdTracker,
        selection: targetPrep.selection,
        inlineTargetLabel: targetPrep.inlineTargetLabel,
        evalCases: targetPrep.evalCases,
      });

      allResults.push(...result.results);
      if (result.promptDumpDir) {
        lastPromptDumpDir = result.promptDumpDir;
      }
    });

    progressReporter.finish();

    const summary = calculateEvaluationSummary(allResults);
    console.log(formatEvaluationSummary(summary));

    if (allResults.length > 0) {
      console.log(`\nResults written to: ${outputPath}`);
    }
    if (lastPromptDumpDir && allResults.length > 0) {
      console.log(`Prompt payloads saved to: ${lastPromptDumpDir}`);
    }
  } finally {
    unsubscribeCodexLogs();
    await outputWriter.close().catch(() => undefined);
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
