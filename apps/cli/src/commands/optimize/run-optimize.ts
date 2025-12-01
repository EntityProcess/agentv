import {
  AceOptimizer,
  loadOptimizerConfig,
  runEvaluation as defaultRunEvaluation,
  type ResolvedOptimizerConfig,
} from "@agentv/core";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

import { JsonlWriter } from "../eval/jsonl-writer.js";
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

const DEFAULT_SHORTCUT_MAX_EPOCHS = 1;

function looksLikeEvalFile(parsed: unknown): parsed is { readonly description?: string } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const candidate = parsed as Record<string, unknown>;
  const schema = typeof candidate.$schema === "string" ? candidate.$schema : "";
  if (schema.includes("agentv-eval")) {
    return true;
  }
  return Array.isArray(candidate.evalcases);
}

type ZodIssueLike = { readonly message: string; readonly path: readonly unknown[] };

function isZodError(error: unknown): error is { readonly issues: readonly ZodIssueLike[] } {
  return Boolean(error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues));
}

function formatZodIssues(error: { readonly issues: readonly ZodIssueLike[] }, sourcePath: string): string {
  return [
    `Invalid optimizer config: ${sourcePath}`,
    ...error.issues.map((issue) => {
      const pathText = issue.path.length > 0 ? ` [${issue.path.join(".")}]` : "";
      return `- ${issue.message}${pathText}`;
    }),
  ].join("\n");
}

async function ensureFileExists(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function buildResultsPath(cwd: string, configPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(configPath, path.extname(configPath));
  return path.join(cwd, ".agentv", "results", `optimize_${baseName}_${timestamp}.jsonl`);
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

async function prepareConfig(
  configPath: string,
  cwd: string,
): Promise<{ config: ResolvedOptimizerConfig; usedShortcut: boolean }> {
  const resolvedPath = path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.resolve(process.cwd(), configPath);
  await ensureFileExists(resolvedPath, "Optimizer config");

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = parse(raw) as unknown;

  try {
    const config = await loadOptimizerConfig(resolvedPath);
    return { config, usedShortcut: false };
  } catch (error) {
    if (looksLikeEvalFile(parsed)) {
      const playbookPath = path.resolve(
        cwd,
        ".agentv",
        "playbooks",
        `${path.basename(resolvedPath, path.extname(resolvedPath))}-playbook.json`,
      );
      const description =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as { description?: unknown }).description
          : undefined;
      return {
        usedShortcut: true,
        config: {
          type: "ace",
          description: typeof description === "string" ? description : undefined,
          evalFiles: [resolvedPath],
          playbookPath,
          maxEpochs: DEFAULT_SHORTCUT_MAX_EPOCHS,
          allowDynamicSections: true,
        },
      };
    }

    if (isZodError(error)) {
      throw new Error(formatZodIssues(error, resolvedPath));
    }
    throw error;
  }
}

export async function runOptimizeCommand(
  configPath: string,
  rawOptions: Record<string, unknown>,
): Promise<void> {
  const options = normalizeOptions(rawOptions);
  const { config, usedShortcut } = await prepareConfig(configPath, process.cwd());
  const repoRoot = await findRepoRoot(process.cwd());
  const resultsPath = buildResultsPath(process.cwd(), configPath);
  const writer = await JsonlWriter.open(resultsPath);

  try {
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
      onEvaluationResult: async ({ epoch, result }) => {
        await writer.append({ epoch: epoch + 1, ...result });
      },
    });

    if (usedShortcut) {
      console.warn(
        `Detected eval file; running ACE with default settings (max_epochs=${config.maxEpochs}). ` +
          `For custom settings, create an optimizer config with type: ace.`,
      );
    }

    console.log(`Starting ACE optimization with ${config.maxEpochs} epoch(s)...`);
    const result = await optimizer.optimize();
    console.log(`Optimization complete. Playbook updated at: ${result.playbookPath}`);
    if (result.scores.length > 0) {
      console.log(`Epoch scores: ${result.scores.map((score) => score.toFixed(3)).join(", ")}`);
    }
    console.log(`Results written to: ${resultsPath}`);
  } finally {
    await writer.close().catch(() => undefined);
  }
}
