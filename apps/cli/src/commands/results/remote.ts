import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type GitListedRun,
  type NormalizedResultsConfig,
  type ResultsConfig,
  type ResultsRepoStatus,
  confirmResultsMergeAndPull,
  directPushResultsWithDetails,
  directorySizeBytes,
  getProject,
  getProjectForPath,
  getResultsRepoSyncStatus,
  listGitRunsCached,
  loadConfig,
  materializeGitRun,
  normalizeResultsConfig,
  resolveResultsConfigForProject,
  resolveResultsRepoRunsDir,
  syncResultsRepoForProject,
} from '@agentv/core';

import { relativeRunPathFromCwd } from '../eval/result-layout.js';
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
  if (!config.branch) {
    return undefined;
  }
  return config.storageBranchWorktree
    ? `refs/remotes/${config.remote}/${config.branch}`
    : config.branch;
}

function cachedListGitRuns(repoDir: string, ref?: string) {
  const now = Date.now();
  const cacheKey = `${repoDir}\0${ref ?? ''}`;
  const cached = gitRunsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const promise = ref ? listGitRunsCached(repoDir, ref) : listGitRunsCached(repoDir);
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
  readonly experiment?: string;
  readonly target?: string;
  readonly summaryPath?: string;
  readonly executionErrorCount?: number;
  /**
   * True when this run is present on the configured remote results branch.
   * A run synced to the remote keeps `source: 'local'` (the local copy is
   * preferred for reads) but still records `on_remote: true`, so the Dashboard
   * can show a per-run "on remote" indicator instead of an exclusive
   * local/remote filter. This is the flag the run-count summary derives from.
   */
  readonly on_remote: boolean;
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
  readonly results_overrides?: ResultsPublishOverrides;
}

export type RemoteExportStatus = 'disabled' | 'published' | 'already_published' | 'failed';

export interface RemoteResultsStatus extends ResultsRepoStatus {
  readonly run_count: number;
}

function relativeLocalRunPath(cwd: string, manifestPath: string): string | undefined {
  const manifestDir = path.resolve(path.dirname(manifestPath));
  return relativeRunPathFromCwd(cwd, manifestDir);
}

function remoteMetadataManifestPath(
  cwd: string,
  config: NormalizedResultsConfig,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'on_remote'>,
): string | undefined {
  if (meta.source === 'remote') {
    return meta.path;
  }
  if (!meta.on_remote) {
    return undefined;
  }
  const relativeRunPath = relativeLocalRunPath(cwd, meta.path);
  if (!relativeRunPath) {
    return undefined;
  }
  return path.join(config.path, 'runs', ...relativeRunPath.split('/'), 'index.jsonl');
}

export interface ResultsPublishOverrides {
  readonly repo?: string;
  readonly repo_url?: string;
  readonly repo_path?: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly auto_push?: boolean;
  readonly require_push?: boolean;
  readonly push_conflict_policy?: 'block';
}

type RuntimeResultsConfig = Omit<ResultsConfig, 'sync'> & {
  readonly sync?: ResultsConfig['sync'] & {
    readonly require_push?: boolean;
  };
};

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
  const relative = relativeRunPathFromCwd(cwd, runDir);
  if (relative) {
    return relative;
  }

  throw new Error(
    `Run workspace must use .agentv/results/<experiment>/<timestamp>: ${path.resolve(runDir)}`,
  );
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
  overrides?: ResultsPublishOverrides,
): Promise<NormalizedResultsConfig | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  const project =
    projectId !== undefined
      ? getProject(projectId)
      : (getProjectForPath(repoRoot) ?? getProjectForPath(cwd));
  const projectResults = project?.results
    ? ({
        mode: 'github' as const,
        ...(project.results.repoUrl !== undefined && {
          repo: project.results.repoUrl,
          repo_url: project.results.repoUrl,
        }),
        ...(project.results.repoPath !== undefined && { repo_path: project.results.repoPath }),
        ...(project.results.branch !== undefined && { branch: project.results.branch }),
        ...(project.results.path !== undefined && { path: project.results.path }),
        ...((project.results.sync?.autoPush !== undefined ||
          project.results.sync?.pushConflictPolicy !== undefined) && {
          sync: {
            ...(project.results.sync?.autoPush !== undefined && {
              auto_push: project.results.sync.autoPush,
            }),
            ...(project.results.sync?.pushConflictPolicy !== undefined && {
              push_conflict_policy: project.results.sync.pushConflictPolicy,
            }),
          },
        }),
        ...(project.results.branchPrefix !== undefined && {
          branch_prefix: project.results.branchPrefix,
        }),
      } satisfies ResultsConfig)
    : undefined;
  const resultsConfig = projectResults ?? resolveResultsConfigForProject(config, project?.id);
  if (!resultsConfig && !overrides) {
    return undefined;
  }
  const baseConfig = resultsConfig
    ? normalizeResultsConfig(resultsConfig, { baseDir: project?.path ?? repoRoot })
    : undefined;
  const repoOverride = overrides?.repo ?? overrides?.repo_url ?? overrides?.repo_path;
  if (!baseConfig && !repoOverride) {
    return undefined;
  }
  if (!overrides) {
    return baseConfig;
  }

  const merged: RuntimeResultsConfig = {
    mode: 'github',
    ...(overrides.repo !== undefined
      ? { repo: overrides.repo }
      : overrides.repo_url !== undefined
        ? { repo_url: overrides.repo_url }
        : overrides.repo_path !== undefined
          ? { repo_path: overrides.repo_path }
          : baseConfig?.repo_path
            ? { repo_path: baseConfig.repo_path }
            : baseConfig?.repo_url
              ? { repo_url: baseConfig.repo_url }
              : baseConfig?.repo
                ? { repo: baseConfig.repo }
                : {}),
    ...(overrides.branch !== undefined
      ? { branch: overrides.branch }
      : baseConfig?.branch
        ? { branch: baseConfig.branch }
        : {}),
    ...(overrides.remote !== undefined
      ? { remote: overrides.remote }
      : baseConfig?.remote
        ? { remote: baseConfig.remote }
        : {}),
    ...(repoOverride === undefined && baseConfig?.repo_path === undefined && baseConfig?.path
      ? { path: baseConfig.path }
      : {}),
    ...((overrides.auto_push !== undefined ||
      overrides.require_push !== undefined ||
      overrides.push_conflict_policy !== undefined ||
      baseConfig?.auto_push !== undefined ||
      baseConfig?.require_push !== undefined ||
      baseConfig?.push_conflict_policy !== undefined) && {
      sync: {
        ...((overrides.auto_push ?? baseConfig?.auto_push) !== undefined && {
          auto_push: overrides.auto_push ?? baseConfig?.auto_push,
        }),
        ...((overrides.require_push ?? baseConfig?.require_push) !== undefined && {
          require_push: overrides.require_push ?? baseConfig?.require_push,
        }),
        ...((overrides.push_conflict_policy ?? baseConfig?.push_conflict_policy) !== undefined && {
          push_conflict_policy: overrides.push_conflict_policy ?? baseConfig?.push_conflict_policy,
        }),
      },
    }),
    ...(baseConfig?.branch_prefix ? { branch_prefix: baseConfig.branch_prefix } : {}),
  };

  return normalizeResultsConfig(merged, { baseDir: project?.path ?? repoRoot });
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

/**
 * The Layer 2 "OK" action: the user has merged the pending temp branch into the
 * target on GitHub. Pull the merged target into the local results checkout and
 * resume normal sync. Mirrors {@link syncRemoteResults}'s config-load and
 * error-wrap behavior.
 */
export async function confirmRemoteResultsMerge(
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
    const status = await confirmResultsMergeAndPull(config);
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
    if (!existing) {
      byRunId.set(run.raw_filename, run);
      continue;
    }
    // A run can appear once locally and once on the remote branch. Keep the
    // local copy (it is materialized on disk and readable), but remember that
    // the run is also present remotely so the per-run "on remote" indicator
    // and the summary count stay accurate for synced runs.
    const preferred = existing.source === 'remote' && run.source === 'local' ? run : existing;
    byRunId.set(run.raw_filename, {
      ...preferred,
      on_remote: existing.on_remote || run.on_remote,
    });
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
        on_remote: false,
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
        on_remote: true,
        path: path.join(config.path, r.manifest_path),
        ...(r.summary_path && { summaryPath: path.join(config.path, r.summary_path) }),
        experiment: r.experiment,
        ...(r.target && { target: r.target }),
        displayName: r.display_name,
        timestamp: r.timestamp,
        testCount: r.test_count,
        ...(r.execution_error_count !== undefined && {
          executionErrorCount: r.execution_error_count,
        }),
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
              on_remote: true,
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
          on_remote: true,
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

  // On the results branch runs live flat under `runs/` (the branch namespaces
  // results), so strip that prefix to recover <experiment>/<timestamp>.
  const relativeRunPath = path.posix.relative('runs', path.posix.dirname(relativeManifestPath));
  await materializeGitRun(config.path, relativeRunPath, getResultsStorageRef(config));
}

export async function readRemoteRunTagState(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'on_remote'>,
  projectId?: string,
): Promise<RemoteRunTagState | undefined> {
  if (meta.source !== 'remote' && !meta.on_remote) return undefined;
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) return undefined;
  const manifestPath = remoteMetadataManifestPath(cwd, config, meta);
  if (!manifestPath) return undefined;

  try {
    return readRemoteRunTags(config.path, manifestPath, getResultsStorageRef(config));
  } catch {
    return undefined;
  }
}

export async function setRemoteRunTags(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'on_remote'>,
  tags: readonly string[],
  projectId?: string,
  expectedTagRevision?: string,
): Promise<RemoteRunTagState> {
  if (meta.source !== 'remote' && !meta.on_remote) {
    throw new Error('Remote metadata can only be set on remote runs');
  }
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new Error('Writable results repo is not configured for remote metadata');
  }
  const manifestPath = remoteMetadataManifestPath(cwd, config, meta);
  if (!manifestPath) {
    throw new Error('Remote metadata can only be set on remote runs');
  }
  assertWritableResultsRepo(config.path);
  return writeRemoteRunTags(
    config.path,
    manifestPath,
    tags,
    getResultsStorageRef(config),
    expectedTagRevision,
  );
}

export async function clearRemoteRunTags(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'on_remote'>,
  projectId?: string,
  expectedTagRevision?: string,
): Promise<RemoteRunTagState> {
  if (meta.source !== 'remote' && !meta.on_remote) {
    throw new Error('Remote metadata can only be removed from remote runs');
  }
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new Error('Writable results repo is not configured for remote metadata');
  }
  const manifestPath = remoteMetadataManifestPath(cwd, config, meta);
  if (!manifestPath) {
    throw new Error('Remote metadata can only be removed from remote runs');
  }
  assertWritableResultsRepo(config.path);
  return deleteRemoteRunTags(
    config.path,
    manifestPath,
    getResultsStorageRef(config),
    expectedTagRevision,
  );
}

export async function maybeAutoExportRunArtifacts(
  payload: RemoteExportPayload,
): Promise<RemoteExportStatus> {
  const config = await loadNormalizedResultsConfig(
    payload.cwd,
    undefined,
    payload.results_overrides,
  );
  if (!config) {
    return 'disabled';
  }

  try {
    await maybeWarnLargeArtifact(payload.run_dir);

    const relativeRunPath = getRelativeRunPath(payload.cwd, payload.run_dir);
    const commitTitle = buildCommitTitle(payload);

    const pushResult = await directPushResultsWithDetails({
      config,
      sourceDir: payload.run_dir,
      destinationPath: relativeRunPath,
      commitMessage: commitTitle,
    });

    if (pushResult.blocked) {
      if (config.require_push) {
        throw new Error(pushResult.block_reason ?? 'Results branch push conflict');
      }
      console.warn(`Warning: skipping results export: ${pushResult.block_reason}`);
      return 'failed';
    }

    if (!pushResult.changed) {
      console.warn('Warning: results export produced no git changes.');
      return 'already_published';
    }

    const pushLabel = config.auto_push || config.require_push ? 'pushed' : 'published locally';
    console.log(
      `Results ${pushLabel} to ${config.repo} (${config.branch ?? 'default branch'}:${relativeRunPath})`,
    );
    if (pushResult.backup_ref) {
      console.log(
        `Backed up previous remote ${pushResult.target_branch ?? config.branch ?? 'results branch'} at ${pushResult.backup_ref}`,
      );
    }
    return 'published';
  } catch (error) {
    if (config.require_push) {
      throw error;
    }
    console.warn(`Warning: skipping results export: ${getStatusMessage(error)}`);
    console.warn("Warning: Run 'gh auth login' if GitHub authentication is missing.");
    return 'failed';
  }
}
