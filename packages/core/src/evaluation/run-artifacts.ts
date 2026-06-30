/**
 * Canonical AgentV run artifact helpers.
 *
 * This module owns the shared run-workspace contract used by CLI and
 * programmatic evals: `index.jsonl`, run-root `summary.json`, per-case
 * `summary.json`, `run-N/result.json`, and transcript projections. Keep wire
 * keys in snake_case here so every caller produces the same artifacts.
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  traceEnvelopeToNormalizedTranscriptJsonLines,
  traceEnvelopeToTranscriptJsonLines,
} from '../import/types.js';
import { parseEvaluationResultBoundary, toCamelCaseDeep } from './case-conversion.js';
import type { ExperimentArtifactMetadata } from './experiment.js';
import {
  type ExternalTraceMetadataWire,
  externalTraceMetadataForResult,
  omitExternalTraceMetadataKeys,
  toExternalTraceMetadataWire,
} from './external-trace.js';
import { DEFAULT_THRESHOLD } from './graders/scoring.js';
import { buildMetricsArtifact } from './metrics.js';
import {
  type ExportDuplicatePolicy,
  type ProjectionIdentity,
  type ProjectionIdentityIssueWire,
  type ProjectionIdentityWire,
  toProjectionIdentityIssueWire,
  toProjectionIdentityWire,
} from './projection-identity.js';
import type { Message } from './providers/types.js';
import { extractLastAssistantContent } from './providers/types.js';
import {
  CANONICAL_FILE_CHANGES_ARTIFACT_PATH,
  CANONICAL_METRICS_ARTIFACT_PATH,
  CANONICAL_TRANSCRIPT_ARTIFACT_PATH,
  type ResultArtifactPointersWire,
} from './result-artifact-contract.js';
import { normalizeResultRow } from './result-row-schema.js';
import {
  type TraceEnvelope,
  buildTraceEnvelopeFromEvaluationResult,
  traceEnvelopeToTranscriptMessages,
} from './trace-envelope.js';
import { type TokenUsage, type TraceSummary, buildTraceFromMessages } from './trace.js';
import type {
  EvalTest,
  EvaluationResult,
  GraderResult,
  TrialAggregation,
  TrialResult,
} from './types.js';

export const RESULT_INDEX_FILENAME = 'index.jsonl';
export const RUN_SUMMARY_FILENAME = 'summary.json';

const TIMING_SOURCE_VALUES = [
  'provider_reported',
  'token_estimated',
  'aggregate',
  'unavailable',
] as const;

type TimingSource = (typeof TIMING_SOURCE_VALUES)[number];

export type RunRuntimeSourceKind = 'direct_suite' | 'wrapper_eval' | 'multi_eval';

export type RunRuntimeConfigSource = 'defaults' | 'inline_experiment' | 'cli_flags' | 'mixed';

export type ExperimentNamespaceSource =
  | 'cli'
  | 'eval_metadata'
  | 'eval_filename'
  | 'multi_eval'
  | 'unknown';

export interface RunRuntimeSourceMetadata {
  readonly schema_version: 'agentv.runtime_source.v1';
  readonly kind: RunRuntimeSourceKind;
  readonly config_source: RunRuntimeConfigSource;
  readonly experiment_namespace: string;
  readonly experiment_namespace_source: ExperimentNamespaceSource;
  readonly eval_files: readonly string[];
  readonly wrapper_eval_file?: string;
  readonly source_eval_files?: readonly string[];
}

export function buildTestTargetKey(testId?: string, target?: string, variant?: string): string {
  return `${testId ?? 'unknown'}::${target ?? 'unknown'}::${variant ?? ''}`;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function resultProjectionDimensions(result: EvaluationResult): Record<string, unknown> | undefined {
  const projectionIdentity = (result as unknown as Record<string, unknown>).projectionIdentity;
  if (!isRecord(projectionIdentity)) {
    return undefined;
  }
  const dimensions = projectionIdentity.dimensions;
  return isRecord(dimensions) ? dimensions : undefined;
}

export function buildEvaluationResultTargetKey(result: EvaluationResult): string {
  const dimensions = resultProjectionDimensions(result);
  return JSON.stringify({
    eval_path:
      stringField(dimensions, 'evalPath') ??
      sourceEvalPath(result, undefined) ??
      stringField(result as unknown as Record<string, unknown>, 'evalPath') ??
      null,
    suite: stringField(dimensions, 'suite') ?? getSuite(result) ?? null,
    test_id: stringField(dimensions, 'testId') ?? result.testId ?? 'unknown',
    target: stringField(dimensions, 'target') ?? result.target ?? 'unknown',
    variant: stringField(dimensions, 'variant') ?? result.variant ?? null,
  });
}

export function buildEvalTestTargetKey(
  test: Pick<EvalTest, 'id' | 'suite' | 'source'>,
  target?: string,
  variant?: string,
): string {
  return JSON.stringify({
    eval_path: evalSourcePath(test.source) ?? null,
    suite: test.suite ?? null,
    test_id: test.id ?? 'unknown',
    target: target ?? 'unknown',
    variant: variant ?? null,
  });
}

export function deduplicateByTestIdTarget(
  results: readonly EvaluationResult[],
): EvaluationResult[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < results.length; i++) {
    seen.set(buildEvaluationResultTargetKey(results[i]), i);
  }
  const deduped: EvaluationResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const key = buildEvaluationResultTargetKey(results[i]);
    if (seen.get(key) === i) {
      deduped.push(results[i]);
    }
  }
  return deduped;
}

export async function aggregateRunDir(
  runDir: string,
  options?: {
    evalFile?: string;
    experiment?: string;
    runId?: string;
    plannedTestCount?: number;
    experimentMetadata?: ExperimentArtifactMetadata;
    runtimeSource?: RunRuntimeSourceMetadata;
  },
): Promise<{ summaryPath: string; testCount: number; targetCount: number }> {
  const indexPath =
    (await resolveExistingResultManifestPath(runDir)) ?? path.join(runDir, RESULT_INDEX_FILENAME);
  const content = await readFile(indexPath, 'utf8');
  const allResults = parseJsonlResults(content);
  const results = deduplicateByTestIdTarget(allResults);

  const previousMetadata = await readRunSummaryMetadata(path.join(runDir, RUN_SUMMARY_FILENAME));
  const plannedTestCount = options?.plannedTestCount ?? previousMetadata.plannedTestCount;
  const runtimeSource = options?.runtimeSource ?? previousMetadata.runtimeSource;

  const summary = buildRunSummaryArtifact(
    results,
    options?.evalFile,
    options?.experiment,
    options?.runId ?? path.basename(runDir),
    plannedTestCount,
    options?.experimentMetadata,
    runtimeSource,
  );
  const summaryPath = path.join(runDir, RUN_SUMMARY_FILENAME);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const targetSet = new Set(results.map((r) => r.target ?? 'unknown'));
  return { summaryPath, testCount: results.length, targetCount: targetSet.size };
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  return readFile(filePath, 'utf8').catch(() => undefined);
}

function safeSummaryManifestPath(runDir: string, manifestPath: unknown): string | undefined {
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    return undefined;
  }
  if (path.isAbsolute(manifestPath)) {
    return undefined;
  }
  const normalized = path.normalize(manifestPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return undefined;
  }
  return path.join(runDir, normalized);
}

async function readRunSummaryManifestPath(runDir: string): Promise<string | undefined> {
  const summaryText = await readTextIfExists(path.join(runDir, RUN_SUMMARY_FILENAME));
  if (!summaryText) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(summaryText) as { manifest_path?: unknown };
    const manifestPath = safeSummaryManifestPath(runDir, parsed.manifest_path);
    if (manifestPath && (await readTextIfExists(manifestPath)) !== undefined) {
      return manifestPath;
    }
  } catch {}
  return undefined;
}

async function resolveExistingResultManifestPath(runDir: string): Promise<string | undefined> {
  const summaryManifestPath = await readRunSummaryManifestPath(runDir);
  if (summaryManifestPath) {
    return summaryManifestPath;
  }

  const manifestPath = path.join(runDir, RESULT_INDEX_FILENAME);
  if ((await readTextIfExists(manifestPath)) !== undefined) {
    return manifestPath;
  }
  return undefined;
}

async function readRunSummaryMetadata(summaryPath: string): Promise<{
  plannedTestCount?: number;
  runtimeSource?: RunRuntimeSourceMetadata;
}> {
  try {
    const raw = await readFile(summaryPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      metadata?: {
        planned_test_count?: number;
        runtime_source?: RunRuntimeSourceMetadata;
      };
    };
    const value = parsed.metadata?.planned_test_count;
    const plannedTestCount =
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const runtimeSource = isRunRuntimeSourceMetadata(parsed.metadata?.runtime_source)
      ? parsed.metadata.runtime_source
      : undefined;
    return {
      ...(plannedTestCount !== undefined && { plannedTestCount }),
      ...(runtimeSource !== undefined && { runtimeSource }),
    };
  } catch {
    return {};
  }
}

function isRunRuntimeSourceMetadata(value: unknown): value is RunRuntimeSourceMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<RunRuntimeSourceMetadata>;
  return (
    candidate.schema_version === 'agentv.runtime_source.v1' &&
    (candidate.kind === 'direct_suite' ||
      candidate.kind === 'wrapper_eval' ||
      candidate.kind === 'multi_eval') &&
    (candidate.config_source === 'defaults' ||
      candidate.config_source === 'inline_experiment' ||
      candidate.config_source === 'cli_flags' ||
      candidate.config_source === 'mixed') &&
    typeof candidate.experiment_namespace === 'string' &&
    (candidate.experiment_namespace_source === 'cli' ||
      candidate.experiment_namespace_source === 'eval_metadata' ||
      candidate.experiment_namespace_source === 'eval_filename' ||
      candidate.experiment_namespace_source === 'multi_eval' ||
      candidate.experiment_namespace_source === 'unknown') &&
    Array.isArray(candidate.eval_files) &&
    candidate.eval_files.every((entry) => typeof entry === 'string')
  );
}

export interface GradingArtifact {
  readonly assertions: readonly {
    readonly text: string;
    readonly passed: boolean;
    readonly evidence: string;
  }[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly total: number;
    readonly pass_rate: number;
  };
  readonly graders?: readonly {
    readonly name: string;
    readonly type: string;
    readonly score: number;
    readonly reasoning: string;
    readonly [key: string]: unknown;
  }[];
  readonly workspace_changes?: {
    readonly files_modified: number;
    readonly files_created: number;
    readonly files_deleted: number;
    readonly deleted_file_paths?: readonly string[];
  };
  readonly conversation?: {
    readonly turns: number;
    readonly conversation_id: string;
  };
  readonly trials?: readonly TrialResultArtifact[];
  readonly aggregation?: TrialAggregationArtifact;
}

export type TrialResultArtifact = {
  readonly attempt: number;
  readonly run_path?: string;
  readonly score: number;
  readonly verdict: string;
  readonly scores?: IndexArtifactEntry['scores'];
  readonly error?: string;
  readonly cost_usd?: number;
  readonly execution_status?: string;
  readonly failure_stage?: string;
  readonly failure_reason_code?: string;
};

export type TrialAggregationArtifact =
  | {
      readonly strategy: 'pass_any';
      readonly passed_attempts: number;
      readonly total_attempts: number;
    }
  | {
      readonly strategy: 'pass_all';
      readonly passed_attempts: number;
      readonly total_attempts: number;
      readonly min: number;
    }
  | {
      readonly strategy: 'mean';
      readonly mean: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly strategy: 'confidence_interval';
      readonly mean: number;
      readonly ci95_lower: number;
      readonly ci95_upper: number;
      readonly stddev: number;
    };

export interface TimingArtifact {
  readonly total_tokens: number;
  readonly duration_ms: number;
  readonly total_duration_seconds: number;
  readonly mean_duration_ms?: number;
  readonly mean_duration_seconds?: number;
  readonly duration_stats?: {
    readonly count: number;
    readonly mean_ms: number;
    readonly mean_seconds: number;
    readonly stddev_ms: number;
    readonly stddev_seconds: number;
    readonly min_ms: number;
    readonly max_ms: number;
  };
  readonly cost_usd: number | null;
  readonly token_usage: {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
  };
  readonly usage_sources: {
    readonly token_usage: TimingSource;
    readonly total_tokens: TimingSource;
    readonly duration: TimingSource;
    readonly cost: TimingSource;
  };
}

export interface RunSummaryArtifact {
  readonly manifest_path: string;
  readonly metadata: {
    readonly run_id?: string;
    readonly eval_file: string;
    readonly timestamp: string;
    readonly targets: readonly string[];
    readonly variants?: readonly string[];
    readonly tests_run: readonly string[];
    readonly experiment?: string;
    readonly experiment_config?: ExperimentArtifactMetadata;
    readonly runtime_source?: RunRuntimeSourceMetadata;
    readonly planned_test_count?: number;
  };
  readonly run_summary: Record<
    string,
    {
      readonly pass_rate: { readonly mean: number; readonly stddev: number };
      readonly time_seconds: { readonly mean: number; readonly stddev: number };
      readonly tokens: { readonly mean: number; readonly stddev: number };
      readonly tool_calls?: { readonly mean: number; readonly stddev: number };
      readonly cost_usd?: { readonly mean: number; readonly stddev: number };
    }
  >;
  readonly per_grader_summary?: Record<string, { readonly mean: number; readonly stddev: number }>;
  readonly timing: TimingArtifact;
  readonly notes: readonly string[];
}

export interface AggregateGradingArtifact {
  readonly assertions: readonly {
    readonly test_id: string;
    readonly text: string;
    readonly passed: boolean;
    readonly evidence: string;
  }[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly total: number;
    readonly pass_rate: number;
  };
}

export interface IndexArtifactEntry {
  readonly timestamp: string;
  readonly test_id: string;
  readonly suite?: string;
  readonly category?: string;
  readonly conversation_id?: string;
  readonly experiment?: string;
  readonly score: number;
  readonly target: string;
  readonly variant?: string;
  readonly token_usage?: EvaluationResult['tokenUsage'];
  readonly cost_usd?: number;
  readonly duration_ms?: number;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly scores?: readonly Record<string, unknown>[];
  readonly trials?: readonly TrialResultArtifact[];
  readonly aggregation?: TrialAggregationArtifact;
  readonly execution_status?: string;
  readonly error?: string;
  readonly failure_stage?: string;
  readonly failure_reason_code?: string;
  readonly workspace_path?: string;
  readonly result_dir?: string;
  readonly grading_path?: string;
  readonly timing_path?: string;
  readonly summary_path?: string;
  readonly output_path?: string;
  readonly answer_path?: string;
  readonly transcript_path?: string;
  readonly transcript_raw_path?: string;
  readonly metrics_path?: string;
  readonly file_changes_path?: string;
  readonly artifact_pointers?: ResultArtifactPointersWire;
  readonly runtime_source?: RunRuntimeSourceMetadata;
  readonly raw_provider_log_path?: string;
  readonly input_path?: string;
  readonly test_dir?: string;
  readonly task_dir?: string;
  readonly eval_path?: string;
  readonly targets_path?: string;
  readonly files_path?: string;
  readonly graders_path?: string;
  readonly external_trace?: ExternalTraceMetadataWire;
  readonly projection_identity?: ProjectionIdentityWire;
  readonly export_metadata?: {
    readonly duplicate_policy: ExportDuplicatePolicy;
    readonly identity_warnings?: readonly ProjectionIdentityIssueWire[];
    readonly skipped?: boolean;
  };
  readonly metadata?: Record<string, unknown>;
}

export type ResultIndexArtifact = IndexArtifactEntry;

export type AdditionalResultIndexFields = Partial<
  Pick<
    IndexArtifactEntry,
    | 'test_dir'
    | 'task_dir'
    | 'eval_path'
    | 'targets_path'
    | 'files_path'
    | 'graders_path'
    | 'raw_provider_log_path'
  >
>;

export interface AdditionalResultArtifactsContext {
  readonly result: EvaluationResult;
  readonly outputDir: string;
  readonly testDir: string;
  readonly sourceTest?: EvalTest;
  readonly sourceTestsById: ReadonlyMap<string, EvalTest>;
}

export interface AgentVRunResultArtifact {
  readonly execution_status: EvaluationResult['executionStatus'];
  readonly verdict: TrialResult['verdict'];
  readonly duration_ms?: number;
  readonly duration_seconds: number;
  readonly model: string;
  readonly grading_path: string;
  readonly metrics_path: string;
  readonly file_changes_path?: string;
  readonly transcript_path?: string;
  readonly transcript_raw_path?: string;
  readonly o11y: {
    readonly total_turns: number;
    readonly tool_calls: Record<string, number>;
    readonly total_tool_calls: number;
    readonly web_fetches: readonly unknown[];
    readonly files_read: readonly string[];
    readonly files_modified: readonly string[];
    readonly files_deleted: readonly string[];
    readonly shell_commands: readonly unknown[];
    readonly errors: readonly unknown[];
    readonly thinking_blocks: number;
  };
  readonly output_paths?: {
    readonly answer?: string;
    readonly file_changes?: string;
    readonly scripts?: Record<string, string>;
  };
  readonly timing?: TimingArtifact;
}

export interface RepeatCaseSummaryArtifact {
  readonly total_runs: number;
  readonly passed_runs: number;
  readonly pass_rate: string;
  readonly mean_duration_ms: number;
  readonly mean_duration_seconds: number;
  readonly fingerprint: string;
  readonly total_tokens: number;
  readonly duration_ms: number;
  readonly total_duration_seconds: number;
  readonly duration_stats?: TimingArtifact['duration_stats'];
  readonly cost_usd: number | null;
  readonly token_usage: TimingArtifact['token_usage'];
  readonly usage_sources: TimingArtifact['usage_sources'];
}

export type AdditionalResultArtifactsWriter = (
  context: AdditionalResultArtifactsContext,
) => Promise<AdditionalResultIndexFields | undefined>;

function computeStats(values: readonly number[]): { mean: number; stddev: number } {
  if (values.length === 0) {
    return { mean: 0, stddev: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean: Math.round(mean * 1000) / 1000,
    stddev: Math.round(Math.sqrt(variance) * 1000) / 1000,
  };
}

function computePassRate(result: EvaluationResult): number {
  const scores = result.scores;
  if (scores && scores.length > 0) {
    const passed = scores.filter((s) => s.score >= DEFAULT_THRESHOLD).length;
    return passed / scores.length;
  }
  return (result.score ?? 0) >= DEFAULT_THRESHOLD ? 1.0 : 0.0;
}

function isExecutionError(result: EvaluationResult): boolean {
  return result.executionStatus === 'execution_error';
}

function countToolCalls(result: EvaluationResult): {
  toolCalls: Record<string, number>;
  total: number;
} {
  const toolCalls = { ...(result.trace?.toolCalls ?? {}) };
  const total = Object.values(toolCalls).reduce((sum, count) => sum + count, 0);
  return { toolCalls, total };
}

function parseWorkspaceChanges(
  fileChanges: string | undefined,
): GradingArtifact['workspace_changes'] | undefined {
  if (!fileChanges) {
    return undefined;
  }

  let filesModified = 0;
  let filesCreated = 0;
  const deletedFilePaths = new Set<string>();

  const lines = fileChanges.split('\n');
  for (let index = 0; index < lines.length - 1; index++) {
    const previousLine = lines[index];
    const nextLine = lines[index + 1];
    if (previousLine === '--- /dev/null' && nextLine.startsWith('+++ b/')) {
      filesCreated += 1;
    } else if (previousLine.startsWith('--- a/') && nextLine.startsWith('+++ b/')) {
      filesModified += 1;
    } else if (previousLine.startsWith('--- a/') && nextLine === '+++ /dev/null') {
      const filePath = previousLine.slice('--- a/'.length).trim();
      if (filePath) {
        deletedFilePaths.add(filePath);
      }
    }
  }

  return {
    files_modified: filesModified,
    files_created: filesCreated,
    files_deleted: deletedFilePaths.size,
    deleted_file_paths: deletedFilePaths.size > 0 ? [...deletedFilePaths] : undefined,
  };
}

function buildAssertions(result: EvaluationResult): GradingArtifact['assertions'] {
  if (!result.assertions) return [];
  return result.assertions.map((a) => ({
    text: a.text,
    passed: a.passed,
    evidence: a.evidence ?? '',
  }));
}

function buildEvaluators(scores: readonly GraderResult[] | undefined): GradingArtifact['graders'] {
  if (!scores || scores.length === 0) {
    return undefined;
  }

  return scores.map((s) => ({
    name: s.name,
    type: s.type,
    score: s.score,
    reasoning: '',
    weight: s.weight,
    verdict: s.verdict,
    assertions: s.assertions,
    details: s.details,
  }));
}

function toIndexAssertion(
  assertion: EvaluationResult['assertions'][number],
): Record<string, unknown> {
  return {
    text: assertion.text,
    passed: assertion.passed,
    evidence: assertion.evidence,
  };
}

function toIndexScore(score: GraderResult): Record<string, unknown> {
  return {
    name: score.name,
    type: score.type,
    score: score.score,
    weight: score.weight,
    verdict: score.verdict,
    assertions: (score.assertions ?? []).map(toIndexAssertion),
    raw_request: score.rawRequest,
    input: score.input,
    target: score.target,
    scores: score.scores?.map(toIndexScore),
    details: score.details,
    token_usage: score.tokenUsage,
    duration_ms: score.durationMs,
    started_at: score.startedAt,
    ended_at: score.endedAt,
  };
}

function toIndexScores(scores: readonly GraderResult[] | undefined): IndexArtifactEntry['scores'] {
  return scores?.map(toIndexScore) as IndexArtifactEntry['scores'];
}

function trialRunDirName(attempt: number): string {
  return `run-${attempt + 1}`;
}

function hasPersistedTrialRuns(result: EvaluationResult): boolean {
  return (result.trials ?? []).some((trial) => trial.result !== undefined);
}

function toTrialArtifacts(
  trials: readonly TrialResult[] | undefined,
): readonly TrialResultArtifact[] | undefined {
  if (!trials || trials.length === 0) {
    return undefined;
  }
  return trials.map((trial) => ({
    attempt: trial.attempt,
    run_path: trial.result ? trialRunDirName(trial.attempt) : undefined,
    score: trial.score,
    verdict: trial.verdict,
    scores: toIndexScores(trial.scores),
    error: trial.error,
    cost_usd: trial.costUsd,
    execution_status: trial.executionStatus,
    failure_stage: trial.failureStage,
    failure_reason_code: trial.failureReasonCode,
  }));
}

function toIndexTrialArtifacts(result: EvaluationResult): readonly TrialResultArtifact[] {
  return toTrialArtifacts(result.trials) ?? toTrialArtifacts([singleRunTrial(result)]) ?? [];
}

function toTrialAggregationArtifact(
  aggregation: TrialAggregation | undefined,
): TrialAggregationArtifact | undefined {
  if (!aggregation) {
    return undefined;
  }
  switch (aggregation.strategy) {
    case 'pass_any':
      return {
        strategy: aggregation.strategy,
        passed_attempts: aggregation.passedAttempts,
        total_attempts: aggregation.totalAttempts,
      };
    case 'pass_all':
      return {
        strategy: aggregation.strategy,
        passed_attempts: aggregation.passedAttempts,
        total_attempts: aggregation.totalAttempts,
        min: aggregation.min,
      };
    case 'mean':
      return {
        strategy: aggregation.strategy,
        mean: aggregation.mean,
        min: aggregation.min,
        max: aggregation.max,
      };
    case 'confidence_interval':
      return {
        strategy: aggregation.strategy,
        mean: aggregation.mean,
        ci95_lower: aggregation.ci95Lower,
        ci95_upper: aggregation.ci95Upper,
        stddev: aggregation.stddev,
      };
  }
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIndexRerunSource(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return dropUndefined({
    mode: value.mode,
    source_run_dir: value.sourceRunDir,
    source_index_path: value.sourceIndexPath,
    source_result_dir: value.sourceResultDir,
    source_test_dir: value.sourceTestDir ?? value.sourceTaskDir,
    source_test_id: value.sourceTestId,
    source_target: value.sourceTarget,
    source_timestamp: value.sourceTimestamp,
  });
}

function resultDurationSeconds(result: EvaluationResult): number {
  const durationMs =
    result.durationMs ?? result.trace?.durationMs ?? result.evalRun?.durationMs ?? 0;
  return Math.round((durationMs / 1000) * 1000) / 1000;
}

function resultDurationMs(result: EvaluationResult): number | undefined {
  const durationMs = result.durationMs ?? result.trace?.durationMs ?? result.evalRun?.durationMs;
  return typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : undefined;
}

function roundMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundSecondsFromMs(value: number): number {
  return Math.round((value / 1000) * 1000) / 1000;
}

function repeatAttemptResults(result: EvaluationResult): readonly EvaluationResult[] {
  const trialResults = (result.trials ?? [])
    .map((trial) => trial.result)
    .filter((trialResult): trialResult is EvaluationResult => trialResult !== undefined);
  return trialResults.length > 0 ? trialResults : [result];
}

function buildRepeatAggregateTimingArtifact(result: EvaluationResult): TimingArtifact {
  const attemptResults = repeatAttemptResults(result);
  const timing = buildTimingArtifact(attemptResults);
  const durationsMs = attemptResults
    .map(resultDurationMs)
    .filter((durationMs): durationMs is number => durationMs !== undefined);
  if (durationsMs.length === 0) {
    return timing;
  }

  const stats = computeStats(durationsMs);
  const minMs = Math.min(...durationsMs);
  const maxMs = Math.max(...durationsMs);
  return {
    ...timing,
    mean_duration_ms: stats.mean,
    mean_duration_seconds: roundSecondsFromMs(stats.mean),
    duration_stats: {
      count: durationsMs.length,
      mean_ms: stats.mean,
      mean_seconds: roundSecondsFromMs(stats.mean),
      stddev_ms: stats.stddev,
      stddev_seconds: roundSecondsFromMs(stats.stddev),
      min_ms: roundMillis(minMs),
      max_ms: roundMillis(maxMs),
    },
  };
}

function formatRepeatPassRate(passedRuns: number, totalRuns: number): string {
  if (totalRuns === 0) {
    return '0%';
  }
  const percent = Math.round((passedRuns / totalRuns) * 1000) / 10;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function fallbackRepeatFingerprint(result: EvaluationResult): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        test_id: result.testId ?? 'unknown',
        target: result.target ?? 'unknown',
        trial_count: result.trials?.length ?? 0,
        aggregation: result.aggregation,
      }),
    )
    .digest('hex');
}

function buildRepeatCaseSummaryArtifact(
  result: EvaluationResult,
  timing: TimingArtifact,
  fingerprint?: string,
): RepeatCaseSummaryArtifact {
  const trials = result.trials ?? [];
  const totalRuns = trials.length > 0 ? trials.length : 1;
  const passedRuns =
    trials.length > 0
      ? trials.filter((trial) => trial.verdict === 'pass').length
      : result.executionStatus !== 'execution_error' && result.score >= DEFAULT_THRESHOLD
        ? 1
        : 0;
  const fallbackMeanMs = totalRuns > 0 ? roundMillis(timing.duration_ms / totalRuns) : 0;
  const meanDurationMs = timing.mean_duration_ms ?? fallbackMeanMs;

  return {
    total_runs: totalRuns,
    passed_runs: passedRuns,
    pass_rate: formatRepeatPassRate(passedRuns, totalRuns),
    mean_duration_ms: meanDurationMs,
    mean_duration_seconds: timing.mean_duration_seconds ?? roundSecondsFromMs(meanDurationMs),
    fingerprint: fingerprint ?? fallbackRepeatFingerprint(result),
    total_tokens: timing.total_tokens,
    duration_ms: timing.duration_ms,
    total_duration_seconds: timing.total_duration_seconds,
    duration_stats: timing.duration_stats,
    cost_usd: timing.cost_usd,
    token_usage: timing.token_usage,
    usage_sources: timing.usage_sources,
  };
}

function toFilePathList(entries: readonly unknown[]): readonly string[] {
  return entries
    .map((entry) => (isRecord(entry) && typeof entry.path === 'string' ? entry.path : undefined))
    .filter((entry): entry is string => entry !== undefined);
}

function buildAgentVRunResultArtifact(params: {
  readonly trial: TrialResult;
  readonly result: EvaluationResult;
  readonly metricsArtifact: ReturnType<typeof buildMetricsArtifact> & {
    readonly timing?: TimingArtifact;
  };
  readonly hasTranscript: boolean;
  readonly hasOutput: boolean;
  readonly hasFileChanges: boolean;
}): AgentVRunResultArtifact {
  const metrics = params.metricsArtifact.metrics;
  const fileChangesPath = params.hasFileChanges
    ? `./${CANONICAL_FILE_CHANGES_ARTIFACT_PATH}`
    : undefined;
  return dropUndefined({
    execution_status: params.trial.executionStatus ?? params.result.executionStatus,
    verdict: params.trial.verdict,
    duration_ms: resultDurationMs(params.result),
    duration_seconds: resultDurationSeconds(params.result),
    model: params.result.target ?? 'unknown',
    grading_path: './grading.json',
    metrics_path: `./${CANONICAL_METRICS_ARTIFACT_PATH}`,
    file_changes_path: fileChangesPath,
    transcript_path: params.hasTranscript ? `./${CANONICAL_TRANSCRIPT_ARTIFACT_PATH}` : undefined,
    transcript_raw_path: params.hasTranscript ? './transcript-raw.jsonl' : undefined,
    o11y: {
      total_turns: metrics.total_turns,
      tool_calls: metrics.tool_calls,
      total_tool_calls: metrics.total_tool_calls,
      web_fetches: metrics.web_fetches,
      files_read: toFilePathList(metrics.files_read),
      files_modified: toFilePathList(metrics.files_modified),
      files_deleted: Array.isArray(metrics.files_deleted) ? metrics.files_deleted : [],
      shell_commands: metrics.shell_commands,
      errors: metrics.errors,
      thinking_blocks: metrics.thinking_blocks,
    },
    output_paths:
      params.hasOutput || params.hasFileChanges
        ? dropUndefined({
            answer: params.hasOutput ? './outputs/answer.md' : undefined,
            file_changes: fileChangesPath,
          })
        : undefined,
    timing: params.metricsArtifact.timing,
  }) as unknown as AgentVRunResultArtifact;
}

function singleRunTrial(result: EvaluationResult): TrialResult {
  return {
    attempt: 0,
    score: result.score,
    verdict:
      result.executionStatus !== 'execution_error' && result.score >= DEFAULT_THRESHOLD
        ? 'pass'
        : 'fail',
    scores: result.scores,
    error: result.error,
    costUsd: result.costUsd,
    executionStatus: result.executionStatus,
    failureStage: result.failureStage,
    failureReasonCode: result.failureReasonCode,
    result,
  };
}

function materializedRunTrials(result: EvaluationResult): readonly TrialResult[] {
  const persisted = (result.trials ?? []).filter((trial) => trial.result !== undefined);
  return persisted.length > 0 ? persisted : [singleRunTrial(result)];
}

async function writeTrialRunArtifacts(params: {
  readonly trial: TrialResult;
  readonly parentTestDir: string;
  readonly outputDir: string;
  readonly evalFile?: string;
  readonly experiment?: string;
  readonly runId?: string;
  readonly duplicatePolicy: ExportDuplicatePolicy;
  readonly testByTestId: Map<string, EvalTest>;
}): Promise<void> {
  const result = params.trial.result;
  if (!result) {
    return;
  }

  const runDirName = trialRunDirName(params.trial.attempt);
  const runDir = path.join(params.parentTestDir, runDirName);
  const grading = buildGradingArtifact(result, { includeTrials: false });
  const timing = buildTimingArtifact([result]);
  const gradingPath = path.join(runDir, 'grading.json');
  const timingPath = path.join(runDir, 'timing.json');
  const metricsPath = path.join(runDir, CANONICAL_METRICS_ARTIFACT_PATH);
  const outputsDir = path.join(runDir, 'outputs');
  const answerOutputPath =
    result.output.length > 0 ? path.join(outputsDir, 'answer.md') : undefined;
  const fileChangesPath = result.fileChanges
    ? path.join(runDir, CANONICAL_FILE_CHANGES_ARTIFACT_PATH)
    : undefined;
  const attemptRunId = params.runId
    ? `${params.runId}:${runDirName}`
    : `${result.testId}:${result.target}:${runDirName}`;
  const envelope = buildTraceEnvelopeSidecar({
    result,
    outputDir: params.outputDir,
    evalPath: resolveEnvelopeEvalPath(result, params.testByTestId, params.evalFile),
    experiment: params.experiment,
    runId: attemptRunId,
    duplicatePolicy: params.duplicatePolicy,
  });
  const hasTranscript = hasTranscriptProjection(result, envelope);
  const transcriptPath = hasTranscript
    ? path.join(runDir, CANONICAL_TRANSCRIPT_ARTIFACT_PATH)
    : undefined;
  const transcriptRawPath = hasTranscript ? path.join(runDir, 'transcript-raw.jsonl') : undefined;

  await mkdir(runDir, { recursive: true });
  await writeFile(gradingPath, `${JSON.stringify(grading, null, 2)}\n`, 'utf8');
  await writeFile(timingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

  await mkdir(outputsDir, { recursive: true });
  if (answerOutputPath) {
    await writeFile(answerOutputPath, result.output, 'utf8');
  }
  if (fileChangesPath && result.fileChanges) {
    await writeFile(fileChangesPath, result.fileChanges, 'utf8');
  }
  if (transcriptPath && transcriptRawPath) {
    await writeNormalizedTranscriptJsonl(transcriptPath, envelope);
    await writeRawTranscriptJsonl(transcriptRawPath, result, envelope);
  }
  const metricsArtifact = await writeMetricsArtifact({
    filePath: metricsPath,
    result,
    envelope,
    transcriptArtifactPath: transcriptPath ? CANONICAL_TRANSCRIPT_ARTIFACT_PATH : undefined,
    gradingArtifactPath: 'grading.json',
    timingArtifactPath: 'timing.json',
    fileChangesArtifactPath: fileChangesPath ? CANONICAL_FILE_CHANGES_ARTIFACT_PATH : undefined,
    timing,
  });

  await writeFile(
    path.join(runDir, 'result.json'),
    `${JSON.stringify(
      buildAgentVRunResultArtifact({
        trial: params.trial,
        result,
        metricsArtifact,
        hasTranscript,
        hasOutput: result.output.length > 0,
        hasFileChanges: result.fileChanges !== undefined && result.fileChanges.length > 0,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function toIndexPreparedAttempt(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return dropUndefined({
    source: value.source,
    manifest_path: value.manifestPath,
    prepared_dir: value.preparedDir,
    workspace_path: value.workspacePath,
    prompt_path: value.promptPath,
    trace_path: value.tracePath,
    target: value.target,
    prepared_at: value.preparedAt,
    setup_status: value.setupStatus,
    baseline_status: value.baselineStatus,
    baseline_commit: value.baselineCommit,
  });
}

function toIndexMetadata(
  metadata: EvaluationResult['metadata'] | undefined,
): IndexArtifactEntry['metadata'] {
  if (!metadata) {
    return undefined;
  }
  const safeMetadata = omitExternalTraceMetadataKeys(metadata);
  if (!safeMetadata) {
    return undefined;
  }
  const rerunSource = toIndexRerunSource(metadata.rerunSource);
  const preparedAttempt = toIndexPreparedAttempt(metadata.preparedAttempt);
  if (!rerunSource && !preparedAttempt) {
    return { ...safeMetadata };
  }
  const reservedKeys = new Set(['rerunSource', 'preparedAttempt']);
  return {
    ...Object.fromEntries(Object.entries(safeMetadata).filter(([key]) => !reservedKeys.has(key))),
    ...(rerunSource ? { rerun_source: rerunSource } : {}),
    ...(preparedAttempt ? { prepared_attempt: preparedAttempt } : {}),
  };
}

function toIndexExternalTrace(
  result: EvaluationResult,
  runId: string | undefined,
): ExternalTraceMetadataWire | undefined {
  const externalTrace = externalTraceMetadataForResult(result, { runId });
  return externalTrace ? toExternalTraceMetadataWire(externalTrace) : undefined;
}

function buildExportMetadata(
  duplicatePolicy: ExportDuplicatePolicy | undefined,
  projectionIdentity: ProjectionIdentity | undefined,
  options?: { skipped?: boolean },
): IndexArtifactEntry['export_metadata'] {
  if (!duplicatePolicy) {
    return undefined;
  }
  const warnings = projectionIdentity?.issues
    ?.filter((issue) => issue.severity === 'warning')
    .map(toProjectionIdentityIssueWire);
  return {
    duplicate_policy: duplicatePolicy,
    identity_warnings: warnings && warnings.length > 0 ? warnings : undefined,
    skipped: options?.skipped,
  };
}

export function buildGradingArtifact(
  result: EvaluationResult,
  options?: { includeTrials?: boolean },
): GradingArtifact {
  const assertions = buildAssertions(result);
  const passed = assertions.filter((e) => e.passed).length;
  const failed = assertions.filter((e) => !e.passed).length;
  const total = assertions.length;
  const includeTrials = options?.includeTrials ?? true;

  return {
    assertions,
    summary: {
      passed,
      failed,
      total,
      pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0,
    },
    graders: buildEvaluators(result.scores),
    workspace_changes: parseWorkspaceChanges(result.fileChanges),
    conversation: result.conversationId
      ? {
          turns:
            result.trace?.messages.filter((message) => message.role === 'assistant').length ?? 0,
          conversation_id: result.conversationId,
        }
      : undefined,
    trials: includeTrials ? toIndexTrialArtifacts(result) : undefined,
    aggregation: includeTrials ? toTrialAggregationArtifact(result.aggregation) : undefined,
  };
}

function timingMetadataSource(
  metadata: EvaluationResult['metadata'],
  sourceKey: 'token_usage' | 'total_tokens' | 'duration' | 'cost',
): TimingSource | undefined {
  const usageSources = metadata?.usage_sources;
  const usageSummary = metadata?.usage_summary;
  const legacyKey =
    sourceKey === 'duration'
      ? 'duration_source'
      : sourceKey === 'cost'
        ? 'cost_source'
        : 'token_usage_source';
  const value = isRecord(usageSources)
    ? usageSources[sourceKey]
    : isRecord(usageSummary)
      ? usageSummary[legacyKey]
      : metadata?.[legacyKey];
  return typeof value === 'string' && TIMING_SOURCE_VALUES.includes(value as TimingSource)
    ? (value as TimingSource)
    : undefined;
}

function sumMessageTokenUsage(messages: readonly Message[]): TokenUsage | undefined {
  let sawUsage = false;
  let input = 0;
  let output = 0;
  let reasoning = 0;

  for (const message of messages) {
    const usage = message.tokenUsage;
    if (!usage) {
      continue;
    }
    sawUsage = true;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    reasoning += usage.reasoning ?? 0;
  }

  return sawUsage ? { input, output, reasoning } : undefined;
}

function combineTimingSources(
  results: readonly EvaluationResult[],
  sources: readonly TimingSource[],
  hasValue: boolean,
): TimingSource {
  if (!hasValue) {
    return 'unavailable';
  }
  if (results.length > 1) {
    return 'aggregate';
  }
  return sources[0] ?? 'unavailable';
}

export function buildTimingArtifact(results: readonly EvaluationResult[]): TimingArtifact {
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalDurationMs = 0;
  let totalCostUsd = 0;
  let hasTokenUsage = false;
  let hasDuration = false;
  let hasCost = false;
  const tokenUsageSources: TimingSource[] = [];
  const durationSources: TimingSource[] = [];
  const costSources: TimingSource[] = [];

  for (const result of results) {
    const providerUsage = result.tokenUsage ?? result.trace?.tokenUsage;
    const aggregateUsage = providerUsage ? undefined : sumMessageTokenUsage(result.trace.messages);
    const usage = providerUsage ?? aggregateUsage;
    if (usage) {
      hasTokenUsage = true;
      totalInput += usage.input ?? 0;
      totalOutput += usage.output ?? 0;
      totalReasoning += usage.reasoning ?? 0;
      tokenUsageSources.push(
        timingMetadataSource(result.metadata, 'token_usage') ??
          (providerUsage ? 'provider_reported' : 'aggregate'),
      );
    }
    const durationMs = result.durationMs ?? result.trace?.durationMs ?? result.evalRun?.durationMs;
    if (durationMs != null) {
      hasDuration = true;
      totalDurationMs += durationMs;
      durationSources.push(
        timingMetadataSource(result.metadata, 'duration') ??
          (result.durationMs != null || result.trace?.durationMs != null
            ? 'provider_reported'
            : 'aggregate'),
      );
    }
    const costUsd = result.costUsd ?? result.trace?.costUsd;
    if (costUsd != null) {
      hasCost = true;
      totalCostUsd += costUsd;
      costSources.push(
        timingMetadataSource(result.metadata, 'cost') ??
          (result.costUsd != null || result.trace?.costUsd != null
            ? 'provider_reported'
            : 'unavailable'),
      );
    }
  }
  const tokenUsageSource = combineTimingSources(results, tokenUsageSources, hasTokenUsage);
  const durationSource = combineTimingSources(results, durationSources, hasDuration);
  const costSource = combineTimingSources(results, costSources, hasCost);

  return {
    total_tokens: totalInput + totalOutput,
    duration_ms: totalDurationMs,
    total_duration_seconds: Math.round((totalDurationMs / 1000) * 1000) / 1000,
    cost_usd: hasCost ? totalCostUsd : null,
    token_usage: {
      input: totalInput,
      output: totalOutput,
      reasoning: totalReasoning,
    },
    usage_sources: {
      token_usage: tokenUsageSource,
      total_tokens: tokenUsageSource,
      duration: durationSource,
      cost: costSource,
    },
  };
}

export function buildRunSummaryArtifact(
  results: readonly EvaluationResult[],
  evalFile = '',
  experiment?: string,
  runId?: string,
  plannedTestCount?: number,
  experimentMetadata?: ExperimentArtifactMetadata,
  runtimeSource?: RunRuntimeSourceMetadata,
): RunSummaryArtifact {
  const targetSet = new Set<string>();
  const variantSet = new Set<string>();
  const testIdSet = new Set<string>();
  for (const result of results) {
    targetSet.add(result.target ?? 'unknown');
    if (result.variant) {
      variantSet.add(result.variant);
    }
    testIdSet.add(result.testId ?? 'unknown');
  }

  const targets = [...targetSet].sort();
  const variants = [...variantSet].sort();
  const testIds = [...testIdSet].sort();

  const runSummary: RunSummaryArtifact['run_summary'] = {};
  const notes: string[] = [];

  for (const target of targets) {
    const targetResults = results.filter((r) => r.target === target);
    const qualityResults = targetResults.filter((r) => !isExecutionError(r));

    const passRates = qualityResults.map(computePassRate);
    const timings = targetResults
      .filter((r) => r.durationMs != null)
      .map((r) => (r.durationMs as number) / 1000);
    const tokens = targetResults
      .filter((r) => r.tokenUsage != null)
      .map((r) => {
        const usage = r.tokenUsage as { input?: number; output?: number };
        return (usage.input ?? 0) + (usage.output ?? 0);
      });

    const entry: Record<string, unknown> = {
      pass_rate: computeStats(passRates),
      time_seconds: computeStats(timings),
      tokens: computeStats(tokens),
    };

    const toolCallCounts = targetResults.map((r) => countToolCalls(r).total);
    if (toolCallCounts.some((count) => count > 0)) {
      entry.tool_calls = computeStats(toolCallCounts);
    }

    const costs = targetResults.filter((r) => r.costUsd != null).map((r) => r.costUsd as number);
    if (costs.length > 0) {
      entry.cost_usd = computeStats(costs);
    }

    runSummary[target] = entry as (typeof runSummary)[string];
  }

  const evaluatorScores = new Map<string, number[]>();
  for (const result of results) {
    if (isExecutionError(result)) {
      continue;
    }
    for (const score of result.scores ?? []) {
      const key = `${score.name}:${score.type}`;
      if (!evaluatorScores.has(key)) {
        evaluatorScores.set(key, []);
      }
      evaluatorScores.get(key)?.push(score.score);
    }
  }

  let perEvaluatorSummary: Record<string, { mean: number; stddev: number }> | undefined;
  if (evaluatorScores.size > 0) {
    perEvaluatorSummary = {};
    for (const [key, scores] of evaluatorScores) {
      perEvaluatorSummary[key] = computeStats(scores);
    }
  }

  const errorCount = results.filter((r) => r.executionStatus === 'execution_error').length;
  if (errorCount > 0) {
    notes.push(
      `${errorCount} test(s) had execution errors and are excluded from quality pass_rate`,
    );
  }
  if (results.length === 0) {
    notes.push('No results to summarize');
  }

  const firstResult = results[0];
  const timestamp = firstResult?.timestamp ?? new Date().toISOString();

  return {
    manifest_path: RESULT_INDEX_FILENAME,
    metadata: {
      run_id: runId,
      eval_file: evalFile,
      timestamp,
      targets,
      variants: variants.length > 0 ? variants : undefined,
      tests_run: testIds,
      experiment,
      experiment_config: experimentMetadata,
      runtime_source: runtimeSource,
      planned_test_count: plannedTestCount,
    },
    run_summary: runSummary,
    per_grader_summary: perEvaluatorSummary,
    timing: buildTimingArtifact(results),
    notes,
  };
}

export async function writeInitialRunSummaryArtifact(
  runDir: string,
  options: {
    evalFile: string;
    plannedTestCount: number;
    experiment?: string;
    runId?: string;
    experimentMetadata?: ExperimentArtifactMetadata;
    runtimeSource?: RunRuntimeSourceMetadata;
  },
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const stub = buildRunSummaryArtifact(
    [],
    options.evalFile,
    options.experiment,
    options.runId ?? path.basename(runDir),
    options.plannedTestCount,
    options.experimentMetadata,
    options.runtimeSource,
  );
  const summaryPath = path.join(runDir, RUN_SUMMARY_FILENAME);
  await writeFile(summaryPath, `${JSON.stringify(stub, null, 2)}\n`, 'utf8');
}

export function buildAggregateGradingArtifact(
  results: readonly EvaluationResult[],
): AggregateGradingArtifact {
  const assertions: AggregateGradingArtifact['assertions'][number][] = [];

  for (const result of results.filter((r) => !isExecutionError(r))) {
    const testId = result.testId ?? 'unknown';
    for (const assertion of result.assertions ?? []) {
      assertions.push({
        test_id: testId,
        text: assertion.text,
        passed: assertion.passed,
        evidence: assertion.evidence ?? '',
      });
    }
  }

  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  const total = assertions.length;

  return {
    assertions,
    summary: {
      passed,
      failed,
      total,
      pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0,
    },
  };
}

function safeArtifactPathSegment(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[/\\:*?"<>|]/g, '_');
}

function safeTestId(testId: string | undefined): string {
  return safeArtifactPathSegment(testId, 'unknown');
}

const ROW_ID_PREFIX_MAX_LENGTH = 64;
const ROW_ID_HASH_LENGTH = 12;

function getSuite(result: EvaluationResult): string | undefined {
  return result.suite;
}

function evalSourcePath(source: EvalTest['source'] | undefined): string | undefined {
  return source?.evalFileRepoPath ?? source?.evalFilePath;
}

function sourceEvalPath(
  result: EvaluationResult,
  sourceTest: EvalTest | undefined,
): string | undefined {
  return evalSourcePath(result.source) ?? evalSourcePath(sourceTest?.source);
}

function compactRowIdPrefix(testId: string | undefined): string {
  const safe = safeTestId(testId);
  return safe.length > ROW_ID_PREFIX_MAX_LENGTH ? safe.slice(0, ROW_ID_PREFIX_MAX_LENGTH) : safe;
}

function buildRowArtifactHashInput(
  result: EvaluationResult,
  sourceTest?: EvalTest,
  projectionIdentity?: ProjectionIdentity,
): {
  readonly eval_path: string | null;
  readonly suite: string | null;
  readonly test_id: string;
  readonly target: string;
  readonly variant: string | null;
} {
  const dimensions = projectionIdentity?.dimensions;
  return {
    eval_path: dimensions?.evalPath ?? sourceEvalPath(result, sourceTest) ?? null,
    suite: dimensions?.suite ?? getSuite(result) ?? null,
    test_id: dimensions?.testId ?? result.testId ?? 'unknown',
    target: dimensions?.target ?? result.target ?? 'unknown',
    variant: dimensions?.variant ?? result.variant ?? null,
  };
}

function buildArtifactSubdir(
  result: EvaluationResult,
  _resultGroup?: string,
  sourceTest?: EvalTest,
  projectionIdentity?: ProjectionIdentity,
): string {
  const hashInput = buildRowArtifactHashInput(result, sourceTest, projectionIdentity);
  const digest = createHash('sha256')
    .update(JSON.stringify(hashInput))
    .digest('hex')
    .slice(0, ROW_ID_HASH_LENGTH);
  return `${compactRowIdPrefix(hashInput.test_id)}--${digest}`;
}

function toRelativeArtifactPath(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join('/');
}

function findResultSourceTest(
  result: EvaluationResult,
  testByTestId: ReadonlyMap<string, EvalTest>,
): EvalTest | undefined {
  const testId = result.testId ?? 'unknown';
  const resultSourcePath = evalSourcePath(result.source);
  if (resultSourcePath) {
    const sourceMatch = testByTestId.get(sourceTestLookupKey(`source:${resultSourcePath}`, testId));
    if (sourceMatch) {
      return sourceMatch;
    }
  }
  const suite = getSuite(result);
  if (suite) {
    const suiteMatch = testByTestId.get(sourceTestLookupKey(suite, testId));
    if (suiteMatch) {
      return suiteMatch;
    }
  }
  return testByTestId.get(testId);
}

function sourceTestLookupKey(suite: string, testId: string): string {
  return `${suite}\u0000${testId}`;
}

function buildSourceTestLookup(
  sourceTests: readonly EvalTest[] | undefined,
): Map<string, EvalTest> {
  const tests = sourceTests ?? [];
  const lookup = new Map<string, EvalTest>();
  for (const test of tests) {
    if (test.suite) {
      lookup.set(sourceTestLookupKey(test.suite, test.id), test);
    }
    const sourcePath = evalSourcePath(test.source);
    if (sourcePath) {
      lookup.set(sourceTestLookupKey(`source:${sourcePath}`, test.id), test);
    }
    if (!lookup.has(test.id)) {
      lookup.set(test.id, test);
    }
  }
  return lookup;
}

function resolveEnvelopeEvalPath(
  result: EvaluationResult,
  testByTestId: ReadonlyMap<string, EvalTest>,
  fallbackEvalFile?: string,
): string | undefined {
  const source = findResultSourceTest(result, testByTestId)?.source;
  return source?.evalFileRepoPath ?? source?.evalFilePath ?? fallbackEvalFile;
}

function resultHasExecutionTraceTranscript(result: EvaluationResult): boolean {
  return result.output.length > 0 || result.trace.messages.length > 0;
}

function rawProviderLogSourcePath(result: EvaluationResult): string | undefined {
  const sourcePath = result.rawProviderLogPath?.trim();
  return sourcePath ? sourcePath : undefined;
}

function providerStagingRoot(): string {
  return path.resolve(tmpdir(), 'agentv-provider-streams');
}

function isAgentvProviderStagingPath(filePath: string): boolean {
  const root = providerStagingRoot();
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${root}${path.sep}`);
}

async function cleanupProviderStagingFile(filePath: string): Promise<void> {
  if (!isAgentvProviderStagingPath(filePath)) {
    return;
  }

  await rm(filePath, { force: true });

  const root = providerStagingRoot();
  let current = path.dirname(path.resolve(filePath));
  while (current !== root && current.startsWith(`${root}${path.sep}`)) {
    try {
      await rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

interface TraceEnvelopeSidecarParams {
  readonly result: EvaluationResult;
  readonly outputDir: string;
  readonly evalPath?: string;
  readonly experiment?: string;
  readonly runId?: string;
  readonly duplicatePolicy?: ExportDuplicatePolicy;
}

function buildTraceEnvelopeSidecar(params: TraceEnvelopeSidecarParams): TraceEnvelope {
  const hasTranscript = resultHasExecutionTraceTranscript(params.result);
  return buildTraceEnvelopeFromEvaluationResult(params.result, {
    evalPath: params.evalPath,
    runId: params.runId ?? path.basename(params.outputDir),
    experiment: params.experiment,
    variant: params.result.variant,
    source: { path: RESULT_INDEX_FILENAME },
    capture: { content: 'full', redactionLevel: 'none', redactedFields: [] },
    artifacts: {
      answer_path: params.result.output.length > 0 ? 'outputs/answer.md' : undefined,
      transcript_path: hasTranscript ? CANONICAL_TRANSCRIPT_ARTIFACT_PATH : undefined,
      metrics_path: CANONICAL_METRICS_ARTIFACT_PATH,
      file_changes_path: params.result.fileChanges
        ? CANONICAL_FILE_CHANGES_ARTIFACT_PATH
        : undefined,
    },
    duplicatePolicy: params.duplicatePolicy,
  });
}

export function buildIndexArtifactEntry(
  result: EvaluationResult,
  options: {
    outputDir: string;
    resultDir?: string;
    gradingPath?: string;
    timingPath?: string;
    summaryPath?: string;
    outputPath?: string;
    answerPath?: string;
    transcriptPath?: string;
    transcriptRawPath?: string;
    metricsPath?: string;
    fileChangesPath?: string;
    artifactPointers?: ResultArtifactPointersWire;
    rawProviderLogPath?: string;
    extraIndexFields?: AdditionalResultIndexFields;
    runtimeSource?: RunRuntimeSourceMetadata;
    projectionIdentity?: ProjectionIdentity;
    duplicatePolicy?: ExportDuplicatePolicy;
  },
): IndexArtifactEntry {
  return {
    timestamp: result.timestamp,
    test_id: result.testId ?? 'unknown',
    suite: getSuite(result),
    category: result.category,
    conversation_id: result.conversationId,
    score: result.score,
    target: result.target ?? 'unknown',
    variant: result.variant,
    token_usage: result.tokenUsage,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    start_time: result.startTime,
    end_time: result.endTime,
    scores: toIndexScores(result.scores),
    trials: toIndexTrialArtifacts(result),
    aggregation: toTrialAggregationArtifact(result.aggregation),
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    result_dir: options.resultDir
      ? toRelativeArtifactPath(options.outputDir, options.resultDir)
      : undefined,
    grading_path: options.gradingPath
      ? toRelativeArtifactPath(options.outputDir, options.gradingPath)
      : undefined,
    timing_path: options.timingPath
      ? toRelativeArtifactPath(options.outputDir, options.timingPath)
      : undefined,
    summary_path: options.summaryPath
      ? toRelativeArtifactPath(options.outputDir, options.summaryPath)
      : undefined,
    output_path: options.outputPath
      ? toRelativeArtifactPath(options.outputDir, options.outputPath)
      : undefined,
    answer_path: options.answerPath
      ? toRelativeArtifactPath(options.outputDir, options.answerPath)
      : undefined,
    transcript_path: options.transcriptPath
      ? toRelativeArtifactPath(options.outputDir, options.transcriptPath)
      : undefined,
    transcript_raw_path: options.transcriptRawPath
      ? toRelativeArtifactPath(options.outputDir, options.transcriptRawPath)
      : undefined,
    metrics_path: options.metricsPath
      ? toRelativeArtifactPath(options.outputDir, options.metricsPath)
      : undefined,
    file_changes_path: options.fileChangesPath
      ? toRelativeArtifactPath(options.outputDir, options.fileChangesPath)
      : undefined,
    raw_provider_log_path: options.rawProviderLogPath
      ? toRelativeArtifactPath(options.outputDir, options.rawProviderLogPath)
      : undefined,
    artifact_pointers: options.artifactPointers,
    runtime_source: options.runtimeSource,
    ...options.extraIndexFields,
    external_trace: toIndexExternalTrace(result, options.projectionIdentity?.dimensions.runId),
    projection_identity: options.projectionIdentity
      ? toProjectionIdentityWire(options.projectionIdentity)
      : undefined,
    export_metadata: buildExportMetadata(options.duplicatePolicy, options.projectionIdentity),
    metadata: toIndexMetadata(result.metadata),
  };
}

export function buildResultIndexArtifact(
  result: EvaluationResult,
  extraIndexFields?: AdditionalResultIndexFields,
  options?: {
    projectionIdentity?: ProjectionIdentity;
    duplicatePolicy?: ExportDuplicatePolicy;
    artifactPointers?: ResultArtifactPointersWire;
    runtimeSource?: RunRuntimeSourceMetadata;
  },
): ResultIndexArtifact {
  const artifactSubdir = buildArtifactSubdir(
    result,
    undefined,
    undefined,
    options?.projectionIdentity,
  );
  const hasAnswer = result.output.length > 0;
  const hasFileChanges = result.fileChanges !== undefined && result.fileChanges.length > 0;
  const hasTranscript = resultHasExecutionTraceTranscript(result);
  const isSingleRun = !hasPersistedTrialRuns(result);
  const singleRunDir = path.posix.join(artifactSubdir, trialRunDirName(0));

  return {
    timestamp: result.timestamp,
    test_id: result.testId ?? 'unknown',
    suite: getSuite(result),
    category: result.category,
    conversation_id: result.conversationId,
    score: result.score,
    target: result.target ?? 'unknown',
    variant: result.variant,
    token_usage: result.tokenUsage,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    start_time: result.startTime,
    end_time: result.endTime,
    scores: toIndexScores(result.scores),
    trials: toIndexTrialArtifacts(result),
    aggregation: toTrialAggregationArtifact(result.aggregation),
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    result_dir: artifactSubdir,
    summary_path: path.posix.join(artifactSubdir, RUN_SUMMARY_FILENAME),
    grading_path: isSingleRun ? path.posix.join(singleRunDir, 'grading.json') : undefined,
    timing_path: isSingleRun ? path.posix.join(singleRunDir, 'timing.json') : undefined,
    metrics_path: isSingleRun
      ? path.posix.join(singleRunDir, CANONICAL_METRICS_ARTIFACT_PATH)
      : undefined,
    output_path:
      isSingleRun && hasAnswer ? path.posix.join(singleRunDir, 'outputs', 'answer.md') : undefined,
    answer_path:
      isSingleRun && hasAnswer ? path.posix.join(singleRunDir, 'outputs', 'answer.md') : undefined,
    file_changes_path:
      isSingleRun && hasFileChanges
        ? path.posix.join(singleRunDir, CANONICAL_FILE_CHANGES_ARTIFACT_PATH)
        : undefined,
    transcript_path:
      isSingleRun && hasTranscript
        ? path.posix.join(singleRunDir, CANONICAL_TRANSCRIPT_ARTIFACT_PATH)
        : undefined,
    transcript_raw_path:
      isSingleRun && hasTranscript
        ? path.posix.join(singleRunDir, 'transcript-raw.jsonl')
        : undefined,
    artifact_pointers: options?.artifactPointers,
    runtime_source: options?.runtimeSource,
    ...extraIndexFields,
    external_trace: toIndexExternalTrace(result, options?.projectionIdentity?.dimensions.runId),
    projection_identity: options?.projectionIdentity
      ? toProjectionIdentityWire(options.projectionIdentity)
      : undefined,
    export_metadata: buildExportMetadata(options?.duplicatePolicy, options?.projectionIdentity),
    metadata: toIndexMetadata(result.metadata),
  };
}

async function writeJsonlFile(filePath: string, records: readonly unknown[]): Promise<void> {
  const content =
    records.length === 0 ? '' : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await writeFile(filePath, content, 'utf8');
}

function hasTranscriptProjection(result: EvaluationResult, envelope: TraceEnvelope): boolean {
  return result.output.length > 0 || traceEnvelopeToTranscriptMessages(envelope).length > 0;
}

async function writeNormalizedTranscriptJsonl(
  filePath: string,
  envelope: TraceEnvelope,
): Promise<void> {
  const lines = traceEnvelopeToNormalizedTranscriptJsonLines(envelope);
  const content =
    lines.length > 0 ? `${lines.map((line) => JSON.stringify(line)).join('\n')}\n` : '';
  await writeFile(filePath, content, 'utf8');
}

async function writeGeneratedRawTranscriptJsonl(
  filePath: string,
  result: EvaluationResult,
  envelope: TraceEnvelope,
): Promise<void> {
  const lines = traceEnvelopeToTranscriptJsonLines(envelope, {
    testId: result.testId,
    target: result.target,
  });
  const content =
    lines.length > 0 ? `${lines.map((line) => JSON.stringify(line)).join('\n')}\n` : '';
  await writeFile(filePath, content, 'utf8');
}

async function writeRawTranscriptJsonl(
  filePath: string,
  result: EvaluationResult,
  envelope: TraceEnvelope,
): Promise<void> {
  const rawSource = rawProviderLogSourcePath(result);
  if (rawSource) {
    await copyFile(rawSource, filePath);
    await cleanupProviderStagingFile(rawSource).catch(() => undefined);
    return;
  }
  await writeGeneratedRawTranscriptJsonl(filePath, result, envelope);
}

function buildMetricsArtifactPayload(params: {
  readonly result: EvaluationResult;
  readonly envelope: TraceEnvelope;
  readonly transcriptPath?: string;
  readonly transcriptArtifactPath?: string;
  readonly gradingArtifactPath?: string;
  readonly timingArtifactPath?: string | null;
  readonly fileChangesArtifactPath?: string;
  readonly timing?: TimingArtifact;
}): ReturnType<typeof buildMetricsArtifact> & { readonly timing?: TimingArtifact } {
  const artifact = buildMetricsArtifact(params.result, params.envelope, {
    transcriptPath:
      params.transcriptArtifactPath ??
      (params.transcriptPath ? CANONICAL_TRANSCRIPT_ARTIFACT_PATH : undefined),
    gradingPath: params.gradingArtifactPath ?? 'grading.json',
    timingPath:
      params.timingArtifactPath === null ? undefined : (params.timingArtifactPath ?? 'timing.json'),
    fileChangesPath: params.fileChangesArtifactPath,
  });
  return params.timing ? { ...artifact, timing: params.timing } : artifact;
}

async function writeMetricsArtifact(params: {
  readonly filePath: string;
  readonly result: EvaluationResult;
  readonly envelope: TraceEnvelope;
  readonly transcriptPath?: string;
  readonly transcriptArtifactPath?: string;
  readonly gradingArtifactPath?: string;
  readonly timingArtifactPath?: string | null;
  readonly fileChangesArtifactPath?: string;
  readonly timing?: TimingArtifact;
}): Promise<ReturnType<typeof buildMetricsArtifact> & { readonly timing?: TimingArtifact }> {
  const artifactWithTiming = buildMetricsArtifactPayload(params);
  await writeFile(params.filePath, `${JSON.stringify(artifactWithTiming, null, 2)}\n`, 'utf8');
  return artifactWithTiming;
}

function indexRecordKey(record: unknown): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  const testId =
    typeof record.test_id === 'string'
      ? record.test_id
      : typeof record.testId === 'string'
        ? record.testId
        : undefined;
  const target = typeof record.target === 'string' ? record.target : undefined;
  const variant = typeof record.variant === 'string' ? record.variant : undefined;
  return testId ? buildTestTargetKey(testId, target, variant) : undefined;
}

function indexRecordReplacementKey(record: unknown): string | undefined {
  return projectionIdentityRecordKey(record) ?? indexRecordKey(record);
}

function projectionIdentityRecordKey(record: unknown): string | undefined {
  if (!isRecord(record) || !isRecord(record.projection_identity)) {
    return undefined;
  }
  const id = record.projection_identity.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

async function readExistingIndexRecords(outputDir: string): Promise<readonly unknown[]> {
  const indexPath = await resolveExistingResultManifestPath(outputDir);
  if (!indexPath) {
    return [];
  }
  const content = await readTextIfExists(indexPath);
  if (content === undefined) {
    return [];
  }

  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {}
  }
  return records;
}

function existingRecordsByProjectionIdentity(
  records: readonly unknown[],
): ReadonlyMap<string, unknown> {
  const byIdentity = new Map<string, unknown>();
  for (const record of records) {
    const key = projectionIdentityRecordKey(record);
    if (key) {
      byIdentity.set(key, record);
    }
  }
  return byIdentity;
}

function skippedExistingRecord(
  record: unknown,
  identity: ProjectionIdentity,
  duplicatePolicy: ExportDuplicatePolicy,
): unknown {
  if (!isRecord(record)) {
    return record;
  }
  return {
    ...record,
    projection_identity: toProjectionIdentityWire(identity),
    export_metadata: buildExportMetadata(duplicatePolicy, identity, { skipped: true }),
  };
}

function duplicateProjectionMessage(identity: ProjectionIdentity): string {
  const dimensions = identity.dimensions;
  return [
    `Duplicate export projection ${identity.id}`,
    `test_id=${dimensions.testId}`,
    `target=${dimensions.target}`,
    `source_target=${dimensions.sourceTarget}`,
    `attempt=${dimensions.attempt}`,
    `variant=${dimensions.variant ?? '<none>'}`,
    `run_id=${dimensions.runId}`,
  ].join(' ');
}

async function rewriteExistingIndexRecords(
  outputDir: string,
  replacements: readonly ResultIndexArtifact[],
): Promise<void> {
  if (replacements.length === 0) {
    return;
  }

  const indexPath = await resolveExistingResultManifestPath(outputDir);
  if (!indexPath) {
    return;
  }
  const content = indexPath ? await readTextIfExists(indexPath) : undefined;
  if (content === undefined) {
    return;
  }

  const replacementsByKey = new Map(
    replacements.flatMap((record) => {
      const key = indexRecordReplacementKey(record);
      return key ? [[key, record] as const] : [];
    }),
  );
  const seen = new Set<string>();
  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const key = indexRecordReplacementKey(parsed);
      const replacement = key ? replacementsByKey.get(key) : undefined;
      if (key && replacement) {
        records.push(replacement);
        seen.add(key);
      } else {
        records.push(parsed);
      }
    } catch {}
  }

  for (const replacement of replacements) {
    const key = indexRecordReplacementKey(replacement);
    if (!key || !seen.has(key)) {
      records.push(replacement);
    }
  }

  await writeJsonlFile(indexPath, records);
}

type ParsedEvaluationResult = Record<string, unknown> & {
  timestamp: string;
  testId: string;
  score: number;
  assertions: EvaluationResult['assertions'];
  target: string;
  output: EvaluationResult['output'];
  trace: EvaluationResult['trace'];
  executionStatus: EvaluationResult['executionStatus'];
};

const EXECUTION_STATUSES = new Set<EvaluationResult['executionStatus']>([
  'ok',
  'quality_failure',
  'execution_error',
]);

function isAssertionEntry(value: unknown): value is EvaluationResult['assertions'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { text?: unknown; passed?: unknown; evidence?: unknown };
  return (
    typeof candidate.text === 'string' &&
    typeof candidate.passed === 'boolean' &&
    (candidate.evidence === undefined || typeof candidate.evidence === 'string')
  );
}

function isOutputMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return typeof (value as { role?: unknown }).role === 'string';
}

function isExecutionStatus(value: unknown): value is EvaluationResult['executionStatus'] {
  return (
    typeof value === 'string' &&
    EXECUTION_STATUSES.has(value as EvaluationResult['executionStatus'])
  );
}

function isTraceRecord(value: unknown): value is EvaluationResult['trace'] {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { messages?: unknown }).messages) &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

function normalizeParsedResult(value: unknown): ParsedEvaluationResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result = value as Record<string, unknown>;
  const parsedResult = { ...result };
  parsedResult.rawProviderLogPath = undefined;
  const legacyOutputMessages = Array.isArray(result.output)
    ? result.output.filter(isOutputMessage)
    : undefined;
  const output =
    typeof result.output === 'string'
      ? result.output
      : extractLastAssistantContent(legacyOutputMessages);
  const legacySummary =
    result.trace && typeof result.trace === 'object' && !Array.isArray(result.trace)
      ? (result.trace as TraceSummary)
      : undefined;
  const trace = isTraceRecord(result.trace)
    ? result.trace
    : buildTraceFromMessages({
        input: Array.isArray(result.input) ? (result.input as EvaluationResult['input']) : [],
        output: legacyOutputMessages,
        summary: legacySummary,
        finalOutput: output,
        tokenUsage: result.tokenUsage as EvaluationResult['tokenUsage'],
        costUsd: typeof result.costUsd === 'number' ? result.costUsd : undefined,
        durationMs: typeof result.durationMs === 'number' ? result.durationMs : undefined,
        target: typeof result.target === 'string' ? result.target : undefined,
        testId: typeof result.testId === 'string' ? result.testId : undefined,
      });

  return {
    ...parsedResult,
    timestamp: typeof result.timestamp === 'string' ? result.timestamp : new Date(0).toISOString(),
    testId: typeof result.testId === 'string' ? result.testId : 'unknown',
    score: typeof result.score === 'number' ? result.score : 0,
    assertions: Array.isArray(result.assertions) ? result.assertions.filter(isAssertionEntry) : [],
    target: typeof result.target === 'string' ? result.target : 'unknown',
    output,
    trace,
    executionStatus: isExecutionStatus(result.executionStatus) ? result.executionStatus : 'ok',
  };
}

export function parseJsonlResults(content: string): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const canonicalRow = normalizeResultRow(parsed, { lineNumber: i + 1 });
    const camelCased = toCamelCaseDeep(canonicalRow);
    const normalized = normalizeParsedResult(camelCased);
    if (normalized) {
      results.push(parseEvaluationResultBoundary(normalized));
    }
  }
  return results;
}

export async function writeArtifacts(
  jsonlPath: string,
  outputDir: string,
  options?: { evalFile?: string; experiment?: string },
): Promise<{
  testArtifactDir: string;
  summaryPath: string;
  indexPath: string;
}> {
  const content = await readFile(jsonlPath, 'utf8');
  const results = parseJsonlResults(content);
  return writeArtifactsFromResults(results, outputDir, options);
}

async function collectAdditionalIndexFields(
  result: EvaluationResult,
  outputDir: string,
  testDir: string,
  testByTestId: ReadonlyMap<string, EvalTest>,
  additionalArtifacts: AdditionalResultArtifactsWriter | undefined,
): Promise<AdditionalResultIndexFields | undefined> {
  if (!additionalArtifacts) {
    return undefined;
  }
  const sourceTest = findResultSourceTest(result, testByTestId);
  return additionalArtifacts({
    result,
    outputDir,
    testDir,
    sourceTest,
    sourceTestsById: testByTestId,
  });
}

export async function writePerTestArtifacts(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: {
    experiment?: string;
    evalFile?: string;
    runId?: string;
    duplicatePolicy?: ExportDuplicatePolicy;
    resultGroup?: string;
    sourceTests?: readonly EvalTest[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
    runtimeSource?: RunRuntimeSourceMetadata;
  },
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const duplicatePolicy = options?.duplicatePolicy ?? 'update';
  const testByTestId = buildSourceTestLookup(options?.sourceTests);
  const indexRecords: ResultIndexArtifact[] = [];

  for (const result of results) {
    const sourceTest = findResultSourceTest(result, testByTestId);
    const evalPath = resolveEnvelopeEvalPath(result, testByTestId, options?.evalFile);
    const envelope = buildTraceEnvelopeSidecar({
      result,
      outputDir,
      evalPath,
      experiment: options?.experiment,
      runId: options?.runId,
      duplicatePolicy,
    });
    const projectionIdentity = envelope.projectionIdentity;
    if (!projectionIdentity) {
      throw new Error(`Result ${result.testId ?? 'unknown'} is missing projection identity`);
    }
    const artifactSubdir = buildArtifactSubdir(
      result,
      options?.resultGroup,
      sourceTest,
      projectionIdentity,
    );
    const testDir = path.join(outputDir, artifactSubdir);
    await mkdir(testDir, { recursive: true });
    const caseSummaryPath = path.join(testDir, RUN_SUMMARY_FILENAME);
    const aggregateTiming = buildRepeatAggregateTimingArtifact(result);
    const summary = buildRepeatCaseSummaryArtifact(result, aggregateTiming, projectionIdentity.id);
    await writeFile(caseSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    for (const trial of materializedRunTrials(result)) {
      await writeTrialRunArtifacts({
        trial,
        parentTestDir: testDir,
        outputDir,
        evalFile: options?.evalFile,
        experiment: options?.experiment,
        runId: options?.runId,
        duplicatePolicy,
        testByTestId,
      });
    }

    const isSingleRun = !hasPersistedTrialRuns(result);
    const singleRunDir = path.join(testDir, trialRunDirName(0));
    const singleAnswerPath =
      isSingleRun && result.output.length > 0
        ? path.join(singleRunDir, 'outputs', 'answer.md')
        : undefined;
    const singleTranscriptPath =
      isSingleRun && hasTranscriptProjection(result, envelope)
        ? path.join(singleRunDir, CANONICAL_TRANSCRIPT_ARTIFACT_PATH)
        : undefined;
    const singleTranscriptRawPath =
      isSingleRun && hasTranscriptProjection(result, envelope)
        ? path.join(singleRunDir, 'transcript-raw.jsonl')
        : undefined;
    const singleGradingPath = isSingleRun ? path.join(singleRunDir, 'grading.json') : undefined;
    const singleTimingPath = isSingleRun ? path.join(singleRunDir, 'timing.json') : undefined;
    const singleMetricsPath = isSingleRun
      ? path.join(singleRunDir, CANONICAL_METRICS_ARTIFACT_PATH)
      : undefined;
    const singleFileChangesPath =
      isSingleRun && result.fileChanges
        ? path.join(singleRunDir, CANONICAL_FILE_CHANGES_ARTIFACT_PATH)
        : undefined;

    const extraIndexFields = await collectAdditionalIndexFields(
      result,
      outputDir,
      testDir,
      testByTestId,
      options?.additionalArtifacts,
    );

    indexRecords.push({
      ...buildIndexArtifactEntry(result, {
        outputDir,
        resultDir: testDir,
        summaryPath: caseSummaryPath,
        gradingPath: singleGradingPath,
        timingPath: singleTimingPath,
        metricsPath: singleMetricsPath,
        outputPath: singleAnswerPath,
        answerPath: singleAnswerPath,
        transcriptPath: singleTranscriptPath,
        transcriptRawPath: singleTranscriptRawPath,
        fileChangesPath: singleFileChangesPath,
        extraIndexFields,
        runtimeSource: options?.runtimeSource,
        projectionIdentity,
        duplicatePolicy,
      }),
      experiment: options?.experiment,
    });
  }

  await rewriteExistingIndexRecords(outputDir, indexRecords);
}

export async function writeArtifactsFromResults(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: {
    evalFile?: string;
    experiment?: string;
    experimentMetadata?: ExperimentArtifactMetadata;
    plannedTestCount?: number;
    runId?: string;
    duplicatePolicy?: ExportDuplicatePolicy;
    resultGroup?: string;
    sourceTests?: readonly EvalTest[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
    runtimeSource?: RunRuntimeSourceMetadata;
  },
): Promise<{
  testArtifactDir: string;
  summaryPath: string;
  indexPath: string;
}> {
  const testArtifactDir = outputDir;
  const summaryPath = path.join(outputDir, RUN_SUMMARY_FILENAME);
  const indexPath = path.join(outputDir, RESULT_INDEX_FILENAME);
  await mkdir(outputDir, { recursive: true });
  const duplicatePolicy = options?.duplicatePolicy ?? 'update';
  const existingRecords = await readExistingIndexRecords(outputDir);
  const existingByIdentity = existingRecordsByProjectionIdentity(existingRecords);
  const indexRecords: unknown[] = [];
  const testByTestId = buildSourceTestLookup(options?.sourceTests);
  const emittedIdentityIds = new Set<string>();

  const plans = results.map((result) => {
    const sourceTest = findResultSourceTest(result, testByTestId);
    const evalPath = resolveEnvelopeEvalPath(result, testByTestId, options?.evalFile);
    const envelope = buildTraceEnvelopeSidecar({
      result,
      outputDir,
      evalPath,
      experiment: options?.experiment,
      runId: options?.runId,
      duplicatePolicy,
    });
    const projectionIdentity = envelope.projectionIdentity;
    if (!projectionIdentity) {
      throw new Error(`Result ${result.testId ?? 'unknown'} is missing projection identity`);
    }
    const artifactSubdir = buildArtifactSubdir(
      result,
      options?.resultGroup,
      sourceTest,
      projectionIdentity,
    );
    const testDir = path.join(outputDir, artifactSubdir);
    const caseSummaryPath = path.join(testDir, RUN_SUMMARY_FILENAME);
    const identityId = projectionIdentity.id;
    const isSingleRun = !hasPersistedTrialRuns(result);
    const singleRunDir = path.join(testDir, trialRunDirName(0));
    const singleAnswerPath =
      isSingleRun && result.output.length > 0
        ? path.join(singleRunDir, 'outputs', 'answer.md')
        : undefined;
    const singleTranscriptPath =
      isSingleRun && hasTranscriptProjection(result, envelope)
        ? path.join(singleRunDir, CANONICAL_TRANSCRIPT_ARTIFACT_PATH)
        : undefined;
    const singleTranscriptRawPath =
      isSingleRun && hasTranscriptProjection(result, envelope)
        ? path.join(singleRunDir, 'transcript-raw.jsonl')
        : undefined;
    const singleGradingPath = isSingleRun ? path.join(singleRunDir, 'grading.json') : undefined;
    const singleTimingPath = isSingleRun ? path.join(singleRunDir, 'timing.json') : undefined;
    const singleMetricsPath = isSingleRun
      ? path.join(singleRunDir, CANONICAL_METRICS_ARTIFACT_PATH)
      : undefined;
    const singleFileChangesPath =
      isSingleRun && result.fileChanges
        ? path.join(singleRunDir, CANONICAL_FILE_CHANGES_ARTIFACT_PATH)
        : undefined;
    return {
      result,
      testDir,
      caseSummaryPath,
      projectionIdentity,
      isSingleRun,
      singleAnswerPath,
      singleTranscriptPath,
      singleTranscriptRawPath,
      singleGradingPath,
      singleTimingPath,
      singleMetricsPath,
      singleFileChangesPath,
      identityId,
    };
  });

  if (duplicatePolicy === 'error') {
    const seen = new Set<string>();
    for (const plan of plans) {
      const duplicate =
        seen.has(plan.identityId) || existingByIdentity.has(plan.identityId)
          ? plan.projectionIdentity
          : undefined;
      if (duplicate) {
        throw new Error(
          `${duplicateProjectionMessage(duplicate)}; use --duplicate-policy update or skip`,
        );
      }
      seen.add(plan.identityId);
    }
  }

  for (const plan of plans) {
    const { result, identityId } = plan;
    const existing = existingByIdentity.get(identityId);
    if (duplicatePolicy === 'skip' && existing) {
      indexRecords.push(skippedExistingRecord(existing, plan.projectionIdentity, duplicatePolicy));
      emittedIdentityIds.add(identityId);
      continue;
    }
    if (duplicatePolicy === 'skip' && emittedIdentityIds.has(identityId)) {
      continue;
    }

    await mkdir(plan.testDir, { recursive: true });

    const aggregateTiming = buildRepeatAggregateTimingArtifact(result);
    const summary = buildRepeatCaseSummaryArtifact(
      result,
      aggregateTiming,
      options?.experimentMetadata?.fingerprint ?? plan.projectionIdentity.id,
    );
    await writeFile(plan.caseSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    for (const trial of materializedRunTrials(result)) {
      await writeTrialRunArtifacts({
        trial,
        parentTestDir: plan.testDir,
        outputDir,
        evalFile: options?.evalFile,
        experiment: options?.experiment,
        runId: options?.runId,
        duplicatePolicy,
        testByTestId,
      });
    }

    const extraIndexFields = await collectAdditionalIndexFields(
      result,
      outputDir,
      plan.testDir,
      testByTestId,
      options?.additionalArtifacts,
    );

    const nextRecord = {
      ...buildIndexArtifactEntry(result, {
        outputDir,
        resultDir: plan.testDir,
        summaryPath: plan.caseSummaryPath,
        gradingPath: plan.singleGradingPath,
        timingPath: plan.singleTimingPath,
        metricsPath: plan.singleMetricsPath,
        outputPath: plan.singleAnswerPath,
        answerPath: plan.singleAnswerPath,
        transcriptPath: plan.singleTranscriptPath,
        transcriptRawPath: plan.singleTranscriptRawPath,
        fileChangesPath: plan.singleFileChangesPath,
        extraIndexFields,
        runtimeSource: options?.runtimeSource,
        projectionIdentity: plan.projectionIdentity,
        duplicatePolicy,
      }),
      experiment: options?.experiment,
    };
    if (duplicatePolicy === 'update' && emittedIdentityIds.has(identityId)) {
      const existingIndex = indexRecords.findIndex(
        (record) => projectionIdentityRecordKey(record) === identityId,
      );
      if (existingIndex >= 0) {
        indexRecords[existingIndex] = nextRecord;
      }
    } else {
      indexRecords.push(nextRecord);
    }
    emittedIdentityIds.add(identityId);
  }

  const previousMetadata = await readRunSummaryMetadata(summaryPath);
  const plannedTestCount = options?.plannedTestCount ?? previousMetadata.plannedTestCount;
  const runtimeSource = options?.runtimeSource ?? previousMetadata.runtimeSource;
  const summary = buildRunSummaryArtifact(
    results,
    options?.evalFile,
    options?.experiment,
    options?.runId ?? path.basename(outputDir),
    plannedTestCount,
    options?.experimentMetadata,
    runtimeSource,
  );
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  await writeJsonlFile(indexPath, indexRecords);

  return { testArtifactDir, summaryPath, indexPath };
}
