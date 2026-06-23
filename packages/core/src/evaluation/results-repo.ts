import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cp, lstat, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentvDataDir } from '../paths.js';
import type { ResultPushConflictPolicy, ResultsConfig } from './loaders/config-loader.js';
import {
  AGENTV_RESULTS_ARTIFACTS_REF,
  AGENTV_RESULTS_PRIMARY_REF,
} from './result-artifact-contract.js';

export type { ResultPushConflictPolicy } from './loaders/config-loader.js';

const execFileAsync = promisify(execFile);
// Local working-tree run workspace inside the eval repo. Local commands
// (`agentv eval` default --output, inspect/trend/export/combine/serve) read and
// write runs here. This is NOT the on-branch layout — see RESULTS_REPO_RUNS_DIR.
const RESULTS_REPO_RESULTS_DIR = '.agentv/results';
// On-branch / results-repo-clone storage layout. The results branch (e.g.
// agentv/results/v1) already namespaces results, so runs are stored flat at
// runs/<experiment>/<timestamp>/ and the editable tag overlays at
// metadata/runs/<experiment>/<timestamp>/ — no redundant `.agentv/results/` prefix.
const RESULTS_REPO_RUNS_DIR = 'runs';
const RESULTS_REPO_METADATA_DIR = 'metadata';
// Top-level directories AgentV owns on the results branch. The auto-sync
// dirty-commit path stages only these so it never touches unrelated repo files.
const RESULTS_REPO_TRACKED_DIRS = [RESULTS_REPO_RUNS_DIR, RESULTS_REPO_METADATA_DIR] as const;
const FALLBACK_RESULTS_REPO_COMMIT_EMAIL = 'agentv@results-repo';
const FALLBACK_RESULTS_REPO_COMMIT_NAME = 'AgentV Results';
const GIT_COMMIT_IDENTITY_ENV_KEYS = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
] as const;
const GIT_ENV_INHERIT_ALLOWLIST = new Set([
  'GIT_ASKPASS',
  'GIT_PASSWORD',
  'GIT_SSH_COMMAND',
  'GIT_TOKEN',
  'GIT_USERNAME',
]);
export const DEFAULT_RESULTS_BRANCH = AGENTV_RESULTS_PRIMARY_REF;
const MANAGED_RESULTS_REMOTE = 'agentv-results';
const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// The results branch is a self-rooted orphan whose first commit is a fixed,
// byte-identical empty-tree genesis. Pinning the message, identity, and dates
// through per-command env makes the root commit SHA deterministic across every
// machine and clone, so all clients share
// one genesis and fast-forward/append to a single ref instead of each minting a
// divergent root. This identity is applied via per-command env only so AgentV
// never overwrites the user's git config. See createOrphanResultsBranch.
const RESULTS_REPO_GENESIS_MESSAGE = 'chore(results): initialize AgentV results branch';
const RESULTS_REPO_GENESIS_DATE = '@0 +0000';
const RESULT_INDEX_FILENAME = 'index.jsonl';

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
  | 'push_conflict'
  | 'syncing';

export interface ResultsRepoStatus {
  readonly configured: boolean;
  readonly available: boolean;
  readonly repo?: string;
  readonly repo_path?: string;
  readonly path?: string;
  readonly auto_push?: boolean;
  readonly require_push?: boolean;
  readonly push_conflict_policy?: ResultPushConflictPolicy;
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
  readonly target_branch?: string;
  readonly remote_commit?: string;
  readonly local_commit?: string;
  readonly backup_ref?: string;
  readonly backup_commit?: string;
  readonly previous_remote_commit?: string;
  readonly force_pushed_commit?: string;
  readonly lease_commit?: string;
}

export interface NormalizedResultsConfig {
  readonly mode: 'github';
  readonly repo: string;
  readonly repo_url?: string;
  readonly repo_path?: string;
  readonly branch?: string;
  readonly remote: string;
  readonly path: string;
  readonly auto_push: boolean;
  readonly require_push: boolean;
  readonly push_conflict_policy: ResultPushConflictPolicy;
  readonly branch_prefix: string;
  /** @internal Runtime mode; not part of YAML wire format. */
  readonly storageBranchWorktree: boolean;
}

type StorageBranchResultsConfig = NormalizedResultsConfig & { readonly branch: string };

export interface DirectPushResultsResult {
  readonly changed: boolean;
  readonly blocked?: boolean;
  readonly block_reason?: string;
  readonly sync_status?: ResultsRepoSyncStatus;
  readonly push_conflict_policy: ResultPushConflictPolicy;
  readonly target_branch?: string;
  readonly remote_commit?: string;
  readonly local_commit?: string;
  readonly backup_ref?: string;
  readonly backup_commit?: string;
  readonly previous_remote_commit?: string;
  readonly force_pushed_commit?: string;
  readonly lease_commit?: string;
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

function resolveLocalPath(p: string, baseDir: string): string {
  const expanded = expandHome(p);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

export function normalizeResultsConfig(
  config: ResultsConfig,
  options?: { baseDir?: string },
): NormalizedResultsConfig {
  const baseDir = options?.baseDir ?? process.cwd();
  const repoUrl = (config.repo_url ?? config.repo)?.trim();
  const repoPath = config.repo_path?.trim();
  const explicitClonePath = config.path?.trim();
  const repo = repoUrl ?? repoPath ?? '';
  const branch = config.branch?.trim() || (repoPath ? DEFAULT_RESULTS_BRANCH : undefined);
  const useStorageBranchWorktree = Boolean(repoPath || (repoUrl && explicitClonePath && branch));
  const remote =
    config.remote?.trim() ||
    (repoUrl && useStorageBranchWorktree ? MANAGED_RESULTS_REMOTE : 'origin');
  const autoPush = config.sync?.auto_push ?? config.auto_push === true;
  const requirePush = config.sync?.require_push === true;
  const pushConflictPolicy = config.sync?.push_conflict_policy ?? 'block';
  const resolvedRepoPath = repoPath ? resolveLocalPath(repoPath, baseDir) : undefined;
  const resolvedPath = explicitClonePath
    ? resolveLocalPath(explicitClonePath, baseDir)
    : repoUrl
      ? path.join(getAgentvDataDir(), 'results', sanitizeRepoSlug(repoUrl))
      : (resolvedRepoPath ?? path.join(getAgentvDataDir(), 'results', sanitizeRepoSlug(repo)));
  return {
    mode: 'github',
    repo,
    ...(repoUrl ? { repo_url: repoUrl } : {}),
    ...(resolvedRepoPath ? { repo_path: resolvedRepoPath } : {}),
    ...(branch ? { branch } : {}),
    remote,
    path: resolvedPath,
    auto_push: autoPush,
    require_push: requirePush,
    push_conflict_policy: pushConflictPolicy,
    branch_prefix: config.branch_prefix?.trim() || 'eval-results',
    storageBranchWorktree: useStorageBranchWorktree,
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

function usesStorageBranchWorktree(config: NormalizedResultsConfig): boolean {
  return config.storageBranchWorktree === true || Boolean(config.repo_path);
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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...args], {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (options?.check === false && error && typeof error === 'object') {
      const execError = error as { code?: unknown; stdout?: string; stderr?: string };
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: typeof execError.code === 'number' ? execError.code : 1,
      };
    }
    throw withFriendlyGitHubAuthError(error);
  }
}

function getGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (!key.startsWith('GIT_') || GIT_ENV_INHERIT_ALLOWLIST.has(key))) {
      env[key] = value;
    }
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

async function runGit(
  args: readonly string[],
  options?: { cwd?: string; check?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommand('git', args, { ...options, env: { ...getGitEnv(), ...options?.env } });
}

async function runGh(
  args: readonly string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommand('gh', args, options);
}

function gitErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error && typeof error === 'object') {
    const record = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    if (typeof record.stdout === 'string') parts.push(record.stdout);
    if (typeof record.stderr === 'string') parts.push(record.stderr);
    if (typeof record.message === 'string') parts.push(record.message);
  } else if (typeof error === 'string') {
    parts.push(error);
  }
  return parts.join('\n').toLowerCase();
}

function isMissingGitIdentityError(error: unknown): boolean {
  const text = gitErrorText(error);
  return (
    text.includes('author identity unknown') ||
    text.includes('committer identity unknown') ||
    text.includes('please tell me who you are') ||
    text.includes('unable to auto-detect email address') ||
    text.includes('empty ident name')
  );
}

function fallbackResultsRepoCommitEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: FALLBACK_RESULTS_REPO_COMMIT_NAME,
    GIT_AUTHOR_EMAIL: FALLBACK_RESULTS_REPO_COMMIT_EMAIL,
    GIT_COMMITTER_NAME: FALLBACK_RESULTS_REPO_COMMIT_NAME,
    GIT_COMMITTER_EMAIL: FALLBACK_RESULTS_REPO_COMMIT_EMAIL,
  };
}

function configuredGitCommitIdentityEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of GIT_COMMIT_IDENTITY_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

async function runGitWithFallbackCommitIdentity(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const env = {
    ...configuredGitCommitIdentityEnv(),
    ...options.env,
  };
  try {
    return await runGit(args, { ...options, env });
  } catch (error) {
    if (!isMissingGitIdentityError(error)) {
      throw error;
    }
    return runGit(args, {
      ...options,
      env: {
        ...env,
        ...fallbackResultsRepoCommitEnv(),
      },
    });
  }
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

async function fetchResultsRepo(
  repoDir: string,
  remote = 'origin',
  branch?: string,
): Promise<void> {
  if (branch) {
    await fetchResultsBranchRef(repoDir, remote, branch);
    await runGit(['remote', 'prune', remote], { cwd: repoDir, check: false });
    return;
  }

  await runGit(['fetch', remote, '--prune'], { cwd: repoDir });
}

function isMissingRemoteBranchFetch(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("couldn't find remote ref") || lower.includes('could not find remote ref');
}

async function fetchResultsBranchRef(
  repoDir: string,
  remote: string,
  branch: string,
): Promise<void> {
  const { exitCode, stderr } = await runGit(
    ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    {
      cwd: repoDir,
      check: false,
    },
  );
  const fetchError = stderr.trim();
  if (exitCode !== 0 && !isMissingRemoteBranchFetch(fetchError)) {
    throw new Error(fetchError);
  }
}

async function fetchResultsArtifactRef(
  repoDir: string,
  remote: string,
  branch: string,
): Promise<void> {
  const refspec = `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
  await runGit(['fetch', '--filter=blob:none', remote, refspec], {
    cwd: repoDir,
    check: false,
  });
  if (!(await gitRefExists(repoDir, `refs/remotes/${remote}/${branch}`))) {
    await fetchResultsBranchRef(repoDir, remote, branch);
  }
}

function remoteBranchRef(branch: string, remote = 'origin'): string {
  return `${remote}/${branch}`;
}

async function gitRefExists(repoDir: string, ref: string): Promise<boolean> {
  const { stdout } = await runGit(['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoDir,
    check: false,
  });
  return stdout.trim().length > 0;
}

async function configuredResultsBranchRef(
  repoDir: string,
  config: NormalizedResultsConfig,
): Promise<string | undefined> {
  if (!config.branch) {
    return undefined;
  }
  const remoteRef = remoteBranchRef(config.branch, config.remote);
  if (await gitRefExists(repoDir, remoteRef)) {
    return remoteRef;
  }
  if (await gitRefExists(repoDir, config.branch)) {
    return config.branch;
  }
  return undefined;
}

async function assertConfiguredResultsBranchExists(
  repoDir: string,
  config: NormalizedResultsConfig,
): Promise<string | undefined> {
  return configuredResultsBranchRef(repoDir, config);
}

async function localBranchExists(repoDir: string, branch: string): Promise<boolean> {
  const { stdout } = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], {
    cwd: repoDir,
    check: false,
  });
  return stdout.trim().length > 0;
}

async function checkoutConfiguredResultsBranch(
  repoDir: string,
  config: NormalizedResultsConfig,
): Promise<string | undefined> {
  const branch = config.branch;
  if (!branch) {
    return undefined;
  }
  const remoteRef = await assertConfiguredResultsBranchExists(repoDir, config);
  if (!remoteRef) {
    await createOrphanResultsBranch(repoDir, branch);
    await runGit(['checkout', branch], { cwd: repoDir });
    return undefined;
  }

  const currentBranch = await getCurrentBranch(repoDir);
  if (currentBranch !== branch) {
    if (await localBranchExists(repoDir, branch)) {
      await runGit(['checkout', branch], { cwd: repoDir });
    } else {
      await runGit(['checkout', '--track', '-b', branch, remoteRef], { cwd: repoDir });
    }
  }
  if (remoteRef === remoteBranchRef(branch, config.remote)) {
    await runGit(['branch', '--set-upstream-to', remoteRef, branch], {
      cwd: repoDir,
      check: false,
    });
  }

  return remoteRef;
}

async function createOrphanResultsBranch(repoDir: string, branch: string): Promise<void> {
  await runGit(['update-ref', `refs/heads/${branch}`, await createResultsGenesisCommit(repoDir)], {
    cwd: repoDir,
  });
}

// Mint the deterministic empty-tree genesis commit (no parents). Tree, message,
// identity, and author/committer dates are all fixed, so two inits at different
// wall-clock times — on different machines — produce the identical root SHA.
async function createResultsGenesisCommit(repoDir: string): Promise<string> {
  const { stdout } = await runGit(
    ['commit-tree', GIT_EMPTY_TREE, '-m', RESULTS_REPO_GENESIS_MESSAGE],
    {
      cwd: repoDir,
      env: {
        ...fallbackResultsRepoCommitEnv(),
        GIT_AUTHOR_DATE: RESULTS_REPO_GENESIS_DATE,
        GIT_COMMITTER_DATE: RESULTS_REPO_GENESIS_DATE,
      },
    },
  );
  return stdout.trim();
}

async function isGitRepository(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repoDir });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function resolveGitTopLevel(repoDir: string): Promise<string> {
  const { stdout } = await runGit(['rev-parse', '--show-toplevel'], { cwd: repoDir });
  return stdout.trim() || repoDir;
}

async function ensureResultsRepoRemote(
  repoDir: string,
  config: NormalizedResultsConfig,
): Promise<void> {
  if (!config.repo_url) {
    return;
  }

  const remoteUrl = resolveResultsRepoUrl(config.repo_url);
  const { stdout } = await runGit(['remote', 'get-url', config.remote], {
    cwd: repoDir,
    check: false,
  });
  const existingUrl = stdout.trim();
  if (!existingUrl) {
    await runGit(['remote', 'add', config.remote, remoteUrl], { cwd: repoDir });
    return;
  }
  if (existingUrl !== remoteUrl) {
    await runGit(['remote', 'set-url', config.remote, remoteUrl], { cwd: repoDir });
  }
}

function updateStatusFile(
  config: ResultsConfig | NormalizedResultsConfig,
  patch: PersistedStatus,
): void {
  const repo =
    typeof config.repo === 'string' ? config.repo : (config.repo_url ?? config.repo_path ?? '');
  const cachePaths = getResultsRepoLocalPaths(repo);
  const current = readPersistedStatus(cachePaths.statusFile);
  writePersistedStatus(cachePaths.statusFile, {
    ...current,
    ...patch,
  });
}

export async function ensureResultsRepoClone(config: ResultsConfig): Promise<string> {
  const normalized = normalizeResultsConfig(config);
  if (normalized.repo_path) {
    if (!(await isGitRepository(normalized.repo_path))) {
      throw new Error(`Results repo_path is not a git repository: ${normalized.repo_path}`);
    }
    return resolveGitTopLevel(normalized.repo_path);
  }

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
        resolveResultsRepoUrl(normalized.repo_url ?? normalized.repo),
        cloneDir,
      ]);
      await ensureResultsRepoRemote(cloneDir, normalized);
      return cloneDir;
    } catch (error) {
      updateStatusFile(normalized, { last_error: withFriendlyGitHubAuthError(error).message });
      throw withFriendlyGitHubAuthError(error);
    }
  }

  if (!existsSync(gitDir)) {
    throw new Error(`Results repo clone path is not a git repository: ${cloneDir}`);
  }

  await ensureResultsRepoRemote(cloneDir, normalized);
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
    ...(normalized.repo_path !== undefined && { repo_path: normalized.repo_path }),
    path: normalized.path,
    auto_push: normalized.auto_push,
    require_push: normalized.require_push,
    push_conflict_policy: normalized.push_conflict_policy,
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

async function resolveComparisonRef(
  repoDir: string,
  config?: NormalizedResultsConfig,
): Promise<string | undefined> {
  if (config?.branch) {
    return assertConfiguredResultsBranchExists(repoDir, config);
  }

  const { stdout: upstream } = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: repoDir, check: false },
  );
  const upstreamRef = upstream.trim();
  if (upstreamRef && !upstreamRef.includes('fatal:')) {
    return upstreamRef;
  }

  const baseBranch = await resolveDefaultBranch(repoDir);
  const fallback = `${config?.remote ?? 'origin'}/${baseBranch}`;
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

async function getAheadBehindForRefs(
  repoDir: string,
  leftRef: string,
  rightRef: string,
): Promise<{ ahead?: number; behind?: number }> {
  const { stdout } = await runGit(
    ['rev-list', '--left-right', '--count', `${leftRef}...${rightRef}`],
    {
      cwd: repoDir,
      check: false,
    },
  );
  const [aheadText, behindText] = stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText ?? '', 10);
  const behind = Number.parseInt(behindText ?? '', 10);

  return {
    ...(Number.isFinite(ahead) && { ahead }),
    ...(Number.isFinite(behind) && { behind }),
  };
}

async function readGitText(
  repoDir: string,
  ref: string | undefined,
  gitPath: string,
): Promise<string | undefined> {
  if (!ref) {
    return undefined;
  }
  const { stdout } = await runGit(['show', `${ref}:${gitPath}`], {
    cwd: repoDir,
    check: false,
  });
  return stdout.length > 0 ? stdout : undefined;
}

async function getStorageBranchWorktreeDirtyPaths(
  repoDir: string,
  config: NormalizedResultsConfig & { readonly branch: string },
): Promise<{ dirtyPaths: string[]; conflictedPaths: string[] }> {
  const { stdout: porcelain } = await runGit(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: repoDir,
      check: false,
    },
  );
  const parsed = parseGitPorcelainPaths(porcelain);
  const safeDirtyPaths = parsed.dirtyPaths.filter(isSafeResultsRepoPath);
  const conflictedPaths = parsed.conflictedPaths.filter(isSafeResultsRepoPath);
  if (safeDirtyPaths.length === 0) {
    return { dirtyPaths: [], conflictedPaths };
  }

  const localRef = `refs/heads/${config.branch}`;
  const remoteRef = remoteBranchRef(config.branch, config.remote);
  const comparisonRef = (await gitRefExists(repoDir, localRef))
    ? localRef
    : (await gitRefExists(repoDir, remoteRef))
      ? remoteRef
      : undefined;
  const dirtyPaths: string[] = [];

  for (const gitPath of safeDirtyPaths) {
    const absolutePath = path.join(repoDir, ...gitPath.split('/'));
    if (!existsSync(absolutePath)) {
      if ((await readGitText(repoDir, comparisonRef, gitPath)) !== undefined) {
        dirtyPaths.push(gitPath);
      }
      continue;
    }

    const localContent = readFileSync(absolutePath, 'utf8');
    const branchContent = await readGitText(repoDir, comparisonRef, gitPath);
    if (branchContent === undefined || localContent !== branchContent) {
      dirtyPaths.push(gitPath);
    }
  }

  return { dirtyPaths: dirtyPaths.sort(), conflictedPaths };
}

async function inspectResultsStorageBranchGit(
  repoDir: string,
  config: NormalizedResultsConfig,
): Promise<ResultsRepoGitInspection> {
  if (!config.branch) {
    return {
      syncStatus: 'clean',
      dirtyPaths: [],
      conflictedPaths: [],
    };
  }
  const localRef = `refs/heads/${config.branch}`;
  const upstream = remoteBranchRef(config.branch, config.remote);
  const localExists = await gitRefExists(repoDir, localRef);
  const remoteExists = await gitRefExists(repoDir, upstream);
  const worktree = await getStorageBranchWorktreeDirtyPaths(repoDir, {
    ...config,
    branch: config.branch,
  });
  const { ahead = 0, behind = 0 } =
    localExists && remoteExists
      ? await getAheadBehindForRefs(repoDir, localRef, upstream)
      : {
          ahead: localExists && !remoteExists ? 1 : 0,
          behind: !localExists && remoteExists ? 1 : 0,
        };

  let syncStatus: ResultsRepoSyncStatus = 'clean';
  if (worktree.conflictedPaths.length > 0) {
    syncStatus = 'conflicted';
  } else if (worktree.dirtyPaths.length > 0) {
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
    branch: config.branch,
    ...(remoteExists && { upstream }),
    ahead,
    behind,
    dirtyPaths: worktree.dirtyPaths,
    conflictedPaths: worktree.conflictedPaths,
  };
}

async function fastForwardStorageBranchRef(
  repoDir: string,
  normalized: StorageBranchResultsConfig,
  upstream: string,
): Promise<void> {
  await assertValidResultsBranchName(repoDir, normalized.branch);
  await ensureResultsBranchNotCheckedOut(repoDir, normalized);

  const localRef = `refs/heads/${normalized.branch}`;
  const localExists = await gitRefExists(repoDir, localRef);
  const updateArgs = ['update-ref', localRef, upstream];
  if (localExists) {
    const { stdout: localSha } = await runGit(['rev-parse', localRef], { cwd: repoDir });
    updateArgs.push(localSha.trim());
  }
  await runGit(updateArgs, { cwd: repoDir });
  await runGit(['branch', '--set-upstream-to', upstream, normalized.branch], {
    cwd: repoDir,
    check: false,
  });
}

async function getDirtyPathsChangedUpstream(
  repoDir: string,
  normalized: StorageBranchResultsConfig,
  dirtyPaths: readonly string[],
  upstream: string,
): Promise<string[]> {
  const safeDirtyPaths = [...new Set(dirtyPaths.filter(isSafeResultsRepoPath))].sort();
  if (safeDirtyPaths.length === 0) {
    return [];
  }

  const localRef = `refs/heads/${normalized.branch}`;
  const localExists = await gitRefExists(repoDir, localRef);
  let changedPaths: string[];
  if (localExists) {
    const { stdout } = await runGit(['diff', '--name-only', `${localRef}..${upstream}`], {
      cwd: repoDir,
      check: false,
    });
    changedPaths = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(isSafeResultsRepoPath)
      .sort();
  } else {
    changedPaths = [];
    for (const dirtyPath of safeDirtyPaths) {
      if ((await readGitText(repoDir, upstream, dirtyPath)) !== undefined) {
        changedPaths.push(dirtyPath);
      }
    }
  }

  const dirtySet = new Set(safeDirtyPaths);
  return [...new Set(changedPaths.filter((changedPath) => dirtySet.has(changedPath)))].sort();
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

async function inspectResultsRepoGit(
  repoDir: string,
  config?: NormalizedResultsConfig,
): Promise<ResultsRepoGitInspection> {
  const branch = await getCurrentBranch(repoDir);
  const upstream = await resolveComparisonRef(repoDir, config);
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
  const { dirtyPaths: allDirtyPaths, conflictedPaths } = parseGitPorcelainPaths(porcelain);
  const dirtyPaths = allDirtyPaths.filter(isSafeResultsRepoPath);
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
  }

  return undefined;
}

type ResultsBranchPushDetails = {
  readonly pushConflictPolicy: ResultPushConflictPolicy;
  readonly targetBranch: string;
  readonly remoteCommit?: string;
  readonly localCommit?: string;
  readonly backupRef?: string;
  readonly backupCommit?: string;
  readonly previousRemoteCommit?: string;
  readonly forcePushedCommit?: string;
  readonly leaseCommit?: string;
};

type ResultsBranchPushOutcome =
  | {
      readonly blocked: false;
      readonly details?: ResultsBranchPushDetails;
    }
  | {
      readonly blocked: true;
      readonly blockReason: string;
      readonly details: ResultsBranchPushDetails;
    };

class ResultsBranchPushConflictError extends Error {
  constructor(readonly result: DirectPushResultsResult) {
    super(result.block_reason ?? 'Results branch push conflict');
    this.name = 'ResultsBranchPushConflictError';
  }
}

function pushDetailsToWire(
  details?: ResultsBranchPushDetails,
): Pick<
  ResultsRepoStatus,
  | 'push_conflict_policy'
  | 'target_branch'
  | 'remote_commit'
  | 'local_commit'
  | 'backup_ref'
  | 'backup_commit'
  | 'previous_remote_commit'
  | 'force_pushed_commit'
  | 'lease_commit'
> {
  if (!details) {
    return {};
  }
  return {
    push_conflict_policy: details.pushConflictPolicy,
    target_branch: details.targetBranch,
    ...(details.remoteCommit !== undefined && { remote_commit: details.remoteCommit }),
    ...(details.localCommit !== undefined && { local_commit: details.localCommit }),
    ...(details.backupRef !== undefined && { backup_ref: details.backupRef }),
    ...(details.backupCommit !== undefined && { backup_commit: details.backupCommit }),
    ...(details.previousRemoteCommit !== undefined && {
      previous_remote_commit: details.previousRemoteCommit,
    }),
    ...(details.forcePushedCommit !== undefined && {
      force_pushed_commit: details.forcePushedCommit,
    }),
    ...(details.leaseCommit !== undefined && { lease_commit: details.leaseCommit }),
  };
}

function withBlockedStatus(
  status: ResultsRepoStatus,
  blockReason: string,
  flags?: {
    readonly pullPerformed?: boolean;
    readonly pushPerformed?: boolean;
    readonly commitCreated?: boolean;
    readonly pushDetails?: ResultsBranchPushDetails;
  },
): ResultsRepoStatus {
  return {
    ...status,
    ...pushDetailsToWire(flags?.pushDetails),
    blocked: true,
    block_reason: blockReason,
    ...(flags?.pullPerformed !== undefined && { pull_performed: flags.pullPerformed }),
    ...(flags?.pushPerformed !== undefined && { push_performed: flags.pushPerformed }),
    ...(flags?.commitCreated !== undefined && { commit_created: flags.commitCreated }),
  };
}

function withPushConflictStatus(
  status: ResultsRepoStatus,
  blockReason: string,
  details: ResultsBranchPushDetails,
  flags: {
    readonly pullPerformed: boolean;
    readonly pushPerformed: boolean;
    readonly commitCreated: boolean;
  },
): ResultsRepoStatus {
  return withBlockedStatus(
    {
      ...status,
      sync_status: 'push_conflict',
    },
    blockReason,
    {
      ...flags,
      pushDetails: details,
    },
  );
}

function withActionFlags(
  status: ResultsRepoStatus,
  flags: {
    readonly pullPerformed: boolean;
    readonly pushPerformed: boolean;
    readonly commitCreated: boolean;
    readonly pushDetails?: ResultsBranchPushDetails;
  },
): ResultsRepoStatus {
  return {
    ...status,
    ...pushDetailsToWire(flags.pushDetails),
    blocked: false,
    pull_performed: flags.pullPerformed,
    push_performed: flags.pushPerformed,
    commit_created: flags.commitCreated,
  };
}

function isSafeResultsRepoPath(p: string): boolean {
  return RESULTS_REPO_TRACKED_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`));
}

// git errors on a pathspec that matches nothing, so when staging AgentV's result
// trees we only pass the ones that currently exist on disk or in the index. A run
// commit may have no tag overlays yet (no `metadata/`), and vice versa.
async function existingTrackedResultsDirs(repoDir: string): Promise<string[]> {
  const targets: string[] = [];
  for (const dir of RESULTS_REPO_TRACKED_DIRS) {
    if (existsSync(path.join(repoDir, dir))) {
      targets.push(dir);
      continue;
    }
    const { stdout } = await runGit(['ls-files', '--', dir], { cwd: repoDir, check: false });
    if (stdout.trim().length > 0) {
      targets.push(dir);
    }
  }
  return targets;
}

function areSafeResultsRepoPaths(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every(isSafeResultsRepoPath);
}

async function getAheadPaths(
  repoDir: string,
  upstream: string | undefined,
  branch = 'HEAD',
): Promise<readonly string[]> {
  if (!upstream) {
    return [];
  }
  const { stdout } = await runGit(['diff', '--name-only', `${upstream}..${branch}`], {
    cwd: repoDir,
    check: false,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function getPushTargetBranch(
  upstream: string | undefined,
  baseBranch: string,
  remote = 'origin',
): string {
  const prefix = `${remote}/`;
  return upstream?.startsWith(prefix) ? upstream.slice(prefix.length) : baseBranch;
}

function timestampForBackupRef(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function slugifyBackupTargetBranch(branch: string): string {
  return (
    branch
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'results'
  );
}

function buildResultsBackupRef(targetBranch: string, remoteCommit: string): string {
  return `agentv/backups/${timestampForBackupRef()}-${slugifyBackupTargetBranch(
    targetBranch,
  )}-${remoteCommit.slice(0, 7)}`;
}

async function getCommitSha(repoDir: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) {
    return undefined;
  }
  const { stdout } = await runGit(['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoDir,
    check: false,
  });
  const sha = stdout.trim();
  return sha.length > 0 ? sha : undefined;
}

function isNonFastForwardPushError(error: unknown): boolean {
  const text = gitErrorText(error);
  return (
    text.includes('non-fast-forward') ||
    text.includes('fetch first') ||
    text.includes('tip is behind its remote') ||
    text.includes('note about fast-forwards') ||
    text.includes('stale info')
  );
}

function formatShortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 12) : 'unknown';
}

function buildBlockedPushConflictReason(details: ResultsBranchPushDetails): string {
  return `Results branch push conflict on ${details.targetBranch}: remote ${formatShortSha(
    details.remoteCommit,
  )}, local ${formatShortSha(details.localCommit)}. Configure results.sync.push_conflict_policy: backup_and_force_push to back up the remote ref before replacing it.`;
}

async function resolveResultBranchPushConflict(params: {
  readonly normalized: StorageBranchResultsConfig;
  readonly repoDir: string;
  readonly targetBranch: string;
  readonly sourceRef: string;
}): Promise<ResultsBranchPushOutcome> {
  await fetchResultsRepo(params.repoDir, params.normalized.remote, params.targetBranch);
  const remoteRef = remoteBranchRef(params.targetBranch, params.normalized.remote);
  const remoteCommit = await getCommitSha(params.repoDir, remoteRef);
  const localCommit = await getCommitSha(params.repoDir, params.sourceRef);
  const baseDetails: ResultsBranchPushDetails = {
    pushConflictPolicy: params.normalized.push_conflict_policy,
    targetBranch: params.targetBranch,
    ...(remoteCommit !== undefined && {
      remoteCommit,
      previousRemoteCommit: remoteCommit,
      leaseCommit: remoteCommit,
    }),
    ...(localCommit !== undefined && { localCommit }),
  };

  if (!remoteCommit) {
    return {
      blocked: true,
      blockReason: `Results branch push conflict on ${params.targetBranch}: remote commit could not be resolved after fetch`,
      details: baseDetails,
    };
  }

  if (params.normalized.push_conflict_policy === 'block') {
    return {
      blocked: true,
      blockReason: buildBlockedPushConflictReason(baseDetails),
      details: baseDetails,
    };
  }

  const backupRef = buildResultsBackupRef(params.targetBranch, remoteCommit);
  const backupDetails: ResultsBranchPushDetails = {
    ...baseDetails,
    backupRef,
    backupCommit: remoteCommit,
  };

  try {
    await assertValidResultsBranchName(params.repoDir, backupRef);
    await runGit(
      ['push', '--porcelain', params.normalized.remote, `${remoteCommit}:refs/heads/${backupRef}`],
      { cwd: params.repoDir },
    );
  } catch (error) {
    return {
      blocked: true,
      blockReason: `Results branch backup creation failed for ${params.targetBranch} at ${formatShortSha(
        remoteCommit,
      )}: ${getStatusMessage(error)}`,
      details: backupDetails,
    };
  }

  try {
    await runGit(
      [
        'push',
        '--porcelain',
        `--force-with-lease=refs/heads/${params.targetBranch}:${remoteCommit}`,
        params.normalized.remote,
        `${params.sourceRef}:refs/heads/${params.targetBranch}`,
      ],
      { cwd: params.repoDir },
    );
  } catch (error) {
    return {
      blocked: true,
      blockReason: `Results branch force push lease failed for ${params.targetBranch}; remote changed after backup ${backupRef} was created with lease ${formatShortSha(
        remoteCommit,
      )}: ${getStatusMessage(error)}`,
      details: backupDetails,
    };
  }

  return {
    blocked: false,
    details: {
      ...backupDetails,
      ...(localCommit !== undefined && { forcePushedCommit: localCommit }),
    },
  };
}

async function statusFromInspection(
  normalized: NormalizedResultsConfig,
  repoDir: string,
): Promise<ResultsRepoStatus> {
  return withGitInspection(
    getResultsRepoStatus(normalized),
    await inspectResultsRepoGit(repoDir, normalized),
  );
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
    await ensureResultsRepoRemote(normalized.path, normalized);
    if (usesStorageBranchWorktree(normalized)) {
      await fetchResultsRepo(normalized.path, normalized.remote, normalized.branch).catch(
        () => undefined,
      );
      return withGitInspection(
        baseStatus,
        await inspectResultsStorageBranchGit(normalized.path, normalized),
      );
    }
    if (normalized.branch) {
      await fetchResultsRepo(normalized.path, normalized.remote, normalized.branch).catch(
        () => undefined,
      );
      await checkoutConfiguredResultsBranch(normalized.path, normalized);
    }
    return withGitInspection(baseStatus, await inspectResultsRepoGit(normalized.path, normalized));
  } catch (error) {
    return {
      ...baseStatus,
      ...(normalized.branch ? { available: false } : {}),
      sync_status: 'unavailable',
      last_error: getStatusMessage(error),
    };
  }
}

export async function syncResultsRepo(config: ResultsConfig): Promise<ResultsRepoStatus> {
  const normalized = normalizeResultsConfig(config);

  try {
    const repoDir = await ensureResultsRepoClone(normalized);
    await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
    if (!usesStorageBranchWorktree(normalized)) {
      await checkoutConfiguredResultsBranch(repoDir, normalized);
    }
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
  let pushDetails: ResultsBranchPushDetails | undefined;

  try {
    const repoDir = await ensureResultsRepoClone(normalized);
    if (usesStorageBranchWorktree(normalized)) {
      try {
        await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
      } catch (error) {
        if (normalized.require_push) {
          throw error;
        }
      }
      let inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
      const fastForwardBehindStorageBranch = async (): Promise<ResultsRepoStatus | undefined> => {
        if ((inspection.behind ?? 0) <= 0 || (inspection.ahead ?? 0) > 0) {
          return undefined;
        }

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

        if (!normalized.branch) {
          return undefined;
        }

        try {
          await fastForwardStorageBranchRef(
            repoDir,
            { ...normalized, branch: normalized.branch },
            inspection.upstream,
          );
          pullPerformed = true;
          inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
          return undefined;
        } catch (error) {
          inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
          const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
          const reason = `Results repo could not be fast-forwarded: ${getStatusMessage(error)}`;
          updateStatusFile(normalized, { last_error: reason });
          return withBlockedStatus(status, reason, {
            pullPerformed,
            pushPerformed,
            commitCreated,
          });
        }
      };

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

      if ((inspection.ahead ?? 0) > 0 && (inspection.behind ?? 0) > 0) {
        const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
        if (!normalized.branch) {
          updateStatusFile(normalized, {
            last_error: 'Results repo local and remote histories have diverged',
          });
          return withBlockedStatus(
            status,
            'Results repo local and remote histories have diverged',
            {
              pullPerformed,
              pushPerformed,
              commitCreated,
            },
          );
        }
        const localRef = `refs/heads/${normalized.branch}`;
        const aheadPaths = await getAheadPaths(repoDir, inspection.upstream, localRef);
        if (!inspection.upstream || !areSafeResultsRepoPaths(aheadPaths)) {
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
        const outcome = await resolveResultBranchPushConflict({
          normalized: { ...normalized, branch: normalized.branch },
          repoDir,
          targetBranch: normalized.branch,
          sourceRef: localRef,
        });
        pushDetails = outcome.details;
        if (outcome.blocked) {
          updateStatusFile(normalized, { last_error: outcome.blockReason });
          return withPushConflictStatus(status, outcome.blockReason, outcome.details, {
            pullPerformed,
            pushPerformed,
            commitCreated,
          });
        }
        pushPerformed = true;
        await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch(
          () => undefined,
        );
        inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
      }

      if (inspection.syncStatus === 'dirty') {
        if (!normalized.auto_push && !normalized.require_push) {
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

        if ((inspection.behind ?? 0) > 0) {
          if (inspection.upstream && normalized.branch) {
            const changedDirtyPaths = await getDirtyPathsChangedUpstream(
              repoDir,
              { ...normalized, branch: normalized.branch },
              inspection.dirtyPaths,
              inspection.upstream,
            );
            if (changedDirtyPaths.length > 0) {
              const conflictInspection: ResultsRepoGitInspection = {
                ...inspection,
                syncStatus: 'conflicted',
                conflictedPaths: [
                  ...new Set([...inspection.conflictedPaths, ...changedDirtyPaths]),
                ].sort(),
              };
              const status = withGitInspection(
                getResultsRepoStatus(normalized),
                conflictInspection,
              );
              const reason = `Results repo local metadata changes conflict with upstream changes: ${changedDirtyPaths.join(', ')}`;
              updateStatusFile(normalized, { last_error: reason });
              return withBlockedStatus(status, reason, {
                pullPerformed,
                pushPerformed,
                commitCreated,
              });
            }
          }
          const blockedStatus = await fastForwardBehindStorageBranch();
          if (blockedStatus) {
            return blockedStatus;
          }
        }

        if (normalized.branch) {
          commitCreated = await commitStorageBranchWorktreePaths({
            normalized: { ...normalized, branch: normalized.branch },
            repoDir,
            paths: inspection.dirtyPaths,
            commitMessage: 'chore(results): sync local result metadata',
          });
          inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
        }
      }

      if ((inspection.behind ?? 0) > 0 && (inspection.ahead ?? 0) === 0) {
        const blockedStatus = await fastForwardBehindStorageBranch();
        if (blockedStatus) {
          return blockedStatus;
        }
      }

      if (normalized.auto_push || normalized.require_push) {
        if (normalized.branch) {
          const localRef = `refs/heads/${normalized.branch}`;
          if (await gitRefExists(repoDir, localRef)) {
            try {
              await runGit(
                [
                  'push',
                  '--porcelain',
                  normalized.remote,
                  `${localRef}:refs/heads/${normalized.branch}`,
                ],
                { cwd: repoDir },
              );
              pushPerformed = true;
              await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch(
                () => undefined,
              );
            } catch (error) {
              if (isNonFastForwardPushError(error)) {
                const outcome = await resolveResultBranchPushConflict({
                  normalized: { ...normalized, branch: normalized.branch },
                  repoDir,
                  targetBranch: normalized.branch,
                  sourceRef: localRef,
                });
                pushDetails = outcome.details;
                if (!outcome.blocked) {
                  pushPerformed = true;
                  await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch(
                    () => undefined,
                  );
                  inspection = await inspectResultsStorageBranchGit(repoDir, normalized);
                } else {
                  updateStatusFile(normalized, { last_error: outcome.blockReason });
                  const status = withGitInspection(
                    getResultsRepoStatus(normalized),
                    await inspectResultsStorageBranchGit(repoDir, normalized),
                  );
                  return withPushConflictStatus(status, outcome.blockReason, outcome.details, {
                    pullPerformed,
                    pushPerformed,
                    commitCreated,
                  });
                }
              } else {
                updateStatusFile(normalized, { last_error: getStatusMessage(error) });
                if (normalized.require_push) {
                  throw error;
                }
                const status = withGitInspection(
                  getResultsRepoStatus(normalized),
                  await inspectResultsStorageBranchGit(repoDir, normalized),
                );
                return withBlockedStatus(
                  status,
                  `Results repo push was rejected: ${getStatusMessage(error)}`,
                  {
                    pullPerformed,
                    pushPerformed,
                    commitCreated,
                  },
                );
              }
            }
          }
        }
      }
      updateStatusFile(normalized, {
        last_synced_at: new Date().toISOString(),
        last_error: undefined,
      });
      const status = withGitInspection(
        getResultsRepoStatus(normalized),
        await inspectResultsStorageBranchGit(repoDir, normalized),
      );
      return withActionFlags(status, { pullPerformed, pushPerformed, commitCreated, pushDetails });
    }
    await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
    await checkoutConfiguredResultsBranch(repoDir, normalized);
    let inspection = await inspectResultsRepoGit(repoDir, normalized);

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

      if ((inspection.behind ?? 0) > 0) {
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
          inspection = await inspectResultsRepoGit(repoDir, normalized);
        } catch (error) {
          inspection = await inspectResultsRepoGit(repoDir, normalized);
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

      if (inspection.syncStatus === 'dirty') {
        const trackedDirs = await existingTrackedResultsDirs(repoDir);
        await runGit(['add', '--all', '--', ...trackedDirs], { cwd: repoDir });
        await runGitWithFallbackCommitIdentity(
          ['commit', '-m', 'chore(results): sync local result metadata', '--', ...trackedDirs],
          {
            cwd: repoDir,
          },
        );
        commitCreated = true;
        inspection = await inspectResultsRepoGit(repoDir, normalized);
      }
    }

    if (inspection.syncStatus === 'diverged') {
      const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
      const aheadPaths = await getAheadPaths(repoDir, inspection.upstream);
      if (!inspection.upstream || !areSafeResultsRepoPaths(aheadPaths)) {
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
      const baseBranch = normalized.branch ?? (await resolveDefaultBranch(repoDir));
      const targetBranch = getPushTargetBranch(inspection.upstream, baseBranch, normalized.remote);
      const outcome = await resolveResultBranchPushConflict({
        normalized: { ...normalized, branch: targetBranch },
        repoDir,
        targetBranch,
        sourceRef: 'HEAD',
      });
      pushDetails = outcome.details;
      if (outcome.blocked) {
        updateStatusFile(normalized, { last_error: outcome.blockReason });
        return withPushConflictStatus(status, outcome.blockReason, outcome.details, {
          pullPerformed,
          pushPerformed,
          commitCreated,
        });
      }
      pushPerformed = true;
      await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
      inspection = await inspectResultsRepoGit(repoDir, normalized);
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
        inspection = await inspectResultsRepoGit(repoDir, normalized);
      } catch (error) {
        inspection = await inspectResultsRepoGit(repoDir, normalized);
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

      const baseBranch = normalized.branch ?? (await resolveDefaultBranch(repoDir));
      const targetBranch = getPushTargetBranch(inspection.upstream, baseBranch, normalized.remote);
      try {
        await runGit(['push', normalized.remote, `HEAD:${targetBranch}`], { cwd: repoDir });
        pushPerformed = true;
        await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
        inspection = await inspectResultsRepoGit(repoDir, normalized);
      } catch (error) {
        if (isNonFastForwardPushError(error)) {
          const outcome = await resolveResultBranchPushConflict({
            normalized: { ...normalized, branch: targetBranch },
            repoDir,
            targetBranch,
            sourceRef: 'HEAD',
          });
          pushDetails = outcome.details;
          if (!outcome.blocked) {
            pushPerformed = true;
            await fetchResultsRepo(repoDir, normalized.remote, normalized.branch);
            inspection = await inspectResultsRepoGit(repoDir, normalized);
          } else {
            await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch(
              () => undefined,
            );
            inspection = await inspectResultsRepoGit(repoDir, normalized);
            const status = withGitInspection(getResultsRepoStatus(normalized), inspection);
            updateStatusFile(normalized, { last_error: outcome.blockReason });
            return withPushConflictStatus(status, outcome.blockReason, outcome.details, {
              pullPerformed,
              pushPerformed,
              commitCreated,
            });
          }
        } else {
          await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch(
            () => undefined,
          );
          inspection = await inspectResultsRepoGit(repoDir, normalized);
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
    }

    updateStatusFile(normalized, {
      last_synced_at: new Date().toISOString(),
      last_error: undefined,
    });

    return withActionFlags(await statusFromInspection(normalized, repoDir), {
      pullPerformed,
      pushPerformed,
      commitCreated,
      pushDetails,
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
  await fetchResultsRepo(repoDir, normalized.remote);
  await runGit(['checkout', '-B', branchName, `${normalized.remote}/${baseBranch}`], {
    cwd: repoDir,
  });
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
  await fetchResultsRepo(cloneDir, normalized.remote);

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-results-repo-'));
  const worktreeDir = path.join(worktreeRoot, 'repo');
  await runGit(
    ['worktree', 'add', '-B', branchName, worktreeDir, `${normalized.remote}/${baseBranch}`],
    {
      cwd: cloneDir,
    },
  );

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
  return path.join(normalized.path, RESULTS_REPO_RESULTS_DIR);
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

  await runGitWithFallbackCommitIdentity(['commit', '-m', params.commitMessage], {
    cwd: params.repoDir,
  });
  await runGit(['push', '-u', 'origin', params.branchName], { cwd: params.repoDir });
  return true;
}

export async function pushResultsRepoBranch(
  config: ResultsConfig,
  branchName: string,
  cwd?: string,
): Promise<void> {
  const normalized = normalizeResultsConfig(config);
  await runGit(['push', '-u', normalized.remote, branchName], {
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

async function hasUnpushedCommits(
  repoDir: string,
  upstreamRef: string,
  branch: string,
): Promise<boolean> {
  const { stdout } = await runGit(['rev-list', '--count', `${upstreamRef}..refs/heads/${branch}`], {
    cwd: repoDir,
    check: false,
  });
  return Number.parseInt(stdout.trim(), 10) > 0;
}

async function assertValidResultsBranchName(repoDir: string, branch: string): Promise<void> {
  if (
    branch.length === 0 ||
    branch.includes('..') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock') ||
    [...branch].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`Invalid results branch name: ${branch}`);
  }
  await runGit(['check-ref-format', '--branch', branch], { cwd: repoDir });
}

function normalizeDestinationPath(destinationPath: string): string {
  const normalized = destinationPath.split(path.sep).join('/');
  const segments = normalized.split('/').filter(Boolean);
  if (
    segments.length === 0 ||
    normalized.startsWith('/') ||
    segments.some((segment) => segment === '..') ||
    normalized.split('').some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`Invalid results destination path: ${destinationPath}`);
  }
  return segments.join('/');
}

async function listSourceFiles(sourceDir: string): Promise<string[]> {
  const entries: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        entries.push(absolutePath);
      }
    }
  }
  await visit(sourceDir);
  entries.sort();
  return entries;
}

type ArtifactSidecarPointer = {
  readonly path: string;
  readonly sha256?: string;
  readonly objectVersion?: string;
};

type PreparedArtifactSidecar = {
  readonly sourceDir: string;
  readonly cleanup: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function artifactSidecarPointers(record: unknown): ArtifactSidecarPointer[] {
  if (!isRecord(record) || !isRecord(record.artifact_pointers)) {
    return [];
  }

  const pointers: ArtifactSidecarPointer[] = [];
  for (const pointer of Object.values(record.artifact_pointers)) {
    if (!isRecord(pointer)) {
      continue;
    }
    if (pointer.ref !== AGENTV_RESULTS_ARTIFACTS_REF || typeof pointer.path !== 'string') {
      continue;
    }
    pointers.push({
      path: pointer.path,
      ...(typeof pointer.sha256 === 'string' ? { sha256: pointer.sha256 } : {}),
      ...(typeof pointer.object_version === 'string'
        ? { objectVersion: pointer.object_version }
        : {}),
    });
  }
  return pointers;
}

function artifactSidecarKey(destinationPath: string, pointerPath: string): string {
  return path.posix.join(
    RESULTS_REPO_RUNS_DIR,
    normalizeDestinationPath(destinationPath),
    normalizeDestinationPath(pointerPath),
  );
}

function collectArtifactSidecarPointers(sourceDir: string): ArtifactSidecarPointer[] {
  const indexPath = path.join(sourceDir, RESULT_INDEX_FILENAME);
  if (!existsSync(indexPath)) {
    return [];
  }

  const pointers: ArtifactSidecarPointer[] = [];
  for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      pointers.push(...artifactSidecarPointers(JSON.parse(trimmed)));
    } catch {}
  }
  return pointers;
}

function resolveArtifactPointerSourcePath(sourceDir: string, pointerPath: string): string {
  const normalizedPointerPath = normalizeDestinationPath(pointerPath);
  const sourceRoot = path.resolve(sourceDir);
  const sourcePath = path.resolve(sourceRoot, ...normalizedPointerPath.split('/'));
  const relative = path.relative(sourceRoot, sourcePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Artifact pointer path escapes run directory: ${pointerPath}`);
  }
  return sourcePath;
}

function verifyArtifactPointerChecksum(pointer: ArtifactSidecarPointer, content: Buffer): void {
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (pointer.sha256 && pointer.sha256 !== sha256) {
    throw new Error(`Artifact pointer checksum mismatch for ${pointer.path}`);
  }
  if (pointer.objectVersion && pointer.objectVersion !== `sha256:${sha256}`) {
    throw new Error(`Artifact pointer object_version mismatch for ${pointer.path}`);
  }
}

async function prepareArtifactSidecar(params: {
  readonly sourceDir: string;
  readonly pointers: readonly ArtifactSidecarPointer[];
}): Promise<PreparedArtifactSidecar | undefined> {
  if (params.pointers.length === 0) {
    return undefined;
  }

  const sidecarRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-artifact-sidecar-'));
  const copied = new Set<string>();
  const contentByPath = new Map<string, Buffer>();

  try {
    for (const pointer of params.pointers) {
      const relativePointerPath = normalizeDestinationPath(pointer.path);
      let content = contentByPath.get(relativePointerPath);
      if (!content) {
        const sourcePath = resolveArtifactPointerSourcePath(params.sourceDir, relativePointerPath);
        content = readFileSync(sourcePath);
        contentByPath.set(relativePointerPath, content);
      }
      verifyArtifactPointerChecksum(pointer, content);
      if (copied.has(relativePointerPath)) {
        continue;
      }
      const destinationPath = path.join(sidecarRoot, ...relativePointerPath.split('/'));
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      writeFileSync(destinationPath, content);
      copied.add(relativePointerPath);
    }
  } catch (error) {
    await rm(sidecarRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  if (copied.size === 0) {
    await rm(sidecarRoot, { recursive: true, force: true }).catch(() => undefined);
    return undefined;
  }

  return {
    sourceDir: sidecarRoot,
    cleanup: () => rm(sidecarRoot, { recursive: true, force: true }),
  };
}

function rewritePublishedIndexLine(line: string, destinationPath: string): string {
  if (!line.trim()) {
    return line;
  }

  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return line;
  }

  if (!isRecord(record) || !isRecord(record.artifact_pointers)) {
    return line;
  }

  let changed = false;
  for (const pointer of Object.values(record.artifact_pointers)) {
    if (!isRecord(pointer)) {
      continue;
    }
    if (pointer.ref !== AGENTV_RESULTS_ARTIFACTS_REF || typeof pointer.path !== 'string') {
      continue;
    }
    const key = artifactSidecarKey(destinationPath, pointer.path);
    if (pointer.key !== key) {
      pointer.key = key;
      changed = true;
    }
  }

  return changed ? JSON.stringify(record) : line;
}

async function preparePublishedResultsSource(params: {
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly pointers: readonly ArtifactSidecarPointer[];
}): Promise<PreparedArtifactSidecar | undefined> {
  if (params.pointers.length === 0) {
    return undefined;
  }

  const publishedRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-results-published-'));
  const omittedPaths = new Set(
    params.pointers.map((pointer) => normalizeDestinationPath(pointer.path)),
  );

  try {
    const sourceFiles = await listSourceFiles(params.sourceDir);
    for (const sourceFile of sourceFiles) {
      const relativeFile = path.relative(params.sourceDir, sourceFile).split(path.sep).join('/');
      const destinationFile = path.join(publishedRoot, ...relativeFile.split('/'));
      if (relativeFile === RESULT_INDEX_FILENAME) {
        const original = readFileSync(sourceFile, 'utf8');
        const rewritten = original
          .split(/\r?\n/)
          .map((line) => rewritePublishedIndexLine(line, params.destinationPath))
          .join('\n');
        mkdirSync(path.dirname(destinationFile), { recursive: true });
        writeFileSync(destinationFile, rewritten);
        continue;
      }
      if (omittedPaths.has(relativeFile)) {
        continue;
      }
      mkdirSync(path.dirname(destinationFile), { recursive: true });
      await cp(sourceFile, destinationFile, { dereference: false });
    }
  } catch (error) {
    await rm(publishedRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    sourceDir: publishedRoot,
    cleanup: () => rm(publishedRoot, { recursive: true, force: true }),
  };
}

async function getExistingRunTreePaths(
  repoDir: string,
  ref: string | undefined,
  destinationTreePath: string,
): Promise<string[]> {
  if (!ref) {
    return [];
  }
  const { stdout } = await runGit(['ls-tree', '-r', '--name-only', ref, destinationTreePath], {
    cwd: repoDir,
    check: false,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolveStorageBranchBase(params: {
  readonly repoDir: string;
  readonly normalized: StorageBranchResultsConfig;
  readonly preferRemote?: boolean;
}): Promise<{
  readonly baseRef?: string;
  readonly baseCommit?: string;
  readonly baseTree?: string;
  readonly localRef: string;
  readonly localExists: boolean;
  readonly remoteRef: string;
  readonly remoteExists: boolean;
}> {
  const localRef = `refs/heads/${params.normalized.branch}`;
  const remoteRef = `refs/remotes/${params.normalized.remote}/${params.normalized.branch}`;
  const localExists = await gitRefExists(params.repoDir, localRef);
  const remoteExists = await gitRefExists(params.repoDir, remoteRef);
  const baseRef = params.preferRemote
    ? remoteExists
      ? remoteRef
      : localExists
        ? localRef
        : undefined
    : localExists
      ? localRef
      : remoteExists
        ? remoteRef
        : undefined;
  const baseCommit = baseRef
    ? (
        await runGit(['rev-parse', `${baseRef}^{commit}`], {
          cwd: params.repoDir,
        })
      ).stdout.trim()
    : undefined;
  const baseTree = baseRef
    ? (
        await runGit(['rev-parse', `${baseRef}^{tree}`], {
          cwd: params.repoDir,
        })
      ).stdout.trim()
    : undefined;
  return { baseRef, baseCommit, baseTree, localRef, localExists, remoteRef, remoteExists };
}

async function ensureResultsBranchNotCheckedOut(
  repoDir: string,
  normalized: StorageBranchResultsConfig,
): Promise<void> {
  const currentBranch = await getCurrentBranch(repoDir);
  if (currentBranch !== normalized.branch) {
    return;
  }
  if (usesStorageBranchWorktree(normalized)) {
    throw new Error(
      `Refusing to publish results while '${normalized.branch}' is checked out in ${repoDir}`,
    );
  }
  await runGit(['checkout', '--detach'], { cwd: repoDir });
}

async function commitStorageBranchWorktreePaths(params: {
  readonly normalized: StorageBranchResultsConfig;
  readonly repoDir: string;
  readonly paths: readonly string[];
  readonly commitMessage: string;
}): Promise<boolean> {
  const { normalized } = params;
  const paths = [...new Set(params.paths.filter(isSafeResultsRepoPath))].sort();
  if (paths.length === 0) {
    return false;
  }

  await assertValidResultsBranchName(params.repoDir, normalized.branch);
  await ensureResultsBranchNotCheckedOut(params.repoDir, normalized);

  let base = await resolveStorageBranchBase({
    repoDir: params.repoDir,
    normalized,
  });
  if (!base.baseRef) {
    await createOrphanResultsBranch(params.repoDir, normalized.branch);
    base = await resolveStorageBranchBase({
      repoDir: params.repoDir,
      normalized,
    });
  }

  const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-results-index-'));
  const indexFile = path.join(indexRoot, 'index');
  const indexEnv = { GIT_INDEX_FILE: indexFile };

  try {
    if (base.baseRef) {
      await runGit(['read-tree', base.baseRef], { cwd: params.repoDir, env: indexEnv });
    } else {
      await runGit(['read-tree', '--empty'], { cwd: params.repoDir, env: indexEnv });
    }

    for (const gitPath of paths) {
      const sourcePath = path.join(params.repoDir, ...gitPath.split('/'));
      if (!existsSync(sourcePath)) {
        await runGit(['update-index', '--force-remove', '--', gitPath], {
          cwd: params.repoDir,
          env: indexEnv,
          check: false,
        });
        continue;
      }

      const fileStat = await lstat(sourcePath);
      let mode = fileStat.mode & 0o111 ? '100755' : '100644';
      if (fileStat.isSymbolicLink()) {
        mode = '120000';
      }
      const { stdout: blob } = await runGit(['hash-object', '-w', '--no-filters', sourcePath], {
        cwd: params.repoDir,
      });
      await runGit(['update-index', '--add', '--cacheinfo', `${mode},${blob.trim()},${gitPath}`], {
        cwd: params.repoDir,
        env: indexEnv,
      });
    }

    const { stdout: newTreeStdout } = await runGit(['write-tree'], {
      cwd: params.repoDir,
      env: indexEnv,
    });
    const newTree = newTreeStdout.trim();
    if (base.baseTree && newTree === base.baseTree) {
      return false;
    }

    const commitArgs = [
      'commit-tree',
      newTree,
      ...(base.baseCommit ? ['-p', base.baseCommit] : []),
      '-m',
      params.commitMessage,
    ];
    const { stdout: commitStdout } = await runGitWithFallbackCommitIdentity(commitArgs, {
      cwd: params.repoDir,
    });
    const commitSha = commitStdout.trim();
    await runGit(
      [
        'update-ref',
        `refs/heads/${normalized.branch}`,
        commitSha,
        ...(base.localExists ? [base.baseCommit ?? ''] : []),
      ].filter(Boolean),
      { cwd: params.repoDir },
    );

    if (base.remoteExists) {
      await runGit(['branch', '--set-upstream-to', base.remoteRef, normalized.branch], {
        cwd: params.repoDir,
        check: false,
      });
    }

    return true;
  } finally {
    await rm(indexRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function commitResultsRunWithTemporaryIndex(params: {
  readonly normalized: StorageBranchResultsConfig;
  readonly repoDir: string;
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly commitMessage: string;
  readonly targetRunId: string;
  readonly preferRemoteBase?: boolean;
}): Promise<{
  readonly commitCreated: boolean;
  readonly branchUpdated: boolean;
  readonly upstreamRef?: string;
}> {
  const { normalized } = params;
  await assertValidResultsBranchName(params.repoDir, normalized.branch);
  await ensureResultsBranchNotCheckedOut(params.repoDir, normalized);

  const destinationRunPath = normalizeDestinationPath(params.destinationPath);
  const destinationTreePath = path.posix.join(RESULTS_REPO_RUNS_DIR, destinationRunPath);
  let base = await resolveStorageBranchBase({
    repoDir: params.repoDir,
    normalized,
    preferRemote: params.preferRemoteBase,
  });

  // No local or remote tip exists yet (after fetching the branch by name): this
  // is the branch's very first commit. Root it at the deterministic empty-tree
  // genesis and parent the run commit on it, rather than letting the run commit
  // itself be the parentless root. This keeps the root SHA byte-identical across
  // clients, so independent first-inits converge on one genesis and reconcile by
  // fast-forward instead of producing divergent orphans.
  if (!base.baseRef) {
    await createOrphanResultsBranch(params.repoDir, normalized.branch);
    base = await resolveStorageBranchBase({
      repoDir: params.repoDir,
      normalized,
      preferRemote: params.preferRemoteBase,
    });
  }

  const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-results-index-'));
  const indexFile = path.join(indexRoot, 'index');
  const indexEnv = { GIT_INDEX_FILE: indexFile };

  try {
    if (base.baseRef) {
      await runGit(['read-tree', base.baseRef], { cwd: params.repoDir, env: indexEnv });
    } else {
      await runGit(['read-tree', '--empty'], { cwd: params.repoDir, env: indexEnv });
    }

    const existingPaths = await getExistingRunTreePaths(
      params.repoDir,
      base.baseRef,
      destinationTreePath,
    );
    for (const existingPath of existingPaths) {
      await runGit(['update-index', '--force-remove', '--', existingPath], {
        cwd: params.repoDir,
        env: indexEnv,
        check: false,
      });
    }

    const sourceFiles = await listSourceFiles(params.sourceDir);
    for (const sourceFile of sourceFiles) {
      const relativeFile = path.relative(params.sourceDir, sourceFile).split(path.sep).join('/');
      const destinationFile = path.posix.join(destinationTreePath, relativeFile);
      const fileStat = await lstat(sourceFile);
      let mode = fileStat.mode & 0o111 ? '100755' : '100644';
      let hashInputPath = sourceFile;
      if (fileStat.isSymbolicLink()) {
        mode = '120000';
        hashInputPath = sourceFile;
      }
      const { stdout: blob } = await runGit(['hash-object', '-w', '--no-filters', hashInputPath], {
        cwd: params.repoDir,
      });
      await runGit(
        ['update-index', '--add', '--cacheinfo', `${mode},${blob.trim()},${destinationFile}`],
        {
          cwd: params.repoDir,
          env: indexEnv,
        },
      );
    }

    const { stdout: newTreeStdout } = await runGit(['write-tree'], {
      cwd: params.repoDir,
      env: indexEnv,
    });
    const newTree = newTreeStdout.trim();
    if (base.baseTree && newTree === base.baseTree) {
      return {
        commitCreated: false,
        branchUpdated: false,
        upstreamRef: base.remoteExists ? base.remoteRef : undefined,
      };
    }

    const commitArgs = [
      'commit-tree',
      newTree,
      ...(base.baseCommit ? ['-p', base.baseCommit] : []),
      '-m',
      params.commitMessage,
      '-m',
      `AgentV-Run: ${params.targetRunId}`,
    ];
    const { stdout: commitStdout } = await runGitWithFallbackCommitIdentity(commitArgs, {
      cwd: params.repoDir,
    });
    const commitSha = commitStdout.trim();
    await runGit(
      [
        'update-ref',
        `refs/heads/${normalized.branch}`,
        commitSha,
        ...(base.localExists && !params.preferRemoteBase ? [base.baseCommit ?? ''] : []),
      ].filter(Boolean),
      { cwd: params.repoDir },
    );

    if (base.remoteExists) {
      await runGit(['branch', '--set-upstream-to', base.remoteRef, normalized.branch], {
        cwd: params.repoDir,
        check: false,
      });
    }

    return {
      commitCreated: true,
      branchUpdated: true,
      upstreamRef: base.remoteExists ? base.remoteRef : undefined,
    };
  } finally {
    await rm(indexRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildDirectPushResult(
  normalized: NormalizedResultsConfig,
  changed: boolean,
  outcome?: ResultsBranchPushOutcome,
): DirectPushResultsResult {
  const details = outcome?.details;
  return {
    changed,
    push_conflict_policy: normalized.push_conflict_policy,
    ...(outcome?.blocked === true && {
      blocked: true,
      block_reason: outcome.blockReason,
      sync_status: 'push_conflict' as const,
    }),
    ...pushDetailsToWire(details),
  };
}

function mergeDirectPushResults(
  normalized: NormalizedResultsConfig,
  results: readonly DirectPushResultsResult[],
): DirectPushResultsResult {
  const blocked = results.find((result) => result.blocked);
  if (blocked) {
    return blocked;
  }
  const detailed = [...results].reverse().find((result) => result.backup_ref !== undefined);
  return {
    changed: results.some((result) => result.changed),
    push_conflict_policy: normalized.push_conflict_policy,
    ...(detailed?.backup_ref !== undefined && {
      backup_ref: detailed.backup_ref,
    }),
    ...(detailed?.target_branch !== undefined && { target_branch: detailed.target_branch }),
    ...(detailed?.remote_commit !== undefined && { remote_commit: detailed.remote_commit }),
    ...(detailed?.local_commit !== undefined && { local_commit: detailed.local_commit }),
    ...(detailed?.backup_commit !== undefined && { backup_commit: detailed.backup_commit }),
    ...(detailed?.previous_remote_commit !== undefined && {
      previous_remote_commit: detailed.previous_remote_commit,
    }),
    ...(detailed?.force_pushed_commit !== undefined && {
      force_pushed_commit: detailed.force_pushed_commit,
    }),
    ...(detailed?.lease_commit !== undefined && { lease_commit: detailed.lease_commit }),
  };
}

async function pushDirectResultsToStorageBranch(params: {
  readonly normalized: StorageBranchResultsConfig;
  readonly repoDir: string;
  readonly storageBranch: string;
}): Promise<ResultsBranchPushOutcome | undefined> {
  try {
    await runGit(
      [
        'push',
        '--porcelain',
        params.normalized.remote,
        `refs/heads/${params.storageBranch}:refs/heads/${params.storageBranch}`,
      ],
      { cwd: params.repoDir },
    );
    updateStatusFile(params.normalized, {
      last_synced_at: new Date().toISOString(),
      last_error: undefined,
    });
    await fetchResultsRepo(params.repoDir, params.normalized.remote, params.storageBranch).catch(
      () => undefined,
    );
    return undefined;
  } catch (error) {
    if (!isNonFastForwardPushError(error)) {
      throw error;
    }
    const outcome = await resolveResultBranchPushConflict({
      normalized: params.normalized,
      repoDir: params.repoDir,
      targetBranch: params.storageBranch,
      sourceRef: `refs/heads/${params.storageBranch}`,
    });
    if (outcome.blocked) {
      updateStatusFile(params.normalized, { last_error: outcome.blockReason });
      return outcome;
    }
    updateStatusFile(params.normalized, {
      last_synced_at: new Date().toISOString(),
      last_error: undefined,
    });
    await fetchResultsRepo(params.repoDir, params.normalized.remote, params.storageBranch).catch(
      () => undefined,
    );
    return outcome;
  }
}

async function commitAndMaybePushRunTree(params: {
  readonly normalized: StorageBranchResultsConfig;
  readonly repoDir: string;
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly commitMessage: string;
  readonly targetRunId: string;
  readonly shouldPush: boolean;
}): Promise<DirectPushResultsResult> {
  const result = await commitResultsRunWithTemporaryIndex({
    normalized: params.normalized,
    repoDir: params.repoDir,
    sourceDir: params.sourceDir,
    destinationPath: params.destinationPath,
    commitMessage: params.commitMessage,
    targetRunId: params.targetRunId,
  });

  if (!params.shouldPush) {
    updateStatusFile(params.normalized, { last_error: undefined });
    return buildDirectPushResult(params.normalized, result.commitCreated);
  }

  if (!result.commitCreated) {
    const localBranchExists = await gitRefExists(
      params.repoDir,
      `refs/heads/${params.normalized.branch}`,
    );
    const hasUnpushed = result.upstreamRef
      ? localBranchExists
        ? await hasUnpushedCommits(params.repoDir, result.upstreamRef, params.normalized.branch)
        : false
      : localBranchExists;
    if (!hasUnpushed) {
      return buildDirectPushResult(params.normalized, false);
    }

    const aheadPaths = result.upstreamRef
      ? await getAheadPaths(
          params.repoDir,
          result.upstreamRef,
          `refs/heads/${params.normalized.branch}`,
        )
      : [];
    if (result.upstreamRef && !areSafeResultsRepoPaths(aheadPaths)) {
      const error = new Error('Results repo has non-results committed changes');
      updateStatusFile(params.normalized, { last_error: error.message });
      throw error;
    }
    const outcome = await pushDirectResultsToStorageBranch({
      normalized: params.normalized,
      repoDir: params.repoDir,
      storageBranch: params.normalized.branch,
    });
    return buildDirectPushResult(params.normalized, !outcome?.blocked, outcome);
  }

  const outcome = await pushDirectResultsToStorageBranch({
    normalized: params.normalized,
    repoDir: params.repoDir,
    storageBranch: params.normalized.branch,
  });
  return buildDirectPushResult(params.normalized, !outcome?.blocked, outcome);
}

/**
 * Push results directly to the configured storage branch of the results repo.
 * Handles non-fast-forward conflicts with the configured push conflict policy.
 * Returns true if artifacts were pushed, false if no changes were detected.
 */
export async function directPushResults(params: {
  readonly config: ResultsConfig;
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly commitMessage: string;
}): Promise<boolean> {
  const result = await directPushResultsWithDetails(params);
  if (result.blocked) {
    throw new ResultsBranchPushConflictError(result);
  }
  return result.changed;
}

export async function directPushResultsWithDetails(params: {
  readonly config: ResultsConfig;
  readonly sourceDir: string;
  readonly destinationPath: string;
  readonly commitMessage: string;
}): Promise<DirectPushResultsResult> {
  const normalized = normalizeResultsConfig(params.config);
  const repoDir = await ensureResultsRepoClone(normalized);
  await fetchResultsRepo(repoDir, normalized.remote, normalized.branch).catch((error) => {
    if (normalized.require_push) {
      throw error;
    }
  });
  const storageBranch = normalized.branch ?? (await resolveDefaultBranch(repoDir));
  const storageConfig: StorageBranchResultsConfig = {
    ...normalized,
    branch: storageBranch,
  };
  const targetRunId = buildGitRunId(params.destinationPath);
  const shouldPush = normalized.auto_push || normalized.require_push;
  const sidecarPointers = collectArtifactSidecarPointers(params.sourceDir);
  const sidecar = await prepareArtifactSidecar({
    sourceDir: params.sourceDir,
    pointers: sidecarPointers,
  });
  let publishedResultsSource: PreparedArtifactSidecar | undefined;

  try {
    publishedResultsSource = await preparePublishedResultsSource({
      sourceDir: params.sourceDir,
      destinationPath: params.destinationPath,
      pointers: sidecarPointers,
    });

    const pushResults: DirectPushResultsResult[] = [];
    if (sidecar) {
      await fetchResultsRepo(repoDir, normalized.remote, AGENTV_RESULTS_ARTIFACTS_REF).catch(
        (error) => {
          if (normalized.require_push) {
            throw error;
          }
        },
      );
      const sidecarResult = await commitAndMaybePushRunTree({
        normalized: {
          ...normalized,
          branch: AGENTV_RESULTS_ARTIFACTS_REF,
        },
        repoDir,
        sourceDir: sidecar.sourceDir,
        destinationPath: params.destinationPath,
        commitMessage: `chore(results): publish artifact sidecars for ${targetRunId}`,
        targetRunId,
        shouldPush,
      });
      pushResults.push(sidecarResult);
      if (sidecarResult.blocked) {
        return sidecarResult;
      }
    }

    pushResults.push(
      await commitAndMaybePushRunTree({
        normalized: storageConfig,
        repoDir,
        sourceDir: publishedResultsSource?.sourceDir ?? params.sourceDir,
        destinationPath: params.destinationPath,
        commitMessage: params.commitMessage,
        targetRunId,
        shouldPush,
      }),
    );
    return mergeDirectPushResults(normalized, pushResults);
  } finally {
    await publishedResultsSource?.cleanup().catch(() => undefined);
    await sidecar?.cleanup().catch(() => undefined);
  }
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

export interface GitResultArtifactReadParams {
  readonly repoDir: string;
  readonly key: string;
  readonly ref?: string;
  readonly remote?: string;
  readonly sha256?: string;
  readonly objectVersion?: string;
}

export async function readGitResultArtifact(
  params: GitResultArtifactReadParams,
): Promise<Buffer | undefined> {
  const artifactRef = params.ref ?? AGENTV_RESULTS_ARTIFACTS_REF;
  const normalizedKey = normalizeDestinationPath(params.key);
  const remote = params.remote ?? 'origin';
  if (!artifactRef.startsWith('refs/')) {
    await fetchResultsArtifactRef(params.repoDir, remote, artifactRef).catch(() => undefined);
  }

  const candidateRefs = [
    `refs/remotes/${remote}/${artifactRef}`,
    `refs/heads/${artifactRef}`,
    artifactRef,
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);

  for (const candidateRef of candidateRefs) {
    const blobs = parseGitBatchBlobs(
      await runGitBatch(params.repoDir, `${candidateRef}:${normalizedKey}\n`),
    );
    const blob = blobs[0];
    if (!blob) {
      continue;
    }
    verifyArtifactPointerChecksum(
      {
        path: normalizedKey,
        ...(params.sha256 ? { sha256: params.sha256 } : {}),
        ...(params.objectVersion ? { objectVersion: params.objectVersion } : {}),
      },
      blob.content,
    );
    return Buffer.from(blob.content);
  }

  return undefined;
}

// ── WIP (work-in-progress) branch helpers ─────────────────────────────────
//
// Periodic best-effort checkpoints push the partial run output to a unique
// non-default branch (`agentv/wip/<hostname>/<run-dir-basename>`) every ~30s.
// The branch is force-pushed (single-writer) to avoid conflict handling and
// noisy history. On successful run completion the branch is deleted.
//
// Manual recovery: if a pod is lost mid-run, an operator can clone the results
// repo, checkout `agentv/wip/<hostname>/<run-dir>`, and resume with:
//   cp -r runs/<run-dir> <local-workspace>
//   agentv eval <eval-file> --output <local-workspace>/<run-dir> --resume

export function buildWipBranchName(runDir: string): string {
  const hostname = os
    .hostname()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 40);
  const runBasename = path
    .basename(runDir)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 60);
  return `agentv/wip/${hostname}/${runBasename}`;
}

export interface WipWorktreeHandle {
  readonly wipBranch: string;
  readonly worktreeDir: string;
  readonly cloneDir: string;
  readonly remote: string;
  readonly cleanup: () => Promise<void>;
}

export async function setupWipWorktree(params: {
  readonly config: ResultsConfig;
  readonly wipBranch: string;
}): Promise<WipWorktreeHandle> {
  const normalized = normalizeResultsConfig(params.config);
  const cloneDir = await ensureResultsRepoClone(normalized);
  await fetchResultsRepo(cloneDir, normalized.remote, normalized.branch).catch((error) => {
    if (normalized.require_push) {
      throw error;
    }
  });
  let baseRef = normalized.branch
    ? await configuredResultsBranchRef(cloneDir, normalized)
    : remoteBranchRef(await resolveDefaultBranch(cloneDir), normalized.remote);
  if (!baseRef && normalized.branch) {
    await createOrphanResultsBranch(cloneDir, normalized.branch);
    baseRef = normalized.branch;
  }
  if (!baseRef) {
    throw new Error('Could not resolve a base ref for the WIP results branch');
  }
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-wip-'));
  const worktreeDir = path.join(worktreeRoot, 'repo');
  await runGit(['worktree', 'add', '-B', params.wipBranch, worktreeDir, baseRef], {
    cwd: cloneDir,
  });
  return {
    wipBranch: params.wipBranch,
    worktreeDir,
    cloneDir,
    remote: normalized.remote,
    cleanup: async () => {
      try {
        await runGit(['worktree', 'remove', '--force', worktreeDir], { cwd: cloneDir });
      } finally {
        await rm(worktreeRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/**
 * Snapshot the current run output into the WIP worktree and force-push to the
 * remote WIP branch. Returns true if a push was performed, false if nothing changed.
 *
 * Uses `--amend` on the base-branch tip so the remote WIP branch always holds
 * exactly one snapshot commit (no noisy history accumulation).
 */
export async function pushWipCheckpoint(params: {
  readonly handle: WipWorktreeHandle;
  readonly sourceDir: string;
  readonly destinationPath: string;
}): Promise<boolean> {
  const destinationDir = path.join(
    params.handle.worktreeDir,
    RESULTS_REPO_RUNS_DIR,
    params.destinationPath,
  );
  await stageResultsArtifacts({
    repoDir: params.handle.worktreeDir,
    sourceDir: params.sourceDir,
    destinationDir,
  });
  const trackedDirs = await existingTrackedResultsDirs(params.handle.worktreeDir);
  await runGit(['add', '--all', '--', ...trackedDirs], {
    cwd: params.handle.worktreeDir,
  });
  const { stdout: status } = await runGit(['status', '--porcelain'], {
    cwd: params.handle.worktreeDir,
    check: false,
  });
  if (!status.trim()) {
    return false;
  }
  const timestamp = new Date().toISOString();
  await runGitWithFallbackCommitIdentity(
    ['commit', '--amend', '-m', `wip(results): checkpoint ${params.handle.wipBranch} ${timestamp}`],
    { cwd: params.handle.worktreeDir },
  );
  await runGit(['push', '--force', params.handle.remote, params.handle.wipBranch], {
    cwd: params.handle.worktreeDir,
  });
  return true;
}

export async function deleteWipBranch(params: {
  readonly config: ResultsConfig;
  readonly wipBranch: string;
}): Promise<void> {
  const normalized = normalizeResultsConfig(params.config);
  const cloneDir = await ensureResultsRepoClone(normalized);
  await runGit(['push', normalized.remote, '--delete', params.wipBranch], { cwd: cloneDir });
}

// git exits non-zero with one of these messages when the requested ref/object
// does not exist yet — e.g. a configured results branch that has never been
// pushed. We treat that as "no remote runs" rather than a hard failure.
function isMissingGitRefError(error: unknown): boolean {
  const parts: string[] = [];
  if (error && typeof error === 'object') {
    const e = error as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string') parts.push(e.stderr);
    if (typeof e.message === 'string') parts.push(e.message);
  } else if (typeof error === 'string') {
    parts.push(error);
  }
  const haystack = parts.join('\n').toLowerCase();
  return (
    haystack.includes('not a valid object name') ||
    haystack.includes('unknown revision or path') ||
    haystack.includes('bad revision') ||
    haystack.includes('does not exist')
  );
}

export async function listGitRuns(repoDir: string, ref = 'origin/main'): Promise<GitListedRun[]> {
  let treeOut: string;
  try {
    ({ stdout: treeOut } = await runGit(
      ['ls-tree', '-r', '--name-only', ref, RESULTS_REPO_RUNS_DIR],
      {
        cwd: repoDir,
      },
    ));
  } catch (error) {
    // A not-yet-created results branch is an empty result, not an error. This
    // keeps the Dashboard's remote-results poll quiet before the first push.
    if (isMissingGitRefError(error)) {
      return [];
    }
    throw error;
  }

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
