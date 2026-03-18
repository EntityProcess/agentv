import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult, EvaluatorResult } from '@agentv/core';

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
  readonly evaluators?: readonly {
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
  readonly per_evaluator_summary?: Record<
    string,
    { readonly mean: number; readonly stddev: number }
  >;
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

const PASS_THRESHOLD = 0.8;

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
    const passed = scores.filter((s) => s.score >= PASS_THRESHOLD).length;
    return passed / scores.length;
  }
  return result.score >= PASS_THRESHOLD ? 1.0 : 0.0;
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
  return result.assertions.map((a) => ({
    text: a.text,
    passed: a.passed,
    evidence: a.evidence ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Build evaluators list
// ---------------------------------------------------------------------------

function buildEvaluators(
  scores: readonly EvaluatorResult[] | undefined,
): GradingArtifact['evaluators'] {
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
    evaluators: buildEvaluators(result.scores),
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
): BenchmarkArtifact {
  const targetSet = new Set<string>();
  const testIdSet = new Set<string>();
  for (const result of results) {
    targetSet.add(result.target);
    testIdSet.add(result.testId);
  }

  const targets = [...targetSet].sort();
  const testIds = [...testIdSet].sort();

  const runSummary: BenchmarkArtifact['run_summary'] = {};
  const notes: string[] = [];

  for (const target of targets) {
    const targetResults = results.filter((r) => r.target === target);

    const passRates = targetResults.map(computePassRate);
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

  // Per-evaluator summary across all results
  const evaluatorScores = new Map<string, number[]>();
  for (const result of results) {
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

  const errorCount = results.filter((r) => r.executionStatus === 'execution_error').length;
  if (errorCount > 0) {
    notes.push(
      `${errorCount} test(s) had execution errors and are included in pass_rate as failures`,
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
    },
    run_summary: runSummary,
    per_evaluator_summary: perEvaluatorSummary,
    notes,
  };
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
      results.push(camelCased as EvaluationResult);
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
  options?: { evalFile?: string },
): Promise<{ gradingDir: string; timingPath: string; benchmarkPath: string }> {
  const content = await readFile(jsonlPath, 'utf8');
  const results = parseJsonlResults(content);

  return writeArtifactsFromResults(results, outputDir, options);
}

export async function writeArtifactsFromResults(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: { evalFile?: string },
): Promise<{ gradingDir: string; timingPath: string; benchmarkPath: string }> {
  const gradingDir = path.join(outputDir, 'grading');
  const timingPath = path.join(outputDir, 'timing.json');
  const benchmarkPath = path.join(outputDir, 'benchmark.json');

  await mkdir(gradingDir, { recursive: true });

  // Write per-test grading artifacts
  for (const result of results) {
    const grading = buildGradingArtifact(result);
    const safeTestId = result.testId.replace(/[/\\:*?"<>|]/g, '_');
    const gradingPath = path.join(gradingDir, `${safeTestId}.json`);
    await writeFile(gradingPath, `${JSON.stringify(grading, null, 2)}\n`, 'utf8');
  }

  // Write aggregate timing
  const timing = buildTimingArtifact(results);
  await writeFile(timingPath, `${JSON.stringify(timing, null, 2)}\n`, 'utf8');

  // Write benchmark
  const benchmark = buildBenchmarkArtifact(results, options?.evalFile);
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');

  return { gradingDir, timingPath, benchmarkPath };
}
