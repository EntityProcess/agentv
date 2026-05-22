import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentvHome } from '../paths.js';
import type { ResultsConfig } from './loaders/config-loader.js';

const execFileAsync = promisify(execFile);

export interface ResultsRepoLocalPaths {
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
  readonly local_dir?: string;
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
    : path.join(getAgentvHome(), 'results', sanitizeRepoSlug(repo));
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

export function getResultsRepoStatus(config?: ResultsConfig): ResultsRepoStatus {
  if (!config) {
    return {
      configured: false,
      available: false,
      repo: '',
      local_dir: '',
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
  };
}

export async function syncResultsRepo(config: ResultsConfig): Promise<ResultsRepoStatus> {
  const normalized = normalizeResultsConfig(config);

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
  config: ResultsConfig,
  branchName: string,
): Promise<CheckedOutResultsRepoBranch> {
  const normalized = normalizeResultsConfig(config);
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
  config: ResultsConfig,
  branchName: string,
): Promise<PreparedResultsRepoBranch> {
  const normalized = normalizeResultsConfig(config);
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

export function resolveResultsRepoRunsDir(config: ResultsConfig): string {
  const normalized = normalizeResultsConfig(config);
  return path.join(normalized.path, 'runs');
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
    cwd: cwd ?? getResultsRepoLocalPaths(normalized.repo).repoDir,
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
 * Handles non-fast-forward conflicts by pulling with rebase and retrying.
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
  await updateCacheRepo(repoDir, baseBranch);

  const destinationDir = path.join(repoDir, normalized.path, params.destinationPath);
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

  await runGit(['commit', '-m', params.commitMessage], { cwd: repoDir });

  for (let attempt = 1; attempt <= DIRECT_PUSH_MAX_RETRIES; attempt++) {
    try {
      await runGit(['push', 'origin', baseBranch], { cwd: repoDir });
      updateStatusFile(normalized, {
        last_synced_at: new Date().toISOString(),
        last_error: undefined,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < DIRECT_PUSH_MAX_RETRIES && message.includes('non-fast-forward')) {
        await runGit(['pull', '--rebase', 'origin', baseBranch], { cwd: repoDir });
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
      env: process.env,
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
      reject(withFriendlyGitHubAuthError(stderr.length > 0 ? new Error(stderr) : new Error('git cat-file failed')));
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
  const { stdout: treeOut } = await runGit(['ls-tree', '-r', '--name-only', ref, 'runs'], {
    cwd: repoDir,
  });

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
    const relativeRunPath = path.posix.relative('runs', runDir);
    const runId = buildGitRunId(relativeRunPath);
    const timestamp = benchmark.metadata?.timestamp?.trim() || path.posix.basename(runDir);
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
        display_name: path.posix.basename(runDir),
        test_count: benchmark.metadata?.tests_run?.length ?? 0,
        avg_score: 0,
        size_bytes: blob.size,
      },
    ];
  });

  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return runs;
}
