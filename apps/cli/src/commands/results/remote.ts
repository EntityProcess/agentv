import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type ResultsConfig,
  type ResultsRepoStatus,
  type RunIndexEntry,
  directPushResults,
  directorySizeBytes,
  getResultsRepoCachePaths,
  getResultsRepoStatus,
  loadConfig,
  readRunIndex,
  resolveResultsRepoRunsDir,
  syncResultsRepo,
} from '@agentv/core';

import { RESULT_INDEX_FILENAME } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import {
  type ResultFileMeta,
  buildRunId,
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

function normalizeResultsConfig(config: ResultsConfig): Required<ResultsConfig> {
  return {
    repo: config.repo,
    path: config.path,
    auto_push: config.auto_push === true,
    branch_prefix: config.branch_prefix?.trim() || 'eval-results',
  };
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

/**
 * Reconstruct the filesystem manifest path from a run_id and the runs directory.
 * Inverse of buildRunId: "experiment::timestamp" → runsDir/experiment/timestamp/index.jsonl
 * Default experiment: "timestamp" → runsDir/default/timestamp/index.jsonl
 */
function runIdToManifestPath(runId: string, runsDir: string): string {
  const sepIdx = runId.indexOf('::');
  const relPath =
    sepIdx === -1
      ? path.join('default', runId)
      : path.join(runId.slice(0, sepIdx), runId.slice(sepIdx + 2));
  return path.join(runsDir, relPath, RESULT_INDEX_FILENAME);
}

/**
 * Read remote runs from the index file. Returns null if index doesn't exist (triggers fallback).
 */
function listRemoteRunsFromIndex(
  repoDir: string,
  config: Required<ResultsConfig>,
): SourcedResultFileMeta[] | null {
  const indexFile = path.join(repoDir, 'index', 'runs.jsonl');
  if (!existsSync(indexFile)) return null;

  const runsDir = resolveResultsRepoRunsDir(config);
  const entries = readRunIndex(indexFile);

  return entries.map((entry) => ({
    path: runIdToManifestPath(entry.run_id, runsDir),
    filename: encodeRemoteRunId(entry.run_id),
    raw_filename: entry.run_id,
    displayName: entry.run_id.includes('::')
      ? (entry.run_id.split('::').at(-1) ?? entry.run_id)
      : entry.run_id,
    timestamp: entry.timestamp,
    testCount: entry.test_count,
    passRate: entry.pass_rate,
    avgScore: entry.avg_score,
    sizeBytes: entry.size_bytes,
    source: 'remote' as const,
  }));
}

export async function getRemoteResultsStatus(cwd: string): Promise<RemoteResultsStatus> {
  const config = await loadNormalizedResultsConfig(cwd);
  const status = getResultsRepoStatus(config);
  const runCount =
    config && status.available
      ? listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).length
      : 0;
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

  const repoDir = getResultsRepoCachePaths(config.repo).repoDir;

  // Prefer index for O(1) listing; fall back to directory walk for repos without an index.
  const remoteRuns =
    listRemoteRunsFromIndex(repoDir, config) ??
    listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).map(
      (meta) =>
        ({
          ...meta,
          filename: encodeRemoteRunId(meta.filename),
          raw_filename: meta.filename,
          source: 'remote' as const,
        }) satisfies SourcedResultFileMeta,
    );

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

export async function maybeAutoExportRunArtifacts(payload: RemoteExportPayload): Promise<void> {
  const config = await loadNormalizedResultsConfig(payload.cwd);
  if (!config?.auto_push) {
    return;
  }

  try {
    await maybeWarnLargeArtifact(payload.run_dir);

    const relativeRunPath = getRelativeRunPath(payload.cwd, payload.run_dir);
    const commitTitle = buildCommitTitle(payload);
    const runId = buildRunId(relativeRunPath);
    const results = payload.results;
    const passed = results.filter((r) => r.score >= DEFAULT_THRESHOLD).length;
    const testCount = results.length;
    const avgScore = testCount > 0 ? results.reduce((sum, r) => sum + r.score, 0) / testCount : 0;
    const passRate = testCount > 0 ? passed / testCount : 0;
    const experiment = payload.experiment ?? 'default';
    const target = results[0]?.target ?? '';
    const sizeBytes = await directorySizeBytes(payload.run_dir);

    const indexEntry: Omit<RunIndexEntry, 'sha'> = {
      run_id: runId,
      timestamp: results[0]?.timestamp ?? new Date().toISOString(),
      experiment,
      target,
      test_count: testCount,
      passed,
      pass_rate: passRate,
      avg_score: avgScore,
      size_bytes: sizeBytes,
      tags: [],
    };

    const pushed = await directPushResults({
      config,
      sourceDir: payload.run_dir,
      destinationPath: relativeRunPath,
      commitMessage: commitTitle,
      indexEntry,
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
