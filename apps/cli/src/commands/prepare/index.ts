/**
 * `agentv prepare` materializes one eval test into a handoff directory for a
 * human or external agent. Core owns workspace setup through the pre-target
 * boundary; this CLI layer owns artifact shape and console output.
 */
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type EvalTargetRef,
  type PreparedEvalWorkspace,
  type PreparedWorkspaceRepoPin,
  type ResolvedTarget,
  type TargetHooksConfig,
  deriveCategory,
  loadTestSuite,
  prepareEvalWorkspace,
} from '@agentv/core';
import { command, oneOf, option, optional, positional, string } from 'cmd-ts';

import { loadEnvFromHierarchy } from '../eval/env.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectMultipleTargets } from '../eval/targets.js';

type SetupStepStatus = 'ok' | 'skipped' | 'warning';

type HookExecution = PreparedEvalWorkspace['hookExecutions'][number];

interface SetupStep {
  readonly name: string;
  readonly status: SetupStepStatus;
  readonly message?: string;
}

interface RepoPin {
  readonly path?: string;
  readonly repo?: string;
  readonly commit?: string;
  readonly baseCommit?: string;
  readonly ancestor?: number;
  readonly sparse?: readonly string[];
}

interface PrepareResult {
  readonly schemaVersion: 1;
  readonly evalPath: string;
  readonly testId: string;
  readonly target: string;
  readonly workspacePath: string;
  readonly promptPath: string;
  readonly manifestPath: string;
  readonly setupStatus: 'ok';
  readonly setupSteps: readonly SetupStep[];
  readonly repoPins: readonly RepoPin[];
  readonly baseline: PreparedEvalWorkspace['baseline'];
  readonly createdAt: string;
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

interface PrepareCommandOutputWire extends PrepareManifestWire {
  readonly manifest_path: string;
}

interface SetupStepWire {
  readonly name: string;
  readonly status: SetupStepStatus;
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
  readonly status: PreparedEvalWorkspace['baseline']['status'];
  readonly commit?: string;
}

function setupStatusFromHook(status: HookExecution['status']): SetupStepStatus {
  if (status === 'success') {
    return 'ok';
  }
  if (status === 'skipped') {
    return 'skipped';
  }
  return 'warning';
}

function setupStepsFromPrepared(prepared: PreparedEvalWorkspace): readonly SetupStep[] {
  return [
    ...prepared.hookExecutions.map((hook) => ({
      name: `${hook.scope}_${hook.name}`,
      status: setupStatusFromHook(hook.status),
      ...(hook.error !== undefined && { message: hook.error }),
    })),
    {
      name: 'workspace_baseline',
      status: prepared.baseline.status === 'initialized' ? 'ok' : 'skipped',
      ...(prepared.baseline.status === 'unavailable' && { message: 'baseline unavailable' }),
    },
  ];
}

function toRepoPins(pins: readonly PreparedWorkspaceRepoPin[]): readonly RepoPin[] {
  return pins.map((pin) => ({
    ...(pin.path !== undefined && { path: pin.path }),
    ...(pin.repo !== undefined && { repo: pin.repo }),
    ...(pin.commit !== undefined && { commit: pin.commit }),
    ...(pin.baseCommit !== undefined && { baseCommit: pin.baseCommit }),
    ...(pin.ancestor !== undefined && { ancestor: pin.ancestor }),
    ...(pin.sparse !== undefined && { sparse: pin.sparse }),
  }));
}

async function moveDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }
    await cp(sourcePath, destinationPath, { recursive: true });
    await rm(sourcePath, { recursive: true, force: true });
  }
}

async function placePreparedWorkspace(
  prepared: PreparedEvalWorkspace,
  destinationPath: string,
): Promise<string> {
  const sourcePath = prepared.workspacePath;
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return destinationPath;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rm(destinationPath, { recursive: true, force: true });

  if (prepared.cleanupPolicy.mode !== 'static' && prepared.pool === undefined) {
    await moveDirectory(sourcePath, destinationPath);
    return destinationPath;
  }

  await cp(sourcePath, destinationPath, { recursive: true });
  return destinationPath;
}

function renderPrompt(options: {
  readonly workspacePath: string;
  readonly target: string;
  readonly taskInput: string;
}): string {
  const taskInput = options.taskInput.trim() || '(No text input was provided.)';
  return [
    '# AgentV Prepared Attempt',
    '',
    '## Task Input',
    '',
    taskInput,
    '',
    '## Execution Instructions',
    '',
    `- Work in this workspace: ${options.workspacePath}`,
    `- Complete the task input for target: ${options.target}`,
    '- Leave the final files in the workspace for a later AgentV grading step.',
    '- Do not run AgentV graders or inspect eval answer keys, rubrics, or oracle data.',
    '',
  ].join('\n');
}

function toManifestWire(result: PrepareResult): PrepareManifestWire {
  return {
    schema_version: result.schemaVersion,
    eval_path: result.evalPath,
    test_id: result.testId,
    target: result.target,
    workspace_path: result.workspacePath,
    prompt_path: result.promptPath,
    setup_status: result.setupStatus,
    setup_steps: result.setupSteps.map((step) => ({
      name: step.name,
      status: step.status,
      ...(step.message !== undefined && { message: step.message }),
    })),
    repo_pins: result.repoPins.map((pin) => ({
      ...(pin.path !== undefined && { path: pin.path }),
      ...(pin.repo !== undefined && { repo: pin.repo }),
      ...(pin.commit !== undefined && { commit: pin.commit }),
      ...(pin.baseCommit !== undefined && { base_commit: pin.baseCommit }),
      ...(pin.ancestor !== undefined && { ancestor: pin.ancestor }),
      ...(pin.sparse !== undefined && { sparse: pin.sparse }),
    })),
    baseline: {
      status: result.baseline.status,
      ...(result.baseline.commit !== undefined && { commit: result.baseline.commit }),
    },
    created_at: result.createdAt,
  };
}

function toCommandOutputWire(result: PrepareResult): PrepareCommandOutputWire {
  return {
    ...toManifestWire(result),
    manifest_path: result.manifestPath,
  };
}

async function selectPrepareTarget(options: {
  readonly evalPath: string;
  readonly repoRoot: string;
  readonly target: string;
  readonly targetRefs?: readonly EvalTargetRef[];
}): Promise<{
  readonly resolvedTarget: ResolvedTarget;
  readonly targetHooks?: TargetHooksConfig;
}> {
  const selections = await selectMultipleTargets({
    testFilePath: options.evalPath,
    repoRoot: options.repoRoot,
    cwd: process.cwd(),
    dryRun: false,
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    env: process.env,
    targetNames: [options.target],
    targetRefs: options.targetRefs,
  });
  const selection = selections[0];
  if (!selection) {
    throw new Error(`Target '${options.target}' could not be resolved`);
  }
  return {
    resolvedTarget: {
      ...selection.resolvedTarget,
      name: options.target,
    } as ResolvedTarget,
    ...(selection.targetHooks !== undefined && { targetHooks: selection.targetHooks }),
  };
}

async function prepareAttempt(options: {
  readonly evalPath: string;
  readonly testId: string;
  readonly target: string;
  readonly outDir: string;
}): Promise<PrepareResult> {
  const evalPath = path.resolve(options.evalPath);
  const outDir = path.resolve(options.outDir);
  const evalDir = path.dirname(evalPath);
  const repoRoot = await findRepoRoot(evalDir);

  await loadEnvFromHierarchy({ testFilePath: evalPath, repoRoot, verbose: false });

  const category = deriveCategory(path.relative(process.cwd(), evalPath));
  const suite = await loadTestSuite(evalPath, repoRoot, { category });
  const test = suite.tests.find((candidate) => candidate.id === options.testId);
  if (!test) {
    throw new Error(`Test ID '${options.testId}' not found in ${evalPath}`);
  }

  const { resolvedTarget, targetHooks } = await selectPrepareTarget({
    evalPath,
    repoRoot,
    target: options.target,
    targetRefs: suite.targetRefs,
  });

  const prepared = await prepareEvalWorkspace({
    testFilePath: evalPath,
    repoRoot,
    target: resolvedTarget,
    ...(targetHooks !== undefined && { targetHooks }),
    evalCases: suite.tests,
    testId: options.testId,
    verbose: false,
    ...(test.workspace?.path === undefined &&
      test.workspace?.mode !== 'static' && { workspaceMode: 'temp' }),
    retainOnSuccess: 'keep',
    retainOnFailure: 'keep',
  });

  await mkdir(outDir, { recursive: true });
  const workspacePath = await placePreparedWorkspace(prepared, path.join(outDir, 'workspace'));
  const promptPath = path.join(outDir, 'prompt.md');
  const manifestPath = path.join(outDir, 'agentv_prepare.json');
  const prompt = renderPrompt({
    workspacePath,
    target: options.target,
    taskInput: prepared.promptSource.question,
  });

  await writeFile(promptPath, prompt, 'utf8');

  const result: PrepareResult = {
    schemaVersion: 1,
    evalPath,
    testId: prepared.testId,
    target: options.target,
    workspacePath,
    promptPath,
    manifestPath,
    setupStatus: 'ok',
    setupSteps: setupStepsFromPrepared(prepared),
    repoPins: toRepoPins(prepared.repoPins),
    baseline: prepared.baseline,
    createdAt: prepared.createdAt,
  };

  await writeFile(manifestPath, `${JSON.stringify(toManifestWire(result), null, 2)}\n`, 'utf8');
  return result;
}

function printHumanOutput(result: PrepareResult): void {
  console.log(`Prepared attempt for ${result.testId} (${result.target})`);
  console.log(`Workspace: ${result.workspacePath}`);
  console.log(`Prompt: ${result.promptPath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Give prompt.md to the human or external agent.');
  console.log(`  2. Run the agent in ${result.workspacePath}.`);
  console.log('  3. Keep the final workspace for a later AgentV grading command.');
}

export const prepareCommand = command({
  name: 'prepare',
  description: 'Prepare one eval test workspace and safe prompt without running the target',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval',
      description: 'Path to an eval file',
    }),
    testId: option({
      type: string,
      long: 'test-id',
      description: 'Exact test ID to prepare',
    }),
    target: option({
      type: string,
      long: 'target',
      description: 'Target name this prepared attempt is for',
    }),
    out: option({
      type: string,
      long: 'out',
      description: 'Prepared-attempt output directory',
    }),
    format: option({
      type: optional(oneOf(['text', 'json'])),
      long: 'format',
      description: 'Output format: text (default) or json',
    }),
  },
  handler: async ({ evalPath, testId, target, out, format }) => {
    const result = await prepareAttempt({ evalPath, testId, target, outDir: out });
    if (format === 'json') {
      console.log(JSON.stringify(toCommandOutputWire(result), null, 2));
      return;
    }
    printHumanOutput(result);
  },
});
