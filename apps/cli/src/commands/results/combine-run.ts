/**
 * Shared run-combine implementation for `agentv results combine` and the
 * Dashboard API.
 *
 * Combines two or more local run workspace manifests into a new local run
 * workspace. The writer keeps per-test artifacts self-contained by copying
 * referenced source files under `sources/source-N/` and rewriting manifest
 * paths, while recomputing top-level `timing.json` and `benchmark.json` from
 * the selected result rows.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type {
  EvaluationResult,
  ResultArtifactPointerWire,
  ResultArtifactPointersWire,
  TranscriptArtifactPointerWire,
} from '@agentv/core';

import {
  type BenchmarkArtifact,
  buildBenchmarkArtifact,
  buildTestTargetKey,
  buildTimingArtifact,
} from '../eval/artifact-writer.js';
import { createRunDirName, resolveRunManifestPath } from '../eval/result-layout.js';
import {
  type ResultManifestRecord,
  loadManifestResults,
  parseResultManifest,
  resolveResultSourcePath,
} from './manifest.js';

export type CombineDuplicatePolicy = 'error' | 'latest' | 'prompt';
export type PromptDuplicateChoice = 'keep' | 'replace';

export interface CombineRunSource {
  readonly id: string;
  readonly displayName: string;
  readonly manifestPath: string;
  readonly tags?: readonly string[];
}

export interface DuplicateConflict {
  readonly key: string;
  readonly test_id: string;
  readonly target: string;
  readonly kept_source_id: string;
  readonly incoming_source_id: string;
  readonly kept_timestamp?: string;
  readonly incoming_timestamp?: string;
  readonly latest_source_id: string;
}

export class CombineDuplicateError extends Error {
  constructor(readonly conflicts: readonly DuplicateConflict[]) {
    super(`Duplicate result rows found for ${conflicts.length} (test_id, target) pair(s)`);
    this.name = 'CombineDuplicateError';
  }
}

interface LoadedSource extends CombineRunSource {
  readonly index: number;
  readonly records: readonly ResultManifestRecord[];
  readonly results: readonly EvaluationResult[];
  readonly startedAt?: string;
}

interface SelectedRow {
  readonly source: LoadedSource;
  readonly record: ResultManifestRecord;
  readonly result: EvaluationResult;
}

export interface CombineRunOptions {
  readonly cwd: string;
  readonly sources: readonly CombineRunSource[];
  readonly outputDir?: string;
  readonly displayName?: string;
  readonly duplicatePolicy: CombineDuplicatePolicy;
  readonly promptChoices?: ReadonlyMap<string, PromptDuplicateChoice>;
}

export interface CombineRunResult {
  readonly runDir: string;
  readonly runId: string;
  readonly manifestPath: string;
  readonly benchmarkPath: string;
  readonly timingPath: string;
  readonly displayName: string;
  readonly combinedFromRunIds: readonly string[];
  readonly duplicateConflicts: readonly DuplicateConflict[];
  readonly testCount: number;
  readonly targetCount: number;
  readonly tags: readonly string[];
}

function parseJsonlLine(line: string): ResultManifestRecord {
  return JSON.parse(line) as ResultManifestRecord;
}

function readManifestRecords(manifestPath: string): ResultManifestRecord[] {
  return readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonlLine);
}

function readBenchmarkMetadata(manifestPath: string): {
  timestamp?: string;
  displayName?: string;
} {
  try {
    const benchmarkPath = path.join(path.dirname(manifestPath), 'benchmark.json');
    const parsed = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as {
      metadata?: { timestamp?: string; display_name?: string };
    };
    return {
      timestamp: parsed.metadata?.timestamp,
      displayName: parsed.metadata?.display_name,
    };
  } catch {
    return {};
  }
}

function earliestTimestamp(values: readonly (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))[0];
}

function latestTimestamp(values: readonly (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .sort((a, b) => b.localeCompare(a))[0];
}

function resultKey(record: ResultManifestRecord, result: EvaluationResult): string {
  return buildTestTargetKey(record.test_id ?? result.testId, record.target ?? result.target);
}

function loadSources(sources: readonly CombineRunSource[]): LoadedSource[] {
  return sources.map((source, index) => {
    const manifestPath = resolveRunManifestPath(source.manifestPath);
    const records = readManifestRecords(manifestPath);
    const results = loadManifestResults(manifestPath);
    if (records.length !== results.length) {
      throw new Error(`Manifest could not be hydrated completely: ${manifestPath}`);
    }
    const metadata = readBenchmarkMetadata(manifestPath);
    return {
      ...source,
      index,
      manifestPath,
      displayName: metadata.displayName ?? source.displayName,
      records,
      results,
      startedAt:
        earliestTimestamp(records.map((record) => record.timestamp)) ??
        earliestTimestamp(results.map((result) => result.timestamp)) ??
        metadata.timestamp,
    };
  });
}

function isIncomingLatest(existing: SelectedRow, incoming: SelectedRow): boolean {
  const existingTimestamp =
    latestTimestamp([existing.record.timestamp, existing.result.timestamp]) ?? '';
  const incomingTimestamp =
    latestTimestamp([incoming.record.timestamp, incoming.result.timestamp]) ?? '';
  if (incomingTimestamp !== existingTimestamp) {
    return incomingTimestamp > existingTimestamp;
  }
  return incoming.source.index > existing.source.index;
}

function buildConflict(
  existing: SelectedRow,
  incoming: SelectedRow,
  key: string,
): DuplicateConflict {
  const latest = isIncomingLatest(existing, incoming) ? incoming : existing;
  return {
    key,
    test_id: incoming.record.test_id ?? incoming.result.testId ?? 'unknown',
    target: incoming.record.target ?? incoming.result.target ?? 'unknown',
    kept_source_id: existing.source.id,
    incoming_source_id: incoming.source.id,
    kept_timestamp: existing.record.timestamp ?? existing.result.timestamp,
    incoming_timestamp: incoming.record.timestamp ?? incoming.result.timestamp,
    latest_source_id: latest.source.id,
  };
}

function selectRows(
  sources: readonly LoadedSource[],
  duplicatePolicy: CombineDuplicatePolicy,
  promptChoices?: ReadonlyMap<string, PromptDuplicateChoice>,
): { rows: SelectedRow[]; conflicts: DuplicateConflict[] } {
  const rows: SelectedRow[] = [];
  const selectedByKey = new Map<string, number>();
  const conflicts: DuplicateConflict[] = [];

  for (const source of sources) {
    for (let i = 0; i < source.records.length; i++) {
      const row: SelectedRow = {
        source,
        record: source.records[i],
        result: source.results[i],
      };
      const key = resultKey(row.record, row.result);
      const existingIndex = selectedByKey.get(key);
      if (existingIndex === undefined) {
        selectedByKey.set(key, rows.length);
        rows.push(row);
        continue;
      }

      const existing = rows[existingIndex];
      const conflict = buildConflict(existing, row, key);
      conflicts.push(conflict);

      if (duplicatePolicy === 'error') {
        continue;
      }

      const shouldUseLatest =
        duplicatePolicy === 'latest' ||
        (duplicatePolicy === 'prompt' && promptChoices?.get(key) === 'replace');
      if (shouldUseLatest && isIncomingLatest(existing, row)) {
        rows[existingIndex] = row;
      }
    }
  }

  if (conflicts.length > 0 && duplicatePolicy === 'error') {
    throw new CombineDuplicateError(conflicts);
  }
  if (
    conflicts.some((conflict) => !promptChoices?.has(conflict.key)) &&
    duplicatePolicy === 'prompt'
  ) {
    throw new CombineDuplicateError(conflicts);
  }

  return { rows, conflicts };
}

export function inspectRunSourceDuplicates(
  sources: readonly CombineRunSource[],
): readonly DuplicateConflict[] {
  const loaded = loadSources(sources);
  try {
    selectRows(loaded, 'error');
    return [];
  } catch (err) {
    if (err instanceof CombineDuplicateError) {
      return err.conflicts;
    }
    throw err;
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'combined-run';
}

function defaultDisplayName(sources: readonly LoadedSource[]): string {
  return `Combined run (${sources.map((source) => source.displayName).join(' + ')})`;
}

function defaultCombinedRunDir(cwd: string, startedAt: string | undefined): string {
  const parsed = startedAt ? new Date(startedAt) : undefined;
  const timestamp =
    parsed && !Number.isNaN(parsed.getTime())
      ? createRunDirName(parsed)
      : sanitizePathSegment(startedAt ?? 'unknown-time');
  return path.join(cwd, '.agentv', 'results', 'runs', 'combined', timestamp);
}

function uniqueRunDir(baseDir: string): string {
  if (!existsSync(baseDir)) return baseDir;
  let suffix = 1;
  while (existsSync(`${baseDir}-${suffix}`)) {
    suffix++;
  }
  return `${baseDir}-${suffix}`;
}

function toRunId(cwd: string, runDir: string): string {
  const runsRoot = path.join(cwd, '.agentv', 'results', 'runs');
  const relative = path.relative(runsRoot, runDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(runDir);
  }
  const parts = relative.split(path.sep);
  return parts.length > 1 ? `${parts[0]}::${parts.slice(1).join(path.sep)}` : relative;
}

const MANIFEST_PATH_FIELDS = [
  'artifact_dir',
  'grading_path',
  'timing_path',
  'input_path',
  'output_path',
  'response_path',
  'transcript_path',
  'raw_provider_log_path',
  'task_dir',
  'eval_path',
  'targets_path',
  'files_path',
  'graders_path',
] as const;

const POINTER_FAMILIES = {
  trace: 'traces',
  transcript: 'transcripts',
} as const;

function isSafeRelativeArtifactPath(relativePath: string): boolean {
  return !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]+/).includes('..');
}

function copyReferencedArtifact(
  sourceBaseDir: string,
  outputDir: string,
  sourceIndex: number,
  relativePath: string | undefined,
): string | undefined {
  if (!relativePath) return undefined;
  if (!isSafeRelativeArtifactPath(relativePath)) {
    throw new Error(`Unsafe artifact path in source manifest: ${relativePath}`);
  }
  const sourcePath = path.join(sourceBaseDir, relativePath);
  if (!existsSync(sourcePath)) {
    return relativePath;
  }
  const rewritten = path.posix.join(`sources/source-${sourceIndex + 1}`, relativePath);
  const destPath = path.join(outputDir, rewritten);
  const sourceStat = statSync(sourcePath);
  mkdirSync(path.dirname(destPath), { recursive: true });
  if (sourceStat.isDirectory()) {
    cpSync(sourcePath, destPath, { recursive: true });
  } else if (sourceStat.isFile()) {
    copyFileSync(sourcePath, destPath);
  }
  return rewritten;
}

function rewriteArtifactPointer(
  pointerName: keyof typeof POINTER_FAMILIES,
  pointer: ResultArtifactPointerWire | undefined,
  sourceBaseDir: string,
  outputDir: string,
  sourceIndex: number,
): ResultArtifactPointerWire | undefined {
  if (!pointer) {
    return undefined;
  }

  if (!isSafeRelativeArtifactPath(pointer.path)) {
    throw new Error(`Unsafe artifact path in source manifest: ${pointer.path}`);
  }
  const sourcePath = path.join(sourceBaseDir, pointer.path);
  if (!existsSync(sourcePath)) {
    return { ...pointer };
  }

  const rewrittenPath = copyReferencedArtifact(sourceBaseDir, outputDir, sourceIndex, pointer.path);
  if (!rewrittenPath) {
    return { ...pointer };
  }

  const family = pointer.family ?? POINTER_FAMILIES[pointerName];
  return {
    ...pointer,
    path: rewrittenPath,
    key: path.posix.join(family, rewrittenPath),
  };
}

function rewriteTranscriptArtifactPointer(
  pointer: TranscriptArtifactPointerWire | undefined,
  sourceBaseDir: string,
  outputDir: string,
  sourceIndex: number,
): TranscriptArtifactPointerWire | undefined {
  return rewriteArtifactPointer('transcript', pointer, sourceBaseDir, outputDir, sourceIndex) as
    | TranscriptArtifactPointerWire
    | undefined;
}

function rewriteArtifactPointers(
  pointers: ResultArtifactPointersWire | undefined,
  sourceBaseDir: string,
  outputDir: string,
  sourceIndex: number,
): ResultArtifactPointersWire | undefined {
  if (!pointers) {
    return undefined;
  }

  return {
    ...pointers,
    trace: rewriteArtifactPointer('trace', pointers.trace, sourceBaseDir, outputDir, sourceIndex),
    transcript: rewriteTranscriptArtifactPointer(
      pointers.transcript,
      sourceBaseDir,
      outputDir,
      sourceIndex,
    ),
  };
}

function rewriteAndCopyRecord(row: SelectedRow, outputDir: string): ResultManifestRecord {
  const sourceBaseDir = path.dirname(row.source.manifestPath);
  const rewritten: Record<string, unknown> = { ...row.record };
  for (const field of MANIFEST_PATH_FIELDS) {
    rewritten[field] = copyReferencedArtifact(
      sourceBaseDir,
      outputDir,
      row.source.index,
      row.record[field],
    );
  }
  const artifactPointers = rewriteArtifactPointers(
    row.record.artifact_pointers,
    sourceBaseDir,
    outputDir,
    row.source.index,
  );
  rewritten.artifact_pointers = artifactPointers;
  if (
    row.record.transcript_path &&
    rewritten.transcript_path === row.record.transcript_path &&
    artifactPointers?.transcript?.path
  ) {
    rewritten.transcript_path = artifactPointers.transcript.path;
  }
  return rewritten as unknown as ResultManifestRecord;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath: string, records: readonly unknown[]): void {
  writeFileSync(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
}

export function buildCombineRunSources(
  sourcePaths: readonly string[],
  cwd: string,
  options?: {
    ids?: readonly string[];
    displayNames?: readonly string[];
    tags?: readonly string[][];
  },
): CombineRunSource[] {
  return sourcePaths.map((sourcePath, index) => {
    const manifestPath = resolveResultSourcePath(sourcePath, cwd);
    return {
      id: options?.ids?.[index] ?? path.basename(path.dirname(manifestPath)),
      displayName: options?.displayNames?.[index] ?? path.basename(path.dirname(manifestPath)),
      manifestPath,
      tags: options?.tags?.[index],
    };
  });
}

export function combineRunSources(options: CombineRunOptions): CombineRunResult {
  if (options.sources.length < 2) {
    throw new Error('Select at least two runs to combine');
  }

  const loadedSources = loadSources(options.sources);
  const startedAt = earliestTimestamp(loadedSources.map((source) => source.startedAt));
  const displayName = options.displayName?.trim() || defaultDisplayName(loadedSources);
  const runDir = uniqueRunDir(
    options.outputDir
      ? path.resolve(options.cwd, options.outputDir)
      : defaultCombinedRunDir(options.cwd, startedAt),
  );
  const { rows, conflicts } = selectRows(
    loadedSources,
    options.duplicatePolicy,
    options.promptChoices,
  );
  const results = rows
    .map((row) => row.result)
    .sort((a, b) => {
      const left = a.timestamp ?? '';
      const right = b.timestamp ?? '';
      return left.localeCompare(right);
    });

  mkdirSync(runDir, { recursive: true });
  const records = rows.map((row) => rewriteAndCopyRecord(row, runDir));
  const manifestPath = path.join(runDir, 'index.jsonl');
  writeJsonl(manifestPath, records);

  const timing = buildTimingArtifact(results);
  const timingPath = path.join(runDir, 'timing.json');
  writeJson(timingPath, timing);

  const benchmark = buildBenchmarkArtifact(results, '', 'combined', results.length);
  const benchmarkWithMetadata: BenchmarkArtifact & {
    metadata: BenchmarkArtifact['metadata'] & {
      display_name: string;
      combined_from_run_ids: readonly string[];
      combined_from_display_names: readonly string[];
      duplicate_policy: Exclude<CombineDuplicatePolicy, 'prompt'> | 'prompt';
    };
  } = {
    ...benchmark,
    metadata: {
      ...benchmark.metadata,
      timestamp: startedAt ?? benchmark.metadata.timestamp,
      display_name: displayName,
      combined_from_run_ids: loadedSources.map((source) => source.id),
      combined_from_display_names: loadedSources.map((source) => source.displayName),
      duplicate_policy: options.duplicatePolicy,
    },
  };
  const benchmarkPath = path.join(runDir, 'benchmark.json');
  writeJson(benchmarkPath, benchmarkWithMetadata);

  const tags = [...new Set(loadedSources.flatMap((source) => source.tags ?? []))].sort();
  return {
    runDir,
    runId: toRunId(options.cwd, runDir),
    manifestPath,
    benchmarkPath,
    timingPath,
    displayName,
    combinedFromRunIds: loadedSources.map((source) => source.id),
    duplicateConflicts: conflicts,
    testCount: rows.length,
    targetCount: new Set(results.map((result) => result.target ?? 'unknown')).size,
    tags,
  };
}
