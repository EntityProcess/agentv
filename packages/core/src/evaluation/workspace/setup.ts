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

import { getWorkspacePoolRoot } from '../../paths.js';
import type {
  EvalTest,
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
import { type PoolSlot, WorkspacePoolManager } from './pool-manager.js';
import { RepoManager } from './repo-manager.js';
import { resolveWorkspaceTemplate } from './resolve.js';
import { type ScriptExecutionContext, executeWorkspaceScript } from './script-executor.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_GIT_TIMEOUT_MS = 300_000;

export type WorkspaceSetupMode = 'pooled' | 'temp' | 'static';
export type WorkspaceSetupCleanPolicy = 'standard' | 'full';
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

export class WorkspaceSetupError extends Error {
  readonly failureStage: FailureStage;
  readonly failureReasonCode: string;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];

  constructor(
    message: string,
    options: {
      readonly failureStage: FailureStage;
      readonly failureReasonCode: string;
      readonly hookExecutions?: readonly WorkspaceSetupHookExecution[];
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'WorkspaceSetupError';
    this.failureStage = options.failureStage;
    this.failureReasonCode = options.failureReasonCode;
    this.hookExecutions = options.hookExecutions ?? [];
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
  readonly poolMaxSlots?: number;
  readonly workspacePath?: string;
  readonly legacyWorkspacePath?: string;
  readonly workspaceMode?: WorkspaceSetupMode;
  readonly workspaceClean?: WorkspaceSetupCleanPolicy;
}

export interface SharedWorkspaceSetup {
  readonly suiteWorkspace?: WorkspaceConfig;
  readonly sharedWorkspaceOwnerKey?: string;
  readonly sharedWorkspaceAppliesToAllCases: boolean;
  readonly sharedWorkspacePath?: string;
  readonly sharedBaselineCommit?: string;
  readonly suiteWorkspaceFile?: string;
  readonly beforeAllOutput?: string;
  readonly repoManager?: RepoManager;
  readonly poolManager?: WorkspacePoolManager;
  readonly poolSlot?: PoolSlot;
  readonly poolSlots: readonly PoolSlot[];
  readonly availablePoolSlots: PoolSlot[];
  readonly poolSlotBaselines: ReadonlyMap<string, string>;
  readonly useStaticWorkspace: boolean;
  readonly configuredMode: WorkspaceSetupMode;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
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
}

export interface EvalCaseWorkspaceSetup {
  readonly workspacePath?: string;
  readonly caseWorkspaceFile?: string;
  readonly beforeAllOutput?: string;
  readonly beforeEachOutput?: string;
  readonly baselineCommit?: string;
  readonly isSharedWorkspace: boolean;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
}

export function toScriptConfig(
  hook: WorkspaceHookConfig,
  hookName: string,
  context: string,
): WorkspaceScriptConfig {
  const command = hook.command ?? hook.script;
  if (!command || command.length === 0) {
    throw new Error(`${hookName} hook in ${context} requires command or script`);
  }
  return {
    command,
    ...(hook.timeout_ms !== undefined && { timeout_ms: hook.timeout_ms }),
    ...(hook.timeoutMs !== undefined && { timeoutMs: hook.timeoutMs }),
    ...(hook.cwd !== undefined && { cwd: hook.cwd }),
    ...(hook.script !== undefined && { script: hook.script }),
  };
}

export function hasHookCommand(hook: WorkspaceHookConfig | undefined): hook is WorkspaceHookConfig {
  return !!((hook?.command && hook.command.length > 0) || (hook?.script && hook.script.length > 0));
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

export function isPerCaseIsolation(
  workspace: { readonly isolation?: WorkspaceConfig['isolation'] } | undefined,
): boolean {
  return workspace?.isolation === 'per_case';
}

export function caseUsesSharedWorkspaceSetup(
  evalCase: EvalTest,
  setup: Pick<SharedWorkspaceSetup, 'sharedWorkspaceAppliesToAllCases' | 'sharedWorkspaceOwnerKey'>,
): boolean {
  if (isPerCaseIsolation(evalCase.workspace)) {
    return false;
  }
  if (setup.sharedWorkspaceAppliesToAllCases) {
    return true;
  }
  return (
    setup.sharedWorkspaceOwnerKey !== undefined &&
    workspaceNeedsSharedSetup(evalCase.workspace) &&
    sharedWorkspaceOwnerKey(evalCase) === setup.sharedWorkspaceOwnerKey
  );
}

function workspaceNeedsSharedSetup(
  workspace: WorkspaceConfig | undefined,
): workspace is WorkspaceConfig {
  if (!workspace || isPerCaseIsolation(workspace)) {
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
  return `${sourceKey}:${stableWorkspaceValue(evalCase.workspace)}`;
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
    if (!workspaceNeedsSharedSetup(evalCase.workspace)) {
      continue;
    }
    const key = sharedWorkspaceOwnerKey(evalCase);
    const existing = candidates.get(key);
    if (existing) {
      existing.testIds.push(evalCase.id);
      continue;
    }
    candidates.set(key, {
      workspace: evalCase.workspace,
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
    `Wrapper eval contains multiple shared workspace owners: ${owners}. AgentV does not merge parent and child workspaces or run separate imported-suite shared workspaces in one wrapper execution. Use isolation: per_case for imported suites, split them into separate runs, or keep only one shared workspace owner.`,
    {
      failureStage: 'setup',
      failureReasonCode: 'ambiguous_shared_workspace',
    },
  );
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
  return hook?.command ?? hook?.script;
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

async function releasePoolSlots(setup: {
  readonly poolManager?: WorkspacePoolManager;
  readonly poolSlot?: PoolSlot;
  readonly poolSlots: readonly PoolSlot[];
}): Promise<void> {
  if (!setup.poolManager) {
    return;
  }
  if (setup.poolSlot) {
    await setup.poolManager.releaseSlot(setup.poolSlot);
  }
  for (const slot of setup.poolSlots) {
    if (slot !== setup.poolSlot) {
      await setup.poolManager.releaseSlot(slot).catch(() => {});
    }
  }
}

export async function releaseSharedWorkspaceSetup(setup: SharedWorkspaceSetup): Promise<void> {
  await releasePoolSlots(setup);
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
    poolMaxSlots: configPoolMaxSlots,
    workspacePath,
    legacyWorkspacePath,
    workspaceMode,
    workspaceClean,
  } = options;
  const selectedSuiteWorkspace = selectSuiteWorkspace(evalCases);
  const suiteWorkspace = selectedSuiteWorkspace?.workspace;
  const rawTemplate = suiteWorkspace?.template;
  const resolvedTemplate = await resolveWorkspaceTemplate(rawTemplate);
  const workspaceTemplate = resolvedTemplate?.dir;
  let suiteWorkspaceFile = resolvedTemplate?.workspaceFile;
  const setupLog = (message: string): void => {
    if (verbose) {
      console.log(`[setup] ${message}`);
    }
  };

  const isPerCaseWorkspace = isPerCaseIsolation(suiteWorkspace);

  const cliWorkspacePath = workspacePath ?? legacyWorkspacePath;
  const sharedWorkspaceAppliesToAllCases = !!cliWorkspacePath;
  if (cliWorkspacePath && workspaceMode && workspaceMode !== 'static') {
    throw new Error('--workspace-path requires --workspace-mode static when both are provided');
  }
  let configuredMode: WorkspaceSetupMode = cliWorkspacePath
    ? 'static'
    : (workspaceMode ?? 'pooled');
  const configuredStaticPath = cliWorkspacePath;

  if (configuredMode === 'static' && !configuredStaticPath) {
    if (!suiteWorkspace?.repos?.length) {
      setupLog(
        'runtime workspaceMode=static with no path and no repos — falling back to temp mode',
      );
      configuredMode = 'temp';
    } else {
      throw new Error(
        'runtime workspaceMode=static requires --workspace-path or execution.workspace_path in config.local.yaml',
      );
    }
  }

  const useStaticWorkspace = configuredMode === 'static';

  if (useStaticWorkspace && evalCases.some((evalCase) => isPerCaseIsolation(evalCase.workspace))) {
    throw new Error(
      'static workspace mode is incompatible with isolation: per_case. Use isolation: shared (default).',
    );
  }
  const hasSharedWorkspace = !!(
    useStaticWorkspace ||
    (!isPerCaseWorkspace &&
      (workspaceTemplate || suiteWorkspace?.hooks || suiteWorkspace?.repos?.length))
  );

  const poolEnabled = configuredMode === 'pooled';
  const usePool =
    poolEnabled !== false &&
    !!suiteWorkspace?.repos?.length &&
    !isPerCaseWorkspace &&
    !useStaticWorkspace;

  setupLog(
    `sharedWorkspace=${hasSharedWorkspace} perCaseIsolation=${isPerCaseWorkspace} usePool=${usePool} workers=${workers}`,
  );
  if (hasSharedWorkspace && !usePool && workers > 1 && evalCases.length > 1) {
    console.warn(
      [
        `Warning: This eval uses a shared workspace with ${workers} workers.`,
        'If the agent under test makes file edits, concurrent runs may corrupt each other.',
        'To limit concurrency, add this to your eval YAML:',
        '',
        '  execution:',
        '    workers: 1',
        '',
        'Or pass --workers 1 on the command line.',
      ].join('\n'),
    );
  }

  let sharedWorkspacePath: string | undefined;
  let sharedBaselineCommit: string | undefined;
  let beforeAllOutput: string | undefined;

  let poolManager: WorkspacePoolManager | undefined;
  let poolSlot: PoolSlot | undefined;
  const poolSlots: PoolSlot[] = [];
  const availablePoolSlots: PoolSlot[] = [];
  const poolSlotBaselines = new Map<string, string>();
  const hookExecutions: WorkspaceSetupHookExecution[] = [];

  const poolMaxSlots = Math.min(configPoolMaxSlots ?? 10, 50);
  let repoManager: RepoManager | undefined;

  try {
    if (useStaticWorkspace && configuredStaticPath) {
      setupLog(`reusing existing static workspace: ${configuredStaticPath}`);
      sharedWorkspacePath = configuredStaticPath;
    } else if (!isPerCaseWorkspace && usePool && suiteWorkspace?.repos) {
      const slotsNeeded = workers;
      setupLog(`acquiring ${slotsNeeded} workspace pool slot(s) (pool capacity: ${poolMaxSlots})`);
      poolManager = new WorkspacePoolManager(getWorkspacePoolRoot());
      const poolRepoManager = new RepoManager(verbose, { projectConfigDir: evalDir });
      repoManager = poolRepoManager;

      for (let i = 0; i < slotsNeeded; i++) {
        const slot = await poolManager.acquireWorkspace({
          templatePath: workspaceTemplate,
          repos: suiteWorkspace.repos,
          maxSlots: poolMaxSlots,
          repoManager: poolRepoManager,
          poolReset:
            (workspaceClean === 'full'
              ? 'strict'
              : workspaceClean === 'standard'
                ? 'fast'
                : null) ?? 'fast',
        });
        poolSlots.push(slot);
        setupLog(`pool slot ${i} acquired at: ${slot.path} (existing=${slot.isExisting})`);
      }

      if (slotsNeeded === 1) {
        poolSlot = poolSlots[0];
        sharedWorkspacePath = poolSlot.path;
      } else {
        availablePoolSlots.push(...poolSlots);
      }
    } else if (!isPerCaseWorkspace && workspaceTemplate) {
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
    } else if (!isPerCaseWorkspace && (suiteWorkspace?.hooks || suiteWorkspace?.repos?.length)) {
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

    const hasReposToMaterialize =
      !!suiteWorkspace?.repos?.length && !usePool && !isPerCaseWorkspace;
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
    if (sharedWorkspacePath && suiteHooksEnabled && hasHookCommand(suiteBeforeAllHook)) {
      const beforeAllHook = suiteBeforeAllHook;
      const beforeAllCommand = (beforeAllHook.command ?? beforeAllHook.script ?? []).join(' ');
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

    if (availablePoolSlots.length > 0 && suiteHooksEnabled && hasHookCommand(suiteBeforeAllHook)) {
      const beforeAllHook = suiteBeforeAllHook;
      for (const slot of availablePoolSlots) {
        setupLog(`running before_all on pool slot ${slot.index}`);
        const scriptContext: ScriptExecutionContext = {
          workspacePath: slot.path,
          testId: '__before_all__',
          evalRunId,
          evalDir,
          workspaceFileDir: suiteWorkspace?.workspaceFileDir,
        };
        try {
          const output = await executeWorkspaceScript(
            toScriptConfig(beforeAllHook, 'before_all', 'suite workspace'),
            scriptContext,
          );
          if (!beforeAllOutput) beforeAllOutput = output;
          hookExecutions.push(
            hookExecution({
              scope: 'workspace',
              name: 'before_all',
              status: 'success',
              testId: '__before_all__',
              workspacePath: slot.path,
              hook: beforeAllHook,
              output,
            }),
          );
          setupLog(`before_all completed on pool slot ${slot.index}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          hookExecutions.push(
            hookExecution({
              scope: 'workspace',
              name: 'before_all',
              status: 'failed',
              testId: '__before_all__',
              workspacePath: slot.path,
              hook: beforeAllHook,
              error: message,
            }),
          );
          throw new WorkspaceSetupError(
            `before_all script failed on pool slot ${slot.index}: ${message}`,
            {
              failureStage: 'setup',
              failureReasonCode: 'script_error',
              hookExecutions,
              cause: error,
            },
          );
        }
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

    if (availablePoolSlots.length > 0 && hasHookCommand(targetBeforeAllHook)) {
      for (const slot of availablePoolSlots) {
        setupLog(`running target before_all on pool slot ${slot.index}`);
        const scriptContext: ScriptExecutionContext = {
          workspacePath: slot.path,
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
              workspacePath: slot.path,
              hook: targetBeforeAllHook,
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          hookExecutions.push(
            hookExecution({
              scope: 'target',
              name: 'before_all',
              status: 'failed',
              testId: '__target_before_all__',
              workspacePath: slot.path,
              hook: targetBeforeAllHook,
              error: message,
            }),
          );
          throw new WorkspaceSetupError(
            `target before_all hook failed on pool slot ${slot.index}: ${message}`,
            {
              failureStage: 'setup',
              failureReasonCode: 'script_error',
              hookExecutions,
              cause: error,
            },
          );
        }
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

    if (availablePoolSlots.length > 0) {
      for (const slot of availablePoolSlots) {
        try {
          const baseline = await initializeBaseline(slot.path);
          poolSlotBaselines.set(slot.path, baseline);
          setupLog(`pool slot ${slot.index} baseline initialized: ${baseline}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setupLog(
            `pool slot ${slot.index} baseline initialization failed (file_changes unavailable): ${message}`,
          );
        }
      }
    }

    return {
      ...(suiteWorkspace !== undefined && { suiteWorkspace }),
      ...(selectedSuiteWorkspace?.key !== undefined && {
        sharedWorkspaceOwnerKey: selectedSuiteWorkspace.key,
      }),
      sharedWorkspaceAppliesToAllCases,
      ...(sharedWorkspacePath !== undefined && { sharedWorkspacePath }),
      ...(sharedBaselineCommit !== undefined && { sharedBaselineCommit }),
      ...(suiteWorkspaceFile !== undefined && { suiteWorkspaceFile }),
      ...(beforeAllOutput !== undefined && { beforeAllOutput }),
      ...(repoManager !== undefined && { repoManager }),
      ...(poolManager !== undefined && { poolManager }),
      ...(poolSlot !== undefined && { poolSlot }),
      poolSlots,
      availablePoolSlots,
      poolSlotBaselines,
      useStaticWorkspace,
      configuredMode,
      hookExecutions,
    };
  } catch (error) {
    await releasePoolSlots({ poolManager, poolSlot, poolSlots }).catch(() => {});
    throw error;
  }
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
  } = options;

  let workspacePath: string | undefined = isPerCaseIsolation(evalCase.workspace)
    ? undefined
    : sharedWorkspacePath;
  const inheritedSuiteWorkspaceFile = workspacePath ? suiteWorkspaceFile : undefined;
  let beforeAllOutput: string | undefined;
  let beforeEachOutput: string | undefined;
  const isSharedWorkspace = !!workspacePath;
  let caseWorkspaceFile: string | undefined;
  const caseHooksEnabled = hooksEnabled(evalCase.workspace);
  const hookExecutions: WorkspaceSetupHookExecution[] = [];

  if (!workspacePath) {
    const rawCaseTemplate = evalCase.workspace?.template;
    const resolvedCaseTemplate = await resolveWorkspaceTemplate(rawCaseTemplate);
    const caseWorkspaceTemplate = resolvedCaseTemplate?.dir;
    caseWorkspaceFile = resolvedCaseTemplate?.workspaceFile;
    if (caseWorkspaceTemplate && evalRunId) {
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
      (evalCase.workspace?.hooks || evalCase.workspace?.repos?.length) &&
      evalRunId
    ) {
      workspacePath = getWorkspacePath(evalRunId, evalCase.id);
      await mkdir(workspacePath, { recursive: true });
    }

    if (evalCase.workspace?.repos?.length && workspacePath) {
      const perCaseRepoManager = new RepoManager(setupDebug, { projectConfigDir: evalDir });
      try {
        if (setupDebug) {
          console.log(
            `[setup] test=${evalCase.id} materializing ${evalCase.workspace.repos.length} per-case repo(s) into ${workspacePath}`,
          );
        }
        await perCaseRepoManager.materializeAll(evalCase.workspace.repos, workspacePath);
        if (setupDebug) {
          console.log(`[setup] test=${evalCase.id} per-case repo materialization complete`);
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

    const caseDockerConfig = evalCase.workspace?.docker;
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

    const caseEnvConfig = evalCase.workspace?.env;
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

    const caseBeforeAllHook = evalCase.workspace?.hooks?.before_all;
    if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeAllHook)) {
      const beforeAllHook = caseBeforeAllHook;
      const beforeAllCommand = (beforeAllHook.command ?? beforeAllHook.script ?? []).join(' ');
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
        workspaceFileDir: evalCase.workspace?.workspaceFileDir,
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
    evalCase.workspace?.hooks?.before_each?.reset &&
    evalCase.workspace.hooks.before_each.reset !== 'none'
  ) {
    try {
      if (repoManager && evalCase.workspace.repos?.length) {
        await repoManager.reset(
          evalCase.workspace.repos,
          workspacePath,
          evalCase.workspace.hooks.before_each.reset,
        );
      } else {
        await resetWorkspaceRoot(
          workspacePath,
          evalCase.workspace.hooks.before_each.reset,
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

  const caseBeforeEachHook = evalCase.workspace?.hooks?.before_each;
  if (workspacePath && caseHooksEnabled && hasHookCommand(caseBeforeEachHook)) {
    const beforeEachHook = caseBeforeEachHook;
    const scriptContext: ScriptExecutionContext = {
      workspacePath,
      testId: evalCase.id,
      evalRunId: evalRunId ?? '',
      caseInput: evalCase.question,
      caseMetadata: evalCase.metadata,
      evalDir,
      workspaceFileDir: evalCase.workspace?.workspaceFileDir,
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
      workspaceFileDir: evalCase.workspace?.workspaceFileDir,
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
    isSharedWorkspace,
    hookExecutions,
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
