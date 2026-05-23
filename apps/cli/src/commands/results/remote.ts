import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type ResultsConfig,
  type ResultsRepoStatus,
  directPushResults,
  directorySizeBytes,
  getResultsRepoStatus,
  listGitRuns,
  loadConfig,
  materializeGitRun,
  normalizeResultsConfig,
  resolveResultsRepoRunsDir,
  syncResultsRepo,
} from '@agentv/core';

import { findRepoRoot } from '../eval/shared.js';
import {
  type ResultFileMeta,
  listResultFiles,
  listResultFilesFromRunsDir,
} from '../inspect/utils.js';

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

function getRelativeRunPath(cwd: string, runDir: string): string {
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

async function loadNormalizedResultsConfig(
  cwd: string,
): Promise<Required<ResultsConfig> | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  if (!config?.results) {
    return undefined;
  }
  return normalizeResultsConfig(config.results);
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

export async function getRemoteResultsStatus(cwd: string): Promise<RemoteResultsStatus> {
  const config = await loadNormalizedResultsConfig(cwd);
  const status = getResultsRepoStatus(config);
  let runCount = 0;
  if (config && status.available) {
    try {
      runCount = (await listGitRuns(config.path)).length;
    } catch {
      runCount = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).length;
    }
  }
  return {
    ...status,
    run_count: runCount,
  };
}

export async function syncRemoteResults(cwd: string): Promise<RemoteResultsStatus> {
  const config = await loadNormalizedResultsConfig(cwd);
  if (!config) {
    return {
      ...getResultsRepoStatus(),
      run_count: 0,
    };
  }

  try {
    await syncResultsRepo(config);
  } catch (error) {
    return {
      ...getResultsRepoStatus(config),
      run_count: 0,
      last_error: getStatusMessage(error),
    };
  }

  return getRemoteResultsStatus(cwd);
}

export async function listMergedResultFiles(
  cwd: string,
  limit?: number,
): Promise<{ runs: SourcedResultFileMeta[]; remote_status: RemoteResultsStatus }> {
  const localRuns = listResultFiles(cwd).map(
    (meta) =>
      ({
        ...meta,
        source: 'local' as const,
        raw_filename: meta.filename,
      }) satisfies SourcedResultFileMeta,
  );

  const remoteStatus = await getRemoteResultsStatus(cwd);
  const config = await loadNormalizedResultsConfig(cwd);
  if (!config || !remoteStatus.available) {
    return {
      runs: limit !== undefined && limit > 0 ? localRuns.slice(0, limit) : localRuns,
      remote_status: remoteStatus,
    };
  }

  let remoteRuns: SourcedResultFileMeta[] = [];
  if (config.mode === 'github') {
    try {
      const gitRuns = await listGitRuns(config.path);
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
): Promise<SourcedResultFileMeta | undefined> {
  const { runs } = await listMergedResultFiles(cwd);
  return runs.find((run) => run.filename === runId);
}

export async function ensureRemoteRunAvailable(
  cwd: string,
  meta: Pick<SourcedResultFileMeta, 'source' | 'path'>,
): Promise<void> {
  if (meta.source !== 'remote' || existsSync(meta.path)) {
    return;
  }

  const config = await loadNormalizedResultsConfig(cwd);
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

  const relativeRunPath = path.posix.relative('runs', path.posix.dirname(relativeManifestPath));
  await materializeGitRun(config.path, relativeRunPath);
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
