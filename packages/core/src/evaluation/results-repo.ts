import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentvDataDir } from '../paths.js';
import type { ResultsConfig } from './loaders/config-loader.js';

const execFileAsync = promisify(execFile);
const RESULTS_REPO_RESULTS_DIR = '.agentv/results';
const RESULTS_REPO_RUNS_DIR = `${RESULTS_REPO_RESULTS_DIR}/runs`;

export interface ResultsRepoLocalPaths {
  readonly rootDir: string;
  readonly repoDir: string;
  readonly statusFile: string;
}

export type ResultsRepoSyncStatus =
  | 'clean'
  | 'unavailable'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'dirty'
  | 'conflicted'
  | 'syncing';

export interface ResultsRepoStatus {
  readonly configured: boolean;
  readonly available: boolean;
  readonly repo?: string;
  readonly path?: string;
  readonly auto_push?: boolean;
  readonly branch_prefix?: string;
  readonly local_dir?: string;
  readonly last_synced_at?: string;
  readonly last_error?: string;
  readonly sync_status?: ResultsRepoSyncStatus;
  readonly branch?: string;
  readonly upstream?: string;
  readonly ahead?: number;
  readonly behind?: number;
  readonly dirty_paths?: readonly string[];
  readonly conflicted_paths?: readonly string[];
  readonly git_status?: string;
  readonly git_diff_summary?: string;
  readonly blocked?: boolean;
  readonly block_reason?: string;
  readonly pull_performed?: boolean;
  readonly push_performed?: boolean;
  readonly commit_created?: boolean;
}

export interface CheckedOutResultsRepoBranch {
  readonly branchName: string;
  readonly baseBranch: string;
  readonly repoDir: string;
}

export interface PreparedResultsRepoBranch extends CheckedOutResultsRepoBranch {
  readonly cleanup: () => Promise<void>;
}

type PersistedStatus = {
  readonly last_synced_at?: string;
  readonly last_error?: string;
};

type ResultsRepoGitInspection = {
  readonly syncStatus: ResultsRepoSyncStatus;
  readonly branch?: string;
  readonly upstream?: string;
  readonly ahead?: number;
  readonly behind?: number;
  readonly dirtyPaths: readonly string[];
  readonly conflictedPaths: readonly string[];
  readonly gitStatus?: string;
  readonly gitDiffSummary?: string;
};

const activeResultsRepoSyncs = new Set<string>();

function sanitizeRepoSlug(repo: string): string {
  return repo.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

function withFriendlyGitHubAuthError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('permission denied') ||
    lower.includes('not logged into any github hosts')
  ) {
    return new Error(`${message}. Run 'gh auth login' to authenticate.`);
  }
  return new Error(message);
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function normalizeResultsConfig(config: ResultsConfig): Required<ResultsConfig> {
  const repo = config.repo.trim();
  const resolvedPath = config.path
    ? expandHome(config.path.trim())
    : path.join(getAgentvDataDir(), 'results', sanitizeRepoSlug(repo));
  return {
    mode: 'github',
    repo,
    path: resolvedPath,
    auto_push: config.auto_push === true,
    branch_prefix: config.branch_prefix?.trim() || 'eval-results',
  };
}

export function resolveResultsRepoUrl(repo: string): string {
  if (repo.includes('://') || repo.startsWith('git@')) {
    return repo;
  }
  return `https://github.com/${repo}.git`;
}

export function getResultsRepoLocalPaths(repo: string): ResultsRepoLocalPaths {
  const rootDir = path.join(getAgentvDataDir(), 'cache', 'results-repo', sanitizeRepoSlug(repo));
  return {
    rootDir,
    repoDir: path.join(rootDir, 'repo'),
    statusFile: path.join(rootDir, 'status.json'),
  };
}

function readPersistedStatus(statusFile: string): PersistedStatus {
  if (!existsSync(statusFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(statusFile, 'utf8')) as PersistedStatus;
  } catch {
    return {};
  }
}

function writePersistedStatus(statusFile: string, status: PersistedStatus): void {
  mkdirSync(path.dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

async function runCommand(
  executable: string,
  args: readonly string[],
  options?: { cwd?: string; check?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...args], {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
    });
    return { stdout, stderr };
  } catch (error) {
    if (options?.check === false && error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string };
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
      };
    }
    throw withFriendlyGitHubAuthError(error);
  }
}

function getGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

async function runGit(
  args: readonly string[],
  options?: { cwd?: string; check?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  return runCommand('git', args, { ...options, env: getGitEnv() });
}

async function runGh(
  args: readonly string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return runCommand('gh', args, options);
}

async function resolveDefaultBranch(repoDir: string): Promise<string> {
  try {
    const { stdout } = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoDir });
    const ref = stdout.trim();
    const prefix = 'refs/remotes/origin/';
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  } catch {
    // Fall through to main/master probing.
  }

  for (const candidate of ['main', 'master']) {
    try {
      await runGit(['rev-parse', '--verify', `origin/${candidate}`], { cwd: repoDir });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return 'main';
}

async function fetchResultsRepo(repoDir: string): Promise<void> {
  await runGit(['fetch', 'origin', '--prune'], { cwd: repoDir });
}

async function isGitRepository(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repoDir });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function updateStatusFile(config: ResultsConfig, patch: PersistedStatus): void {
  const cachePaths = getResultsRepoLocalPaths(config.repo);
  const current = readPersistedStatus(cachePaths.statusFile);
  writePersistedStatus(cachePaths.statusFile, {
    ...current,
    ...patch,
  });
}

export async function ensureResultsRepoClone(config: ResultsConfig): Promise<string> {
  const normalized = normalizeResultsConfig(config);
  const cachePaths = getResultsRepoLocalPaths(normalized.repo);
  const cloneDir = normalized.path;
  mkdirSync(cachePaths.rootDir, { recursive: true });
  mkdirSync(path.dirname(cloneDir), { recursive: true });

  const cloneMissing = !existsSync(cloneDir);
  const gitDir = path.join(cloneDir, '.git');
  const cloneEmpty = !cloneMissing && !existsSync(gitDir) && (await readdir(cloneDir)).length === 0;

  if (cloneMissing || cloneEmpty) {
    try {
      await runGit([
        'clone',
        '--filter=blob:none',
        resolveResultsRepoUrl(normalized.repo),
        cloneDir,
      ]);
      return cloneDir;
    } catch (error) {
      updateStatusFile(normalized, { last_error: withFriendlyGitHubAuthError(error).message });
      throw withFriendlyGitHubAuthError(error);
    }
  }

  if (!existsSync(gitDir)) {
    throw new Error(`Results repo clone path is not a git repository: ${cloneDir}`);
  }

  return cloneDir;
}

export function getResultsRepoStatus(config?: ResultsConfig): ResultsRepoStatus {
  if (!config) {
    return {
      configured: false,
      available: false,
      repo: '',
      local_dir: '',
      sync_status: 'unavailable',
    };
  }

  const normalized = normalizeResultsConfig(config);
  const localPaths = getResultsRepoLocalPaths(normalized.repo);
  const persisted = readPersistedStatus(localPaths.statusFile);

  return {
    configured: true,
    available: existsSync(normalized.path),
    repo: normalized.repo,
    path: normalized.path,
    auto_push: normalized.auto_push,
    branch_prefix: normalized.branch_prefix,
    local_dir: normalized.path,
    last_synced_at: persisted.last_synced_at,
    last_error: persisted.last_error,
    sync_status: existsSync(normalized.path) ? 'clean' : 'unavailable',
  };
}

function parseGitPorcelainPaths(status: string): {
  dirtyPaths: string[];
  conflictedPaths: string[];
} {
  const dirtyPaths = new Set<string>();
  const conflictedPaths = new Set<string>();
  const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

  for (const line of status.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const paths = rawPath.includes(' -> ') ? rawPath.split(' -> ') : [rawPath];

    for (const p of paths.map((entry) => entry.trim()).filter(Boolean)) {
      dirtyPaths.add(p);
      if (conflictCodes.has(code)) {
        conflictedPaths.add(p);
      }
    }
  }

  return {
    dirtyPaths: [...dirtyPaths].sort(),
    conflictedPaths: [...conflictedPaths].sort(),
  };
}

async function getCurrentBranch(repoDir: string): Promise<string | undefined> {
  const { stdout } = await runGit(['branch', '--show-current'], { cwd: repoDir, check: false });
  const branch = stdout.trim();
  if (branch) {
    return branch;
  }

  const { stdout: sha } = await runGit(['rev-parse', '--short', 'HEAD'], {
    cwd: repoDir,
    check: false,
  });
  return sha.trim() ? `HEAD@${sha.trim()}` : undefined;
}

async function resolveComparisonRef(repoDir: string): Promise<string | undefined> {
  const { stdout: upstream } = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: repoDir, check: false },
  );
  const upstreamRef = upstream.trim();
  if (upstreamRef && !upstreamRef.includes('fatal:')) {
    return upstreamRef;
  }

  const baseBranch = await resolveDefaultBranch(repoDir);
  const fallback = `origin/${baseBranch}`;
  const { stdout: fallbackSha } = await runGit(['rev-parse', '--verify', fallback], {
    cwd: repoDir,
    check: false,
  });
  return fallbackSha.trim() ? fallback : undefined;
}

async function getAheadBehind(
  repoDir: string,
  upstream: string | undefined,
): Promise<{ ahead?: number; behind?: number }> {
  if (!upstream) {
    return {};
  }

  const { stdout } = await runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], {
    cwd: repoDir,
    check: false,
  });
  const [aheadText, behindText] = stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText ?? '', 10);
  const behind = Number.parseInt(behindText ?? '', 10);

  return {
    ...(Number.isFinite(ahead) && { ahead }),
    ...(Number.isFinite(behind) && { behind }),
  };
}

async function hasInProgressGitConflict(repoDir: string): Promise<boolean> {
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'];
  for (const marker of markers) {
    const { stdout } = await runGit(['rev-parse', '--git-path', marker], {
      cwd: repoDir,
      check: false,
    });
    const markerPath = stdout.trim();
    const resolvedMarkerPath = path.isAbsolute(markerPath)
      ? markerPath
      : path.join(repoDir, markerPath);
    if (markerPath && existsSync(resolvedMarkerPath)) {
      return true;
    }
  }
  return false;
}

async function buildGitDiffSummary(
  repoDir: string,
  upstream: string | undefined,
): Promise<string | undefined> {
  const summaries: string[] = [];
  for (const args of [
    ['diff', '--stat'],
    ['diff', '--cached', '--stat'],
    ...(upstream ? ([['diff', '--stat', `${upstream}..HEAD`]] as string[][]) : []),
  ]) {
    const { stdout } = await runGit(args, { cwd: repoDir, check: false });
    const summary = stdout.trim();
    if (summary) {
      summaries.push(summary);
    }
  }

  return summaries.length > 0 ? summaries.join('\n') : undefined;
}

async function inspectResultsRepoGit(repoDir: string): Promise<ResultsRepoGitInspection> {
  const branch = await getCurrentBranch(repoDir);
  const upstream = await resolveComparisonRef(repoDir);
  const { stdout: porcelain } = await runGit(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: repoDir,
      check: false,
    },
  );
  const { stdout: shortStatus } = await runGit(['status', '--short', '--branch'], {
    cwd: repoDir,
    check: false,
  });
  const { dirtyPaths, conflictedPaths } = parseGitPorcelainPaths(porcelain);
  const { ahead = 0, behind = 0 } = await getAheadBehind(repoDir, upstream);
  const inProgressConflict = await hasInProgressGitConflict(repoDir);

  let syncStatus: ResultsRepoSyncStatus = 'clean';
  if (conflictedPaths.length > 0 || inProgressConflict) {
    syncStatus = 'conflicted';
  } else if (dirtyPaths.length > 0) {
    syncStatus = 'dirty';
  } else if (ahead > 0 && behind > 0) {
    syncStatus = 'diverged';
  } else if (behind > 0) {
    syncStatus = 'behind';
  } else if (ahead > 0) {
    syncStatus = 'ahead';
  }

  return {
    syncStatus,
    branch,
    upstream,
    ahead,
    behind,
    dirtyPaths,
    conflictedPaths,
    gitStatus: shortStatus.trim() || undefined,
    gitDiffSummary: await buildGitDiffSummary(repoDir, upstream),
  };
}

function withGitInspection(
  status: ResultsRepoStatus,
  inspection: ResultsRepoGitInspection,
): ResultsRepoStatus {
  return {
    ...status,
    sync_status: inspection.syncStatus,
    branch: inspection.branch,
    upstream: inspection.upstream,
    ahead: inspection.ahead,
    behind: inspection.behind,
    dirty_paths: inspection.dirtyPaths,
    conflicted_paths: inspection.conflictedPaths,
    git_status: inspection.gitStatus,
    git_diff_summary: inspection.gitDiffSummary,
    last_error: lastErrorForGitInspection(status, inspection),
  };
}

function lastErrorForGitInspection(
  status: ResultsRepoStatus,
  inspection: ResultsRepoGitInspection,
): string | undefined {
  if (inspection.syncStatus === 'conflicted') {
    return 'Results repo has unresolved git conflicts';
  }

  if (inspection.syncStatus === 'diverged') {
    return 'Results repo local and remote histories have diverged';
  }

  if (inspection.syncStatus === 'dirty') {
    if (status.auto_push === false) {
      return 'Results repo has uncommitted changes and auto_push is disabled';
    }
    if (!areSafeResultsRepoPaths(inspection.dirtyPaths)) {
      return 'Results repo has non-results working tree changes';
    }
  }

  return undefined;
}

function withBlockedStatus(
  status: ResultsRepoStatus,
  blockReason: string,
  flags?: {
    readonly pullPerformed?: boolean;
    readonly pushPerformed?: boolean;
    readonly commitCreated?: boolean;
  },
): ResultsRepoStatus {
  return {
    ...status,
    blocked: true,
    block_reason: blockReason,
    ...(flags?.pullPerformed !== undefined && { pull_performed: flags.pullPerformed }),
    ...(flags?.pushPerformed !== undefined && { push_performed: flags.pushPerformed }),
    ...(flags?.commitCreated !== undefined && { commit_created: flags.commitCreated }),
  };
}

function withActionFlags(
  status: ResultsRepoStatus,
  flags: {
    readonly pullPerformed: boolean;
    readonly pushPerformed: boolean;
    readonly commitCreated: boolean;
  },
): ResultsRepoStatus {
  return {
    ...status,
    blocked: false,
    pull_performed: flags.pullPerformed,
    push_performed: flags.pushPerformed,
    commit_created: flags.commitCreated,
  };
}

function areSafeResultsRepoPaths(paths: readonly string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      (p) => p === RESULTS_REPO_RESULTS_DIR || p.startsWith(`${RESULTS_REPO_RESULTS_DIR}/`),
    )
  );
}

async function getAheadPaths(
  repoDir: string,
  upstream: string | undefined,
): Promise<readonly string[]> {
  if (!upstream) {
    return [];
  }
  const { stdout } = await runGit(['diff', '--name-only', `${upstream}..HEAD`], {
    cwd: repoDir,
    check: false,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function getPushTargetBranch(upstream: string | undefined, baseBranch: string): string {
  return upstream?.startsWith('origin/') ? upstream.slice('origin/'.length) : baseBranch;
}

async function statusFromInspection(
  normalized: Required<ResultsConfig>,
  repoDir: string,
): Promise<ResultsRepoStatus> {
  return withGitInspection(getResultsRepoStatus(normalized), await inspectResultsRepoGit(repoDir));
}

export async function getResultsRepoSyncStatus(config?: ResultsConfig): Promise<ResultsRepoStatus> {
  const baseStatus = getResultsRepoStatus(config);
  if (!config) {
    return baseStatus;
  }

  const normalized = normalizeResultsConfig(config);
  if (activeResultsRepoSyncs.has(normalized.path)) {
    return {
      ...baseStatus,
      sync_status: 'syncing',
    };
  }

  if (!existsSync(normalized.path) || !(await isGitRepository(normalized.path))) {
    return {
      ...baseStatus,
      sync_status: 'unavailable',
    };
  }

  try {
    return withGitInspection(baseStatus, await inspectResultsRepoGit(normalized.path));
  } catch (error) {
    return {
      ...baseStatus,
      sync_status: 'unavailable',
      last_error: getStatusMessage(error),
    };
  }
}

export async function syncResultsRepo(config: ResultsConfig): Promise<ResultsRepoStatus> {
  const normalized = normalizeResultsConfig(config);

  try {
    const repoDir = await ensureResultsRepoClone(normalized);
    await fetchResultsRepo(repoDir);
    updateStatusFile(normalized, {
      last_synced_at: new Date().toISOString(),
      last_error: undefined,
    });
  } catch (error) {
    updateStatusFile(normalized, {
      last_error: withFriendlyGitHubAuthError(error).message,
    });
    throw withFriendlyGitHubAuthError(error);
  }

  return getResultsRepoStatus(normalized);
}

function getStatusMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function syncResultsRepoForProject(config: ResultsConfig): Promise<ResultsRepoStatus> {
  const normalized = normalizeResultsConfig(config);
  const syncKey = normalized.path;
  if (activeResultsRepoSyncs.has(syncKey)) {
    return {
      ...(await getResultsRepoSyncStatus(normalized)),
      sync_status: 'syncing',
      blocked: true,
      block_reason: 'Results repo sync is already in progress',
    };
  }

  activeResultsRepoSyncs.add(syncKey);
  let pullPerformed = false;
  let pushPerformed = false;
  let commitCreated = false;

  try {
    const repoDir = await ensureResultsRepoClone(normalized);
    await fetchResultsRepo(repoDir);
    let inspection = await inspectResultsRepoGit(repoDir);

    if (inspection.syncStatus === 'conflicted') {
      const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
      updateStatusFile(normalized, {
        last_error: 'Results repo has unresolved git conflicts',
      });
      return withBlockedStatus(status, 'Results repo has unresolved git conflicts', {
        pullPerformed,
        pushPerformed,
        commitCreated,
      });
    }

    if (inspection.syncStatus === 'dirty') {
      if (!normalized.auto_push) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        updateStatusFile(normalized, {
          last_error: 'Results repo has uncommitted changes and auto_push is disabled',
        });
        return withBlockedStatus(
          status,
          'Results repo has uncommitted changes and auto_push is disabled',
          {
            pullPerformed,
            pushPerformed,
            commitCreated,
          },
        );
      }

      if (!areSafeResultsRepoPaths(inspection.dirtyPaths)) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        updateStatusFile(normalized, {
          last_error: 'Results repo has non-results working tree changes',
        });
        return withBlockedStatus(status, 'Results repo has non-results working tree changes', {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }

      if ((inspection.behind ?? 0) > 0) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        const reason = 'Results repo has uncommitted result changes and remote changes';
        updateStatusFile(normalized, { last_error: reason });
        return withBlockedStatus(status, reason, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }

      await runGit(['add', '--all', '--', RESULTS_REPO_RESULTS_DIR], { cwd: repoDir });
      await runGit(['commit', '-m', 'chore(results): sync local result metadata'], {
        cwd: repoDir,
      });
      commitCreated = true;
      inspection = await inspectResultsRepoGit(repoDir);
    }

    if (inspection.syncStatus === 'diverged') {
      const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
      updateStatusFile(normalized, {
        last_error: 'Results repo local and remote histories have diverged',
      });
      return withBlockedStatus(status, 'Results repo local and remote histories have diverged', {
        pullPerformed,
        pushPerformed,
        commitCreated,
      });
    }

    if ((inspection.behind ?? 0) > 0 && (inspection.ahead ?? 0) === 0) {
      if (!inspection.upstream) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        updateStatusFile(normalized, {
          last_error: 'Results repo has no upstream branch to pull from',
        });
        return withBlockedStatus(status, 'Results repo has no upstream branch to pull from', {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }

      try {
        await runGit(['merge', '--ff-only', inspection.upstream], { cwd: repoDir });
        pullPerformed = true;
        inspection = await inspectResultsRepoGit(repoDir);
      } catch (error) {
        inspection = await inspectResultsRepoGit(repoDir);
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        const reason = `Results repo could not be fast-forwarded: ${getStatusMessage(error)}`;
        updateStatusFile(normalized, { last_error: reason });
        return withBlockedStatus(status, reason, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }
    }

    if ((inspection.ahead ?? 0) > 0) {
      if (!normalized.auto_push) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        return withActionFlags(status, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }

      const aheadPaths = await getAheadPaths(repoDir, inspection.upstream);
      if (!inspection.upstream || !areSafeResultsRepoPaths(aheadPaths)) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        const reason = !inspection.upstream
          ? 'Results repo has no upstream branch to push to'
          : 'Results repo has non-results committed changes';
        updateStatusFile(normalized, { last_error: reason });
        return withBlockedStatus(status, reason, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }

      const baseBranch = await resolveDefaultBranch(repoDir);
      const targetBranch = getPushTargetBranch(inspection.upstream, baseBranch);
      try {
        await runGit(['push', 'origin', `HEAD:${targetBranch}`], { cwd: repoDir });
        pushPerformed = true;
        await fetchResultsRepo(repoDir);
        inspection = await inspectResultsRepoGit(repoDir);
      } catch (error) {
        await fetchResultsRepo(repoDir).catch(() => undefined);
        inspection = await inspectResultsRepoGit(repoDir);
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        const reason = `Results repo push was rejected: ${getStatusMessage(error)}`;
        updateStatusFile(normalized, { last_error: reason });
        return withBlockedStatus(status, reason, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }
    }

    updateStatusFile(normalized, {
      last_synced_at: new Date().toISOString(),
      last_error: undefined,
    });

    return withActionFlags(await statusFromInspection(normalized, repoDir), {
      pullPerformed,
      pushPerformed,
      commitCreated,
    });
  } catch (error) {
    updateStatusFile(normalized, {
      last_error: withFriendlyGitHubAuthError(error).message,
    });
    throw withFriendlyGitHubAuthError(error);
  } finally {
    activeResultsRepoSyncs.delete(syncKey);
  }
}

export async function checkoutResultsRepoBranch(
  config: ResultsConfig,
  branchName: string,
): Promise<CheckedOutResultsRepoBranch> {
  const normalized = normalizeResultsConfig(config);
  const repoDir = await ensureResultsRepoClone(normalized);
  const baseBranch = await resolveDefaultBranch(repoDir);
  await fetchResultsRepo(repoDir);
  await runGit(['checkout', '-B', branchName, `origin/${baseBranch}`], { cwd: repoDir });
  updateStatusFile(normalized, { last_error: undefined });
  return {
    branchName,
    baseBranch,
    repoDir,
  };
}

export async function prepareResultsRepoBranch(
  config: ResultsConfig,
  branchName: string,
): Promise<PreparedResultsRepoBranch> {
  const normalized = normalizeResultsConfig(config);
  const cloneDir = await ensureResultsRepoClone(normalized);
  const baseBranch = await resolveDefaultBranch(cloneDir);
  await fetchResultsRepo(cloneDir);

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-results-repo-'));
  const worktreeDir = path.join(worktreeRoot, 'repo');
  await runGit(['worktree', 'add', '-B', branchName, worktreeDir, `origin/${baseBranch}`], {
    cwd: cloneDir,
  });

  return {
    branchName,
    baseBranch,
    repoDir: worktreeDir,
    cleanup: async () => {
      try {
        await runGit(['worktree', 'remove', '--force', worktreeDir], { cwd: cloneDir });
      } finally {
        await rm(worktreeRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export async function stageResultsArtifacts(params: {
  readonly repoDir: string;
  readonly sourceDir: string;
  readonly destinationDir: string;
}): Promise<void> {
  rmSync(params.destinationDir, { recursive: true, force: true });
  mkdirSync(path.dirname(params.destinationDir), { recursive: true });
  await cp(params.sourceDir, params.destinationDir, { recursive: true });
}

export function resolveResultsRepoRunsDir(config: ResultsConfig): string {
  const normalized = normalizeResultsConfig(config);
  return path.join(normalized.path, RESULTS_REPO_RESULTS_DIR, 'runs');
}

export async function directorySizeBytes(targetPath: string): Promise<number> {
  const entry = await stat(targetPath);
  if (entry.isFile()) {
    return entry.size;
  }

  let total = 0;
  for (const child of await readdir(targetPath, { withFileTypes: true })) {
    total += await directorySizeBytes(path.join(targetPath, child.name));
  }
  return total;
}

export async function commitAndPushResultsBranch(params: {
  readonly repoDir: string;
  readonly branchName: string;
  readonly commitMessage: string;
}): Promise<boolean> {
  await runGit(['add', '--all'], { cwd: params.repoDir });

  const { stdout: diffStdout } = await runGit(['status', '--porcelain'], {
    cwd: params.repoDir,
    check: false,
  });
  if (diffStdout.trim().length === 0) {
    return false;
  }

  await runGit(['commit', '-m', params.commitMessage], { cwd: params.repoDir });
  await runGit(['push', '-u', 'origin', params.branchName], { cwd: params.repoDir });
  return true;
}

export async function pushResultsRepoBranch(
  config: ResultsConfig,
  branchName: string,
  cwd?: string,
): Promise<void> {
  const normalized = normalizeResultsConfig(config);
  await runGit(['push', '-u', 'origin', branchName], {
    cwd: cwd ?? normalized.path,
  });
  updateStatusFile(normalized, {
    last_synced_at: new Date().toISOString(),
    last_error: undefined,
  });
}

export async function createDraftResultsPr(params: {
  readonly repo: string;
  readonly repoDir: string;
  readonly baseBranch: string;
  readonly branchName: string;
  readonly title: string;
  readonly body: string;
}): Promise<string> {
  const { stdout } = await runGh(
    [
      'pr',
      'create',
      '--draft',
      '--repo',
      params.repo,
      '--base',
      params.baseBranch,
      '--head',
      params.branchName,
      '--title',
      params.title,
      '--body',
      params.body,
    ],
    { cwd: params.repoDir },
  );
  return stdout.trim();
}

const DIRECT_PUSH_MAX_RETRIES = 3;

/**
 * Push results directly to the base branch of the results repo.
 * Handles non-fast-forward conflicts by fetching, rebasing, and retrying.
 * Returns true if artifacts were pushed, false if no changes were detected.
 */
export async function directPushResults(params: {
  readonly config: ResultsConfig;
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly commitMessage: string;
}): Promise<boolean> {
  const normalized = normalizeResultsConfig(params.config);
  const repoDir = await ensureResultsRepoClone(normalized);
  const baseBranch = await resolveDefaultBranch(repoDir);
  await fetchResultsRepo(repoDir);
  const targetRunId = buildGitRunId(params.destinationPath);

  const destinationDir = path.join(
    repoDir,
    RESULTS_REPO_RESULTS_DIR,
    'runs',
    params.destinationPath,
  );
  await stageResultsArtifacts({
    repoDir,
    sourceDir: params.sourceDir,
    destinationDir,
  });

  await runGit(['add', '--all'], { cwd: repoDir });
  const { stdout: status } = await runGit(['status', '--porcelain'], {
    cwd: repoDir,
    check: false,
  });
  if (status.trim().length === 0) {
    return false;
  }

  await runGit(['commit', '-m', params.commitMessage, '-m', `Agentv-Run: ${targetRunId}`], {
    cwd: repoDir,
  });

  for (let attempt = 1; attempt <= DIRECT_PUSH_MAX_RETRIES; attempt++) {
    try {
      await runGit(['push', 'origin', `HEAD:${baseBranch}`], { cwd: repoDir });
      updateStatusFile(normalized, {
        last_synced_at: new Date().toISOString(),
        last_error: undefined,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < DIRECT_PUSH_MAX_RETRIES && message.includes('non-fast-forward')) {
        await fetchResultsRepo(repoDir);
        await runGit(['rebase', `origin/${baseBranch}`], { cwd: repoDir });
      } else {
        throw error;
      }
    }
  }

  return false;
}

export interface GitListedRun {
  run_id: string;
  experiment: string;
  timestamp: string;
  pass_rate?: number;
  target?: string;
  manifest_path: string;
  benchmark_path: string;
  display_name: string;
  test_count: number;
  avg_score: number;
  size_bytes: number;
}

type GitBatchBlob = {
  readonly size: number;
  readonly content: Buffer;
};

type GitRunBenchmark = {
  readonly metadata?: {
    readonly display_name?: string;
    readonly timestamp?: string;
    readonly experiment?: string;
    readonly targets?: readonly string[];
    readonly tests_run?: readonly string[];
  };
  readonly run_summary?: Record<
    string,
    {
      readonly pass_rate?: { readonly mean?: number };
    }
  >;
};

function buildGitRunId(relativeRunPath: string): string {
  const normalized = relativeRunPath.split(path.sep).join('/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const experiment = segments.slice(0, -1).join('/');
    const timestamp = segments.at(-1);
    if (experiment === 'default') {
      return timestamp ?? normalized;
    }
    return `${experiment}::${timestamp}`;
  }
  return segments[0] ?? relativeRunPath;
}

function getRunExperiment(runId: string, benchmark: GitRunBenchmark): string {
  const experiment = benchmark.metadata?.experiment?.trim();
  if (experiment) {
    return experiment;
  }

  const separatorIndex = runId.lastIndexOf('::');
  return separatorIndex === -1 ? 'default' : runId.slice(0, separatorIndex);
}

function computeAveragePassRate(runSummary: GitRunBenchmark['run_summary']): number | undefined {
  if (!runSummary) {
    return undefined;
  }

  const passRates = Object.values(runSummary)
    .map((summary) => summary.pass_rate?.mean)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (passRates.length === 0) {
    return undefined;
  }

  return passRates.reduce((sum, value) => sum + value, 0) / passRates.length;
}

async function runGitBatch(repoDir: string, input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], {
      cwd: repoDir,
      env: getGitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', (error) => reject(withFriendlyGitHubAuthError(error)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(
        withFriendlyGitHubAuthError(
          stderr.length > 0 ? new Error(stderr) : new Error('git cat-file failed'),
        ),
      );
    });

    child.stdin.end(input);
  });
}

function parseGitBatchBlobs(output: Buffer): GitBatchBlob[] {
  const blobs: GitBatchBlob[] = [];
  let offset = 0;

  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error('Malformed git cat-file output: missing header terminator');
    }

    const header = output.subarray(offset, headerEnd).toString('utf8');
    offset = headerEnd + 1;

    if (header.length === 0) {
      continue;
    }

    const missingMatch = /^(.*) missing$/.exec(header);
    if (missingMatch) {
      continue;
    }

    const headerMatch = /^(.*) (\w+) (\d+)$/.exec(header);
    if (!headerMatch) {
      throw new Error(`Malformed git cat-file header: ${header}`);
    }

    const [, objectRef, objectType, sizeText] = headerMatch;
    if (objectType !== 'blob') {
      throw new Error(`Unsupported git object type for ${objectRef}: ${objectType}`);
    }

    const size = Number.parseInt(sizeText, 10);
    const contentEnd = offset + size;
    if (contentEnd > output.length) {
      throw new Error(`Malformed git cat-file output for ${objectRef}: truncated blob content`);
    }

    blobs.push({
      size,
      content: output.subarray(offset, contentEnd),
    });
    offset = contentEnd;

    if (offset < output.length && output[offset] === 0x0a) {
      offset += 1;
    }
  }

  return blobs;
}

export async function listGitRuns(repoDir: string, ref = 'origin/main'): Promise<GitListedRun[]> {
  const { stdout: treeOut } = await runGit(
    ['ls-tree', '-r', '--name-only', ref, RESULTS_REPO_RUNS_DIR],
    {
      cwd: repoDir,
    },
  );

  const benchmarkPaths = treeOut
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('/benchmark.json'));
  if (benchmarkPaths.length === 0) {
    return [];
  }

  const batchInput = `${benchmarkPaths.map((benchmarkPath) => `${ref}:${benchmarkPath}`).join('\n')}\n`;
  const blobs = parseGitBatchBlobs(await runGitBatch(repoDir, batchInput));
  if (blobs.length !== benchmarkPaths.length) {
    throw new Error(
      `Expected ${benchmarkPaths.length} git blobs but received ${blobs.length} while listing results runs`,
    );
  }

  const runs = blobs.flatMap((blob, index): GitListedRun[] => {
    const benchmarkPath = benchmarkPaths[index];
    const benchmark = JSON.parse(blob.content.toString('utf8')) as GitRunBenchmark;
    const runDir = path.posix.dirname(benchmarkPath);
    const relativeRunPath = path.posix.relative(RESULTS_REPO_RUNS_DIR, runDir);
    const runId = buildGitRunId(relativeRunPath);
    const timestamp = benchmark.metadata?.timestamp?.trim() || path.posix.basename(runDir);
    const displayName = benchmark.metadata?.display_name?.trim() || path.posix.basename(runDir);
    const targets = benchmark.metadata?.targets ?? [];
    const passRate = computeAveragePassRate(benchmark.run_summary);

    return [
      {
        run_id: runId,
        experiment: getRunExperiment(runId, benchmark),
        timestamp,
        ...(passRate !== undefined && { pass_rate: passRate }),
        ...(targets.length === 1 && targets[0] ? { target: targets[0] } : {}),
        manifest_path: path.posix.join(runDir, 'index.jsonl'),
        benchmark_path: benchmarkPath,
        display_name: displayName,
        test_count: benchmark.metadata?.tests_run?.length ?? 0,
        avg_score: 0,
        size_bytes: blob.size,
      },
    ];
  });

  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return runs;
}

export async function materializeGitRun(
  repoDir: string,
  relativeRunPath: string,
  ref = 'origin/main',
): Promise<void> {
  const normalizedRunPath = relativeRunPath.split(path.sep).join('/');
  const runTreePath = path.posix.join(RESULTS_REPO_RUNS_DIR, normalizedRunPath);
  const targetRunDir = path.join(repoDir, ...runTreePath.split('/'));
  const { stdout: treeOut } = await runGit(['ls-tree', '-r', '--name-only', ref, runTreePath], {
    cwd: repoDir,
  });

  const filePaths = treeOut
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (filePaths.length === 0) {
    return;
  }

  const batchInput = `${filePaths.map((filePath) => `${ref}:${filePath}`).join('\n')}\n`;
  const blobs = parseGitBatchBlobs(await runGitBatch(repoDir, batchInput));
  if (blobs.length !== filePaths.length) {
    throw new Error(
      `Expected ${filePaths.length} git blobs but received ${blobs.length} while materializing results run`,
    );
  }

  const tempRoot = mkdtempSync(path.join(repoDir, '.agentv-run-'));
  const tempRunDir = path.join(tempRoot, 'run');

  try {
    for (const [index, filePath] of filePaths.entries()) {
      const relativeFilePath = path.posix.relative(runTreePath, filePath);
      const absolutePath = path.join(tempRunDir, ...relativeFilePath.split('/'));
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, blobs[index].content);
    }

    mkdirSync(path.dirname(targetRunDir), { recursive: true });
    try {
      renameSync(tempRunDir, targetRunDir);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if ((code === 'EEXIST' || code === 'ENOTEMPTY') && existsSync(targetRunDir)) {
        return;
      }
      throw error;
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
