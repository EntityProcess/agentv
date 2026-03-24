import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

import type { GradingArtifact, TimingArtifact } from '../eval/artifact-writer.js';
import { parseJsonlResults } from '../eval/artifact-writer.js';
import {
  RESULT_INDEX_FILENAME,
  resolveWorkspaceOrFilePath,
} from '../eval/result-layout.js';

export interface ResultManifestRecord {
  readonly timestamp?: string;
  readonly test_id?: string;
  readonly eval_id?: string;
  readonly eval_set?: string;
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
  readonly grading_path?: string;
  readonly timing_path?: string;
  readonly input_path?: string;
  readonly output_path?: string;
  readonly response_path?: string;
}

function parseJsonlLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function isIndexManifestPath(sourceFile: string): boolean {
  return path.basename(sourceFile) === RESULT_INDEX_FILENAME;
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
  const responseText = readOptionalText(baseDir, record.output_path ?? record.response_path);
  if (!responseText) {
    return undefined;
  }

  const messages = parseMarkdownMessages(responseText);
  if (messages.length > 0) {
    return messages.map((message) => ({
      role: message.role as 'assistant' | 'user' | 'system' | 'tool',
      content: message.content,
    }));
  }

  return [{ role: 'assistant', content: responseText.trimEnd() }];
}

function hydrateManifestRecord(baseDir: string, record: ResultManifestRecord): EvaluationResult {
  const grading = readOptionalJson<GradingArtifact>(baseDir, record.grading_path);
  const timing = readOptionalJson<TimingArtifact>(baseDir, record.timing_path);
  const testId = record.test_id ?? record.eval_id ?? 'unknown';

  return {
    timestamp: record.timestamp,
    testId,
    eval_set: record.eval_set,
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
      grading?.evaluators?.map((evaluator) => ({
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
    output: hydrateOutput(baseDir, record),
  } as EvaluationResult;
}

export function parseResultManifest(content: string): ResultManifestRecord[] {
  return parseJsonlLines<ResultManifestRecord>(content);
}

export function resolveResultSourcePath(source: string, cwd?: string): string {
  const resolved = path.isAbsolute(source) ? source : path.resolve(cwd ?? process.cwd(), source);
  return resolveWorkspaceOrFilePath(resolved);
}

export function loadManifestResults(sourceFile: string): EvaluationResult[] {
  const resolvedSourceFile = resolveWorkspaceOrFilePath(sourceFile);

  if (!isIndexManifestPath(resolvedSourceFile)) {
    return parseJsonlResults(readFileSync(resolvedSourceFile, 'utf8'));
  }

  const content = readFileSync(resolvedSourceFile, 'utf8');
  const records = parseResultManifest(content);
  const baseDir = path.dirname(resolvedSourceFile);
  return records.map((record) => hydrateManifestRecord(baseDir, record));
}

export interface LightweightResultRecord {
  readonly testId: string;
  readonly target?: string;
  readonly score: number;
  readonly scores?: readonly Record<string, unknown>[];
  readonly executionStatus?: string;
  readonly error?: string;
  readonly timestamp?: string;
}

export function loadLightweightResults(sourceFile: string): LightweightResultRecord[] {
  const resolvedSourceFile = resolveWorkspaceOrFilePath(sourceFile);
  const content = readFileSync(resolvedSourceFile, 'utf8');

  if (isIndexManifestPath(resolvedSourceFile)) {
    return parseResultManifest(content).map((record) => ({
      testId: record.test_id ?? record.eval_id ?? 'unknown',
      target: record.target,
      score: record.score,
      scores: record.scores,
      executionStatus: record.execution_status,
      error: record.error,
      timestamp: record.timestamp,
    }));
  }

  const records: LightweightResultRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const rawTestId = record.test_id ?? record.eval_id ?? record.testId ?? record.evalId;
    if (typeof rawTestId !== 'string') {
      throw new Error(`Missing test_id in result: ${trimmed}`);
    }

    if (typeof record.score !== 'number') {
      throw new Error(`Missing or invalid score in result: ${trimmed}`);
    }

    records.push({
      testId: rawTestId,
      target: typeof record.target === 'string' ? record.target : undefined,
      score: record.score,
      scores: Array.isArray(record.scores)
        ? (record.scores as readonly Record<string, unknown>[])
        : undefined,
      executionStatus:
        typeof record.execution_status === 'string'
          ? record.execution_status
          : typeof record.executionStatus === 'string'
            ? record.executionStatus
            : undefined,
      error: typeof record.error === 'string' ? record.error : undefined,
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    });
  }

  return records;
}

