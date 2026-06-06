import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type GitListedRun,
  type ResultsConfig,
  ResultsRepoRunExistsError,
  type ResultsRepoStatus,
  directPushResults,
  directorySizeBytes,
  findResultsRepoRun,
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
import { loadManifestResults } from './manifest.js';
import {
  type RemoteRunTagState,
  assertWritableResultsRepo,
  deleteRemoteRunTags,
  readRemoteRunTags,
  writeRemoteRunTags,
} from './remote-metadata.js';

// ── In-memory TTL cache for listGitRuns ────────────────────────────
// Avoids repeated expensive git ls-tree + git cat-file --batch operations
// on every API request. Cache key is repoDir, TTL is 60 seconds.
const gitRunsCache = new Map<string, { data: Promise<GitListedRun[]>; expiresAt: number }>();
const GIT_RUNS_CACHE_TTL_MS = 60_000;

function cachedListGitRuns(repoDir: string) {
  const now = Date.now();
  const cached = gitRunsCache.get(repoDir);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const promise = listGitRuns(repoDir);
  gitRunsCache.set(repoDir, { data: promise, expiresAt: now + GIT_RUNS_CACHE_TTL_MS });
  // Evict stale entry once the promise settles so a fresh fetch replaces it
  promise
    .catch(() => {})
    .finally(() => {
      const entry = gitRunsCache.get(repoDir);
      if (entry && entry.expiresAt <= Date.now()) {
        gitRunsCache.delete(repoDir);
      }
    });
  return promise;
}

function invalidateGitRunsCache(repoDir: string): void {
  gitRunsCache.delete(repoDir);
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

export interface LocalRunPublishPreview {
  readonly sourceRunId: string;
  readonly targetRepo: string;
  readonly targetPath: string;
  readonly targetRunId: string;
  readonly remoteExists: boolean;
  readonly replaceRequired: boolean;
  readonly canPublish: boolean;
  readonly blockReason?: string;
  readonly remoteStatus: RemoteResultsStatus;
}

export interface LocalRunPublishResult extends LocalRunPublishPreview {
  readonly published: boolean;
  readonly replaced: boolean;
}

export class LocalRunPublishError extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409 = 400) {
    super(message);
    this.name = 'LocalRunPublishError';
    this.status = status;
  }
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

function getRelativeRunPath(cwd: string, runDir: string): string {
  const relative = path.relative(path.join(cwd, '.agentv', 'results', 'runs'), runDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  const experiment = path.basename(path.dirname(runDir));
  const runName = path.basename(runDir);
  return experiment && experiment !== runName ? path.join(experiment, runName) : runName;
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

function getPublishStatusBlockReason(status: RemoteResultsStatus): string | undefined {
  if (!status.configured) {
    return 'Remote results repo is not configured for this project.';
  }

  if (status.sync_status === 'syncing') {
    return 'Project sync is already in progress. Wait for it to finish before publishing a run.';
  }

  if (status.sync_status && status.sync_status !== 'clean') {
    return 'Sync Project before publishing a selected run so pending result metadata is handled first.';
  }

  if (status.blocked) {
    return status.block_reason ?? 'Remote results repo sync is blocked.';
  }

  return undefined;
}

function getExperimentFromRunId(runId: string): string {
  const separatorIndex = runId.lastIndexOf('::');
  return separatorIndex === -1 ? 'default' : runId.slice(0, separatorIndex);
}

async function buildLocalRunPublishPreview(params: {
  readonly cwd: string;
  readonly config: Required<ResultsConfig>;
  readonly meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'raw_filename'>;
  readonly projectId?: string;
}): Promise<LocalRunPublishPreview & { readonly relativeRunPath: string }> {
  if (params.meta.source !== 'local') {
    throw new LocalRunPublishError('Selected run publish is only available for local runs');
  }

  const runDir = path.dirname(params.meta.path);
  const relativeRunPath = toPosixPath(getRelativeRunPath(params.cwd, runDir));
  const targetPath = path.posix.join('.agentv/results/runs', relativeRunPath);
  const existingRun = await findResultsRepoRun(params.config, params.meta.raw_filename);
  const remoteStatus = await getRemoteResultsStatus(params.cwd, params.projectId);
  const blockReason = getPublishStatusBlockReason(remoteStatus);
  const remoteExists = existingRun !== undefined;

  return {
    sourceRunId: params.meta.raw_filename,
    targetRepo: params.config.repo,
    targetPath,
    targetRunId: params.meta.raw_filename,
    remoteExists,
    replaceRequired: remoteExists,
    canPublish: !blockReason && !remoteExists,
    ...(blockReason && { blockReason }),
    remoteStatus,
    relativeRunPath,
  };
}

export async function previewLocalRunPublish(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'raw_filename'>,
  projectId?: string,
): Promise<LocalRunPublishPreview> {
  const config = await loadNormalizedResultsConfig(cwd, projectId);
  if (!config) {
    throw new LocalRunPublishError('Remote results repo is not configured for this project', 409);
  }

  const { relativeRunPath: _relativeRunPath, ...preview } = await buildLocalRunPublishPreview({
    cwd,
    config,
    meta,
    projectId,
  });
  return preview;
}

export async function publishLocalRun(params: {
  readonly cwd: string;
  readonly meta: Pick<SourcedResultFileMeta, 'source' | 'path' | 'raw_filename'>;
  readonly projectId?: string;
  readonly replace?: boolean;
}): Promise<LocalRunPublishResult> {
  const config = await loadNormalizedResultsConfig(params.cwd, params.projectId);
  if (!config) {
    throw new LocalRunPublishError('Remote results repo is not configured for this project', 409);
  }

  const preview = await buildLocalRunPublishPreview({
    cwd: params.cwd,
    config,
    meta: params.meta,
    projectId: params.projectId,
  });
  if (preview.blockReason) {
    throw new LocalRunPublishError(preview.blockReason, 409);
  }
  if (preview.remoteExists && params.replace !== true) {
    throw new ResultsRepoRunExistsError(preview.targetRunId, preview.relativeRunPath);
  }

  await maybeWarnLargeArtifact(path.dirname(params.meta.path));
  const results = loadManifestResults(params.meta.path);
  const pushed = await directPushResults({
    config,
    sourceDir: path.dirname(params.meta.path),
    destinationPath: preview.relativeRunPath,
    commitMessage: buildCommitTitle({
      cwd: params.cwd,
      run_dir: path.dirname(params.meta.path),
      test_files: [],
      results,
      eval_summaries: [],
      experiment: getExperimentFromRunId(preview.targetRunId),
    }),
    replaceExisting: params.replace === true,
  });

  invalidateGitRunsCache(config.path);
  const refreshed = await previewLocalRunPublish(params.cwd, params.meta, params.projectId);
  return {
    ...refreshed,
    published: pushed,
    replaced: preview.remoteExists && params.replace === true,
  };
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

async function loadNormalizedResultsConfig(
  cwd: string,
  projectId?: string,
): Promise<Required<ResultsConfig> | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  const project =
    projectId !== undefined
      ? getProject(projectId)
      : (getProjectForPath(repoRoot) ?? getProjectForPath(cwd));
  const projectResults = project?.results
    ? {
        mode: project.results.mode,
        repo: project.results.repo,
        path: project.results.path,
        auto_push: project.results.autoPush,
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
  config: Required<ResultsConfig> | undefined,
  status: ResultsRepoStatus,
): Promise<number> {
  let runCount = 0;
  if (config && status.available) {
    try {
      runCount = (await cachedListGitRuns(config.path)).length;
    } catch {
      runCount = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).length;
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
      run_count: 0,
      last_error: getStatusMessage(error),
      blocked: true,
      block_reason: getStatusMessage(error),
    };
  }
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
      const gitRuns = await cachedListGitRuns(config.path);
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

  const merged = [...localRuns, ...remoteRuns].sort((a, b) =>
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
  await materializeGitRun(config.path, relativeRunPath);
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
