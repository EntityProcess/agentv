import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  type EvalTest,
  type EvalTestSource,
  type EvaluationResult,
  type GraderResult,
  toTranscriptJsonLines,
} from '@agentv/core';
import { toSnakeCaseDeep } from '../../utils/case-conversion.js';
import { RESULT_INDEX_FILENAME } from './result-layout.js';

export const RUN_SOURCE_FILENAME = 'run-source.json';
const MAX_SOURCE_CAPTURE_BYTES = 64 * 1024;
const SOURCE_SECRET_LINE_PATTERN =
  /^(\s*[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*\s*:\s*).+$/gim;
const SOURCE_SECRET_ASSIGNMENT_PATTERN =
  /^((?:--?)?[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*[=:]).+$/i;
const SOURCE_SECRET_FLAG_PATTERN =
  /^--?[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*$/i;
const REDACTED_SOURCE_VALUE = '[redacted]';

export function buildTestTargetKey(testId?: string, target?: string): string {
  return `${testId ?? 'unknown'}::${target ?? 'unknown'}`;
}

// Deduplication helper — keeps the last entry per (test_id, target) pair.
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

  // Preserve `planned_test_count` from any pre-existing benchmark.json (e.g.
  // the stub written at run start, or from the original run when this is a
  // resume) unless an explicit value was passed.
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

// ---------------------------------------------------------------------------
// Artifact interfaces (snake_case to match skill-creator conventions)
// ---------------------------------------------------------------------------

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
    /**
     * Total number of test cases the run was planned to execute (across all
     * targets and eval files). Written at run start so an interrupted run
     * can be diagnosed as resumable when `tests_run.length < planned_test_count`,
     * even if every recorded row has `execution_status: ok`.
     */
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
  readonly scores?: readonly Record<string, unknown>[];
  readonly execution_status?: string;
  readonly error?: string;
  readonly failure_stage?: string;
  readonly failure_reason_code?: string;
  readonly workspace_path?: string;
  readonly grading_path: string;
  readonly timing_path: string;
  readonly output_path?: string;
  readonly input_path?: string;
  readonly response_path?: string;
  /** Case-level metadata pass-through (governance taxonomies, skill tags, etc.). */
  readonly metadata?: Record<string, unknown>;
}

export type ResultIndexArtifact = IndexArtifactEntry;

export interface RunSourceOmittedContent {
  readonly reason: 'size_limit' | 'binary' | 'not_file' | 'read_error' | 'unresolved';
  readonly message?: string;
  readonly max_bytes?: number;
}

export interface RunSourceCapturedFile {
  readonly kind?: string;
  readonly display_path: string;
  readonly repo_relative_path?: string;
  readonly absolute_path?: string;
  readonly content_sha256?: string;
  readonly size_bytes?: number;
  readonly content?: string;
  readonly omitted?: RunSourceOmittedContent;
}

export interface RunSourceReferencedFile extends RunSourceCapturedFile {
  readonly kind: string;
  readonly grader_name?: string;
  readonly command?: readonly string[];
}

export interface RunSourceTraceabilityArtifact {
  readonly status: 'captured' | 'not_captured';
  readonly message?: string;
  readonly eval_file?: RunSourceCapturedFile;
  readonly test_id?: string;
  readonly source_test?: {
    readonly test_id: string;
    readonly yaml: string;
  };
  readonly graders?: readonly {
    readonly name: string;
    readonly type: string;
    readonly weight?: number;
    readonly required?: boolean | number;
    readonly min_score?: number;
    readonly definition: Record<string, unknown>;
  }[];
  readonly referenced_files?: readonly RunSourceReferencedFile[];
}

export interface RunSourceResultEntry {
  readonly test_id: string;
  readonly target?: string;
  readonly suite?: string;
  readonly category?: string;
  readonly eval_file_path?: string;
  readonly source_traceability: RunSourceTraceabilityArtifact;
}

export interface RunSourceArtifact {
  readonly version: 1;
  readonly captured_at: string;
  readonly eval_file?: RunSourceCapturedFile;
  readonly results: readonly RunSourceResultEntry[];
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool-call counting from trace data
// ---------------------------------------------------------------------------

function countToolCalls(result: EvaluationResult): {
  toolCalls: Record<string, number>;
  total: number;
} {
  const toolCalls: Record<string, number> = {};
  let total = 0;

  const trace = result.trace as
    | { steps?: readonly { toolName?: string; type?: string }[] }
    | undefined;

  if (trace?.steps) {
    for (const step of trace.steps) {
      if (step.toolName || step.type === 'tool') {
        const name = step.toolName ?? 'unknown';
        toolCalls[name] = (toolCalls[name] ?? 0) + 1;
        total += 1;
      }
    }
  }

  return { toolCalls, total };
}

// ---------------------------------------------------------------------------
// Workspace change parsing from fileChanges diff
// ---------------------------------------------------------------------------

function parseWorkspaceChanges(
  fileChanges: string | undefined,
): GradingArtifact['workspace_changes'] | undefined {
  if (!fileChanges) {
    return undefined;
  }

  let filesModified = 0;
  let filesCreated = 0;

  const lines = fileChanges.split('\n');
  for (const line of lines) {
    if (line.startsWith('--- /dev/null')) {
      filesCreated += 1;
    } else if (line.startsWith('--- a/')) {
      filesModified += 1;
    }
  }

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

// ---------------------------------------------------------------------------
// Build assertions from evaluation result (skill-creator compatible)
// ---------------------------------------------------------------------------

function buildAssertions(result: EvaluationResult): GradingArtifact['assertions'] {
  if (!result.assertions) return [];
  return result.assertions.map((a) => ({
    text: a.text,
    passed: a.passed,
    evidence: a.evidence ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Build graders list
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public artifact builders
// ---------------------------------------------------------------------------

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
          turns: result.trace
            ? ((result.trace as { steps?: readonly unknown[] }).steps?.length ?? 0)
            : 0,
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

    // Optional tool_calls stats from trace data
    const toolCallCounts = targetResults.map((r) => countToolCalls(r).total);
    if (toolCallCounts.some((c) => c > 0)) {
      entry.tool_calls = computeStats(toolCallCounts);
    }

    // Optional cost stats
    const costs = targetResults.filter((r) => r.costUsd != null).map((r) => r.costUsd as number);
    if (costs.length > 0) {
      entry.cost_usd = computeStats(costs);
    }

    runSummary[target] = entry as (typeof runSummary)[string];
  }

  // Per-grader summary across all results
  const evaluatorScores = new Map<string, number[]>();
  for (const result of results) {
    if (isExecutionError(result)) {
      continue;
    }
    if (result.scores) {
      for (const score of result.scores) {
        const key = `${score.name}:${score.type}`;
        if (!evaluatorScores.has(key)) {
          evaluatorScores.set(key, []);
        }
        evaluatorScores.get(key)?.push(score.score);
      }
    }
  }

  let perEvaluatorSummary: Record<string, { mean: number; stddev: number }> | undefined;
  if (evaluatorScores.size > 0) {
    perEvaluatorSummary = {};
    for (const [key, scores] of evaluatorScores) {
      perEvaluatorSummary[key] = computeStats(scores);
    }
  }

  const errorCount = results.filter(
    (r) => r.executionStatus != null && r.executionStatus === 'execution_error',
  ).length;
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

/**
 * Write a stub `benchmark.json` at the start of a run, before any tests
 * have executed. Carries `planned_test_count` so an interrupted run can
 * still be detected as resumable even when every recorded row has
 * `execution_status: ok`.
 *
 * The end-of-run write (writeArtifactsFromResults / aggregateRunDir)
 * overwrites this file with the full summary; preserve `planned_test_count`
 * by passing it through.
 */
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
    if (!result.assertions) continue;
    const testId = result.testId ?? 'unknown';
    for (const a of result.assertions) {
      assertions.push({
        test_id: testId,
        text: a.text,
        passed: a.passed,
        evidence: a.evidence ?? '',
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

function toPortableRelativePath(root: string | undefined, candidate: string): string | undefined {
  if (!root) {
    return undefined;
  }
  const relative = path.relative(root, candidate);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return undefined;
}

function redactSecretLikeLines(content: string): string {
  return content.replace(SOURCE_SECRET_LINE_PATTERN, `$1${REDACTED_SOURCE_VALUE}`);
}

function isLikelyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

function buildFileIdentity(params: {
  readonly displayPath: string;
  readonly resolvedPath?: string;
  readonly repoRoot?: string;
  readonly cwd?: string;
}): Pick<RunSourceCapturedFile, 'display_path' | 'repo_relative_path' | 'absolute_path'> {
  const resolvedPath = params.resolvedPath ? path.resolve(params.resolvedPath) : undefined;
  const repoRelative = resolvedPath
    ? (toPortableRelativePath(params.repoRoot, resolvedPath) ??
      toPortableRelativePath(params.cwd, resolvedPath))
    : undefined;
  const displayPath = repoRelative ?? params.displayPath;
  return {
    display_path: displayPath,
    ...(repoRelative ? { repo_relative_path: repoRelative } : {}),
    ...(!repoRelative && resolvedPath ? { absolute_path: resolvedPath } : {}),
  };
}

function toPortableCommandArg(arg: string, repoRoot: string | undefined, cwd: string | undefined) {
  if (!path.isAbsolute(arg)) {
    return arg;
  }
  return toPortableRelativePath(repoRoot, arg) ?? toPortableRelativePath(cwd, arg) ?? arg;
}

function sanitizeSourceCommand(
  command: readonly string[],
  options: { readonly repoRoot?: string; readonly cwd?: string },
): readonly string[] {
  let redactNext = false;
  return command.map((arg) => {
    const portableArg = toPortableCommandArg(arg, options.repoRoot, options.cwd);
    if (redactNext) {
      redactNext = false;
      return REDACTED_SOURCE_VALUE;
    }
    if (SOURCE_SECRET_ASSIGNMENT_PATTERN.test(portableArg)) {
      return portableArg.replace(SOURCE_SECRET_ASSIGNMENT_PATTERN, `$1${REDACTED_SOURCE_VALUE}`);
    }
    if (SOURCE_SECRET_FLAG_PATTERN.test(portableArg)) {
      redactNext = true;
    }
    return portableArg;
  });
}

async function captureSourceFile(params: {
  readonly kind?: string;
  readonly displayPath: string;
  readonly resolvedPath?: string;
  readonly repoRoot?: string;
  readonly cwd?: string;
  readonly graderName?: string;
  readonly command?: readonly string[];
}): Promise<RunSourceReferencedFile | RunSourceCapturedFile> {
  const identity = buildFileIdentity({
    displayPath: params.displayPath,
    resolvedPath: params.resolvedPath,
    repoRoot: params.repoRoot,
    cwd: params.cwd,
  });
  const base = {
    ...(params.kind ? { kind: params.kind } : {}),
    ...identity,
    ...(params.graderName ? { grader_name: params.graderName } : {}),
    ...(params.command
      ? {
          command: sanitizeSourceCommand(params.command, {
            repoRoot: params.repoRoot,
            cwd: params.cwd,
          }),
        }
      : {}),
  };

  if (!params.resolvedPath) {
    return {
      ...base,
      omitted: { reason: 'unresolved', message: 'No resolved source path was available.' },
    };
  }

  try {
    const fileStat = await stat(params.resolvedPath);
    if (!fileStat.isFile()) {
      return {
        ...base,
        size_bytes: fileStat.size,
        omitted: { reason: 'not_file', message: 'Resolved source path is not a file.' },
      };
    }

    const contentBuffer = await readFile(params.resolvedPath);
    const contentSha256 = createHash('sha256').update(contentBuffer).digest('hex');
    const common = {
      ...base,
      content_sha256: contentSha256,
      size_bytes: contentBuffer.length,
    };

    if (contentBuffer.length > MAX_SOURCE_CAPTURE_BYTES) {
      return {
        ...common,
        omitted: {
          reason: 'size_limit',
          max_bytes: MAX_SOURCE_CAPTURE_BYTES,
          message: 'Source file exceeded the run-source capture size limit.',
        },
      };
    }

    if (isLikelyBinary(contentBuffer)) {
      return {
        ...common,
        omitted: { reason: 'binary', message: 'Source file appears to be binary.' },
      };
    }

    return {
      ...common,
      content: redactSecretLikeLines(contentBuffer.toString('utf8').replace(/\r\n/g, '\n')),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      omitted: { reason: 'read_error', message },
    };
  }
}

function buildSourceByTestId(
  sourceTests: readonly EvalTest[] | undefined,
): Map<string, EvalTestSource> {
  const sourceByTestId = new Map<string, EvalTestSource>();
  for (const test of sourceTests ?? []) {
    if (test.source) {
      sourceByTestId.set(test.source.testId, test.source);
    }
  }
  return sourceByTestId;
}

function evalFileDisplayPath(source: EvalTestSource, fallbackEvalFile?: string): string {
  return (
    source.evalFileRepoPath ??
    source.evalFilePath ??
    fallbackEvalFile ??
    source.evalFileAbsolutePath
  );
}

async function captureEvalFile(
  sourceByTestId: ReadonlyMap<string, EvalTestSource>,
  options: RunSourceBuildOptions,
): Promise<RunSourceCapturedFile | undefined> {
  const firstSource = sourceByTestId.values().next().value;
  if (!firstSource) {
    return undefined;
  }
  return captureSourceFile({
    displayPath: evalFileDisplayPath(firstSource, options.evalFile),
    resolvedPath: firstSource.evalFileAbsolutePath,
    repoRoot: options.repoRoot,
    cwd: options.cwd,
  });
}

function toRunSourceGraderDefinitions(
  source: EvalTestSource,
): RunSourceTraceabilityArtifact['graders'] {
  return source.graderDefinitions.map((grader) => ({
    name: grader.name,
    type: grader.type,
    ...(grader.weight !== undefined ? { weight: grader.weight } : {}),
    ...(grader.required !== undefined ? { required: grader.required } : {}),
    ...(grader.minScore !== undefined ? { min_score: grader.minScore } : {}),
    definition: toSnakeCaseDeep(grader.definition) as Record<string, unknown>,
  }));
}

async function captureReferencedFiles(
  source: EvalTestSource,
  options: RunSourceBuildOptions,
): Promise<readonly RunSourceReferencedFile[]> {
  const captured = await Promise.all(
    source.references.map(async (reference) => {
      const file = await captureSourceFile({
        kind: reference.kind,
        displayPath: reference.displayPath,
        resolvedPath: reference.resolvedPath,
        repoRoot: options.repoRoot,
        cwd: options.cwd,
        graderName: reference.graderName,
        command: reference.command,
      });
      return file as RunSourceReferencedFile;
    }),
  );
  return captured;
}

interface RunSourceBuildOptions {
  readonly evalFile?: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
  readonly sourceTests?: readonly EvalTest[];
}

export async function buildRunSourceArtifact(
  results: readonly EvaluationResult[],
  options: RunSourceBuildOptions = {},
): Promise<RunSourceArtifact | undefined> {
  const sourceByTestId = buildSourceByTestId(options.sourceTests);
  if (sourceByTestId.size === 0) {
    return undefined;
  }

  const evalFile = await captureEvalFile(sourceByTestId, options);
  const resultsWithSource: RunSourceResultEntry[] = [];
  for (const result of results) {
    const testId = result.testId ?? 'unknown';
    const source = sourceByTestId.get(testId);
    if (!source) {
      resultsWithSource.push({
        test_id: testId,
        target: result.target,
        suite: getSuite(result),
        category: result.category,
        source_traceability: {
          status: 'not_captured',
          message: 'Source metadata was not available for this result.',
        },
      });
      continue;
    }

    const referencedFiles = await captureReferencedFiles(source, options);
    resultsWithSource.push({
      test_id: testId,
      target: result.target,
      suite: getSuite(result),
      category: result.category,
      eval_file_path: evalFileDisplayPath(source, options.evalFile),
      source_traceability: {
        status: 'captured',
        ...(evalFile ? { eval_file: evalFile } : {}),
        test_id: source.testId,
        source_test: {
          test_id: source.testId,
          yaml: source.testSnapshotYaml,
        },
        graders: toRunSourceGraderDefinitions(source),
        referenced_files: referencedFiles,
      },
    });
  }

  return {
    version: 1,
    captured_at: new Date().toISOString(),
    ...(evalFile ? { eval_file: evalFile } : {}),
    results: resultsWithSource,
  };
}

export async function writeRunSourceArtifact(
  results: readonly EvaluationResult[],
  outputDir: string,
  options: RunSourceBuildOptions = {},
): Promise<string | undefined> {
  const artifact = await buildRunSourceArtifact(results, options);
  if (!artifact) {
    return undefined;
  }

  const outputPath = path.join(outputDir, RUN_SOURCE_FILENAME);
  await writeFile(outputPath, `${JSON.stringify(toSnakeCaseDeep(artifact), null, 2)}\n`, 'utf8');
  return outputPath;
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

export function buildIndexArtifactEntry(
  result: EvaluationResult,
  options: {
    outputDir: string;
    gradingPath: string;
    timingPath: string;
    outputPath?: string;
    inputPath?: string;
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
    scores: result.scores
      ? (toSnakeCaseDeep(result.scores) as IndexArtifactEntry['scores'])
      : undefined,
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    grading_path: toRelativeArtifactPath(options.outputDir, options.gradingPath),
    timing_path: toRelativeArtifactPath(options.outputDir, options.timingPath),
    output_path: options.outputPath
      ? toRelativeArtifactPath(options.outputDir, options.outputPath)
      : undefined,
    input_path: options.inputPath
      ? toRelativeArtifactPath(options.outputDir, options.inputPath)
      : undefined,
    metadata: result.metadata,
  };
}

export function buildResultIndexArtifact(result: EvaluationResult): ResultIndexArtifact {
  const artifactSubdir = buildArtifactSubdir(result);
  const input = extractInput(result);
  const hasResponse = Array.isArray(result.output) && result.output.length > 0;

  return {
    timestamp: result.timestamp,
    test_id: result.testId ?? 'unknown',
    suite: getSuite(result),
    category: result.category,
    conversation_id: result.conversationId,
    score: result.score,
    target: result.target ?? 'unknown',
    scores: result.scores
      ? (toSnakeCaseDeep(result.scores) as IndexArtifactEntry['scores'])
      : undefined,
    execution_status: result.executionStatus,
    error: result.error,
    failure_stage: result.failureStage,
    failure_reason_code: result.failureReasonCode,
    workspace_path: result.workspacePath,
    grading_path: path.posix.join(artifactSubdir, 'grading.json'),
    timing_path: path.posix.join(artifactSubdir, 'timing.json'),
    input_path: input ? path.posix.join(artifactSubdir, 'input.md') : undefined,
    output_path: hasResponse
      ? path.posix.join(artifactSubdir, 'outputs', 'response.md')
      : undefined,
    response_path: hasResponse
      ? path.posix.join(artifactSubdir, 'outputs', 'response.md')
      : undefined,
    metadata: result.metadata,
  };
}

async function writeJsonlFile(filePath: string, records: readonly unknown[]): Promise<void> {
  const content =
    records.length === 0
      ? ''
      : `${records.map((record) => JSON.stringify(toSnakeCaseDeep(record))).join('\n')}\n`;
  await writeFile(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Snake_case to camelCase conversion for reading JSONL files
// ---------------------------------------------------------------------------

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

function isOutputMessage(value: unknown): value is EvaluationResult['output'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { role?: unknown };
  return typeof candidate.role === 'string';
}

function isExecutionStatus(value: unknown): value is EvaluationResult['executionStatus'] {
  return (
    typeof value === 'string' &&
    EXECUTION_STATUSES.has(value as EvaluationResult['executionStatus'])
  );
}

function normalizeParsedResult(value: unknown): ParsedEvaluationResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result = value as Record<string, unknown>;
  return {
    ...result,
    timestamp: typeof result.timestamp === 'string' ? result.timestamp : new Date(0).toISOString(),
    testId: typeof result.testId === 'string' ? result.testId : 'unknown',
    score: typeof result.score === 'number' ? result.score : 0,
    assertions: Array.isArray(result.assertions) ? result.assertions.filter(isAssertionEntry) : [],
    target: typeof result.target === 'string' ? result.target : 'unknown',
    output: Array.isArray(result.output) ? result.output.filter(isOutputMessage) : [],
    executionStatus: isExecutionStatus(result.executionStatus) ? result.executionStatus : 'ok',
  };
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

export function parseJsonlResults(content: string): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      // JSONL files from AgentV use snake_case; convert back to camelCase
      const camelCased = toCamelCaseDeep(parsed);
      const normalized = normalizeParsedResult(camelCased);
      if (normalized) {
        results.push(normalized);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Artifact writer — reads JSONL and writes all three artifact types
// ---------------------------------------------------------------------------

export async function writeArtifacts(
  jsonlPath: string,
  outputDir: string,
  options?: { evalFile?: string; experiment?: string },
): Promise<{
  testArtifactDir: string;
  timingPath: string;
  benchmarkPath: string;
  indexPath: string;
  runSourcePath?: string;
}> {
  const content = await readFile(jsonlPath, 'utf8');
  const results = parseJsonlResults(content);

  return writeArtifactsFromResults(results, outputDir, options);
}

function buildTranscriptMessageLines(results: readonly EvaluationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    const transcriptLines = toTranscriptJsonLines(
      {
        messages: [...(result.input ?? []), ...result.output],
        source: {
          provider: result.target,
          sessionId: result.conversationId ?? result.testId,
          startedAt: result.timestamp,
        },
        tokenUsage: result.tokenUsage,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
      },
      {
        testId: result.testId,
        target: result.target,
      },
    );

    lines.push(...transcriptLines.map((line) => JSON.stringify(line)));
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export async function writePerTestArtifacts(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: { experiment?: string },
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
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
    if (result.output && result.output.length > 0) {
      const outputsDir = path.join(testDir, 'outputs');
      await mkdir(outputsDir, { recursive: true });
      await writeFile(
        path.join(outputsDir, 'response.md'),
        formatOutputMarkdown(result.output),
        'utf8',
      );
    }
  }
}

export async function writeArtifactsFromResults(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: {
    evalFile?: string;
    experiment?: string;
    plannedTestCount?: number;
    cwd?: string;
    repoRoot?: string;
    sourceTests?: readonly EvalTest[];
  },
): Promise<{
  testArtifactDir: string;
  timingPath: string;
  benchmarkPath: string;
  indexPath: string;
  runSourcePath?: string;
}> {
  const testArtifactDir = outputDir;
  const timingPath = path.join(outputDir, 'timing.json');
  const benchmarkPath = path.join(outputDir, 'benchmark.json');
  const indexPath = path.join(outputDir, RESULT_INDEX_FILENAME);
  await mkdir(outputDir, { recursive: true });
  const indexRecords: ResultIndexArtifact[] = [];

  // Write per-test grading artifacts
  for (const result of results) {
    const grading = buildGradingArtifact(result);
    const timing = buildTimingArtifact([result]);
    const artifactSubdir = buildArtifactSubdir(result);
    const testDir = path.join(outputDir, artifactSubdir);
    const gradingPath = path.join(testDir, 'grading.json');
    const perTestTimingPath = path.join(testDir, 'timing.json');
    await mkdir(testDir, { recursive: true });
    await writeFile(gradingPath, `${JSON.stringify(grading, null, 2)}\n`, 'utf8');
    await writeFile(perTestTimingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

    const input = extractInput(result);
    if (input) {
      await writeFile(path.join(testDir, 'input.md'), input, 'utf8');
    }

    if (result.output && result.output.length > 0) {
      const outputsDir = path.join(testDir, 'outputs');
      await mkdir(outputsDir, { recursive: true });
      await writeFile(
        path.join(outputsDir, 'response.md'),
        formatOutputMarkdown(result.output),
        'utf8',
      );
    }

    indexRecords.push({
      ...buildResultIndexArtifact(result),
      experiment: options?.experiment,
    });
  }

  // Write aggregate timing
  const timing = buildTimingArtifact(results);
  await writeFile(timingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

  // Write benchmark — preserve `planned_test_count` from the run-start stub
  // (or from the original run when this is a resume) unless an explicit
  // value was passed by the caller.
  const plannedTestCount = options?.plannedTestCount ?? (await readPlannedTestCount(benchmarkPath));
  const benchmark = buildBenchmarkArtifact(
    results,
    options?.evalFile,
    options?.experiment,
    plannedTestCount,
  );
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');

  await writeJsonlFile(indexPath, indexRecords);

  // Write transcript JSONL (auto-generated on every eval run)
  const transcriptPath = path.join(outputDir, 'transcript.jsonl');
  await writeFile(transcriptPath, buildTranscriptMessageLines(results), 'utf8');

  const runSourcePath = await writeRunSourceArtifact(results, outputDir, {
    evalFile: options?.evalFile,
    cwd: options?.cwd,
    repoRoot: options?.repoRoot,
    sourceTests: options?.sourceTests,
  });

  return { testArtifactDir, timingPath, benchmarkPath, indexPath, runSourcePath };
}
