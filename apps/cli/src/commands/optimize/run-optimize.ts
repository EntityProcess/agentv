import {
  AceOptimizer,
  loadOptimizerConfig,
  runEvaluation as defaultRunEvaluation,
  type ResolvedOptimizerConfig,
} from "@agentv/core";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvFromHierarchy } from "../eval/env.js";
import { selectTarget } from "../eval/targets.js";

interface NormalizedOptions {
  readonly target?: string;
  readonly targetsPath?: string;
  readonly verbose: boolean;
  readonly dryRun: boolean;
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

function normalizeOptions(raw: Record<string, unknown>): NormalizedOptions {
  return {
    target: normalizeString(raw.target),
    targetsPath: normalizeString(raw.targets),
    verbose: normalizeBoolean(raw.verbose),
    dryRun: normalizeBoolean(raw.dryRun),
  };
}

async function ensureFileExists(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
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

async function prepareConfig(configPath: string): Promise<ResolvedOptimizerConfig> {
  const resolvedPath = path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.resolve(process.cwd(), configPath);
  await ensureFileExists(resolvedPath, "Optimizer config");
  return loadOptimizerConfig(resolvedPath);
}

export async function runOptimizeCommand(
  configPath: string,
  rawOptions: Record<string, unknown>,
): Promise<void> {
  const options = normalizeOptions(rawOptions);
  const config = await prepareConfig(configPath);
  const repoRoot = await findRepoRoot(process.cwd());

  for (const evalFile of config.evalFiles) {
    await ensureFileExists(evalFile, "Eval file");
    await loadEnvFromHierarchy({
      testFilePath: evalFile,
      repoRoot,
      verbose: options.verbose,
    });
  }

  const evaluationRunner = await resolveEvaluationRunner();
  const selection = await selectTarget({
    testFilePath: config.evalFiles[0],
    repoRoot,
    cwd: process.cwd(),
    explicitTargetsPath: options.targetsPath,
    cliTargetName: options.target,
    dryRun: options.dryRun,
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    env: process.env,
  });

  const optimizer = new AceOptimizer({
    config,
    repoRoot,
    target: selection.resolvedTarget,
    targets: selection.definitions,
    env: process.env,
    evaluationRunner,
    logger: (message: string) => console.log(message),
    verbose: options.verbose,
  });

  console.log(`Starting ACE optimization with ${config.maxEpochs} epoch(s)...`);
  const result = await optimizer.optimize();
  console.log(`Optimization complete. Playbook updated at: ${result.playbookPath}`);
  if (result.scores.length > 0) {
    console.log(`Epoch scores: ${result.scores.map((score) => score.toFixed(3)).join(", ")}`);
  }
}
