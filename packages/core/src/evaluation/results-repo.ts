import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentvHome } from '../paths.js';
import type { ResultsExportConfig } from './loaders/config-loader.js';

const execFileAsync = promisify(execFile);

export interface ResultsRepoCachePaths {
  readonly rootDir: string;
  readonly repoDir: string;
  readonly statusFile: string;
}

export interface ResultsRepoStatus {
  readonly configured: boolean;
  readonly available: boolean;
  readonly repo?: string;
  readonly path?: string;
  readonly auto_push?: boolean;
  readonly branch_prefix?: string;
  readonly cache_dir?: string;
  readonly last_synced_at?: string;
  readonly last_error?: string;
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

export function normalizeResultsExportConfig(
  config: ResultsExportConfig,
): Required<ResultsExportConfig> {
  return {
    repo: config.repo.trim(),
    path: config.path.trim().replace(/^\/+|\/+$/g, ''),
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

export function getResultsRepoCachePaths(repo: string): ResultsRepoCachePaths {
  const rootDir = path.join(getAgentvHome(), 'cache', 'results-repo', sanitizeRepoSlug(repo));
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
  options?: { cwd?: string; check?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...args], {
      cwd: options?.cwd,
      env: process.env,
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

async function runGit(
  args: readonly string[],
  options?: { cwd?: string; check?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  return runCommand('git', args, options);
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

async function updateCacheRepo(repoDir: string, baseBranch: string): Promise<void> {
  await runGit(['fetch', 'origin', '--prune'], { cwd: repoDir });
  await runGit(['checkout', baseBranch], { cwd: repoDir });
  await runGit(['pull', '--ff-only', 'origin', baseBranch], { cwd: repoDir });
}

function updateStatusFile(config: ResultsExportConfig, patch: PersistedStatus): void {
  const cachePaths = getResultsRepoCachePaths(config.repo);
  const current = readPersistedStatus(cachePaths.statusFile);
  writePersistedStatus(cachePaths.statusFile, {
    ...current,
    ...patch,
  });
}

export async function ensureResultsRepoClone(config: ResultsExportConfig): Promise<string> {
  const normalized = normalizeResultsExportConfig(config);
  const cachePaths = getResultsRepoCachePaths(normalized.repo);
  mkdirSync(cachePaths.rootDir, { recursive: true });

  if (!existsSync(cachePaths.repoDir)) {
    try {
      await runGit([
        'clone',
        '--filter=blob:none',
        resolveResultsRepoUrl(normalized.repo),
        cachePaths.repoDir,
      ]);
      return cachePaths.repoDir;
    } catch (error) {
      updateStatusFile(normalized, { last_error: withFriendlyGitHubAuthError(error).message });
      throw withFriendlyGitHubAuthError(error);
    }
  }

  if (!existsSync(path.join(cachePaths.repoDir, '.git'))) {
    throw new Error(`Results repo cache is not a git repository: ${cachePaths.repoDir}`);
  }

  return cachePaths.repoDir;
}

export function getResultsRepoStatus(config?: ResultsExportConfig): ResultsRepoStatus {
  if (!config) {
    return {
      configured: false,
      available: false,
      repo: '',
      cache_dir: '',
    };
  }

  const normalized = normalizeResultsExportConfig(config);
  const cachePaths = getResultsRepoCachePaths(normalized.repo);
  const persisted = readPersistedStatus(cachePaths.statusFile);

  return {
    configured: true,
    available: existsSync(cachePaths.repoDir),
    repo: normalized.repo,
    path: normalized.path,
    auto_push: normalized.auto_push,
    branch_prefix: normalized.branch_prefix,
    cache_dir: cachePaths.repoDir,
    last_synced_at: persisted.last_synced_at,
    last_error: persisted.last_error,
  };
}

export async function syncResultsRepo(config: ResultsExportConfig): Promise<ResultsRepoStatus> {
  const normalized = normalizeResultsExportConfig(config);

  try {
    const repoDir = await ensureResultsRepoClone(normalized);
    const baseBranch = await resolveDefaultBranch(repoDir);
    await updateCacheRepo(repoDir, baseBranch);
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

export async function checkoutResultsRepoBranch(
  config: ResultsExportConfig,
  branchName: string,
): Promise<CheckedOutResultsRepoBranch> {
  const normalized = normalizeResultsExportConfig(config);
  const repoDir = await ensureResultsRepoClone(normalized);
  const baseBranch = await resolveDefaultBranch(repoDir);
  await updateCacheRepo(repoDir, baseBranch);
  await runGit(['checkout', '-B', branchName, `origin/${baseBranch}`], { cwd: repoDir });
  updateStatusFile(normalized, { last_error: undefined });
  return {
    branchName,
    baseBranch,
    repoDir,
  };
}

export async function prepareResultsRepoBranch(
  config: ResultsExportConfig,
  branchName: string,
): Promise<PreparedResultsRepoBranch> {
  const normalized = normalizeResultsExportConfig(config);
  const cloneDir = await ensureResultsRepoClone(normalized);
  const baseBranch = await resolveDefaultBranch(cloneDir);
  await updateCacheRepo(cloneDir, baseBranch);

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

export function resolveResultsRepoRunsDir(config: ResultsExportConfig): string {
  const normalized = normalizeResultsExportConfig(config);
  return path.join(
    getResultsRepoCachePaths(normalized.repo).repoDir,
    ...normalized.path.split('/'),
  );
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
  config: ResultsExportConfig,
  branchName: string,
  cwd?: string,
): Promise<void> {
  const normalized = normalizeResultsExportConfig(config);
  await runGit(['push', '-u', 'origin', branchName], {
    cwd: cwd ?? getResultsRepoCachePaths(normalized.repo).repoDir,
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
