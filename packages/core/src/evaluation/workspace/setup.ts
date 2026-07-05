/**
 * Workspace setup pipeline shared by eval execution and prepared attempts.
 *
 * This module owns the pre-target lifecycle only: materialize the selected
 * workspace, run setup hooks, initialize the baseline, and return the prepared
 * paths needed by the caller. Provider invocation, grading, teardown hooks, and
 * artifact writing stay in the orchestrator.
 *
 * To add another setup primitive, extend the helpers here first and then call
 * them from the orchestrator or prepare API. Avoid adding a second copy of the
 * workspace/template/repo/hook sequence elsewhere.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  DockerEnvironmentSetupError,
  type DockerEnvironmentSetupResult,
  prepareDockerEnvironment,
} from '../environment/docker.js';
import {
  HostEnvironmentSetupError,
  type HostEnvironmentSetupResult,
  prepareHostEnvironment,
} from '../environment/host.js';
import { type ExtensionRuntimeState, runExtensionsForHook } from '../extensions/runner.js';
import type {
  DockerEnvironmentRecipe,
  HostEnvironmentRecipe,
} from '../loaders/environment-recipe.js';
import type { TargetRuntimeConfig } from '../providers/sandbox-runner.js';
import type {
  AgentVExtensionConfig,
  EvalTest,
  ExtensionLifecycleHook,
  FailureStage,
  TargetHooksConfig,
  WorkspaceConfig,
  WorkspaceEnvConfig,
  WorkspaceHookConfig,
  WorkspaceScriptConfig,
} from '../types.js';
import {
  captureFileChanges as captureWorkspaceFileChanges,
  initializeBaseline,
} from './file-changes.js';
import {
  cleanupWorkspace,
  copyDirectoryRecursive,
  createTempWorkspace,
  getWorkspacePath,
} from './manager.js';
import { RepoManager } from './repo-manager.js';
import { resolveWorkspaceTemplate } from './resolve.js';
import { type ScriptExecutionContext, executeWorkspaceScript } from './script-executor.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_GIT_TIMEOUT_MS = 300_000;

export type WorkspaceSetupMode = 'temp' | 'static';
export type WorkspaceSetupRetentionPolicy = 'keep' | 'cleanup';
export type WorkspaceSetupHookScope = 'workspace' | 'target';
export type WorkspaceSetupHookName = 'before_all' | 'before_each';
export type WorkspaceSetupHookStatus = 'success' | 'skipped' | 'failed';

export interface WorkspaceSetupHookExecution {
  readonly scope: WorkspaceSetupHookScope;
  readonly name: WorkspaceSetupHookName;
  readonly status: WorkspaceSetupHookStatus;
  readonly testId: string;
  readonly workspacePath?: string;
  readonly command?: readonly string[];
  readonly cwd?: string;
  readonly output?: string;
  readonly error?: string;
}

export interface EnvironmentSetupExecution {
  readonly scope: 'environment';
  readonly name: 'setup';
  readonly status: HostEnvironmentSetupResult['status'] | DockerEnvironmentSetupResult['status'];
  readonly testId: string;
  readonly workdir: string;
  readonly type?: 'host' | 'docker';
  readonly image?: string;
  readonly command?: readonly string[] | string;
  readonly cwd?: string;
  readonly output?: string;
  readonly error?: string;
  readonly exitCode?: number;
}

export class WorkspaceSetupError extends Error {
  readonly failureStage: FailureStage;
  readonly failureReasonCode: string;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
  readonly environmentSetupExecutions: readonly EnvironmentSetupExecution[];

  constructor(
    message: string,
    options: {
      readonly failureStage: FailureStage;
      readonly failureReasonCode: string;
      readonly hookExecutions?: readonly WorkspaceSetupHookExecution[];
      readonly environmentSetupExecutions?: readonly EnvironmentSetupExecution[];
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'WorkspaceSetupError';
    this.failureStage = options.failureStage;
    this.failureReasonCode = options.failureReasonCode;
    this.hookExecutions = options.hookExecutions ?? [];
    this.environmentSetupExecutions = options.environmentSetupExecutions ?? [];
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface SharedWorkspaceSetupOptions {
  readonly evalRunId: string;
  readonly evalCases: readonly EvalTest[];
  readonly targetHooks?: TargetHooksConfig;
  readonly evalDir: string;
  readonly verbose?: boolean;
  readonly workers: number;
  readonly workspacePath?: string;
  readonly legacyWorkspacePath?: string;
}

export interface SharedWorkspaceSetup {
  readonly suiteWorkspace?: WorkspaceConfig;
  readonly sharedWorkspaceOwnerKey?: string;
  readonly sharedEnvironmentOwnerKey?: string;
  readonly sharedWorkspaceAppliesToAllCases: boolean;
  readonly sharedWorkspacePath?: string;
  readonly sharedBaselineCommit?: string;
  readonly suiteWorkspaceFile?: string;
  readonly beforeAllOutput?: string;
  readonly repoManager?: RepoManager;
  readonly useStaticWorkspace: boolean;
  readonly configuredMode: WorkspaceSetupMode;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
  readonly environmentSetupExecutions: readonly EnvironmentSetupExecution[];
  readonly extensionState?: ExtensionRuntimeState;
}

export interface EvalCaseWorkspaceSetupOptions {
  readonly evalCase: EvalTest;
  readonly targetName: string;
  readonly evalRunId?: string;
  readonly sharedWorkspacePath?: string;
  readonly sharedBaselineCommit?: string;
  readonly suiteWorkspaceFile?: string;
  readonly repoManager?: RepoManager;
  readonly evalDir?: string;
  readonly cleanupWorkspaces?: boolean;
  readonly targetHooks?: TargetHooksConfig;
  readonly setupDebug?: boolean;
  readonly sharedExtensionState?: ExtensionRuntimeState;
}

export interface EvalCaseWorkspaceSetup {
  readonly workspacePath?: string;
  readonly caseWorkspaceFile?: string;
  readonly beforeAllOutput?: string;
  readonly beforeEachOutput?: string;
  readonly baselineCommit?: string;
  readonly targetCwd?: string;
  readonly targetRuntime?: TargetRuntimeConfig;
  readonly isSharedWorkspace: boolean;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
  readonly environmentSetupExecutions: readonly EnvironmentSetupExecution[];
  readonly extensionState?: ExtensionRuntimeState;
}

export function toScriptConfig(
  hook: WorkspaceHookConfig,
  hookName: string,
  context: string,
): WorkspaceScriptConfig {
  const command = hook.command;
  if (!command || command.length === 0) {
    throw new Error(`${hookName} hook in ${context} requires command`);
  }
  return {
    command,
    ...(hook.timeout_ms !== undefined && { timeout_ms: hook.timeout_ms }),
    ...(hook.timeoutMs !== undefined && { timeoutMs: hook.timeoutMs }),
    ...(hook.cwd !== undefined && { cwd: hook.cwd }),
  };
}

export function hasHookCommand(hook: WorkspaceHookConfig | undefined): hook is WorkspaceHookConfig {
  return !!(hook?.command && hook.command.length > 0);
}

/**
 * Check whether hooks are enabled for a workspace config.
 * Returns true when hooks.enabled is undefined or explicitly true.
 */
export function hooksEnabled(
  workspace: { readonly hooks?: { readonly enabled?: boolean } } | undefined,
): boolean {
  return workspace?.hooks?.enabled !== false;
}

export function isAttemptScopedWorkspace(
  workspace: { readonly scope?: WorkspaceConfig['scope'] } | undefined,
): boolean {
  return workspace?.scope === 'attempt';
}

export function caseUsesSharedWorkspaceSetup(
  evalCase: EvalTest,
  setup: Pick<
    SharedWorkspaceSetup,
    'sharedWorkspaceAppliesToAllCases' | 'sharedWorkspaceOwnerKey' | 'sharedEnvironmentOwnerKey'
  >,
): boolean {
  const workspace = effectiveRuntimeWorkspace(evalCase);
  if (isAttemptScopedWorkspace(workspace)) {
    return false;
  }
  if (setup.sharedWorkspaceAppliesToAllCases) {
    return true;
  }
  if (
    setup.sharedWorkspaceOwnerKey !== undefined &&
    workspaceNeedsSharedSetup(workspace) &&
    sharedWorkspaceOwnerKey(evalCase) === setup.sharedWorkspaceOwnerKey
  ) {
    return true;
  }
  return !!(
    setup.sharedEnvironmentOwnerKey !== undefined &&
    hostEnvironment(evalCase) &&
    hostEnvironmentOwnerKey(evalCase) === setup.sharedEnvironmentOwnerKey
  );
}

function workspaceNeedsSharedSetup(
  workspace: WorkspaceConfig | undefined,
): workspace is WorkspaceConfig {
  if (!workspace || isAttemptScopedWorkspace(workspace)) {
    return false;
  }
  return !!(
    workspace.template ||
    workspace.hooks ||
    workspace.repos?.length ||
    workspace.docker ||
    workspace.env
  );
}

function effectiveRuntimeWorkspace(evalCase: EvalTest): WorkspaceConfig | undefined {
  return evalCase.workspace;
}

function hostEnvironment(evalCase: EvalTest): HostEnvironmentRecipe | undefined {
  const environment = evalCase.environment;
  return environment?.type === 'host' ? environment : undefined;
}

function dockerEnvironment(evalCase: EvalTest): DockerEnvironmentRecipe | undefined {
  const environment = evalCase.environment;
  return environment?.type === 'docker' ? environment : undefined;
}

function stableWorkspaceValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableWorkspaceValue).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableWorkspaceValue(entryValue)}`)
    .join(',')}}`;
}

function describeWorkspaceOwner(evalCase: EvalTest): string {
  const source = evalCase.source;
  if (source?.importedSuiteName) {
    return `imported suite "${source.importedSuiteName}" (${source.evalFileAbsolutePath})`;
  }
  if (source?.evalFileAbsolutePath) {
    return `parent-owned cases (${source.evalFileAbsolutePath})`;
  }
  return 'programmatic cases';
}

function sharedWorkspaceOwnerKey(evalCase: EvalTest): string {
  const source = evalCase.source;
  const sourceKey = source?.importedSuiteName
    ? `imported:${source.evalFileAbsolutePath}:${source.importedSuiteName}`
    : source?.evalFileAbsolutePath
      ? `parent:${source.evalFileAbsolutePath}`
      : 'programmatic';
  return `${sourceKey}:${stableWorkspaceValue(effectiveRuntimeWorkspace(evalCase))}`;
}

function hostEnvironmentOwnerKey(evalCase: EvalTest): string {
  const source = evalCase.source;
  const sourceKey = source?.importedSuiteName
    ? `imported:${source.evalFileAbsolutePath}:${source.importedSuiteName}`
    : source?.evalFileAbsolutePath
      ? `parent:${source.evalFileAbsolutePath}`
      : 'programmatic';
  return `${sourceKey}:${stableWorkspaceValue(hostEnvironment(evalCase))}`;
}

interface SelectedSharedWorkspace {
  readonly key: string;
  readonly workspace: WorkspaceConfig;
}

function selectSuiteWorkspace(evalCases: readonly EvalTest[]): SelectedSharedWorkspace | undefined {
  const candidates = new Map<
    string,
    { readonly workspace: WorkspaceConfig; readonly owner: string; readonly testIds: string[] }
  >();

  for (const evalCase of evalCases) {
    const workspace = effectiveRuntimeWorkspace(evalCase);
    if (!workspaceNeedsSharedSetup(workspace)) {
      continue;
    }
    const key = sharedWorkspaceOwnerKey(evalCase);
    const existing = candidates.get(key);
    if (existing) {
      existing.testIds.push(evalCase.id);
      continue;
    }
    candidates.set(key, {
      workspace,
      owner: describeWorkspaceOwner(evalCase),
      testIds: [evalCase.id],
    });
  }

  if (candidates.size <= 1) {
    const [key, candidate] = [...candidates.entries()][0] ?? [];
    return key && candidate ? { key, workspace: candidate.workspace } : undefined;
  }

  const owners = [...candidates.values()]
    .map((candidate) => `${candidate.owner} for tests ${candidate.testIds.join(', ')}`)
    .join('; ');
  throw new WorkspaceSetupError(
    `Wrapper eval contains multiple suite workspace owners: ${owners}. AgentV does not merge parent and child workspaces or run separate imported-suite suite workspaces in one wrapper execution. Use workspace.scope: attempt for imported suites, split them into separate runs, or keep only one suite workspace owner.`,
    {
      failureStage: 'setup',
      failureReasonCode: 'ambiguous_shared_workspace',
    },
  );
}

interface SelectedSharedEnvironment {
  readonly key: string;
  readonly environment: HostEnvironmentRecipe;
}

function selectSuiteHostEnvironment(
  evalCases: readonly EvalTest[],
): SelectedSharedEnvironment | undefined {
  const candidates = new Map<
    string,
    {
      readonly environment: HostEnvironmentRecipe;
      readonly owner: string;
      readonly testIds: string[];
    }
  >();

  for (const evalCase of evalCases) {
    const environment = hostEnvironment(evalCase);
    if (!environment || isAttemptScopedWorkspace(effectiveRuntimeWorkspace(evalCase))) {
      continue;
    }
    const key = hostEnvironmentOwnerKey(evalCase);
    const existing = candidates.get(key);
    if (existing) {
      existing.testIds.push(evalCase.id);
      continue;
    }
    candidates.set(key, {
      environment,
      owner: describeWorkspaceOwner(evalCase),
      testIds: [evalCase.id],
    });
  }

  if (candidates.size <= 1) {
    const [key, candidate] = [...candidates.entries()][0] ?? [];
    return key && candidate ? { key, environment: candidate.environment } : undefined;
  }

  const owners = [...candidates.values()]
    .map((candidate) => `${candidate.owner} for tests ${candidate.testIds.join(', ')}`)
    .join('; ');
  throw new WorkspaceSetupError(
    `Wrapper eval contains multiple suite host environments: ${owners}. AgentV does not merge multiple environment.workdir values in one wrapper execution. Split them into separate runs or use workspace.scope: attempt for per-case setup.`,
    {
      failureStage: 'setup',
      failureReasonCode: 'ambiguous_shared_environment',
    },
  );
}

function selectSuiteExtensions(evalCases: readonly EvalTest[]): readonly AgentVExtensionConfig[] {
  const candidates = new Map<string, readonly AgentVExtensionConfig[]>();
  for (const evalCase of evalCases) {
    const extensions = evalCase.extensions ?? [];
    if (extensions.length === 0 || isAttemptScopedWorkspace(effectiveRuntimeWorkspace(evalCase))) {
      continue;
    }
    candidates.set(stableWorkspaceValue(extensions), extensions);
  }

  if (candidates.size > 1) {
    throw new WorkspaceSetupError(
      'Wrapper eval contains multiple suite extension sets. Split the suites or use workspace.scope: attempt when lifecycle extensions differ.',
      {
        failureStage: 'setup',
        failureReasonCode: 'ambiguous_shared_extensions',
      },
    );
  }
  return [...candidates.values()][0] ?? [];
}

function workspaceGitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND') {
      delete env[key];
    }
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  };
}

export async function resetWorkspaceRoot(
  workspacePath: string,
  resetMode: 'fast' | 'strict',
  baselineRef?: string,
): Promise<boolean> {
  if (!existsSync(path.join(workspacePath, '.git'))) {
    return false;
  }

  const cleanFlag = resetMode === 'strict' ? '-fdx' : '-fd';
  const opts = {
    cwd: workspacePath,
    timeout: WORKSPACE_GIT_TIMEOUT_MS,
    env: workspaceGitEnv(),
    maxBuffer: 50 * 1024 * 1024,
  };

  await execFileAsync('git', ['reset', '--hard', baselineRef ?? 'HEAD'], opts);
  await execFileAsync('git', ['clean', cleanFlag], opts);
  return true;
}

function commandForHook(hook: WorkspaceHookConfig | undefined): readonly string[] | undefined {
  return hook?.command;
}

function mergeHookOutput(left: string | undefined, right: string | undefined): string | undefined {
  return [left, right].filter(Boolean).join('\n') || undefined;
}

function hasExtensionHook(
  extensions: readonly AgentVExtensionConfig[] | undefined,
  hook: ExtensionLifecycleHook,
): boolean {
  return (extensions ?? []).some((extension) => extension.hook === hook);
}

function hookExecution(options: {
  readonly scope: WorkspaceSetupHookScope;
  readonly name: WorkspaceSetupHookName;
  readonly status: WorkspaceSetupHookStatus;
  readonly testId: string;
  readonly workspacePath?: string;
  readonly hook?: WorkspaceHookConfig;
  readonly output?: string;
  readonly error?: string;
}): WorkspaceSetupHookExecution {
  const command = commandForHook(options.hook);
  return {
    scope: options.scope,
    name: options.name,
    status: options.status,
    testId: options.testId,
    ...(options.workspacePath !== undefined && { workspacePath: options.workspacePath }),
    ...(command !== undefined && { command }),
    ...(options.hook?.cwd !== undefined && { cwd: options.hook.cwd }),
    ...(options.output !== undefined && { output: options.output }),
    ...(options.error !== undefined && { error: options.error }),
  };
}

export async function releaseSharedWorkspaceSetup(setup: SharedWorkspaceSetup): Promise<void> {
  void setup;
}

function environmentSetupExecution(options: {
  readonly result: HostEnvironmentSetupResult;
  readonly testId: string;
  readonly error?: string;
}): EnvironmentSetupExecution {
  return {
    scope: 'environment',
    name: 'setup',
    status: options.error ? 'failed' : options.result.status,
    testId: options.testId,
    workdir: options.result.workdir,
    type: options.result.type,
    ...(options.result.command !== undefined && { command: options.result.command }),
    ...(options.result.cwd !== undefined && { cwd: options.result.cwd }),
    ...(options.result.stdout !== undefined && { output: options.result.stdout }),
    ...((options.error ?? options.result.stderr)
      ? { error: options.error ?? options.result.stderr }
      : {}),
    ...(options.result.exitCode !== undefined && { exitCode: options.result.exitCode }),
  };
}

function dockerEnvironmentSetupExecution(options: {
  readonly result: DockerEnvironmentSetupResult;
  readonly testId: string;
  readonly error?: string;
}): EnvironmentSetupExecution {
  return {
    scope: 'environment',
    name: 'setup',
    status: options.error ? 'failed' : options.result.status,
    testId: options.testId,
    workdir: options.result.workdir,
    type: options.result.type,
    image: options.result.image,
    ...(options.result.command !== undefined && { command: options.result.command }),
    ...(options.result.cwd !== undefined && { cwd: options.result.cwd }),
    ...(options.result.stdout !== undefined && { output: options.result.stdout }),
    ...((options.error ?? options.result.stderr)
      ? { error: options.error ?? options.result.stderr }
      : {}),
    ...(options.result.exitCode !== undefined && { exitCode: options.result.exitCode }),
  };
}

async function prepareHostEnvironmentForSetup(
  environment: HostEnvironmentRecipe,
  testId: string,
): Promise<{
  readonly workdir: string;
  readonly execution: EnvironmentSetupExecution;
}> {
  try {
    const result = await prepareHostEnvironment(environment);
    return {
      workdir: result.workdir,
      execution: environmentSetupExecution({ result, testId }),
    };
  } catch (error) {
    if (error instanceof HostEnvironmentSetupError) {
      const execution = environmentSetupExecution({
        result: error.result,
        testId,
        error: error.message,
      });
      throw new WorkspaceSetupError(error.message, {
        failureStage: 'setup',
        failureReasonCode: 'environment_setup_error',
        environmentSetupExecutions: [execution],
        cause: error,
      });
    }
    throw error;
  }
}

async function prepareDockerEnvironmentForSetup(
  environment: DockerEnvironmentRecipe,
  testId: string,
): Promise<{
  readonly targetCwd: string;
  readonly targetRuntime: TargetRuntimeConfig;
  readonly execution: EnvironmentSetupExecution;
}> {
  try {
    const result = await prepareDockerEnvironment(environment);
    return {
      targetCwd: result.workdir,
      targetRuntime: result.targetRuntime,
      execution: dockerEnvironmentSetupExecution({ result, testId }),
    };
  } catch (error) {
    if (error instanceof DockerEnvironmentSetupError) {
      const execution = dockerEnvironmentSetupExecution({
        result: error.result,
        testId,
        error: error.message,
      });
      throw new WorkspaceSetupError(error.message, {
        failureStage: 'setup',
        failureReasonCode: 'environment_setup_error',
        environmentSetupExecutions: [execution],
        cause: error,
      });
    }
    throw error;
  }
}

export async function prepareSharedWorkspaceSetup(
  options: SharedWorkspaceSetupOptions,
): Promise<SharedWorkspaceSetup> {
  const {
    evalRunId,
    evalCases,
    targetHooks,
    evalDir,
    verbose,
    workers,
    workspacePath,
    legacyWorkspacePath,
  } = options;
  const selectedSuiteWorkspace = selectSuiteWorkspace(evalCases);
  const selectedSuiteEnvironment = selectSuiteHostEnvironment(evalCases);
  const suiteWorkspace = selectedSuiteWorkspace?.workspace;
  const suiteExtensions = selectSuiteExtensions(evalCases);
  const rawTemplate = suiteWorkspace?.template;
  const resolvedTemplate = await resolveWorkspaceTemplate(rawTemplate);
  const workspaceTemplate = resolvedTemplate?.dir;
  let suiteWorkspaceFile = resolvedTemplate?.workspaceFile;
  const setupLog = (message: string): void => {
    if (verbose) {
      console.log(`[setup] ${message}`);
    }
  };

  const isAttemptWorkspace = isAttemptScopedWorkspace(suiteWorkspace);

  const cliWorkspacePath = workspacePath ?? legacyWorkspacePath;
  const sharedWorkspaceAppliesToAllCases = !!cliWorkspacePath;
  const configuredMode: WorkspaceSetupMode = cliWorkspacePath ? 'static' : 'temp';
  const configuredStaticPath = cliWorkspacePath;

  const useStaticWorkspace = configuredMode === 'static' || !!selectedSuiteEnvironment;

  if (
    useStaticWorkspace &&
    evalCases.some((evalCase) => isAttemptScopedWorkspace(effectiveRuntimeWorkspace(evalCase)))
  ) {
    throw new Error(
      'static workspace mode is incompatible with workspace.scope: attempt. Use workspace.scope: suite or omit the static workspace override.',
    );
  }
  const hasSharedWorkspace = !!(
    useStaticWorkspace ||
    selectedSuiteEnvironment ||
    (!isAttemptWorkspace &&
      (workspaceTemplate || suiteWorkspace?.hooks || suiteWorkspace?.repos?.length)) ||
    suiteExtensions.length > 0
  );

  setupLog(
    `sharedWorkspace=${hasSharedWorkspace} attemptScope=${isAttemptWorkspace} workers=${workers}`,
  );
  if (hasSharedWorkspace && workers > 1 && evalCases.length > 1) {
    console.warn(
      [
        `Warning: This eval uses a shared workspace with ${workers} workers.`,
        'If the agent under test makes file edits, concurrent runs may corrupt each other.',
        'To limit concurrency, pass --workers 1 on the command line, set evaluate_options.max_concurrency in eval YAML, or set execution.max_concurrency in .agentv/config.yaml.',
      ].join('\n'),
    );
  }

  let sharedWorkspacePath: string | undefined;
  let sharedBaselineCommit: string | undefined;
  let beforeAllOutput: string | undefined;

  const hookExecutions: WorkspaceSetupHookExecution[] = [];
  const environmentSetupExecutions: EnvironmentSetupExecution[] = [];
  let extensionState: ExtensionRuntimeState | undefined;

  let repoManager: RepoManager | undefined;

  if (useStaticWorkspace && configuredStaticPath) {
    setupLog(`reusing existing static workspace: ${configuredStaticPath}`);
    sharedWorkspacePath = configuredStaticPath;
  } else if (selectedSuiteEnvironment) {
    setupLog(`preparing shared host environment: ${selectedSuiteEnvironment.environment.workdir}`);
    try {
      const prepared = await prepareHostEnvironmentForSetup(
        selectedSuiteEnvironment.environment,
        '__environment_setup__',
      );
      sharedWorkspacePath = prepared.workdir;
      environmentSetupExecutions.push(prepared.execution);
      setupLog(`shared host environment ready at: ${sharedWorkspacePath}`);
    } catch (error) {
      if (error instanceof WorkspaceSetupError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspaceSetupError(`Failed to prepare host environment: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'environment_setup_error',
        hookExecutions,
        cause: error,
      });
    }
  } else if (!isAttemptWorkspace && workspaceTemplate) {
    setupLog(`creating shared workspace from template: ${workspaceTemplate}`);
    try {
      sharedWorkspacePath = await createTempWorkspace(workspaceTemplate, evalRunId, 'shared');
      setupLog(`shared workspace created at: ${sharedWorkspacePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspaceSetupError(`Failed to create shared workspace: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'template_error',
        hookExecutions,
        cause: error,
      });
    }
  } else if (
    !isAttemptWorkspace &&
    (suiteWorkspace?.hooks || suiteWorkspace?.repos?.length || suiteExtensions.length > 0)
  ) {
    sharedWorkspacePath = getWorkspacePath(evalRunId, 'shared');
    await mkdir(sharedWorkspacePath, { recursive: true });
    setupLog(`created empty shared workspace at: ${sharedWorkspacePath}`);
  }

  if (suiteWorkspaceFile && sharedWorkspacePath) {
    const copiedWorkspaceFile = path.join(sharedWorkspacePath, path.basename(suiteWorkspaceFile));
    try {
      await stat(copiedWorkspaceFile);
      suiteWorkspaceFile = copiedWorkspaceFile;
    } catch {
      // Keep original if copy does not exist.
    }
  }

  const hasReposToMaterialize = !!suiteWorkspace?.repos?.length && !isAttemptWorkspace;
  const needsRepoMaterialisation = hasReposToMaterialize && !useStaticWorkspace;
  repoManager =
    repoManager ??
    (needsRepoMaterialisation
      ? new RepoManager(verbose, { projectConfigDir: evalDir })
      : undefined);

  if (needsRepoMaterialisation && repoManager && sharedWorkspacePath && suiteWorkspace?.repos) {
    try {
      setupLog(
        `materializing ${suiteWorkspace.repos.length} shared repo(s) into ${sharedWorkspacePath}`,
      );
      await repoManager.materializeAll(suiteWorkspace.repos, sharedWorkspacePath);
      setupLog('shared repo materialization complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sharedWorkspacePath && !useStaticWorkspace) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new WorkspaceSetupError(`Failed to materialize repos: ${message}`, {
        failureStage: 'repo_setup',
        failureReasonCode: 'clone_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  const suiteDockerConfig = suiteWorkspace?.docker;
  if (suiteDockerConfig) {
    await prepareDockerWorkspace(suiteDockerConfig, setupLog);
  }

  if (suiteWorkspace?.env) {
    try {
      await runPreflightChecks(suiteWorkspace.env, sharedWorkspacePath ?? undefined, setupLog);
      setupLog('preflight checks passed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sharedWorkspacePath && !useStaticWorkspace) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new WorkspaceSetupError(message, {
        failureStage: 'setup',
        failureReasonCode: 'preflight_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  const suiteHooksEnabled = hooksEnabled(suiteWorkspace);
  const suiteBeforeAllHook = suiteWorkspace?.hooks?.before_all;
  if (sharedWorkspacePath && suiteExtensions.length > 0) {
    try {
      extensionState = await runExtensionsForHook({
        extensions: suiteExtensions,
        hook: 'beforeAll',
        context: {
          hook_name: 'beforeAll',
          workspace_path: sharedWorkspacePath,
          test_id: '__before_all__',
          eval_run_id: evalRunId,
          eval_dir: evalDir,
        },
        state: extensionState,
      });
      beforeAllOutput = mergeHookOutput(beforeAllOutput, extensionState?.output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sharedWorkspacePath && !useStaticWorkspace) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new WorkspaceSetupError(`beforeAll extension failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'extension_error',
        hookExecutions,
        cause: error,
      });
    }
  }
  if (sharedWorkspacePath && suiteHooksEnabled && hasHookCommand(suiteBeforeAllHook)) {
    const beforeAllHook = suiteBeforeAllHook;
    const beforeAllCommand = (beforeAllHook.command ?? []).join(' ');
    setupLog(
      `running shared before_all in cwd=${beforeAllHook.cwd ?? evalDir} command=${beforeAllCommand}`,
    );
    const scriptContext: ScriptExecutionContext = {
      workspacePath: sharedWorkspacePath,
      testId: '__before_all__',
      evalRunId,
      evalDir,
      workspaceFileDir: suiteWorkspace?.workspaceFileDir,
    };
    try {
      beforeAllOutput = await executeWorkspaceScript(
        toScriptConfig(beforeAllHook, 'before_all', 'suite workspace'),
        scriptContext,
      );
      hookExecutions.push(
        hookExecution({
          scope: 'workspace',
          name: 'before_all',
          status: 'success',
          testId: '__before_all__',
          workspacePath: sharedWorkspacePath,
          hook: beforeAllHook,
          output: beforeAllOutput,
        }),
      );
      setupLog('shared before_all completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hookExecutions.push(
        hookExecution({
          scope: 'workspace',
          name: 'before_all',
          status: 'failed',
          testId: '__before_all__',
          workspacePath: sharedWorkspacePath,
          hook: beforeAllHook,
          error: message,
        }),
      );
      if (sharedWorkspacePath && !useStaticWorkspace) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new WorkspaceSetupError(`before_all script failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'script_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  const targetBeforeAllHook = targetHooks?.before_all;
  if (sharedWorkspacePath && hasHookCommand(targetBeforeAllHook)) {
    const beforeAllCommand = (targetBeforeAllHook.command ?? []).join(' ');
    setupLog(`running target before_all command=${beforeAllCommand}`);
    const scriptContext: ScriptExecutionContext = {
      workspacePath: sharedWorkspacePath,
      testId: '__target_before_all__',
      evalRunId,
      evalDir,
      workspaceFileDir: suiteWorkspace?.workspaceFileDir,
    };
    try {
      await executeWorkspaceScript(
        toScriptConfig(targetBeforeAllHook, 'before_all', 'target hooks'),
        scriptContext,
      );
      hookExecutions.push(
        hookExecution({
          scope: 'target',
          name: 'before_all',
          status: 'success',
          testId: '__target_before_all__',
          workspacePath: sharedWorkspacePath,
          hook: targetBeforeAllHook,
        }),
      );
      setupLog('target before_all completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hookExecutions.push(
        hookExecution({
          scope: 'target',
          name: 'before_all',
          status: 'failed',
          testId: '__target_before_all__',
          workspacePath: sharedWorkspacePath,
          hook: targetBeforeAllHook,
          error: message,
        }),
      );
      if (sharedWorkspacePath && !useStaticWorkspace) {
        await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
      }
      throw new WorkspaceSetupError(`target before_all hook failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'script_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  if (sharedWorkspacePath) {
    try {
      sharedBaselineCommit = await initializeBaseline(sharedWorkspacePath);
      setupLog(`shared baseline initialized: ${sharedBaselineCommit}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setupLog(`shared baseline initialization failed (file_changes unavailable): ${message}`);
    }
  }

  return {
    ...(suiteWorkspace !== undefined && { suiteWorkspace }),
    ...(selectedSuiteWorkspace?.key !== undefined && {
      sharedWorkspaceOwnerKey: selectedSuiteWorkspace.key,
    }),
    ...(selectedSuiteEnvironment?.key !== undefined && {
      sharedEnvironmentOwnerKey: selectedSuiteEnvironment.key,
    }),
    sharedWorkspaceAppliesToAllCases,
    ...(sharedWorkspacePath !== undefined && { sharedWorkspacePath }),
    ...(sharedBaselineCommit !== undefined && { sharedBaselineCommit }),
    ...(suiteWorkspaceFile !== undefined && { suiteWorkspaceFile }),
    ...(beforeAllOutput !== undefined && { beforeAllOutput }),
    ...(repoManager !== undefined && { repoManager }),
    useStaticWorkspace,
    configuredMode,
    hookExecutions,
    environmentSetupExecutions,
    ...(extensionState !== undefined && { extensionState }),
  };
}

export async function prepareEvalCaseWorkspace(
  options: EvalCaseWorkspaceSetupOptions,
): Promise<EvalCaseWorkspaceSetup> {
  const {
    evalCase,
    evalRunId,
    sharedWorkspacePath,
    sharedBaselineCommit,
    suiteWorkspaceFile,
    repoManager,
    evalDir,
    cleanupWorkspaces: forceCleanup,
    targetHooks,
    setupDebug,
    sharedExtensionState,
  } = options;

  const runtimeWorkspace = effectiveRuntimeWorkspace(evalCase);
  const runtimeEnvironment = hostEnvironment(evalCase);
  const runtimeDockerEnvironment = dockerEnvironment(evalCase);
  let workspacePath: string | undefined = isAttemptScopedWorkspace(runtimeWorkspace)
    ? undefined
    : sharedWorkspacePath;
  let targetCwd: string | undefined;
  let targetRuntime: TargetRuntimeConfig | undefined;
  const inheritedSuiteWorkspaceFile = workspacePath ? suiteWorkspaceFile : undefined;
  let beforeAllOutput: string | undefined;
  let beforeEachOutput: string | undefined;
  let isSharedWorkspace = !!workspacePath;
  let caseWorkspaceFile: string | undefined;
  const caseHooksEnabled = hooksEnabled(runtimeWorkspace);
  const hookExecutions: WorkspaceSetupHookExecution[] = [];
  const environmentSetupExecutions: EnvironmentSetupExecution[] = [];
  let extensionState = sharedExtensionState;

  if (!workspacePath) {
    if (runtimeEnvironment) {
      try {
        const prepared = await prepareHostEnvironmentForSetup(runtimeEnvironment, evalCase.id);
        workspacePath = prepared.workdir;
        isSharedWorkspace = true;
        environmentSetupExecutions.push(prepared.execution);
      } catch (error) {
        if (error instanceof WorkspaceSetupError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkspaceSetupError(`Failed to prepare host environment: ${message}`, {
          failureStage: 'setup',
          failureReasonCode: 'environment_setup_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    if (runtimeDockerEnvironment) {
      try {
        const prepared = await prepareDockerEnvironmentForSetup(
          runtimeDockerEnvironment,
          evalCase.id,
        );
        targetCwd = prepared.targetCwd;
        targetRuntime = prepared.targetRuntime;
        environmentSetupExecutions.push(prepared.execution);
      } catch (error) {
        if (error instanceof WorkspaceSetupError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkspaceSetupError(`Failed to prepare Docker environment: ${message}`, {
          failureStage: 'setup',
          failureReasonCode: 'environment_setup_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    const rawCaseTemplate = runtimeWorkspace?.template;
    const resolvedCaseTemplate = await resolveWorkspaceTemplate(rawCaseTemplate);
    const caseWorkspaceTemplate = resolvedCaseTemplate?.dir;
    caseWorkspaceFile = resolvedCaseTemplate?.workspaceFile;
    if (!workspacePath && caseWorkspaceTemplate && evalRunId) {
      try {
        workspacePath = await createTempWorkspace(caseWorkspaceTemplate, evalRunId, evalCase.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkspaceSetupError(`Failed to create workspace: ${message}`, {
          failureStage: 'setup',
          failureReasonCode: 'template_error',
          hookExecutions,
          cause: error,
        });
      }

      if (caseWorkspaceFile && workspacePath) {
        const copiedFile = path.join(workspacePath, path.basename(caseWorkspaceFile));
        try {
          await stat(copiedFile);
          caseWorkspaceFile = copiedFile;
        } catch {
          // Keep original if copy does not exist.
        }
      }
    }

    if (
      !workspacePath &&
      (runtimeWorkspace?.hooks || runtimeWorkspace?.repos?.length || evalCase.extensions?.length) &&
      evalRunId
    ) {
      workspacePath = getWorkspacePath(evalRunId, evalCase.id);
      await mkdir(workspacePath, { recursive: true });
    }

    if (runtimeWorkspace?.repos?.length && workspacePath) {
      const perCaseRepoManager = new RepoManager(setupDebug, { projectConfigDir: evalDir });
      try {
        if (setupDebug) {
          console.log(
            `[setup] test=${evalCase.id} materializing ${runtimeWorkspace.repos.length} attempt repo(s) into ${workspacePath}`,
          );
        }
        await perCaseRepoManager.materializeAll(runtimeWorkspace.repos, workspacePath);
        if (setupDebug) {
          console.log(`[setup] test=${evalCase.id} attempt repo materialization complete`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkspaceSetupError(`Failed to materialize repos: ${message}`, {
          failureStage: 'repo_setup',
          failureReasonCode: 'clone_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    if (workspacePath && evalCase.metadata?.agent_skills_files) {
      const baseDir = evalCase.metadata.agent_skills_base_dir as string | undefined;
      const files = evalCase.metadata.agent_skills_files as readonly string[];
      if (baseDir && files.length > 0) {
        for (const relPath of files) {
          const srcPath = path.resolve(baseDir, relPath);
          const destPath = path.resolve(workspacePath, relPath);
          try {
            await mkdir(path.dirname(destPath), { recursive: true });
            await copyFile(srcPath, destPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new WorkspaceSetupError(
              `Agent Skills eval file not found: ${relPath} (resolved from ${baseDir}): ${message}`,
              {
                failureStage: 'setup',
                failureReasonCode: 'file_copy_error',
                hookExecutions,
                cause: error,
              },
            );
          }
        }
      }
    }

    const caseDockerConfig = runtimeWorkspace?.docker;
    if (caseDockerConfig) {
      try {
        await prepareDockerWorkspace(caseDockerConfig, (message) => {
          if (setupDebug) {
            console.log(`[setup] test=${evalCase.id} ${message}`);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (forceCleanup && workspacePath) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        throw new WorkspaceSetupError(message, {
          failureStage: 'setup',
          failureReasonCode: 'docker_setup_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    const caseEnvConfig = runtimeWorkspace?.env;
    if (caseEnvConfig) {
      try {
        await runPreflightChecks(caseEnvConfig, workspacePath ?? evalDir, (message) => {
          if (setupDebug) {
            console.log(`[setup] test=${evalCase.id} ${message}`);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (forceCleanup && workspacePath) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        throw new WorkspaceSetupError(message, {
          failureStage: 'setup',
          failureReasonCode: 'preflight_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    if (workspacePath && evalCase.extensions && evalCase.extensions.length > 0) {
      try {
        extensionState = await runExtensionsForHook({
          extensions: evalCase.extensions,
          hook: 'beforeAll',
          context: {
            hook_name: 'beforeAll',
            workspace_path: workspacePath,
            test_id: evalCase.id,
            eval_run_id: evalRunId ?? '',
            case_input: evalCase.question,
            case_metadata: evalCase.metadata,
            eval_dir: evalDir ?? process.cwd(),
            workspace_file_dir: runtimeWorkspace?.workspaceFileDir,
          },
          state: extensionState,
        });
        beforeAllOutput = mergeHookOutput(beforeAllOutput, extensionState?.output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (forceCleanup && workspacePath) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        throw new WorkspaceSetupError(`beforeAll extension failed: ${message}`, {
          failureStage: 'setup',
          failureReasonCode: 'extension_error',
          hookExecutions,
          cause: error,
        });
      }
    }

    const caseBeforeAllHook = runtimeWorkspace?.hooks?.before_all;
    if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeAllHook)) {
      const beforeAllHook = caseBeforeAllHook;
      const beforeAllCommand = (beforeAllHook.command ?? []).join(' ');
      if (setupDebug) {
        console.log(
          `[setup] test=${evalCase.id} running before_all in cwd=${beforeAllHook.cwd ?? evalDir} command=${beforeAllCommand}`,
        );
      }
      const scriptContext: ScriptExecutionContext = {
        workspacePath,
        testId: evalCase.id,
        evalRunId: evalRunId ?? '',
        caseInput: evalCase.question,
        caseMetadata: evalCase.metadata,
        evalDir,
        workspaceFileDir: runtimeWorkspace?.workspaceFileDir,
      };
      try {
        beforeAllOutput = await executeWorkspaceScript(
          toScriptConfig(beforeAllHook, 'before_all', `test '${evalCase.id}'`),
          scriptContext,
        );
        hookExecutions.push(
          hookExecution({
            scope: 'workspace',
            name: 'before_all',
            status: 'success',
            testId: evalCase.id,
            workspacePath,
            hook: beforeAllHook,
            output: beforeAllOutput,
          }),
        );
        if (setupDebug) {
          console.log(`[setup] test=${evalCase.id} before_all completed`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        hookExecutions.push(
          hookExecution({
            scope: 'workspace',
            name: 'before_all',
            status: 'failed',
            testId: evalCase.id,
            workspacePath,
            hook: beforeAllHook,
            error: message,
          }),
        );
        if (forceCleanup && workspacePath) {
          await cleanupWorkspace(workspacePath).catch(() => {});
        }
        throw new WorkspaceSetupError(`before_all script failed: ${message}`, {
          failureStage: 'setup',
          failureReasonCode: 'script_error',
          hookExecutions,
          cause: error,
        });
      }
    }
  }

  let beforeEachNeedsFreshBaseline = false;

  if (
    caseHooksEnabled &&
    workspacePath &&
    runtimeWorkspace?.hooks?.before_each?.reset &&
    runtimeWorkspace.hooks.before_each.reset !== 'none'
  ) {
    try {
      if (repoManager && runtimeWorkspace.repos?.length) {
        await repoManager.reset(
          runtimeWorkspace.repos,
          workspacePath,
          runtimeWorkspace.hooks.before_each.reset,
        );
      } else {
        await resetWorkspaceRoot(
          workspacePath,
          runtimeWorkspace.hooks.before_each.reset,
          sharedBaselineCommit,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspaceSetupError(`before_each reset failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'script_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  const caseBeforeEachHook = runtimeWorkspace?.hooks?.before_each;
  if (workspacePath && evalCase.extensions && evalCase.extensions.length > 0) {
    try {
      beforeEachNeedsFreshBaseline = hasExtensionHook(evalCase.extensions, 'beforeEach');
      const nextState = await runExtensionsForHook({
        extensions: evalCase.extensions,
        hook: 'beforeEach',
        context: {
          hook_name: 'beforeEach',
          workspace_path: workspacePath,
          test_id: evalCase.id,
          eval_run_id: evalRunId ?? '',
          case_input: evalCase.question,
          case_metadata: evalCase.metadata,
          eval_dir: evalDir ?? process.cwd(),
          workspace_file_dir: runtimeWorkspace?.workspaceFileDir,
        },
        state: extensionState,
      });
      if (nextState !== extensionState) {
        beforeEachNeedsFreshBaseline = true;
      }
      extensionState = nextState;
      beforeEachOutput = mergeHookOutput(beforeEachOutput, extensionState?.output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspaceSetupError(`beforeEach extension failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'extension_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeEachHook)) {
    const beforeEachHook = caseBeforeEachHook;
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
      evalDir,
      workspaceFileDir: runtimeWorkspace?.workspaceFileDir,
    };
    try {
      beforeEachOutput = await executeWorkspaceScript(
        toScriptConfig(beforeEachHook, 'before_each', `test '${evalCase.id}'`),
        scriptContext,
      );
      hookExecutions.push(
        hookExecution({
          scope: 'workspace',
          name: 'before_each',
          status: 'success',
          testId: evalCase.id,
          workspacePath,
          hook: beforeEachHook,
          output: beforeEachOutput,
        }),
      );
      beforeEachNeedsFreshBaseline = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hookExecutions.push(
        hookExecution({
          scope: 'workspace',
          name: 'before_each',
          status: 'failed',
          testId: evalCase.id,
          workspacePath,
          hook: beforeEachHook,
          error: message,
        }),
      );
      throw new WorkspaceSetupError(`before_each script failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'script_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  const targetBeforeEachHook = targetHooks?.before_each;
  if (workspacePath && hasHookCommand(targetBeforeEachHook)) {
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
      evalDir,
      workspaceFileDir: runtimeWorkspace?.workspaceFileDir,
    };
    try {
      await executeWorkspaceScript(
        toScriptConfig(targetBeforeEachHook, 'before_each', `target hook for '${evalCase.id}'`),
        scriptContext,
      );
      hookExecutions.push(
        hookExecution({
          scope: 'target',
          name: 'before_each',
          status: 'success',
          testId: evalCase.id,
          workspacePath,
          hook: targetBeforeEachHook,
        }),
      );
      beforeEachNeedsFreshBaseline = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hookExecutions.push(
        hookExecution({
          scope: 'target',
          name: 'before_each',
          status: 'failed',
          testId: evalCase.id,
          workspacePath,
          hook: targetBeforeEachHook,
          error: message,
        }),
      );
      throw new WorkspaceSetupError(`target before_each hook failed: ${message}`, {
        failureStage: 'setup',
        failureReasonCode: 'script_error',
        hookExecutions,
        cause: error,
      });
    }
  }

  let baselineCommit: string | undefined = beforeEachNeedsFreshBaseline
    ? undefined
    : sharedBaselineCommit;
  if (!baselineCommit && workspacePath) {
    try {
      baselineCommit = await initializeBaseline(workspacePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (setupDebug) {
        console.warn(`[setup] test=${evalCase.id} baseline initialization failed: ${message}`);
      }
    }
  }

  return {
    ...(workspacePath !== undefined && { workspacePath }),
    caseWorkspaceFile: caseWorkspaceFile ?? inheritedSuiteWorkspaceFile,
    ...(beforeAllOutput !== undefined && { beforeAllOutput }),
    ...(beforeEachOutput !== undefined && { beforeEachOutput }),
    ...(baselineCommit !== undefined && { baselineCommit }),
    ...(targetCwd !== undefined && { targetCwd }),
    ...(targetRuntime !== undefined && { targetRuntime }),
    isSharedWorkspace,
    hookExecutions,
    environmentSetupExecutions,
    ...(extensionState !== undefined && { extensionState }),
  };
}

/**
 * Run preflight environment checks for workspace.env config.
 * Fails fast if any required command or Python module is missing.
 */
async function runPreflightChecks(
  env: WorkspaceEnvConfig,
  cwd: string | undefined,
  log: (msg: string) => void,
): Promise<void> {
  const missing: string[] = [];

  for (const cmd of env.required_commands ?? []) {
    log(`preflight: checking command "${cmd}"`);
    try {
      if (process.platform === 'win32') {
        await execFileAsync('where', [cmd], { cwd });
      } else {
        await execFileAsync('sh', ['-c', `command -v ${cmd}`], { cwd });
      }
    } catch {
      missing.push(`command: ${cmd}`);
    }
  }

  for (const mod of env.required_python_modules ?? []) {
    log(`preflight: checking Python module "${mod}"`);
    try {
      await execFileAsync('python3', ['-c', `import ${mod}`], { cwd });
    } catch {
      missing.push(`python module: ${mod}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Preflight checks failed — missing dependencies:\n${missing.map((m) => `  • ${m}`).join('\n')}\n\nInstall the missing dependencies before running this eval.`,
    );
  }
}

async function prepareDockerWorkspace(
  dockerConfig: WorkspaceConfig['docker'],
  log: (msg: string) => void,
): Promise<void> {
  if (!dockerConfig) {
    return;
  }
  log(`pulling Docker image: ${dockerConfig.image}`);
  const { DockerWorkspaceProvider } = await import('./docker-workspace.js');
  const dockerSetup = new DockerWorkspaceProvider(dockerConfig);
  if (!(await dockerSetup.isDockerAvailable())) {
    throw new Error(
      'Docker workspace configured but Docker CLI is not available. Install Docker and ensure it is running.',
    );
  }
  await dockerSetup.pullImage();
  log('Docker image pull complete');
}

export { captureWorkspaceFileChanges };
