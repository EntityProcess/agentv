/**
 * `agentv grade` evaluates a workspace that was previously materialized by
 * `agentv prepare` and then edited by a human or external agent. This command
 * deliberately stops short of provider execution: the prepared manifest is the
 * source of workspace, prompt, target, setup, and baseline provenance, while
 * core grader/result primitives produce the normal run artifacts.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type PreparedAttemptMetadata,
  type ResolvedTarget,
  deriveCategory,
  gradePreparedEvalCase,
  loadTestSuite,
  writeArtifactsFromResults,
} from '@agentv/core';
import { command, number, oneOf, option, optional, positional, string } from 'cmd-ts';

import { loadEnvFromHierarchy } from '../eval/env.js';
import { buildDefaultRunDir } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectMultipleTargets } from '../eval/targets.js';

interface SetupStepWire {
  readonly name: string;
  readonly status: 'ok' | 'skipped' | 'warning';
  readonly message?: string;
}

interface RepoPinWire {
  readonly path?: string;
  readonly repo?: string;
  readonly commit?: string;
  readonly base_commit?: string;
  readonly ancestor?: number;
  readonly sparse?: readonly string[];
}

interface BaselineWire {
  readonly status: 'initialized' | 'unavailable';
  readonly commit?: string;
}

interface PrepareManifestWire {
  readonly schema_version: 1;
  readonly eval_path: string;
  readonly test_id: string;
  readonly target: string;
  readonly workspace_path: string;
  readonly prompt_path: string;
  readonly setup_status: 'ok';
  readonly setup_steps: readonly SetupStepWire[];
  readonly repo_pins: readonly RepoPinWire[];
  readonly baseline: BaselineWire;
  readonly created_at: string;
}

interface PreparedManifest {
  readonly schemaVersion: 1;
  readonly evalPath: string;
  readonly testId: string;
  readonly target: string;
  readonly workspacePath: string;
  readonly promptPath: string;
  readonly setupStatus: 'ok';
  readonly setupSteps: readonly SetupStepWire[];
  readonly repoPins: readonly RepoPinWire[];
  readonly baseline: BaselineWire;
  readonly createdAt: string;
  readonly manifestPath: string;
  readonly preparedDir: string;
}

interface GradePreparedResult {
  readonly testId: string;
  readonly target: string;
  readonly score: number;
  readonly executionStatus: string;
  readonly workspacePath: string;
  readonly manifestPath: string;
  readonly outputDir: string;
  readonly indexPath: string;
}

interface GradePreparedResultWire {
  readonly test_id: string;
  readonly target: string;
  readonly score: number;
  readonly execution_status: string;
  readonly workspace_path: string;
  readonly manifest_path: string;
  readonly output_dir: string;
  readonly index_path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidManifest(manifestPath: string, message: string): Error {
  return new Error(`Invalid prepared manifest at ${manifestPath}: ${message}`);
}

function expectString(record: Record<string, unknown>, key: string, manifestPath: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidManifest(manifestPath, `missing non-empty string field '${key}'`);
  }
  return value;
}

function expectArray(
  record: Record<string, unknown>,
  key: string,
  manifestPath: string,
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw invalidManifest(manifestPath, `missing array field '${key}'`);
  }
  return value;
}

function expectBaseline(value: unknown, manifestPath: string): BaselineWire {
  if (!isRecord(value)) {
    throw invalidManifest(manifestPath, "missing object field 'baseline'");
  }
  const status = value.status;
  if (status !== 'initialized' && status !== 'unavailable') {
    throw invalidManifest(
      manifestPath,
      "field 'baseline.status' must be 'initialized' or 'unavailable'",
    );
  }
  const commit = value.commit;
  if (commit !== undefined && typeof commit !== 'string') {
    throw invalidManifest(manifestPath, "field 'baseline.commit' must be a string");
  }
  if (status === 'initialized' && (!commit || commit.trim().length === 0)) {
    throw invalidManifest(
      manifestPath,
      "field 'baseline.commit' is required when baseline.status is 'initialized'",
    );
  }
  return {
    status,
    ...(typeof commit === 'string' && commit.trim().length > 0 && { commit }),
  };
}

function fromManifestWire(value: unknown, manifestPath: string): PreparedManifest {
  if (!isRecord(value)) {
    throw invalidManifest(manifestPath, 'expected a JSON object');
  }
  if (value.schema_version !== 1) {
    throw invalidManifest(manifestPath, "field 'schema_version' must be 1");
  }
  const setupStatus = value.setup_status;
  if (setupStatus !== 'ok') {
    throw invalidManifest(manifestPath, "field 'setup_status' must be 'ok'");
  }

  const preparedDir = path.dirname(manifestPath);
  const resolveManifestPath = (rawPath: string) =>
    path.isAbsolute(rawPath) ? rawPath : path.resolve(preparedDir, rawPath);

  return {
    schemaVersion: 1,
    evalPath: resolveManifestPath(expectString(value, 'eval_path', manifestPath)),
    testId: expectString(value, 'test_id', manifestPath),
    target: expectString(value, 'target', manifestPath),
    workspacePath: resolveManifestPath(expectString(value, 'workspace_path', manifestPath)),
    promptPath: resolveManifestPath(expectString(value, 'prompt_path', manifestPath)),
    setupStatus,
    setupSteps: expectArray(value, 'setup_steps', manifestPath) as readonly SetupStepWire[],
    repoPins: expectArray(value, 'repo_pins', manifestPath) as readonly RepoPinWire[],
    baseline: expectBaseline(value.baseline, manifestPath),
    createdAt: expectString(value, 'created_at', manifestPath),
    manifestPath,
    preparedDir,
  };
}

async function resolvePreparedManifestPath(preparedPath: string): Promise<string> {
  const resolved = path.resolve(preparedPath);
  try {
    const stats = await stat(resolved);
    return stats.isDirectory() ? path.join(resolved, 'agentv_prepare.json') : resolved;
  } catch {
    return path.basename(resolved) === 'agentv_prepare.json'
      ? resolved
      : path.join(resolved, 'agentv_prepare.json');
  }
}

async function readPreparedManifest(preparedPath: string): Promise<PreparedManifest> {
  const manifestPath = await resolvePreparedManifestPath(preparedPath);
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Prepared manifest not found at ${manifestPath}. Run agentv prepare first and pass --prepared <dir>.`,
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid prepared manifest JSON at ${manifestPath}: ${message}`);
  }
  return fromManifestWire(parsed, manifestPath);
}

async function ensureDirectoryExists(dirPath: string, description: string): Promise<void> {
  try {
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`${description} is not a directory: ${dirPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${description} not found: ${dirPath}`);
    }
    throw error;
  }
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`${description} is not a file: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${description} not found: ${filePath}`);
    }
    throw error;
  }
}

function assertMatchesManifest(options: {
  readonly manifest: PreparedManifest;
  readonly evalPath: string;
  readonly testId?: string;
}): string {
  const commandEvalPath = path.resolve(options.evalPath);
  if (path.resolve(options.manifest.evalPath) !== commandEvalPath) {
    throw new Error(
      `Prepared manifest eval_path does not match command eval path: ${options.manifest.evalPath} !== ${commandEvalPath}`,
    );
  }
  if (options.testId && options.testId !== options.manifest.testId) {
    throw new Error(
      `Prepared manifest test_id '${options.manifest.testId}' does not match --test-id '${options.testId}'`,
    );
  }
  return options.testId ?? options.manifest.testId;
}

function toPreparedAttemptMetadata(manifest: PreparedManifest): PreparedAttemptMetadata {
  return {
    source: 'manual',
    manifestPath: manifest.manifestPath,
    preparedDir: manifest.preparedDir,
    workspacePath: manifest.workspacePath,
    promptPath: manifest.promptPath,
    target: manifest.target,
    preparedAt: manifest.createdAt,
    setupStatus: manifest.setupStatus,
    baselineStatus: manifest.baseline.status,
    ...(manifest.baseline.commit !== undefined && { baselineCommit: manifest.baseline.commit }),
  };
}

function toCommandOutputWire(result: GradePreparedResult): GradePreparedResultWire {
  return {
    test_id: result.testId,
    target: result.target,
    score: result.score,
    execution_status: result.executionStatus,
    workspace_path: result.workspacePath,
    manifest_path: result.manifestPath,
    output_dir: result.outputDir,
    index_path: result.indexPath,
  };
}

function printHumanOutput(result: GradePreparedResult): void {
  console.log(`Graded prepared attempt for ${result.testId} (${result.target})`);
  console.log(`Score: ${result.score.toFixed(3)} (${result.executionStatus})`);
  console.log(`Workspace: ${result.workspacePath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Artifact workspace: ${result.outputDir}`);
  console.log(`Index: ${result.indexPath}`);
}

async function gradePreparedAttempt(options: {
  readonly evalPath: string;
  readonly testId?: string;
  readonly preparedPath: string;
  readonly outputDir?: string;
  readonly responsePath?: string;
  readonly experiment?: string;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly threshold?: number;
  readonly verbose?: boolean;
}): Promise<GradePreparedResult> {
  const manifest = await readPreparedManifest(options.preparedPath);
  const evalPath = path.resolve(options.evalPath);
  const testId = assertMatchesManifest({ manifest, evalPath, testId: options.testId });

  await ensureDirectoryExists(manifest.workspacePath, 'Prepared workspace');
  await ensureFileExists(manifest.promptPath, 'Prepared prompt');

  const evalDir = path.dirname(evalPath);
  const repoRoot = await findRepoRoot(evalDir);
  await loadEnvFromHierarchy({ testFilePath: evalPath, repoRoot, verbose: !!options.verbose });

  const category = deriveCategory(path.relative(process.cwd(), evalPath));
  const suite = await loadTestSuite(evalPath, repoRoot, { category });
  const test = suite.tests.find((candidate) => candidate.id === testId);
  if (!test) {
    throw new Error(`Test ID '${testId}' not found in ${evalPath}`);
  }

  const selections = await selectMultipleTargets({
    testFilePath: evalPath,
    repoRoot,
    cwd: process.cwd(),
    dryRun: false,
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    env: process.env,
    targetNames: [manifest.target],
    targetRefs: suite.targetRefs,
  });
  const selection = selections[0];
  if (!selection) {
    throw new Error(`Target '${manifest.target}' could not be resolved`);
  }
  const target = {
    ...selection.resolvedTarget,
    name: manifest.target,
  } as ResolvedTarget;

  const response =
    options.responsePath !== undefined
      ? await readFile(path.resolve(options.responsePath), 'utf8')
      : undefined;
  const runDir = path.resolve(
    options.outputDir ?? buildDefaultRunDir(process.cwd(), options.experiment),
  );

  const result = await gradePreparedEvalCase({
    evalCase: test,
    target,
    targets: selection.definitions,
    env: process.env,
    evalFilePath: evalPath,
    workspacePath: manifest.workspacePath,
    baselineCommit: manifest.baseline.commit,
    response,
    verbose: options.verbose,
    graderTarget: options.graderTarget,
    model: options.model,
    threshold: options.threshold ?? suite.threshold,
    preparedAttempt: toPreparedAttemptMetadata(manifest),
  });

  const artifacts = await writeArtifactsFromResults([result], runDir, {
    evalFile: evalPath,
    experiment: options.experiment,
    plannedTestCount: 1,
    sourceTests: [test],
  });

  return {
    testId,
    target: manifest.target,
    score: result.score,
    executionStatus: result.executionStatus,
    workspacePath: manifest.workspacePath,
    manifestPath: manifest.manifestPath,
    outputDir: runDir,
    indexPath: artifacts.indexPath,
  };
}

export const gradeCommand = command({
  name: 'grade',
  description: 'Grade a prepared workspace attempt without running the target provider',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval',
      description: 'Path to an eval file',
    }),
    testId: option({
      type: optional(string),
      long: 'test-id',
      description: 'Exact test ID to grade; defaults to agentv_prepare.json test_id',
    }),
    prepared: option({
      type: string,
      long: 'prepared',
      description: 'Prepared-attempt directory or agentv_prepare.json path',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Run artifact directory (writes index.jsonl and per-test artifacts)',
    }),
    response: option({
      type: optional(string),
      long: 'response',
      description: 'Optional final response text file from the human or external agent',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label for canonical run output (default: default)',
    }),
    graderTarget: option({
      type: optional(string),
      long: 'grader-target',
      description:
        'Override grader target for all evaluators (e.g., "agentv", or a target name from targets.yaml)',
    }),
    model: option({
      type: optional(string),
      long: 'model',
      description: 'Override model for the grader target (e.g., "openai:gpt-5-mini")',
    }),
    threshold: option({
      type: optional(number),
      long: 'threshold',
      description: 'Per-test score threshold (0-1, default 0.8 or suite threshold)',
    }),
    format: option({
      type: optional(oneOf(['text', 'json'])),
      long: 'format',
      description: 'Output format: text (default) or json',
    }),
  },
  handler: async ({
    evalPath,
    testId,
    prepared,
    output,
    response,
    experiment,
    graderTarget,
    model,
    threshold,
    format,
  }) => {
    const result = await gradePreparedAttempt({
      evalPath,
      testId,
      preparedPath: prepared,
      outputDir: output,
      responsePath: response,
      experiment,
      graderTarget,
      model,
      threshold,
      verbose: false,
    });
    if (format === 'json') {
      console.log(JSON.stringify(toCommandOutputWire(result), null, 2));
      return;
    }
    printHumanOutput(result);
  },
});
