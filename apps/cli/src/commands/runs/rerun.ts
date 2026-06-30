import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseYamlValue } from '@agentv/core';
import {
  array,
  command,
  flag,
  multioption,
  number,
  option,
  optional,
  positional,
  string,
} from 'cmd-ts';
import { config as loadDotenv } from 'dotenv';

import {
  buildDefaultRunDir,
  createRunDirName,
  resolveRunManifestPath,
} from '../eval/result-layout.js';
import { runEvalCommand } from '../eval/run-eval.js';
import { type ResultManifestRecord, parseResultManifest } from '../results/manifest.js';

const TASK_EVAL_FILENAME = 'EVAL.yaml';
const TASK_TARGETS_FILENAME = 'targets.yaml';
const ENV_REF_PATTERN = /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

interface SelectedTaskBundle {
  readonly record: ResultManifestRecord;
  readonly testId: string;
  readonly sourceTarget: string;
  readonly resultDir: string;
  readonly testDir: string;
  readonly evalPath: string;
  readonly targetsPath: string;
  readonly taskTarget: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function displayRecord(record: ResultManifestRecord): string {
  return `${record.test_id ?? 'unknown'}@${record.target ?? 'unknown'}`;
}

function resolveSourcePath(cwd: string, source: string): string {
  return path.isAbsolute(source) ? source : path.resolve(cwd, source);
}

function resolveRelativeRunPath(
  runDir: string,
  relativePath: string | undefined,
): string | undefined {
  if (!relativePath || relativePath.trim().length === 0) {
    return undefined;
  }
  return path.resolve(runDir, relativePath);
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.length === 0 || patterns.some((pattern) => matchesGlob(value, pattern));
}

function matchesGlob(value: string, pattern: string): boolean {
  let source = '';
  for (const char of pattern) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`).test(value);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function readExecutionTarget(parsedEval: unknown): string | undefined {
  if (!isRecord(parsedEval)) {
    return undefined;
  }
  const execution = parsedEval.execution;
  if (isRecord(execution) && typeof execution.target === 'string' && execution.target.length > 0) {
    return execution.target;
  }
  return typeof parsedEval.target === 'string' && parsedEval.target.length > 0
    ? parsedEval.target
    : undefined;
}

async function readTaskTarget(evalPath: string, fallback: string): Promise<string> {
  const raw = await readFile(evalPath, 'utf8');
  return readExecutionTarget(parseYamlValue(raw)) ?? fallback;
}

async function readTargetDefinitions(
  targetsPath: string,
): Promise<readonly Record<string, unknown>[]> {
  const parsed = parseYamlValue(await readFile(targetsPath, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.targets)) {
    throw new Error(`Targets file is missing a top-level targets array: ${targetsPath}`);
  }
  return parsed.targets.filter(isRecord);
}

function targetName(definition: Record<string, unknown>): string | undefined {
  return typeof definition.name === 'string' && definition.name.trim().length > 0
    ? definition.name.trim()
    : undefined;
}

function resolveWholeEnvReference(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.trim().match(/^\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (!match) {
    return value.trim().length > 0 ? value.trim() : undefined;
  }
  const resolved = process.env[match[1]];
  return resolved && resolved.trim().length > 0 ? resolved.trim() : undefined;
}

function referencedTargetNames(definition: Record<string, unknown>): readonly string[] {
  const names: string[] = [];
  for (const key of ['use_target', 'grader_target', 'judge_target'] as const) {
    const resolved = resolveWholeEnvReference(definition[key]);
    if (resolved && !resolved.includes('${{')) {
      names.push(resolved);
    }
  }
  const fallbackTargets = definition.fallback_targets;
  if (Array.isArray(fallbackTargets)) {
    for (const entry of fallbackTargets) {
      const resolved = resolveWholeEnvReference(entry);
      if (resolved && !resolved.includes('${{')) {
        names.push(resolved);
      }
    }
  }
  return names;
}

function collectEnvRefs(value: unknown, names = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ENV_REF_PATTERN)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
    return names;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectEnvRefs(entry, names);
    }
    return names;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'required_env') {
        for (const required of stringArray(entry)) {
          names.add(required);
        }
      }
      collectEnvRefs(entry, names);
    }
  }
  return names;
}

async function validateTargetFile(
  targetsPath: string,
  targetNames: readonly string[],
  label: string,
): Promise<void> {
  const definitions = await readTargetDefinitions(targetsPath);
  const byName = new Map<string, Record<string, unknown>>();
  for (const definition of definitions) {
    const name = targetName(definition);
    if (name) {
      byName.set(name, definition);
    }
  }

  const missingTargets = [...new Set(targetNames)].filter((name) => !byName.has(name));
  if (missingTargets.length > 0) {
    throw new Error(
      `${label} is incompatible: ${targetsPath} does not define target(s): ${missingTargets.join(
        ', ',
      )}`,
    );
  }

  const envRefs = new Set<string>();
  const seenTargets = new Set<string>();
  const visit = (name: string) => {
    if (seenTargets.has(name)) {
      return;
    }
    const definition = byName.get(name);
    if (!definition) {
      return;
    }
    seenTargets.add(name);
    collectEnvRefs(definition, envRefs);
    for (const referencedName of referencedTargetNames(definition)) {
      visit(referencedName);
    }
  };
  for (const name of targetNames) {
    visit(name);
  }

  const missingEnv = [...envRefs].filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim().length === 0;
  });
  if (missingEnv.length > 0) {
    throw new Error(
      `Missing environment variable(s) required by ${targetsPath}: ${missingEnv.join(
        ', ',
      )}. Provide --env-file <path> or export them before rerun.`,
    );
  }
}

function isInsideOrSame(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function forbiddenOutputRoots(
  sourceRunDir: string,
  selected: readonly SelectedTaskBundle[],
): readonly string[] {
  return [
    path.resolve(sourceRunDir),
    ...selected.flatMap((bundle) => [path.resolve(bundle.resultDir), path.resolve(bundle.testDir)]),
  ];
}

function assertOutputIsSeparate(outputDir: string, roots: readonly string[]): void {
  const forbiddenRoot = roots.find((root) => isInsideOrSame(root, outputDir));
  if (!forbiddenRoot) {
    return;
  }
  throw new Error(
    `Refusing to write rerun output inside the source bundle. Output: ${outputDir}; source: ${forbiddenRoot}`,
  );
}

function defaultOutputDir(
  cwd: string,
  sourceRunDir: string,
  selected: readonly SelectedTaskBundle[],
  experiment?: string,
): string {
  const roots = forbiddenOutputRoots(sourceRunDir, selected);
  const candidate = buildDefaultRunDir(cwd, experiment ?? 'rerun');
  if (!roots.some((root) => isInsideOrSame(root, candidate))) {
    return candidate;
  }
  return path.join(path.dirname(path.resolve(sourceRunDir)), `rerun-${createRunDirName()}`);
}

async function loadEnvFile(
  envFile: string | undefined,
  cwd: string,
  verbose: boolean,
): Promise<void> {
  if (!envFile) {
    return;
  }
  const resolved = path.isAbsolute(envFile) ? envFile : path.resolve(cwd, envFile);
  await ensureFile(resolved, 'Environment file');
  const loaded = loadDotenv({ path: resolved, override: false });
  if (loaded.error) {
    throw loaded.error;
  }
  if (verbose) {
    console.log(`Loaded environment from: ${resolved}`);
  }
}

async function loadSelectedTaskBundles(options: {
  readonly indexPath: string;
  readonly sourceRunDir: string;
  readonly testIds: readonly string[];
  readonly sourceTargets: readonly string[];
}): Promise<readonly SelectedTaskBundle[]> {
  const content = await readFile(options.indexPath, 'utf8');
  const records = parseResultManifest(content);
  if (records.length === 0) {
    throw new Error(`Run manifest contains no result rows: ${options.indexPath}`);
  }

  const selected: SelectedTaskBundle[] = [];
  for (const record of records) {
    const testId = record.test_id ?? 'unknown';
    const sourceTarget = record.target ?? 'unknown';
    if (!matchesAny(testId, options.testIds) || !matchesAny(sourceTarget, options.sourceTargets)) {
      continue;
    }

    const recordLabel = displayRecord(record);
    const bundleDir = record.test_dir ?? record.task_dir;
    const evalPath =
      resolveRelativeRunPath(options.sourceRunDir, record.eval_path) ??
      resolveRelativeRunPath(
        options.sourceRunDir,
        bundleDir && `${bundleDir}/${TASK_EVAL_FILENAME}`,
      );
    const targetsPath =
      resolveRelativeRunPath(options.sourceRunDir, record.targets_path) ??
      resolveRelativeRunPath(
        options.sourceRunDir,
        bundleDir && `${bundleDir}/${TASK_TARGETS_FILENAME}`,
      );
    const testDir =
      resolveRelativeRunPath(options.sourceRunDir, bundleDir) ??
      (evalPath ? path.dirname(evalPath) : undefined);
    const resultDir =
      resolveRelativeRunPath(options.sourceRunDir, record.result_dir) ??
      (testDir ? path.dirname(testDir) : undefined);

    if (!evalPath || !targetsPath || !testDir || !resultDir) {
      throw new Error(
        `Selected result ${recordLabel} is missing test bundle paths. Re-run requires test/EVAL.yaml and test/targets.yaml.`,
      );
    }

    await ensureFile(evalPath, `Test eval for ${recordLabel}`);
    await ensureFile(targetsPath, `Test targets for ${recordLabel}`);
    const taskTarget = await readTaskTarget(evalPath, sourceTarget);
    selected.push({
      record,
      testId,
      sourceTarget,
      resultDir,
      testDir,
      evalPath,
      targetsPath,
      taskTarget,
    });
  }

  if (selected.length === 0) {
    throw new Error(
      'No captured test bundles matched the provided --test-id/--source-target filters.',
    );
  }
  return selected;
}

function buildSourceMetadataByEvalFile(
  sourceRunDir: string,
  indexPath: string,
  selected: readonly SelectedTaskBundle[],
): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(
    selected.map((bundle) => [
      path.resolve(bundle.evalPath),
      {
        rerunSource: {
          mode: 'rerun',
          sourceRunDir: path.resolve(sourceRunDir),
          sourceIndexPath: path.resolve(indexPath),
          sourceResultDir: path.resolve(bundle.resultDir),
          sourceTestDir: path.resolve(bundle.testDir),
          sourceTestId: bundle.testId,
          sourceTarget: bundle.sourceTarget,
          sourceTimestamp: bundle.record.timestamp,
        },
      },
    ]),
  );
}

export const runsRerunCommand = command({
  name: 'rerun',
  description: 'Rerun captured test bundles with local target environment',
  args: {
    runDir: positional({
      type: string,
      displayName: 'run-dir',
      description: 'Run workspace directory or run manifest containing test bundles',
    }),
    testId: multioption({
      type: array(string),
      long: 'test-id',
      description: 'Only rerun captured test ID(s); glob supported, repeatable',
    }),
    sourceTarget: multioption({
      type: array(string),
      long: 'source-target',
      description: 'Only rerun captured source target(s); glob supported, repeatable',
    }),
    target: multioption({
      type: array(string),
      long: 'target',
      description: 'Override target name(s) for the new eval run',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: 'Path to replacement targets.yaml for the new eval run',
    }),
    envFile: option({
      type: optional(string),
      long: 'env-file',
      description: 'Load local environment variables from a dotenv file before rerun',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Artifact directory for the new rerun output',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label for default rerun output (default: rerun)',
    }),
    workers: option({
      type: optional(number),
      long: 'workers',
      description: 'Number of parallel test cases within each task eval file',
    }),
    dryRun: flag({
      long: 'dry-run',
      description: 'Use mock provider responses instead of real provider calls',
    }),
    verbose: flag({
      long: 'verbose',
      description: 'Enable verbose logging',
    }),
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const indexPath = resolveRunManifestPath(resolveSourcePath(cwd, args.runDir));
    const sourceRunDir = path.dirname(indexPath);

    await loadEnvFile(args.envFile, cwd, args.verbose);

    const selected = await loadSelectedTaskBundles({
      indexPath,
      sourceRunDir,
      testIds: args.testId,
      sourceTargets: args.sourceTarget,
    });

    const targetOverrides = args.target;
    const outputDir = args.output
      ? path.resolve(cwd, args.output)
      : defaultOutputDir(cwd, sourceRunDir, selected, args.experiment);
    assertOutputIsSeparate(outputDir, forbiddenOutputRoots(sourceRunDir, selected));

    if (args.targets) {
      const overrideTargetsPath = path.resolve(cwd, args.targets);
      await ensureFile(overrideTargetsPath, 'Target override');
      const targetNames =
        targetOverrides.length > 0 ? targetOverrides : selected.map((bundle) => bundle.taskTarget);
      await validateTargetFile(overrideTargetsPath, targetNames, 'Target override');
    } else {
      const targetNamesByFile = new Map<string, Set<string>>();
      for (const bundle of selected) {
        const targetNames = targetOverrides.length > 0 ? targetOverrides : [bundle.taskTarget];
        const names = targetNamesByFile.get(bundle.targetsPath) ?? new Set<string>();
        for (const targetName of targetNames) {
          names.add(targetName);
        }
        targetNamesByFile.set(bundle.targetsPath, names);
      }
      for (const [targetsPath, names] of targetNamesByFile.entries()) {
        await validateTargetFile(targetsPath, [...names], 'Test bundle targets');
      }
    }

    console.log(`Rerunning ${selected.length} captured test bundle(s) from: ${sourceRunDir}`);
    console.log(`Rerun output directory: ${outputDir}`);

    const result = await runEvalCommand({
      testFiles: selected.map((bundle) => bundle.evalPath),
      rawOptions: {
        target: targetOverrides,
        targets: args.targets ? path.resolve(cwd, args.targets) : undefined,
        output: outputDir,
        experiment: args.experiment ?? 'rerun',
        workers: args.workers,
        dryRun: args.dryRun,
        verbose: args.verbose,
        sourceMetadataByEvalFile: buildSourceMetadataByEvalFile(sourceRunDir, indexPath, selected),
      },
    });

    if (result?.allExecutionErrors) {
      process.exit(2);
    }
    if (result?.budgetExceeded || result?.thresholdFailed) {
      process.exit(1);
    }
  },
});
