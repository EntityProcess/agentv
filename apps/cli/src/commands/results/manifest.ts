import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type EvaluationResult,
  type ExternalTraceMetadataWire,
  type MetricsArtifactWire,
  type ResultArtifactPointersWire,
  type RunRuntimeSourceMetadata,
  type TraceSummary,
  buildTraceFromMessages,
  fromTraceEnvelopeWire,
  normalizeMetricsArtifactWire,
  toCamelCaseDeep,
  traceEnvelopeToTraceSummary,
  traceEnvelopeToTranscriptMessages,
} from '@agentv/core';

import type { GradingArtifact } from '../eval/artifact-writer.js';
import {
  isDirectoryPath,
  isRunManifestPath,
  resolveRunManifestPath,
} from '../eval/result-layout.js';
import { normalizeResultRow } from './result-row-schema.js';

export interface ResultManifestRecord {
  readonly timestamp?: string;
  readonly test_id?: string;
  readonly suite?: string;
  readonly category?: string;
  readonly experiment?: string;
  /** promptfoo-shaped tag map (`Record<string,string>`), e.g. `{experiment, team, env}`. */
  readonly tags?: Record<string, string>;
  readonly target?: string;
  readonly variant?: string;
  readonly score: number;
  readonly scores?: readonly Record<string, unknown>[];
  readonly samples?: readonly {
    readonly sample?: number;
    readonly sample_index?: number;
    readonly sample_path?: string;
    readonly run_path?: string;
    readonly score?: number;
    readonly status?: string;
    readonly [key: string]: unknown;
  }[];
  /** Legacy pre-v5 repeat sample field accepted when reading older bundles. */
  readonly attempts?: readonly {
    readonly attempt?: number;
    readonly attempt_path?: string;
    readonly sample_path?: string;
    readonly run_path?: string;
    readonly score?: number;
    readonly verdict?: string;
    readonly [key: string]: unknown;
  }[];
  /** Legacy pre-v5 repeat sample field accepted when reading older bundles. */
  readonly trials?: readonly {
    readonly attempt?: number;
    readonly attempt_path?: string;
    readonly sample_path?: string;
    readonly run_path?: string;
    readonly score?: number;
    readonly verdict?: string;
    readonly [key: string]: unknown;
  }[];
  readonly aggregation?: Record<string, unknown>;
  readonly execution_status?: string;
  readonly error?: string;
  /** Compact target-runtime error classification; full envelope lives at `target_execution_path`. */
  readonly target_error_kind?: string;
  /** Legacy pre-v5.4 fat index row field accepted when reading older bundles; superseded by `target_error_kind`. */
  readonly target_execution?: { readonly error_kind?: string; readonly errorKind?: string };
  readonly cost_usd?: number;
  readonly duration_ms?: number;
  readonly token_usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
  readonly trace?: Record<string, unknown>;
  readonly summary_path?: string;
  readonly grading_path?: string;
  readonly timing_path?: string;
  readonly input_path?: string;
  readonly output_path?: string;
  readonly answer_path?: string;
  readonly trace_path?: string;
  readonly transcript_path?: string;
  readonly transcript_raw_path?: string;
  readonly metrics_path?: string;
  readonly raw_provider_log_path?: string;
  readonly artifact_pointers?: ResultArtifactPointersWire;
  readonly runtime_source?: RunRuntimeSourceMetadata;
  readonly external_trace?: ExternalTraceMetadataWire;
  readonly response_path?: string;
  readonly result_dir?: string;
  readonly test_dir?: string;
  readonly task_dir?: string;
  readonly eval_path?: string;
  readonly providers_path?: string;
  readonly files_path?: string;
  readonly graders_path?: string;
  readonly metadata?: Record<string, unknown>;
}

interface LegacyTimingArtifact {
  readonly duration_ms?: number;
  readonly token_usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
}

function manifestBaseDir(indexPath: string): string {
  const dir = path.dirname(indexPath);
  return path.basename(dir) === '.internal' ? path.dirname(dir) : dir;
}

export interface ManifestHydrationOptions {
  /**
   * Defaults to true for report/inspect consumers that need a trace projection.
   * Dashboard detail routes set this false so transcript bodies are loaded only
   * by the explicit transcript artifact endpoint.
   */
  readonly hydrateTranscriptTrace?: boolean;
}

type HydratedScore = NonNullable<EvaluationResult['scores']>[number];

function readNestedGradingScores(record: Record<string, unknown>): unknown {
  if (Array.isArray(record.component_results)) {
    return record.component_results;
  }
  if (Array.isArray(record.scores)) {
    return record.scores;
  }
  return undefined;
}

function componentLabel(component: Record<string, unknown>): string {
  const assertion = component.assertion;
  if (assertion && typeof assertion === 'object' && !Array.isArray(assertion)) {
    const record = assertion as Record<string, unknown>;
    for (const key of ['value', 'name', 'id', 'type']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
  }
  return typeof component.reason === 'string' ? component.reason : 'grading component';
}

function mapComponentAssertion(
  component: Record<string, unknown>,
): EvaluationResult['assertions'][number] {
  return {
    text: componentLabel(component),
    passed: component.pass === true,
    evidence: typeof component.reason === 'string' ? component.reason : undefined,
  };
}

function collectComponentAssertions(value: unknown): NonNullable<EvaluationResult['assertions']> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((component) => {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      return [];
    }
    const record = component as Record<string, unknown>;
    const nested = collectComponentAssertions(record.component_results);
    return nested.length > 0 ? nested : [mapComponentAssertion(record)];
  });
}

function mapGradingEvaluator(evaluator: Record<string, unknown>): HydratedScore {
  const pass = evaluator.pass === true;
  const verdict = pass ? ('pass' as const) : ('fail' as const);
  const details =
    evaluator.details && typeof evaluator.details === 'object' && !Array.isArray(evaluator.details)
      ? (evaluator.details as HydratedScore['details'])
      : undefined;
  const assertion =
    evaluator.assertion &&
    typeof evaluator.assertion === 'object' &&
    !Array.isArray(evaluator.assertion)
      ? (evaluator.assertion as Record<string, unknown>)
      : undefined;

  return {
    name: String(assertion?.name ?? assertion?.id ?? evaluator.name ?? componentLabel(evaluator)),
    type: String(assertion?.type ?? evaluator.type ?? 'llm-grader') as HydratedScore['type'],
    score: typeof evaluator.score === 'number' ? evaluator.score : 0,
    reason: typeof evaluator.reason === 'string' ? evaluator.reason : undefined,
    assertions: (() => {
      const nestedAssertions = collectComponentAssertions(evaluator.component_results);
      if (nestedAssertions.length > 0) {
        return nestedAssertions;
      }
      return [mapComponentAssertion(evaluator)];
    })(),
    scores: mapGradingEvaluators(readNestedGradingScores(evaluator)),
    weight: typeof evaluator.weight === 'number' ? evaluator.weight : undefined,
    verdict,
    details,
  };
}

function mapGradingEvaluators(value: unknown): EvaluationResult['scores'] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((evaluator) => mapGradingEvaluator(evaluator as Record<string, unknown>));
}

function parseResultRows(content: string, sourceLabel?: string): ResultManifestRecord[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(
      ({ line, lineNumber }) =>
        normalizeResultRow(JSON.parse(line), {
          lineNumber,
          sourceLabel,
        }) as unknown as ResultManifestRecord,
    );
}

function parseMarkdownMessages(content: string): { role: string; content: string }[] {
  const trimmed = content.trim();
  if (!trimmed.startsWith('@[')) {
    return [];
  }

  const matches = [...trimmed.matchAll(/^@\[(.+?)\]:\n([\s\S]*?)(?=^@\[(.+?)\]:\n|\s*$)/gm)];
  return matches.map((match) => ({
    role: match[1],
    content: match[2].trimEnd(),
  }));
}

function readOptionalText(baseDir: string, relativePath: string | undefined): string | undefined {
  if (!relativePath) {
    return undefined;
  }

  const absolutePath = path.join(baseDir, relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  return readFileSync(absolutePath, 'utf8');
}

function readOptionalJson<T>(baseDir: string, relativePath: string | undefined): T | undefined {
  const text = readOptionalText(baseDir, relativePath);
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function hydrateInput(
  baseDir: string,
  record: ResultManifestRecord,
): EvaluationResult['input'] | undefined {
  const inputText = readOptionalText(baseDir, record.input_path);
  if (!inputText) {
    return undefined;
  }

  const messages = parseMarkdownMessages(inputText);
  return messages.length > 0 ? messages : [{ role: 'user', content: inputText.trimEnd() }];
}

function hydrateOutput(
  baseDir: string,
  record: ResultManifestRecord,
): EvaluationResult['output'] | undefined {
  const responseText = readOptionalText(
    baseDir,
    record.output_path ?? record.answer_path ?? record.response_path,
  );
  if (!responseText) {
    return undefined;
  }

  return responseText.trimEnd();
}

function hydrateTraceEnvelope(
  baseDir: string,
  record: ResultManifestRecord,
): EvaluationResult['trace'] | undefined {
  const traceWire = readOptionalJson<unknown>(baseDir, record.trace_path);
  if (!traceWire) {
    return undefined;
  }

  try {
    const envelope = fromTraceEnvelopeWire(traceWire);
    const summary = traceEnvelopeToTraceSummary(envelope);
    return buildTraceFromMessages({
      output: traceEnvelopeToTranscriptMessages(envelope),
      summary: summary.trace,
      finalOutput: hydrateOutput(baseDir, record),
      tokenUsage: summary.tokenUsage,
      costUsd: summary.costUsd,
      durationMs: summary.durationMs,
      startTime: summary.startTime,
      endTime: summary.endTime,
      provider: envelope.source.provider,
      target: record.target ?? envelope.eval.target,
      testId: record.test_id ?? envelope.eval.testId,
      conversationId: envelope.eval.runId,
    });
  } catch {
    return undefined;
  }
}

function hydrateTrace(
  baseDir: string,
  record: ResultManifestRecord,
  options: ManifestHydrationOptions,
): EvaluationResult['trace'] {
  if (options.hydrateTranscriptTrace !== false) {
    const trace = hydrateTraceEnvelope(baseDir, record);
    if (trace) {
      return trace;
    }
  }

  const output = hydrateOutput(baseDir, record) ?? '';
  return buildTraceFromMessages({
    input: hydrateInput(baseDir, record),
    output: output ? [{ role: 'assistant', content: output }] : [],
    summary: record.trace ? (toCamelCaseDeep(record.trace) as TraceSummary) : undefined,
    finalOutput: output,
    target: record.target,
    testId: record.test_id,
  });
}

function hydrateManifestRecord(
  baseDir: string,
  record: ResultManifestRecord,
  options: ManifestHydrationOptions,
): EvaluationResult {
  const grading = readOptionalJson<GradingArtifact>(baseDir, record.grading_path);
  const metrics = normalizeMetricsArtifactWire(
    readOptionalJson<MetricsArtifactWire | Record<string, unknown>>(baseDir, record.metrics_path),
  );
  const timing = metrics ?? readOptionalJson<LegacyTimingArtifact>(baseDir, record.timing_path);
  const testId = record.test_id ?? 'unknown';
  const gradingAssertions = grading
    ? collectComponentAssertions((grading as unknown as Record<string, unknown>).component_results)
    : undefined;
  const gradingRecord = grading as GradingArtifact | undefined;
  const gradingScores = mapGradingEvaluators(gradingRecord?.component_results);

  return {
    timestamp: record.timestamp,
    testId,
    suite: record.suite,
    category: record.category,
    target: record.target,
    variant: record.variant,
    score: record.score,
    executionStatus: record.execution_status,
    error: record.error,
    assertions: gradingAssertions?.map((assertion) => ({
      text: assertion.text,
      passed: assertion.passed,
      evidence: assertion.evidence,
    })),
    scores: gradingScores ?? (record.scores as EvaluationResult['scores']),
    tokenUsage: metrics?.tokens
      ? {
          input: metrics.tokens.input,
          output: metrics.tokens.output,
          reasoning: metrics.tokens.reasoning,
        }
      : (timing as LegacyTimingArtifact | undefined)?.token_usage
        ? {
            input: (timing as LegacyTimingArtifact).token_usage?.input,
            output: (timing as LegacyTimingArtifact).token_usage?.output,
            reasoning: (timing as LegacyTimingArtifact).token_usage?.reasoning,
          }
        : record.token_usage,
    durationMs:
      metrics?.duration?.total_ms ??
      (timing as LegacyTimingArtifact | undefined)?.duration_ms ??
      record.duration_ms,
    costUsd: metrics?.cost?.usd ?? record.cost_usd,
    input: hydrateInput(baseDir, record),
    output: hydrateOutput(baseDir, record) ?? '',
    trace: hydrateTrace(baseDir, record, options),
    metadata: record.metadata,
  } as EvaluationResult;
}

export function parseResultManifest(content: string): ResultManifestRecord[] {
  return parseResultRows(content);
}

export function resolveResultSourcePath(source: string, cwd?: string): string {
  const resolved = path.isAbsolute(source) ? source : path.resolve(cwd ?? process.cwd(), source);
  if (isDirectoryPath(resolved) || isRunManifestPath(resolved)) {
    return resolveRunManifestPath(resolved);
  }
  return resolved;
}

export function loadManifestResults(
  sourceFile: string,
  options: ManifestHydrationOptions = {},
): EvaluationResult[] {
  const resolvedSourceFile = resolveRunManifestPath(sourceFile);
  const content = readFileSync(resolvedSourceFile, 'utf8');
  const records = parseResultRows(content, resolvedSourceFile);
  const baseDir = manifestBaseDir(resolvedSourceFile);
  return records.map((record) => hydrateManifestRecord(baseDir, record, options));
}

export interface LightweightResultRecord {
  readonly testId: string;
  readonly evalPath?: string;
  readonly suite?: string;
  readonly category?: string;
  readonly target?: string;
  readonly variant?: string;
  readonly experiment?: string;
  /** promptfoo-shaped tag map from the JSONL row's `tags` field. */
  readonly tags?: Record<string, string>;
  readonly score: number;
  readonly scores?: readonly Record<string, unknown>[];
  readonly executionStatus?: string;
  readonly error?: string;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly tokenUsage?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
  readonly timestamp?: string;
  readonly runtimeSource?: RunRuntimeSourceMetadata;
  readonly resultDir?: string;
  readonly outputPath?: string;
  readonly answerPath?: string;
  readonly gradingPath?: string;
  readonly transcriptPath?: string;
  readonly metricsPath?: string;
}

/**
 * Coerce a raw JSONL `tags` value into a `Record<string,string>`, dropping
 * non-string values. Returns undefined when the map is absent or empty so the
 * lightweight record stays sparse for old runs that never wrote a tags map.
 */
export function normalizeTagMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries: [string, string][] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      entries.push([key, raw]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function loadLightweightResults(sourceFile: string): LightweightResultRecord[] {
  const resolvedSourceFile = resolveRunManifestPath(sourceFile);
  const content = readFileSync(resolvedSourceFile, 'utf8');
  return parseResultManifest(content).map((record) => ({
    testId: record.test_id ?? 'unknown',
    evalPath: record.eval_path,
    suite: record.suite,
    category: record.category,
    target: record.target,
    variant: record.variant,
    experiment: record.experiment,
    tags: normalizeTagMap(record.tags),
    score: record.score,
    scores: record.scores,
    executionStatus: record.execution_status,
    error: record.error,
    costUsd: record.cost_usd,
    durationMs: record.duration_ms,
    tokenUsage: record.token_usage,
    timestamp: record.timestamp,
    runtimeSource: record.runtime_source,
    resultDir: record.result_dir,
    outputPath: record.output_path,
    answerPath: record.answer_path,
    gradingPath: record.grading_path,
    transcriptPath: record.transcript_path,
    metricsPath: record.metrics_path,
  }));
}
