import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type GitListedRun,
  type NormalizedResultsConfig,
  type ResultsRepoStatus,
  directPushResults,
  directorySizeBytes,
  getProject,
  getProjectForPath,
  getResultsRepoSyncStatus,
  listGitRuns,
  loadConfig,
  materializeGitRun,
  normalizeResultsConfig,
  resolveResultsConfigForProject,
  resolveResultsRepoRunsDir,
  syncResultsRepoForProject,
} from '@agentv/core';

import { findRepoRoot } from '../eval/shared.js';
import {
  type ResultFileMeta,
  listResultFiles,
  listResultFilesFromRunsDir,
} from '../inspect/utils.js';
import {
  type RemoteRunTagState,
  assertWritableResultsRepo,
  deleteRemoteRunTags,
  readRemoteRunTags,
  writeRemoteRunTags,
} from './remote-metadata.js';

// ── In-memory TTL cache for listGitRuns ────────────────────────────
// Avoids repeated expensive git ls-tree + git cat-file --batch operations
// on every API request. Cache key is repoDir + ref, TTL is 60 seconds.
const gitRunsCache = new Map<string, { data: Promise<GitListedRun[]>; expiresAt: number }>();
const GIT_RUNS_CACHE_TTL_MS = 60_000;

function getResultsStorageRef(config: NormalizedResultsConfig): string | undefined {
  return config.branch ? `origin/${config.branch}` : undefined;
}

function cachedListGitRuns(repoDir: string, ref?: string) {
  const now = Date.now();
  const cacheKey = `${repoDir}\0${ref ?? ''}`;
  const cached = gitRunsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const promise = ref ? listGitRuns(repoDir, ref) : listGitRuns(repoDir);
  gitRunsCache.set(cacheKey, { data: promise, expiresAt: now + GIT_RUNS_CACHE_TTL_MS });
  // Evict stale entry once the promise settles so a fresh fetch replaces it
  promise
    .catch(() => {})
    .finally(() => {
      const entry = gitRunsCache.get(cacheKey);
      if (entry && entry.expiresAt <= Date.now()) {
        gitRunsCache.delete(cacheKey);
      }
    });
  return promise;
}

function invalidateGitRunsCache(repoDir: string): void {
  for (const key of gitRunsCache.keys()) {
    if (key.startsWith(`${repoDir}\0`)) {
      gitRunsCache.delete(key);
    }
  }
}

export type RunSource = 'local' | 'remote';

export interface SourcedResultFileMeta extends ResultFileMeta {
  readonly source: RunSource;
  readonly raw_filename: string;
}

export interface RemoteEvalSummary {
  readonly eval_file: string;
  readonly total: number;
  readonly passed: number;
  readonly avg_score: number;
  readonly results: Array<{
    readonly test_id: string;
    readonly score: number;
    readonly status: 'PASS' | 'FAIL' | 'ERROR';
  }>;
}

export interface RemoteExportPayload {
  readonly cwd: string;
  readonly run_dir: string;
  readonly test_files: readonly string[];
  readonly results: readonly EvaluationResult[];
  readonly eval_summaries: readonly RemoteEvalSummary[];
  readonly experiment?: string;
}

export interface RemoteResultsStatus extends ResultsRepoStatus {
  readonly run_count: number;
}

const REMOTE_RUN_PREFIX = 'remote::';
const SIZE_WARNING_BYTES = 10 * 1024 * 1024;

function getStatusMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusForResult(result: EvaluationResult): 'PASS' | 'FAIL' | 'ERROR' {
  if (result.executionStatus === 'execution_error' || result.error) {
    return 'ERROR';
  }
  return result.score >= DEFAULT_THRESHOLD ? 'PASS' : 'FAIL';
}

export function getRelativeRunPath(cwd: string, runDir: string): string {
  const relative = path.relative(path.join(cwd, '.agentv', 'results', 'runs'), runDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  const experiment = path.basename(path.dirname(runDir));
  const runName = path.basename(runDir);
  return experiment && experiment !== runName ? path.join(experiment, runName) : runName;
}

function buildCommitTitle(payload: RemoteExportPayload): string {
  const passed = payload.results.filter((result) => result.score >= DEFAULT_THRESHOLD).length;
  const avgScore =
    payload.results.length > 0
      ? payload.results.reduce((sum, result) => sum + result.score, 0) / payload.results.length
      : 0;
  const experiment = payload.experiment ?? 'default';
  return `feat(results): ${experiment} - ${passed}/${payload.results.length} PASS (${avgScore.toFixed(3)})`;
}

async function maybeWarnLargeArtifact(runDir: string): Promise<void> {
  const sizeBytes = await directorySizeBytes(runDir);
  if (sizeBytes > SIZE_WARNING_BYTES) {
    console.warn(
      `Warning: run artifacts total ${(sizeBytes / (1024 * 1024)).toFixed(1)}MB. Export will continue.`,
    );
  }
}

export async function loadNormalizedResultsConfig(
  cwd: string,
  projectId?: string,
): Promise<NormalizedResultsConfig | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  const project =
    projectId !== undefined
      ? getProject(projectId)
      : (getProjectForPath(repoRoot) ?? getProjectForPath(cwd));
  const projectResults = project?.results
    ? {
        mode: 'github' as const,
        repo: project.results.repoUrl,
        branch: project.results.branch,
        path: project.results.path,
        auto_push: project.results.sync?.autoPush,
        branch_prefix: project.results.branchPrefix,
      }
    : undefined;
  const resultsConfig = projectResults ?? resolveResultsConfigForProject(config, project?.id);
  if (!resultsConfig) {
    return undefined;
  }
  return normalizeResultsConfig(resultsConfig);
}

export function encodeRemoteRunId(filename: string): string {
  return `${REMOTE_RUN_PREFIX}${filename}`;
}

export function isRemoteRunId(filename: string): boolean {
  return filename.startsWith(REMOTE_RUN_PREFIX);
}

export function decodeRemoteRunId(filename: string): string {
  return filename.replace(REMOTE_RUN_PREFIX, '');
}

export async function getRemoteResultsStatus(
  cwd: string,
  projectId?: string,
): Promise<RemoteResultsStatus> {
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  const status = await getResultsRepoSyncStatus(config);
  const runCount = await getRemoteRunCount(config, status);
  return {
    ...status,
    run_count: runCount,
  };
}

async function getRemoteRunCount(
  config: NormalizedResultsConfig | undefined,
  status: ResultsRepoStatus,
): Promise<number> {
  let runCount = 0;
  if (config && status.available) {
    try {
      runCount = (await cachedListGitRuns(config.path, getResultsStorageRef(config))).length;
    } catch {
      if (!config.branch) {
        runCount = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).length;
      }
    }
  }
  return runCount;
}

export async function syncRemoteResults(
  cwd: string,
  projectId?: string,
): Promise<RemoteResultsStatus> {
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    return {
      ...(await getResultsRepoSyncStatus()),
      run_count: 0,
    };
  }

  try {
    const status = await syncResultsRepoForProject(config);
    invalidateGitRunsCache(config.path);
    return {
      ...status,
      run_count: await getRemoteRunCount(config, status),
    };
  } catch (error) {
    const status = await getResultsRepoSyncStatus(config);
    return {
      ...status,
      run_count: await getRemoteRunCount(config, status),
      last_error: getStatusMessage(error),
      blocked: true,
      block_reason: getStatusMessage(error),
    };
  }
}

function dedupeSyncedRunCopies(runs: SourcedResultFileMeta[]): SourcedResultFileMeta[] {
  const byRunId = new Map<string, SourcedResultFileMeta>();

  for (const run of runs) {
    const existing = byRunId.get(run.raw_filename);
    if (!existing || (existing.source === 'remote' && run.source === 'local')) {
      byRunId.set(run.raw_filename, run);
    }
  }

  return [...byRunId.values()];
}

export async function listMergedResultFiles(
  cwd: string,
  limit?: number,
  projectId?: string,
): Promise<{ runs: SourcedResultFileMeta[]; remote_status: RemoteResultsStatus }> {
  const localRuns = listResultFiles(cwd).map(
    (meta) =>
      ({
        ...meta,
        source: 'local' as const,
        raw_filename: meta.filename,
      }) satisfies SourcedResultFileMeta,
  );

  const remoteStatus = await getRemoteResultsStatus(cwd, projectId);
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config || !remoteStatus.available) {
    return {
      runs: limit !== undefined && limit > 0 ? localRuns.slice(0, limit) : localRuns,
      remote_status: remoteStatus,
    };
  }

  let remoteRuns: SourcedResultFileMeta[] = [];
  if (config.mode === 'github') {
    try {
      const gitRuns = await cachedListGitRuns(config.path, getResultsStorageRef(config));
      remoteRuns = gitRuns.map((r) => ({
        filename: encodeRemoteRunId(r.run_id),
        raw_filename: r.run_id,
        source: 'remote' as const,
        path: path.join(config.path, r.manifest_path),
        displayName: r.display_name,
        timestamp: r.timestamp,
        testCount: r.test_count,
        passRate: r.pass_rate || 0,
        avgScore: r.avg_score || 0,
        sizeBytes: r.size_bytes || 0,
      }));
    } catch (error) {
      if (config.branch) {
        console.error('git-native listing failed for configured results branch', error);
      } else {
        console.error('git-native listing failed, falling back', error);
        remoteRuns = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).map(
          (meta) =>
            ({
              ...meta,
              filename: encodeRemoteRunId(meta.filename),
              raw_filename: meta.filename,
              source: 'remote' as const,
            }) satisfies SourcedResultFileMeta,
        );
      }
    }
  } else {
    remoteRuns = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).map(
      (meta) =>
        ({
          ...meta,
          filename: encodeRemoteRunId(meta.filename),
          raw_filename: meta.filename,
          source: 'remote' as const,
        }) satisfies SourcedResultFileMeta,
    );
  }

  const merged = dedupeSyncedRunCopies([...localRuns, ...remoteRuns]).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
  return {
    runs: limit !== undefined && limit > 0 ? merged.slice(0, limit) : merged,
    remote_status: remoteStatus,
  };
}

export async function findRunById(
  cwd: string,
  runId: string,
  projectId?: string,
): Promise<SourcedResultFileMeta | undefined> {
  const { runs } = await listMergedResultFiles(cwd, undefined, projectId);
  return runs.find((run) => run.filename === runId);
}

export async function ensureRemoteRunAvailable(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path'>,
  projectId?: string,
): Promise<void> {
  if (meta.source !== 'remote' || existsSync(meta.path)) {
    return;
  }

  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new Error('Remote results are not configured');
  }

  const relativeManifestPath = path.relative(config.path, meta.path).split(path.sep).join('/');
  if (
    relativeManifestPath.length === 0 ||
    relativeManifestPath === meta.path ||
    relativeManifestPath.startsWith('../')
  ) {
    throw new Error(`Remote manifest path is outside the results repo clone: ${meta.path}`);
  }

  const relativeRunPath = path.posix.relative(
    '.agentv/results/runs',
    path.posix.dirname(relativeManifestPath),
  );
  await materializeGitRun(config.path, relativeRunPath, getResultsStorageRef(config));
}

export async function readRemoteRunTagState(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path'>,
  projectId?: string,
): Promise<RemoteRunTagState | undefined> {
  if (meta.source !== 'remote') return undefined;
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) return undefined;

  try {
    return readRemoteRunTags(config.path, meta.path);
  } catch {
    return undefined;
  }
}

export async function setRemoteRunTags(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path'>,
  tags: readonly string[],
  projectId?: string,
): Promise<RemoteRunTagState> {
  if (meta.source !== 'remote') {
    throw new Error('Remote metadata can only be set on remote runs');
  }
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new Error('Writable results repo is not configured for remote metadata');
  }
  assertWritableResultsRepo(config.path);
  return writeRemoteRunTags(config.path, meta.path, tags);
}

export async function clearRemoteRunTags(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path'>,
  projectId?: string,
): Promise<RemoteRunTagState> {
  if (meta.source !== 'remote') {
    throw new Error('Remote metadata can only be removed from remote runs');
  }
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new Error('Writable results repo is not configured for remote metadata');
  }
  assertWritableResultsRepo(config.path);
  return deleteRemoteRunTags(config.path, meta.path);
}

export async function maybeAutoExportRunArtifacts(payload: RemoteExportPayload): Promise<void> {
  const config = await loadNormalizedResultsConfig(payload.cwd);
  if (!config?.auto_push) {
    return;
  }

  try {
    await maybeWarnLargeArtifact(payload.run_dir);

    const relativeRunPath = getRelativeRunPath(payload.cwd, payload.run_dir);
    const commitTitle = buildCommitTitle(payload);

    const pushed = await directPushResults({
      config,
      sourceDir: payload.run_dir,
      destinationPath: relativeRunPath,
      commitMessage: commitTitle,
    });

    if (!pushed) {
      console.warn('Warning: results export produced no git changes. Skipping push.');
      return;
    }

    console.log(`Results pushed to ${config.repo} (${config.path}/${relativeRunPath})`);
  } catch (error) {
    console.warn(`Warning: skipping results export: ${getStatusMessage(error)}`);
    console.warn("Warning: Run 'gh auth login' if GitHub authentication is missing.");
  }
}
