import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvaluationResult,
  type ResultsExportConfig,
  type ResultsRepoStatus,
  commitAndPushResultsBranch,
  createDraftResultsPr,
  directorySizeBytes,
  getResultsRepoStatus,
  loadConfig,
  prepareResultsRepoBranch,
  resolveResultsRepoRunsDir,
  stageResultsArtifacts,
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

function normalizeResultsExportConfig(config: ResultsExportConfig): Required<ResultsExportConfig> {
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

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
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

function buildBranchName(
  config: Required<ResultsExportConfig>,
  payload: RemoteExportPayload,
): string {
  const timestamp = path.basename(payload.run_dir);
  const evalStem =
    payload.test_files.length === 1
      ? path
          .basename(payload.test_files[0])
          .replace(/\.eval\.ya?ml$/i, '')
          .replace(/\.[^.]+$/i, '')
      : `${payload.test_files.length}-evals`;
  const experiment = slugify(payload.experiment ?? 'default');
  const branchLeaf = slugify(`${experiment}-${evalStem}-${timestamp}`) || timestamp;
  return `${config.branch_prefix}/${branchLeaf}`;
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

function buildPrBody(payload: RemoteExportPayload): string {
  const sections = payload.eval_summaries
    .map((summary) => {
      const table = summary.results
        .map((result) => `| ${result.test_id} | ${result.score.toFixed(3)} | ${result.status} |`)
        .join('\n');
      return [
        `### ${summary.eval_file}`,
        '',
        `Summary: ${summary.passed}/${summary.total} PASS (${summary.avg_score.toFixed(3)})`,
        '',
        '| Test | Score | Status |',
        '|---|---|---|',
        table || '| (no results) | 0.000 | ERROR |',
      ].join('\n');
    })
    .join('\n\n');

  return [
    '## Results',
    '',
    sections,
    '',
    `Run: ${path.basename(payload.run_dir)}`,
    `Experiment: ${payload.experiment ?? 'default'}`,
    `Eval Files: ${payload.test_files.join(', ')}`,
  ].join('\n');
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
): Promise<Required<ResultsExportConfig> | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  if (!config?.results?.export) {
    return undefined;
  }
  return normalizeResultsExportConfig(config.results.export);
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

  const remoteRuns = listResultFilesFromRunsDir(resolveResultsRepoRunsDir(config)).map(
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

    const branchName = buildBranchName(config, payload);
    const prepared = await prepareResultsRepoBranch(config, branchName);

    try {
      const relativeRunPath = getRelativeRunPath(payload.cwd, payload.run_dir);
      const destinationDir = path.join(prepared.repoDir, config.path, relativeRunPath);
      await stageResultsArtifacts({
        repoDir: prepared.repoDir,
        sourceDir: payload.run_dir,
        destinationDir,
      });

      const commitTitle = buildCommitTitle(payload);
      const changed = await commitAndPushResultsBranch({
        repoDir: prepared.repoDir,
        branchName,
        commitMessage: commitTitle,
      });

      if (!changed) {
        console.warn('Warning: results export produced no git changes. Skipping PR creation.');
        return;
      }

      const prUrl = await createDraftResultsPr({
        repo: config.repo,
        repoDir: prepared.repoDir,
        baseBranch: prepared.baseBranch,
        branchName,
        title: commitTitle,
        body: buildPrBody(payload),
      });

      console.log(`Remote results draft PR created: ${prUrl}`);
    } finally {
      await prepared.cleanup();
    }
  } catch (error) {
    console.warn(`Warning: skipping results export: ${getStatusMessage(error)}`);
    console.warn("Warning: Run 'gh auth login' if GitHub authentication is missing.");
  }
}
