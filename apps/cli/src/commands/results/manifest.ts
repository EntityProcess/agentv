import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type EvaluationResult,
  type ExternalTraceMetadataWire,
  type ResultArtifactPointersWire,
  type TraceSummary,
  type TranscriptJsonLine,
  buildTraceFromMessages,
  toCamelCaseDeep,
  traceFromTranscriptJsonLines,
} from '@agentv/core';

import type { GradingArtifact, TimingArtifact } from '../eval/artifact-writer.js';
import {
  RESULT_INDEX_FILENAME,
  isDirectoryPath,
  resolveRunManifestPath,
} from '../eval/result-layout.js';
import { normalizeResultRow } from './result-row-schema.js';

export interface ResultManifestRecord {
  readonly timestamp?: string;
  readonly test_id?: string;
  readonly suite?: string;
  readonly category?: string;
  readonly experiment?: string;
  readonly target?: string;
  readonly score: number;
  readonly scores?: readonly Record<string, unknown>[];
  readonly execution_status?: string;
  readonly error?: string;
  readonly cost_usd?: number;
  readonly duration_ms?: number;
  readonly token_usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
  readonly trace?: Record<string, unknown>;
  readonly grading_path?: string;
  readonly timing_path?: string;
  readonly input_path?: string;
  readonly output_path?: string;
  readonly answer_path?: string;
  readonly transcript_path?: string;
  readonly execution_summary_path?: string;
  readonly raw_provider_log_path?: string;
  readonly artifact_pointers?: ResultArtifactPointersWire;
  readonly external_trace?: ExternalTraceMetadataWire;
  readonly transcript?: ArtifactPointer;
  readonly artifacts?: ArtifactPointerMap;
  readonly response_path?: string;
  readonly artifact_dir?: string;
  readonly task_dir?: string;
  readonly eval_path?: string;
  readonly targets_path?: string;
  readonly files_path?: string;
  readonly graders_path?: string;
  readonly metadata?: Record<string, unknown>;
}

export type ArtifactPointer =
  | string
  | {
      readonly path?: unknown;
      readonly artifact_path?: unknown;
      readonly relative_path?: unknown;
      readonly ref?: unknown;
      readonly storage?: unknown;
      readonly uri?: unknown;
      readonly href?: unknown;
      readonly [key: string]: unknown;
    };

export interface ArtifactPointerMap {
  readonly transcript_path?: string;
  readonly answer_path?: string;
  readonly transcript?: ArtifactPointer;
  readonly answer?: ArtifactPointer;
  readonly [key: string]: unknown;
}

export interface ManifestHydrationOptions {
  /**
   * Defaults to true for report/inspect consumers that need a trace projection.
   * Dashboard detail routes set this false so transcript bodies are loaded only
   * by the explicit transcript artifact endpoint.
   */
  readonly hydrateTranscriptTrace?: boolean;
}

function parseJsonlLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function artifactPointerPath(pointer: ArtifactPointer | undefined): string | undefined {
  if (typeof pointer === 'string') {
    return nonEmptyString(pointer);
  }
  if (!pointer) {
    return undefined;
  }
  return (
    nonEmptyString(pointer.path) ??
    nonEmptyString(pointer.artifact_path) ??
    nonEmptyString(pointer.relative_path)
  );
}

function resolveTranscriptPath(record: ResultManifestRecord): string | undefined {
  return (
    record.transcript_path ??
    record.artifact_pointers?.transcript?.path ??
    record.artifacts?.transcript_path ??
    artifactPointerPath(record.transcript ?? record.artifacts?.transcript)
  );
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

function hydrateTrace(
  baseDir: string,
  record: ResultManifestRecord,
  options: ManifestHydrationOptions,
): EvaluationResult['trace'] {
  if (options.hydrateTranscriptTrace !== false) {
    const transcriptText = readOptionalText(baseDir, resolveTranscriptPath(record));
    if (transcriptText) {
      try {
        return traceFromTranscriptJsonLines(parseJsonlLines<TranscriptJsonLine>(transcriptText));
      } catch {
        // Fall through to a minimal trace below.
      }
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
  const timing = readOptionalJson<TimingArtifact>(baseDir, record.timing_path);
  const testId = record.test_id ?? 'unknown';

  return {
    timestamp: record.timestamp,
    testId,
    suite: record.suite,
    category: record.category,
    target: record.target,
    score: record.score,
    executionStatus: record.execution_status,
    error: record.error,
    assertions: grading?.assertions.map((assertion) => ({
      text: assertion.text,
      passed: assertion.passed,
      evidence: assertion.evidence,
    })),
    scores:
      // `evaluators` was renamed to `graders` in v4.13 — read both for backwards compat with old artifacts.
      // TODO: remove `evaluators` fallback once old run directories are no longer in use.
      (
        grading?.graders ??
        (grading as (GradingArtifact & { evaluators?: GradingArtifact['graders'] }) | undefined)
          ?.evaluators
      )?.map((evaluator) => ({
        name: evaluator.name,
        type: evaluator.type,
        score: evaluator.score,
        assertions: Array.isArray(evaluator.assertions)
          ? evaluator.assertions.map((assertion) => ({
              text: String((assertion as Record<string, unknown>).text ?? ''),
              passed: Boolean((assertion as Record<string, unknown>).passed),
              evidence:
                typeof (assertion as Record<string, unknown>).evidence === 'string'
                  ? String((assertion as Record<string, unknown>).evidence)
                  : undefined,
            }))
          : undefined,
        weight: typeof evaluator.weight === 'number' ? evaluator.weight : undefined,
        verdict: typeof evaluator.verdict === 'string' ? evaluator.verdict : undefined,
        details: evaluator.details,
      })) ?? (record.scores as EvaluationResult['scores']),
    tokenUsage: timing?.token_usage
      ? {
          input: timing.token_usage.input,
          output: timing.token_usage.output,
          reasoning: timing.token_usage.reasoning,
        }
      : record.token_usage,
    durationMs: timing?.duration_ms ?? record.duration_ms,
    costUsd: record.cost_usd,
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
  if (isDirectoryPath(resolved) || path.basename(resolved) === RESULT_INDEX_FILENAME) {
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
  const baseDir = path.dirname(resolvedSourceFile);
  return records.map((record) => hydrateManifestRecord(baseDir, record, options));
}

export interface LightweightResultRecord {
  readonly testId: string;
  readonly suite?: string;
  readonly category?: string;
  readonly target?: string;
  readonly experiment?: string;
  readonly score: number;
  readonly scores?: readonly Record<string, unknown>[];
  readonly executionStatus?: string;
  readonly error?: string;
  readonly costUsd?: number;
  readonly timestamp?: string;
}

export function loadLightweightResults(sourceFile: string): LightweightResultRecord[] {
  const resolvedSourceFile = resolveRunManifestPath(sourceFile);
  const content = readFileSync(resolvedSourceFile, 'utf8');
  return parseResultManifest(content).map((record) => ({
    testId: record.test_id ?? 'unknown',
    suite: record.suite,
    category: record.category,
    target: record.target,
    experiment: record.experiment,
    score: record.score,
    scores: record.scores,
    executionStatus: record.execution_status,
    error: record.error,
    costUsd: record.cost_usd,
    timestamp: record.timestamp,
  }));
}
