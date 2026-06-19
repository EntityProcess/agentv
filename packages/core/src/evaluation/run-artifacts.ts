/**
 * Canonical AgentV run artifact helpers.
 *
 * This module owns the shared run-workspace contract used by CLI and
 * programmatic evals: `index.jsonl`, `benchmark.json`, `timing.json`, per-test
 * grading/timing/output sidecars, and transcript projections. Keep wire keys in
 * snake_case here so every caller produces the same artifacts.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { traceToTranscriptJsonLines } from '../import/types.js';
import { DEFAULT_THRESHOLD } from './graders/scoring.js';
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
import { normalizeResultRow } from './result-row-schema.js';
import {
  type TraceEnvelope,
  buildTraceEnvelopeFromEvaluationResult,
  toTraceEnvelopeWire,
  traceEnvelopeToTranscriptMessages,
} from './trace-envelope.js';
import { type TraceSummary, buildTraceFromMessages } from './trace.js';
import type { EvalTest, EvaluationResult, GraderResult } from './types.js';

export const RESULT_INDEX_FILENAME = 'index.jsonl';

export function buildTestTargetKey(testId?: string, target?: string): string {
  return `${testId ?? 'unknown'}::${target ?? 'unknown'}`;
}

export function deduplicateByTestIdTarget(
  results: readonly EvaluationResult[],
): EvaluationResult[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < results.length; i++) {
    seen.set(buildTestTargetKey(results[i].testId, results[i].target), i);
  }
  const deduped: EvaluationResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const key = buildTestTargetKey(results[i].testId, results[i].target);
    if (seen.get(key) === i) {
      deduped.push(results[i]);
    }
  }
  return deduped;
}

export async function aggregateRunDir(
  runDir: string,
  options?: { evalFile?: string; experiment?: string; plannedTestCount?: number },
): Promise<{ benchmarkPath: string; timingPath: string; testCount: number; targetCount: number }> {
  const indexPath = path.join(runDir, RESULT_INDEX_FILENAME);
  const content = await readFile(indexPath, 'utf8');
  const allResults = parseJsonlResults(content);
  const results = deduplicateByTestIdTarget(allResults);

  const timing = buildTimingArtifact(results);
  const timingPath = path.join(runDir, 'timing.json');
  await writeFile(timingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

  const plannedTestCount =
    options?.plannedTestCount ?? (await readPlannedTestCount(path.join(runDir, 'benchmark.json')));

  const benchmark = buildBenchmarkArtifact(
    results,
    options?.evalFile,
    options?.experiment,
    plannedTestCount,
  );
  const benchmarkPath = path.join(runDir, 'benchmark.json');
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');

  const targetSet = new Set(results.map((r) => r.target ?? 'unknown'));
  return { benchmarkPath, timingPath, testCount: results.length, targetCount: targetSet.size };
}

async function readPlannedTestCount(benchmarkPath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(benchmarkPath, 'utf8');
    const parsed = JSON.parse(raw) as { metadata?: { planned_test_count?: number } };
    const value = parsed.metadata?.planned_test_count;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
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
  readonly execution_metrics: {
    readonly tool_calls: Record<string, number>;
    readonly total_tool_calls: number;
    readonly errors_encountered: number;
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
    readonly diff_summary: string;
  };
  readonly conversation?: {
    readonly turns: number;
    readonly conversation_id: string;
  };
}

export interface TimingArtifact {
  readonly total_tokens: number;
  readonly duration_ms: number;
  readonly total_duration_seconds: number;
  readonly token_usage: {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
  };
}

export interface BenchmarkArtifact {
  readonly metadata: {
    readonly eval_file: string;
    readonly timestamp: string;
    readonly targets: readonly string[];
    readonly tests_run: readonly string[];
    readonly experiment?: string;
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
  readonly token_usage?: EvaluationResult['tokenUsage'];
  readonly cost_usd?: number;
  readonly duration_ms?: number;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly scores?: readonly Record<string, unknown>[];
  readonly execution_status?: string;
  readonly error?: string;
  readonly failure_stage?: string;
  readonly failure_reason_code?: string;
  readonly workspace_path?: string;
  readonly artifact_dir?: string;
  readonly grading_path: string;
  readonly timing_path: string;
  readonly output_path?: string;
  readonly answer_path?: string;
  readonly transcript_path?: string;
  readonly input_path?: string;
  readonly response_path?: string;
  readonly task_dir?: string;
  readonly eval_path?: string;
  readonly targets_path?: string;
  readonly files_path?: string;
  readonly graders_path?: string;
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
    'task_dir' | 'eval_path' | 'targets_path' | 'files_path' | 'graders_path'
  >
>;

export interface AdditionalResultArtifactsContext {
  readonly result: EvaluationResult;
  readonly outputDir: string;
  readonly testDir: string;
  readonly sourceTest?: EvalTest;
  readonly sourceTestsById: ReadonlyMap<string, EvalTest>;
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

  for (const line of fileChanges.split('\n')) {
    if (line.startsWith('--- /dev/null')) {
      filesCreated += 1;
    } else if (line.startsWith('--- a/')) {
      filesModified += 1;
    }
  }

  const lines = fileChanges.split('\n');
  const summaryLines = lines.slice(0, 20);
  const diffSummary =
    lines.length > 20
      ? `${summaryLines.join('\n')}\n... (${lines.length - 20} more lines)`
      : fileChanges;

  return {
    files_modified: filesModified,
    files_created: filesCreated,
    diff_summary: diffSummary,
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
    assertions: score.assertions.map(toIndexAssertion),
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
    source_artifact_dir: value.sourceArtifactDir,
    source_task_dir: value.sourceTaskDir,
    source_test_id: value.sourceTestId,
    source_target: value.sourceTarget,
    source_timestamp: value.sourceTimestamp,
  });
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
  const rerunSource = toIndexRerunSource(metadata.rerunSource);
  const preparedAttempt = toIndexPreparedAttempt(metadata.preparedAttempt);
  if (!rerunSource && !preparedAttempt) {
    return { ...metadata };
  }
  const reservedKeys = new Set(['rerunSource', 'preparedAttempt']);
  return {
    ...Object.fromEntries(Object.entries(metadata).filter(([key]) => !reservedKeys.has(key))),
    ...(rerunSource ? { rerun_source: rerunSource } : {}),
    ...(preparedAttempt ? { prepared_attempt: preparedAttempt } : {}),
  };
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

export function buildGradingArtifact(result: EvaluationResult): GradingArtifact {
  const assertions = buildAssertions(result);
  const passed = assertions.filter((e) => e.passed).length;
  const failed = assertions.filter((e) => !e.passed).length;
  const total = assertions.length;

  const { toolCalls, total: totalToolCalls } = countToolCalls(result);
  const errorsEncountered = result.error ? 1 : 0;

  return {
    assertions,
    summary: {
      passed,
      failed,
      total,
      pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0,
    },
    execution_metrics: {
      tool_calls: toolCalls,
      total_tool_calls: totalToolCalls,
      errors_encountered: errorsEncountered,
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
  };
}

export function buildTimingArtifact(results: readonly EvaluationResult[]): TimingArtifact {
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalDurationMs = 0;

  for (const result of results) {
    const usage = result.tokenUsage as
      | { input?: number; output?: number; reasoning?: number }
      | undefined;
    if (usage) {
      totalInput += usage.input ?? 0;
      totalOutput += usage.output ?? 0;
      totalReasoning += usage.reasoning ?? 0;
    }
    if (result.durationMs != null) {
      totalDurationMs += result.durationMs;
    }
  }

  return {
    total_tokens: totalInput + totalOutput,
    duration_ms: totalDurationMs,
    total_duration_seconds: Math.round((totalDurationMs / 1000) * 1000) / 1000,
    token_usage: {
      input: totalInput,
      output: totalOutput,
      reasoning: totalReasoning,
    },
  };
}

export function buildBenchmarkArtifact(
  results: readonly EvaluationResult[],
  evalFile = '',
  experiment?: string,
  plannedTestCount?: number,
): BenchmarkArtifact {
  const targetSet = new Set<string>();
  const testIdSet = new Set<string>();
  for (const result of results) {
    targetSet.add(result.target ?? 'unknown');
    testIdSet.add(result.testId ?? 'unknown');
  }

  const targets = [...targetSet].sort();
  const testIds = [...testIdSet].sort();

  const runSummary: BenchmarkArtifact['run_summary'] = {};
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
    metadata: {
      eval_file: evalFile,
      timestamp,
      targets,
      tests_run: testIds,
      experiment,
      planned_test_count: plannedTestCount,
    },
    run_summary: runSummary,
    per_grader_summary: perEvaluatorSummary,
    notes,
  };
}

export async function writeInitialBenchmarkArtifact(
  runDir: string,
  options: {
    evalFile: string;
    plannedTestCount: number;
    experiment?: string;
  },
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const stub = buildBenchmarkArtifact(
    [],
    options.evalFile,
    options.experiment,
    options.plannedTestCount,
  );
  const benchmarkPath = path.join(runDir, 'benchmark.json');
  await writeFile(benchmarkPath, `${JSON.stringify(stub, null, 2)}\n`, 'utf8');
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

function getSuite(result: EvaluationResult): string | undefined {
  return result.suite;
}

function buildArtifactSubdir(result: EvaluationResult): string {
  const segments = [];
  const evalSet = getSuite(result);
  if (evalSet) {
    segments.push(safeArtifactPathSegment(evalSet, 'default'));
  }
  segments.push(safeTestId(result.testId));
  return path.posix.join(...segments);
}

function formatOutputMarkdown(output: readonly { role: string; content?: unknown }[]): string {
  return output.map((msg) => `@[${msg.role}]:\n${String(msg.content ?? '')}`).join('\n\n');
}

function extractInput(result: EvaluationResult): string | null {
  const input = (result as unknown as Record<string, unknown>).input;
  if (!input) return null;
  if (typeof input === 'string') return input;
  if (Array.isArray(input) && input.length > 0) {
    return formatOutputMarkdown(input as { role: string; content?: unknown }[]);
  }
  return null;
}

function toRelativeArtifactPath(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join('/');
}

function findResultSourceTest(
  result: EvaluationResult,
  testByTestId: ReadonlyMap<string, EvalTest>,
): EvalTest | undefined {
  return testByTestId.get(result.testId ?? 'unknown');
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

interface TraceEnvelopeSidecarParams {
  readonly result: EvaluationResult;
  readonly outputDir: string;
  readonly outputsDir: string;
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
    source: { path: RESULT_INDEX_FILENAME },
    capture: { content: 'full', redactionLevel: 'none', redactedFields: [] },
    artifacts: {
      execution_trace_path: 'outputs/execution-trace.json',
      answer_path: params.result.output.length > 0 ? 'outputs/answer.md' : undefined,
      response_path: params.result.output.length > 0 ? 'outputs/response.md' : undefined,
      transcript_path: hasTranscript ? 'outputs/transcript.jsonl' : undefined,
    },
    duplicatePolicy: params.duplicatePolicy,
  });
}

async function writeTraceEnvelopeSidecar(
  params: TraceEnvelopeSidecarParams,
): Promise<TraceEnvelope> {
  const envelope = buildTraceEnvelopeSidecar(params);
  await writeFile(
    path.join(params.outputsDir, 'execution-trace.json'),
    `${JSON.stringify(toTraceEnvelopeWire(envelope), null, 2)}\n`,
    'utf8',
  );
  return envelope;
}

export function buildIndexArtifactEntry(
  result: EvaluationResult,
  options: {
    outputDir: string;
    artifactDir?: string;
    gradingPath: string;
    timingPath: string;
    outputPath?: string;
    answerPath?: string;
    transcriptPath?: string;
    inputPath?: string;
    responsePath?: string;
    extraIndexFields?: AdditionalResultIndexFields;
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
    token_usage: result.tokenUsage,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    start_time: result.startTime,
    end_time: result.endTime,
    scores: toIndexScores(result.scores),
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    artifact_dir: options.artifactDir
      ? toRelativeArtifactPath(options.outputDir, options.artifactDir)
      : undefined,
    grading_path: toRelativeArtifactPath(options.outputDir, options.gradingPath),
    timing_path: toRelativeArtifactPath(options.outputDir, options.timingPath),
    output_path: options.outputPath
      ? toRelativeArtifactPath(options.outputDir, options.outputPath)
      : undefined,
    answer_path: options.answerPath
      ? toRelativeArtifactPath(options.outputDir, options.answerPath)
      : undefined,
    transcript_path: options.transcriptPath
      ? toRelativeArtifactPath(options.outputDir, options.transcriptPath)
      : undefined,
    input_path: options.inputPath
      ? toRelativeArtifactPath(options.outputDir, options.inputPath)
      : undefined,
    response_path: options.responsePath
      ? toRelativeArtifactPath(options.outputDir, options.responsePath)
      : undefined,
    ...options.extraIndexFields,
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
  },
): ResultIndexArtifact {
  const artifactSubdir = buildArtifactSubdir(result);
  const input = extractInput(result);
  const hasAnswer = result.output.length > 0;
  const hasTranscript = resultHasExecutionTraceTranscript(result);

  return {
    timestamp: result.timestamp,
    test_id: result.testId ?? 'unknown',
    suite: getSuite(result),
    category: result.category,
    conversation_id: result.conversationId,
    score: result.score,
    target: result.target ?? 'unknown',
    token_usage: result.tokenUsage,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    start_time: result.startTime,
    end_time: result.endTime,
    scores: toIndexScores(result.scores),
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    artifact_dir: artifactSubdir,
    grading_path: path.posix.join(artifactSubdir, 'grading.json'),
    timing_path: path.posix.join(artifactSubdir, 'timing.json'),
    input_path: input ? path.posix.join(artifactSubdir, 'input.md') : undefined,
    output_path: hasAnswer ? path.posix.join(artifactSubdir, 'outputs', 'answer.md') : undefined,
    answer_path: hasAnswer ? path.posix.join(artifactSubdir, 'outputs', 'answer.md') : undefined,
    transcript_path: hasTranscript
      ? path.posix.join(artifactSubdir, 'outputs', 'transcript.jsonl')
      : undefined,
    response_path: hasAnswer
      ? path.posix.join(artifactSubdir, 'outputs', 'response.md')
      : undefined,
    ...extraIndexFields,
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

function traceProjectionForTranscript(result: EvaluationResult, envelope: TraceEnvelope) {
  return {
    ...result.trace,
    messages: traceEnvelopeToTranscriptMessages(envelope),
  };
}

function hasTranscriptProjection(result: EvaluationResult, envelope: TraceEnvelope): boolean {
  return result.output.length > 0 || traceEnvelopeToTranscriptMessages(envelope).length > 0;
}

async function writeTranscriptJsonl(
  filePath: string,
  result: EvaluationResult,
  envelope: TraceEnvelope,
): Promise<void> {
  const lines = traceToTranscriptJsonLines(traceProjectionForTranscript(result, envelope), {
    testId: result.testId,
    target: result.target,
  });
  const content =
    lines.length > 0 ? `${lines.map((line) => JSON.stringify(line)).join('\n')}\n` : '';
  await writeFile(filePath, content, 'utf8');
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
  return testId ? buildTestTargetKey(testId, target) : undefined;
}

function projectionIdentityRecordKey(record: unknown): string | undefined {
  if (!isRecord(record) || !isRecord(record.projection_identity)) {
    return undefined;
  }
  const id = record.projection_identity.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

async function readExistingIndexRecords(outputDir: string): Promise<readonly unknown[]> {
  const indexPath = path.join(outputDir, RESULT_INDEX_FILENAME);
  const content = await readFile(indexPath, 'utf8').catch(() => undefined);
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

  const indexPath = path.join(outputDir, RESULT_INDEX_FILENAME);
  const content = await readFile(indexPath, 'utf8').catch(() => undefined);
  if (content === undefined) {
    return;
  }

  const replacementsByKey = new Map(
    replacements.map((record) => [buildTestTargetKey(record.test_id, record.target), record]),
  );
  const seen = new Set<string>();
  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const key = indexRecordKey(parsed);
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
    const key = buildTestTargetKey(replacement.test_id, replacement.target);
    if (!seen.has(key)) {
      records.push(replacement);
    }
  }

  await writeJsonlFile(indexPath, records);
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toCamelCaseDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCaseDeep(item));
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[toCamelCase(key)] = toCamelCaseDeep(value);
    }
    return result;
  }
  return obj;
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
    ...result,
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
      results.push(normalized);
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
  timingPath: string;
  benchmarkPath: string;
  indexPath: string;
}> {
  const content = await readFile(jsonlPath, 'utf8');
  const results = parseJsonlResults(content);
  return writeArtifactsFromResults(results, outputDir, options);
}

function buildTranscriptMessageLines(results: readonly EvaluationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    const transcriptLines = traceToTranscriptJsonLines(result.trace, {
      testId: result.testId,
      target: result.target,
    });
    lines.push(...transcriptLines.map((line) => JSON.stringify(line)));
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
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
  return additionalArtifacts({
    result,
    outputDir,
    testDir,
    sourceTest: testByTestId.get(result.testId ?? 'unknown'),
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
    sourceTests?: readonly EvalTest[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
  },
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const duplicatePolicy = options?.duplicatePolicy ?? 'update';
  const testByTestId = new Map((options?.sourceTests ?? []).map((test) => [test.id, test]));
  const indexRecords: ResultIndexArtifact[] = [];

  for (const result of results) {
    const grading = buildGradingArtifact(result);
    const timing = buildTimingArtifact([result]);
    const artifactSubdir = buildArtifactSubdir(result);
    const testDir = path.join(outputDir, artifactSubdir);
    await mkdir(testDir, { recursive: true });
    await writeFile(
      path.join(testDir, 'grading.json'),
      `${JSON.stringify(grading, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(testDir, 'timing.json'),
      `${JSON.stringify(timing, null, 2)}\n`,
      'utf8',
    );

    const input = extractInput(result);
    if (input) {
      await writeFile(path.join(testDir, 'input.md'), input, 'utf8');
    }
    const outputsDir = path.join(testDir, 'outputs');
    await mkdir(outputsDir, { recursive: true });
    if (result.output.length > 0) {
      await writeFile(path.join(outputsDir, 'answer.md'), result.output, 'utf8');
      await writeFile(path.join(outputsDir, 'response.md'), result.output, 'utf8');
    }
    const envelope = await writeTraceEnvelopeSidecar({
      result,
      outputDir,
      outputsDir,
      evalPath: resolveEnvelopeEvalPath(result, testByTestId, options?.evalFile),
      experiment: options?.experiment,
      runId: options?.runId,
      duplicatePolicy,
    });
    if (hasTranscriptProjection(result, envelope)) {
      await writeTranscriptJsonl(path.join(outputsDir, 'transcript.jsonl'), result, envelope);
    }

    const extraIndexFields = await collectAdditionalIndexFields(
      result,
      outputDir,
      testDir,
      testByTestId,
      options?.additionalArtifacts,
    );

    indexRecords.push({
      ...buildResultIndexArtifact(result, extraIndexFields, {
        projectionIdentity: envelope.projectionIdentity,
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
    plannedTestCount?: number;
    runId?: string;
    duplicatePolicy?: ExportDuplicatePolicy;
    sourceTests?: readonly EvalTest[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
  },
): Promise<{
  testArtifactDir: string;
  timingPath: string;
  benchmarkPath: string;
  indexPath: string;
}> {
  const testArtifactDir = outputDir;
  const timingPath = path.join(outputDir, 'timing.json');
  const benchmarkPath = path.join(outputDir, 'benchmark.json');
  const indexPath = path.join(outputDir, RESULT_INDEX_FILENAME);
  await mkdir(outputDir, { recursive: true });
  const duplicatePolicy = options?.duplicatePolicy ?? 'update';
  const existingRecords = await readExistingIndexRecords(outputDir);
  const existingByIdentity = existingRecordsByProjectionIdentity(existingRecords);
  const indexRecords: unknown[] = [];
  const testByTestId = new Map((options?.sourceTests ?? []).map((test) => [test.id, test]));
  const emittedIdentityIds = new Set<string>();

  const plans = results.map((result) => {
    const grading = buildGradingArtifact(result);
    const timing = buildTimingArtifact([result]);
    const artifactSubdir = buildArtifactSubdir(result);
    const testDir = path.join(outputDir, artifactSubdir);
    const gradingPath = path.join(testDir, 'grading.json');
    const perTestTimingPath = path.join(testDir, 'timing.json');
    const input = extractInput(result);
    const inputPath = input ? path.join(testDir, 'input.md') : undefined;
    const outputsDir = path.join(testDir, 'outputs');
    const answerPath = result.output.length > 0 ? path.join(outputsDir, 'answer.md') : undefined;
    const responsePath =
      result.output.length > 0 ? path.join(outputsDir, 'response.md') : undefined;
    const envelope = buildTraceEnvelopeSidecar({
      result,
      outputDir,
      outputsDir,
      evalPath: resolveEnvelopeEvalPath(result, testByTestId, options?.evalFile),
      experiment: options?.experiment,
      runId: options?.runId,
      duplicatePolicy,
    });
    const transcriptPath = hasTranscriptProjection(result, envelope)
      ? path.join(outputsDir, 'transcript.jsonl')
      : undefined;
    const projectionIdentity = envelope.projectionIdentity;
    if (!projectionIdentity) {
      throw new Error(`Result ${result.testId ?? 'unknown'} is missing projection identity`);
    }
    const identityId = projectionIdentity.id;
    return {
      result,
      grading,
      timing,
      testDir,
      gradingPath,
      perTestTimingPath,
      input,
      inputPath,
      outputsDir,
      answerPath,
      responsePath,
      envelope,
      projectionIdentity,
      transcriptPath,
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
    const { result, envelope, identityId } = plan;
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
    await writeFile(plan.gradingPath, `${JSON.stringify(plan.grading, null, 2)}\n`, 'utf8');
    await writeFile(plan.perTestTimingPath, `${JSON.stringify(plan.timing, null, 2)}\n`, 'utf8');

    if (plan.inputPath && plan.input) {
      await writeFile(plan.inputPath, plan.input, 'utf8');
    }

    await mkdir(plan.outputsDir, { recursive: true });
    if (plan.answerPath && plan.responsePath) {
      await writeFile(plan.answerPath, result.output, 'utf8');
      await writeFile(plan.responsePath, result.output, 'utf8');
    }
    await writeFile(
      path.join(plan.outputsDir, 'execution-trace.json'),
      `${JSON.stringify(toTraceEnvelopeWire(envelope), null, 2)}\n`,
      'utf8',
    );
    if (plan.transcriptPath) {
      await writeTranscriptJsonl(plan.transcriptPath, result, envelope);
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
        artifactDir: plan.testDir,
        gradingPath: plan.gradingPath,
        timingPath: plan.perTestTimingPath,
        outputPath: plan.answerPath,
        answerPath: plan.answerPath,
        transcriptPath: plan.transcriptPath,
        inputPath: plan.inputPath,
        responsePath: plan.responsePath,
        extraIndexFields,
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

  const timing = buildTimingArtifact(results);
  await writeFile(timingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

  const plannedTestCount = options?.plannedTestCount ?? (await readPlannedTestCount(benchmarkPath));
  const benchmark = buildBenchmarkArtifact(
    results,
    options?.evalFile,
    options?.experiment,
    plannedTestCount,
  );
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');

  await writeJsonlFile(indexPath, indexRecords);
  await writeFile(
    path.join(outputDir, 'transcript.jsonl'),
    buildTranscriptMessageLines(results),
    'utf8',
  );

  return { testArtifactDir, timingPath, benchmarkPath, indexPath };
}
