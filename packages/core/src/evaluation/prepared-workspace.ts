/**
 * Prepared workspace API for external attempts.
 *
 * `prepareEvalWorkspace` materializes exactly one eval case for one target and
 * stops immediately before provider execution. It is the core primitive behind
 * `agentv prepare` and future prepared-attempt grading: callers get a workspace
 * path, prompt inputs, setup-hook history, repo pins, and baseline metadata, but
 * no target provider or grader is invoked here.
 *
 * The returned object uses internal camelCase names. Any CLI manifest writer
 * should translate these fields to snake_case at the disk boundary.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import micromatch from 'micromatch';

import type { ResolvedTarget } from './providers/targets.js';
import type { ChatPrompt } from './providers/types.js';
import { AGENT_PROVIDER_KINDS } from './providers/types.js';
import type { EvalTest, RepoConfig, TargetHooksConfig } from './types.js';
import {
  type SharedWorkspaceSetup,
  type WorkspaceSetupCleanPolicy,
  type WorkspaceSetupHookExecution,
  type WorkspaceSetupMode,
  type WorkspaceSetupRetentionPolicy,
  prepareEvalCaseWorkspace,
  prepareSharedWorkspaceSetup,
  releaseSharedWorkspaceSetup,
} from './workspace/setup.js';
import { type PromptInputs, buildPromptInputs, loadTests } from './yaml-parser.js';

export interface PrepareEvalWorkspaceOptions {
  readonly testFilePath: string;
  readonly repoRoot: URL | string;
  readonly target: ResolvedTarget;
  readonly targetHooks?: TargetHooksConfig;
  readonly evalCases?: readonly EvalTest[];
  /** Exact test id to prepare. */
  readonly testId?: string;
  /** Glob filter used when `testId` is not supplied. Must resolve to one case. */
  readonly filter?: string | readonly string[];
  readonly verbose?: boolean;
  readonly now?: () => Date;
  readonly maxConcurrency?: number;
  /** Legacy static workspace path override. */
  readonly workspace?: string;
  readonly workspaceMode?: WorkspaceSetupMode;
  readonly workspacePath?: string;
  readonly workspaceClean?: WorkspaceSetupCleanPolicy;
  readonly poolMaxSlots?: number;
  readonly keepWorkspaces?: boolean;
  readonly cleanupWorkspaces?: boolean;
  readonly retainOnSuccess?: WorkspaceSetupRetentionPolicy;
  readonly retainOnFailure?: WorkspaceSetupRetentionPolicy;
}

export interface PreparedWorkspaceRepoPin {
  readonly path?: string;
  readonly repo?: string;
  readonly commit?: string;
  readonly baseCommit?: string;
  readonly ancestor?: number;
  readonly sparse?: readonly string[];
}

export interface PreparedWorkspaceBaseline {
  readonly status: 'initialized' | 'unavailable';
  readonly commit?: string;
}

export interface PreparedWorkspacePromptSource {
  readonly kind: 'eval_case';
  readonly formattingMode: 'agent' | 'lm';
  readonly question: string;
  readonly systemMessage?: string;
  readonly chatPrompt?: ChatPrompt;
}

export interface PreparedWorkspaceCleanupPolicy {
  readonly mode: WorkspaceSetupMode;
  readonly retainOnSuccess: WorkspaceSetupRetentionPolicy;
  readonly retainOnFailure: WorkspaceSetupRetentionPolicy;
  readonly manualCleanup: boolean;
}

export interface PreparedWorkspacePoolMetadata {
  readonly fingerprint: string;
  readonly slotIndex: number;
  readonly lockPath: string;
}

export interface PreparedEvalWorkspace {
  readonly evalPath: string;
  readonly testId: string;
  readonly target: string;
  readonly evalRunId: string;
  readonly workspacePath: string;
  readonly workspaceFile?: string;
  readonly createdAt: string;
  readonly hookExecutions: readonly WorkspaceSetupHookExecution[];
  readonly repoPins: readonly PreparedWorkspaceRepoPin[];
  readonly baseline: PreparedWorkspaceBaseline;
  readonly promptSource: PreparedWorkspacePromptSource;
  readonly cleanupPolicy: PreparedWorkspaceCleanupPolicy;
  readonly sharedWorkspace: boolean;
  readonly pool?: PreparedWorkspacePoolMetadata;
}

function matchesFilter(id: string, filter: string | readonly string[]): boolean {
  return typeof filter === 'string'
    ? micromatch.isMatch(id, filter)
    : filter.some((pattern) => micromatch.isMatch(id, pattern));
}

function selectSingleCase(options: {
  readonly evalCases: readonly EvalTest[];
  readonly testId?: string;
  readonly filter?: string | readonly string[];
  readonly evalPath: string;
}): EvalTest {
  const selected = options.testId
    ? options.evalCases.filter((evalCase) => evalCase.id === options.testId)
    : options.filter
      ? options.evalCases.filter((evalCase) => matchesFilter(evalCase.id, options.filter ?? ''))
      : options.evalCases;

  if (selected.length !== 1) {
    const selector = options.testId
      ? `test_id "${options.testId}"`
      : options.filter
        ? `filter "${Array.isArray(options.filter) ? options.filter.join(',') : options.filter}"`
        : 'the eval file';
    throw new Error(
      `prepareEvalWorkspace requires exactly one test, but ${selector} matched ${selected.length} in ${options.evalPath}.`,
    );
  }

  return selected[0];
}

function promptModeForTarget(target: ResolvedTarget): 'agent' | 'lm' {
  return AGENT_PROVIDER_KINDS.includes(target.kind) || target.kind === 'cli' ? 'agent' : 'lm';
}

function toRepoPins(repos: readonly RepoConfig[] | undefined): readonly PreparedWorkspaceRepoPin[] {
  return (repos ?? []).map((repo) => ({
    ...(repo.path !== undefined && { path: repo.path }),
    ...(repo.repo !== undefined && { repo: repo.repo }),
    ...(repo.commit !== undefined && { commit: repo.commit }),
    ...(repo.base_commit !== undefined && { baseCommit: repo.base_commit }),
    ...(repo.ancestor !== undefined && { ancestor: repo.ancestor }),
    ...(repo.sparse !== undefined && { sparse: repo.sparse }),
  }));
}

function poolMetadata(
  setup: SharedWorkspaceSetup,
  selectedSlotPath: string | undefined,
): PreparedWorkspacePoolMetadata | undefined {
  const slot =
    setup.poolSlot ?? setup.poolSlots.find((candidate) => candidate.path === selectedSlotPath);
  if (!slot) {
    return undefined;
  }
  return {
    fingerprint: slot.fingerprint,
    slotIndex: slot.index,
    lockPath: slot.lockPath,
  };
}

async function releaseUnselectedPoolSlots(
  setup: SharedWorkspaceSetup,
  selectedSlotPath: string | undefined,
): Promise<void> {
  if (!setup.poolManager) {
    return;
  }
  for (const slot of setup.poolSlots) {
    if (slot.path !== selectedSlotPath) {
      await setup.poolManager.releaseSlot(slot).catch(() => {});
    }
  }
}

export async function prepareEvalWorkspace(
  options: PrepareEvalWorkspaceOptions,
): Promise<PreparedEvalWorkspace> {
  const evalPath = path.resolve(options.testFilePath);
  const evalRunId = randomUUID();
  const evalCases =
    options.evalCases ??
    (await loadTests(evalPath, options.repoRoot, {
      verbose: options.verbose,
      filter: options.testId ?? options.filter,
    }));
  const evalCase = selectSingleCase({
    evalCases,
    testId: options.testId,
    filter: options.filter,
    evalPath,
  });
  const evalDir = path.dirname(evalPath);
  const workers = options.maxConcurrency ?? 1;
  const retainOnSuccess = options.retainOnSuccess ?? (options.keepWorkspaces ? 'keep' : 'cleanup');
  const retainOnFailure =
    options.retainOnFailure ?? (options.cleanupWorkspaces ? 'cleanup' : 'keep');
  const formattingMode = promptModeForTarget(options.target);
  const promptInputs: PromptInputs = await buildPromptInputs(evalCase, formattingMode);

  let sharedSetup: SharedWorkspaceSetup | undefined;
  try {
    sharedSetup = await prepareSharedWorkspaceSetup({
      evalRunId,
      evalCases: [evalCase],
      targetHooks: options.targetHooks,
      evalDir,
      verbose: options.verbose,
      workers,
      poolMaxSlots: options.poolMaxSlots,
      workspacePath: options.workspacePath,
      legacyWorkspacePath: options.workspace,
      workspaceMode: options.workspaceMode,
      workspaceClean: options.workspaceClean,
    });

    const testPoolSlot =
      sharedSetup.availablePoolSlots.length > 0 ? sharedSetup.availablePoolSlots.pop() : undefined;
    const selectedWorkspacePath = testPoolSlot?.path ?? sharedSetup.sharedWorkspacePath;
    const selectedBaselineCommit = testPoolSlot
      ? sharedSetup.poolSlotBaselines.get(testPoolSlot.path)
      : sharedSetup.sharedBaselineCommit;

    const caseSetup = await prepareEvalCaseWorkspace({
      evalCase,
      targetName: options.target.name,
      evalRunId,
      sharedWorkspacePath: selectedWorkspacePath,
      sharedBaselineCommit: selectedBaselineCommit,
      suiteWorkspaceFile: sharedSetup.suiteWorkspaceFile,
      repoManager: sharedSetup.repoManager,
      evalDir,
      cleanupWorkspaces: options.cleanupWorkspaces,
      targetHooks: options.targetHooks,
      setupDebug: options.verbose,
    });

    if (!caseSetup.workspacePath) {
      throw new Error(
        `No workspace was materialized for test "${evalCase.id}". Add workspace.template, workspace.repos, or workspace.hooks before preparing an external attempt.`,
      );
    }

    await releaseUnselectedPoolSlots(sharedSetup, caseSetup.workspacePath);
    const pool = poolMetadata(sharedSetup, caseSetup.workspacePath);

    return {
      evalPath,
      testId: evalCase.id,
      target: options.target.name,
      evalRunId,
      workspacePath: caseSetup.workspacePath,
      ...(caseSetup.caseWorkspaceFile !== undefined && {
        workspaceFile: caseSetup.caseWorkspaceFile,
      }),
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      hookExecutions: [...sharedSetup.hookExecutions, ...caseSetup.hookExecutions],
      repoPins: toRepoPins(evalCase.workspace?.repos),
      baseline: caseSetup.baselineCommit
        ? { status: 'initialized', commit: caseSetup.baselineCommit }
        : { status: 'unavailable' },
      promptSource: {
        kind: 'eval_case',
        formattingMode,
        question: promptInputs.question,
        ...(promptInputs.systemMessage !== undefined && {
          systemMessage: promptInputs.systemMessage,
        }),
        ...(promptInputs.chatPrompt !== undefined && { chatPrompt: promptInputs.chatPrompt }),
      },
      cleanupPolicy: {
        mode: sharedSetup.configuredMode,
        retainOnSuccess,
        retainOnFailure,
        manualCleanup: true,
      },
      sharedWorkspace: caseSetup.isSharedWorkspace,
      ...(pool !== undefined && { pool }),
    };
  } catch (error) {
    if (sharedSetup) {
      await releaseSharedWorkspaceSetup(sharedSetup).catch(() => {});
    }
    throw error;
  }
}
