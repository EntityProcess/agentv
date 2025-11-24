import {
  runEvaluation as defaultRunEvaluation,
  type EvaluationCache,
  type EvaluationResult,
  type ProviderResponse,
  ensureVSCodeSubagents,
} from "@agentv/core";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvFromHierarchy } from "./env.js";
import {
  createOutputWriter,
  getDefaultExtension,
  type OutputFormat,
  type OutputWriter,
} from "./output-writer.js";
import { ProgressDisplay, type WorkerProgress } from "./progress-display.js";
import { calculateEvaluationSummary, formatEvaluationSummary } from "./statistics.js";
import { selectTarget } from "./targets.js";

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
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeOptions(rawOptions: Record<string, unknown>): NormalizedOptions {
  const formatStr = normalizeString(rawOptions.outputFormat) ?? "jsonl";
  const format: OutputFormat = formatStr === "yaml" ? "yaml" : "jsonl";

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
    const candidate = path.join(current, ".git");
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = "eval";
  const extension = getDefaultExtension(format);
  return path.join(cwd, ".agentv", "results", `${baseName}_${timestamp}${extension}`);
}

function resolvePromptDirectory(option: string | boolean | undefined, cwd: string): string | undefined {
  if (option === undefined) {
    return undefined;
  }
  if (typeof option === "string" && option.trim().length > 0) {
    return path.resolve(cwd, option);
  }
  return path.join(cwd, ".agentv", "prompts");
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
  start(): void;
  setTotal(total: number): void;
  update(workerId: number, progress: WorkerProgress): void;
  finish(): void;
};

function createProgressReporter(maxWorkers: number): ProgressReporter {
  const display = new ProgressDisplay(maxWorkers);
  return {
    start: () => display.start(),
    setTotal: (total: number) => display.setTotalTests(total),
    update: (workerId: number, progress: WorkerProgress) =>
      display.updateWorker({ ...progress, workerId }),
    finish: () => display.finish(),
  };
}

type WorkerPool = {
  allocate(count: number): number[];
  release(workerIds: readonly number[]): void;
};

function createWorkerPool(initialSize: number): WorkerPool {
  const available: number[] = Array.from({ length: Math.max(1, initialSize) }, (_, i) => i + 1);
  const inUse = new Set<number>();

  const allocate = (count: number): number[] => {
    const needed = Math.max(1, count);
    while (available.length < needed) {
      available.push(available.length + 1);
    }

    const allocated: number[] = [];
    for (let i = 0; i < needed; i++) {
      const next = available.shift();
      if (next === undefined) {
        break;
      }
      inUse.add(next);
      allocated.push(next);
    }
    return allocated;
  };

  const release = (workerIds: readonly number[]): void => {
    for (const id of workerIds) {
      if (inUse.delete(id)) {
        available.push(id);
      }
    }
    available.sort((a, b) => a - b);
  };

  return { allocate, release };
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
  readonly workerPool: WorkerPool;
  readonly progressReporter: ProgressReporter;
  readonly seenEvalCases: Set<string>;
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
    workerPool,
    progressReporter,
    seenEvalCases,
  } =
    params;

  await ensureFileExists(testFilePath, "Test file");

  await loadEnvFromHierarchy({
    testFilePath,
    repoRoot,
    verbose: options.verbose,
  });

  const targetSelection = await selectTarget({
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

  const providerLabel = options.dryRun ? `${targetSelection.resolvedTarget.kind} (dry-run)` : targetSelection.resolvedTarget.kind;
  const targetMessage = options.verbose
    ? `Using target (${targetSelection.targetSource}): ${targetSelection.targetName} [provider=${providerLabel}] via ${targetSelection.targetsFilePath}`
    : `Using target: ${targetSelection.targetName} [provider=${providerLabel}]`;
  console.log(targetMessage);

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
  let resolvedWorkers = workerPreference ?? targetSelection.resolvedTarget.workers ?? 1;
  if (resolvedWorkers < 1 || resolvedWorkers > 50) {
    throw new Error(`Workers must be between 1 and 50, got: ${resolvedWorkers}`);
  }

  // VSCode providers require window focus, so only 1 worker is allowed
  const isVSCodeProvider = ["vscode", "vscode-insiders"].includes(
    targetSelection.resolvedTarget.kind
  );
  if (isVSCodeProvider && resolvedWorkers > 1) {
    console.warn(`Warning: VSCode providers require window focus. Limiting workers from ${resolvedWorkers} to 1 to prevent race conditions.`);
    resolvedWorkers = 1;
  }

  if (options.verbose) {
    const workersSource = workerPreference
      ? "CLI flag (balanced across files)"
      : targetSelection.resolvedTarget.workers
        ? "target setting"
        : "default";
    console.log(`Using ${resolvedWorkers} worker(s) (source: ${workersSource})`);
  }

  // Auto-provision subagents for VSCode targets
  if (isVSCodeProvider && !options.dryRun) {
    await ensureVSCodeSubagents({
      kind: targetSelection.resolvedTarget.kind as "vscode" | "vscode-insiders",
      count: resolvedWorkers,
      verbose: options.verbose,
    });
  }

  const workerAssignments = new Map<number, number>();
  const allocatedWorkers: number[] = [];
  const translateWorkerId = (localId: number): number => {
    const existing = workerAssignments.get(localId);
    if (existing !== undefined) {
      return existing;
    }
    const [assigned] = workerPool.allocate(1);
    workerAssignments.set(localId, assigned);
    allocatedWorkers.push(assigned);
    return assigned;
  };
  const pendingTests = new Set<string>();

  try {
    const results = await evaluationRunner({
      testFilePath,
      repoRoot,
      target: targetSelection.resolvedTarget,
      targets: targetSelection.definitions,
      env: process.env,
      maxRetries: Math.max(0, options.maxRetries),
      agentTimeoutMs,
      promptDumpDir,
      cache,
      useCache: options.cache,
      evalId: options.evalId,
      verbose: options.verbose,
      maxConcurrency: resolvedWorkers,
      onResult: async (result: EvaluationResult) => {
        await outputWriter.append(result);
      },
      onProgress: async (event) => {
        // Track pending events to determine total test count
        if (event.status === "pending") {
          const key = `${testFilePath}::${event.evalId}`;
          if (!seenEvalCases.has(key)) {
            seenEvalCases.add(key);
            progressReporter.setTotal(seenEvalCases.size);
          }
          pendingTests.add(key);
        }
        progressReporter.update(translateWorkerId(event.workerId), {
          workerId: translateWorkerId(event.workerId),
          evalId: event.evalId,
          status: event.status,
          startedAt: event.startedAt,
          completedAt: event.completedAt,
          error: event.error,
        });
      },
    });

    return { results: [...results], promptDumpDir };
  } finally {
    workerPool.release(allocatedWorkers);
  }
}

export async function runEvalCommand(input: RunEvalCommandInput): Promise<void> {
  const options = normalizeOptions(input.rawOptions);
  const cwd = process.cwd();
  const repoRoot = await findRepoRoot(cwd);

  if (options.verbose) {
    console.log(`Repository root: ${repoRoot}`);
  }

  const outputPath = options.outPath ? path.resolve(options.outPath) : buildDefaultOutputPath(cwd, options.format);
  console.log(`Output path: ${outputPath}`);

  const outputWriter = await createOutputWriter(outputPath, options.format);
  const cache = options.cache ? createEvaluationCache() : undefined;
  const evaluationRunner = await resolveEvaluationRunner();
  const allResults: EvaluationResult[] = [];
  let lastPromptDumpDir: string | undefined;
  const seenEvalCases = new Set<string>();

  // Derive file-level concurrency from worker count (global) when provided
  const totalWorkers = options.workers ?? 1;
  const fileConcurrency = Math.min(Math.max(1, totalWorkers), Math.max(1, input.testFiles.length));
  const perFileWorkers = options.workers
    ? Math.max(1, Math.floor(totalWorkers / fileConcurrency))
    : undefined;
  const workerPool = createWorkerPool(totalWorkers);
  const progressReporter = createProgressReporter(totalWorkers);
  progressReporter.start();

  try {
    await runWithLimit(input.testFiles, fileConcurrency, async (testFilePath) => {
      const result = await runSingleEvalFile({
        testFilePath: path.resolve(testFilePath),
        cwd,
        repoRoot,
        options,
        outputWriter,
        cache,
        evaluationRunner,
        workersOverride: perFileWorkers,
        workerPool,
        progressReporter,
        seenEvalCases,
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
  if (typeof candidate !== "function") {
    throw new Error(
      `Module '${resolved}' must export a 'runEvaluation' function to override the default implementation`,
    );
  }
  return candidate as typeof defaultRunEvaluation;
}
