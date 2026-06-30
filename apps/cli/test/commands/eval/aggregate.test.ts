import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type EvaluationResult, buildTraceFromMessages } from '@agentv/core';
import { toSnakeCaseDeep } from '../../../src/utils/case-conversion.js';

import {
  RESULT_INDEX_FILENAME,
  aggregateRunDir,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  writePerTestArtifacts,
} from '../../../src/commands/eval/artifact-writer.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const result = {
    timestamp: '2026-04-13T00:00:00.000Z',
    testId: 'test-1',
    score: 0.9,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: 'test answer',
    target: 'test-target',
    executionStatus: 'ok',
    ...overrides,
  } as EvaluationResult;

  return {
    ...result,
    trace:
      result.trace ??
      buildTraceFromMessages({
        output: result.output ? [{ role: 'assistant', content: result.output }] : [],
        finalOutput: result.output,
        target: result.target,
        testId: result.testId,
      }),
  };
}

function writeJsonlIndex(
  dir: string,
  results: Partial<EvaluationResult>[],
  filename = RESULT_INDEX_FILENAME,
): string {
  const indexPath = path.join(dir, filename);
  const lines = results.map((r) => JSON.stringify(toSnakeCaseDeep(makeResult(r)))).join('\n');
  writeFileSync(indexPath, `${lines}\n`);
  return indexPath;
}

function readIndexRows(dir: string): Array<{ test_id: string; result_dir: string }> {
  const indexPath = path.join(dir, RESULT_INDEX_FILENAME);
  if (!existsSync(indexPath)) {
    return readdirSync(dir)
      .filter((entry) => /--[a-f0-9]{12}$/.test(entry))
      .map((entry) => ({ test_id: entry.replace(/--[a-f0-9]{12}$/, ''), result_dir: entry }));
  }
  return readFileSync(indexPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { test_id: string; result_dir: string });
}

function rowRunPath(dir: string, testId: string, ...segments: string[]): string {
  const row = readIndexRows(dir).find((entry) => entry.test_id === testId);
  expect(row?.result_dir).toMatch(new RegExp(`^${testId}--[a-f0-9]{12}$`));
  return path.join(dir, row?.result_dir ?? '', ...segments);
}

// ---------------------------------------------------------------------------
// deduplicateByTestIdTarget
// ---------------------------------------------------------------------------

describe('deduplicateByTestIdTarget', () => {
  it('keeps last entry per (testId, target, variant) tuple', () => {
    const results = [
      makeResult({ testId: 'a', target: 'x', score: 0.1 }),
      makeResult({ testId: 'a', target: 'x', score: 0.9 }),
      makeResult({ testId: 'b', target: 'x', score: 0.5 }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].testId).toBe('a');
    expect(deduped[0].score).toBe(0.9);
    expect(deduped[1].testId).toBe('b');
  });

  it('keeps entries with different targets', () => {
    const results = [
      makeResult({ testId: 'a', target: 'x', score: 0.3 }),
      makeResult({ testId: 'a', target: 'y', score: 0.7 }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
  });

  it('keeps entries with different variants for the same test and target', () => {
    const results = [
      makeResult({ testId: 'a', target: 'x', variant: 'baseline', score: 0.3 }),
      makeResult({ testId: 'a', target: 'x', variant: 'candidate', score: 0.7 }),
      makeResult({ testId: 'a', target: 'x', variant: 'candidate', score: 0.9 }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => [r.variant, r.score])).toEqual([
      ['baseline', 0.3],
      ['candidate', 0.9],
    ]);
  });

  it('keeps entries with different suites for the same test and target', () => {
    const results = [
      makeResult({ suite: 'suite-a', testId: 'a', target: 'x', score: 0.3 }),
      makeResult({ suite: 'suite-b', testId: 'a', target: 'x', score: 0.7 }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => r.suite)).toEqual(['suite-a', 'suite-b']);
  });

  it('keeps duplicate suite labels from different eval paths', () => {
    const results = [
      makeResult({
        suite: 'duplicate-suite',
        testId: 'a',
        target: 'x',
        source: {
          evalFilePath: 'evals/a/cases.eval.yaml',
          evalFileAbsolutePath: '/repo/evals/a/cases.eval.yaml',
          testId: 'a',
          testSnapshotYaml: 'id: a\n',
          graderDefinitions: [],
          references: [],
        },
      }),
      makeResult({
        suite: 'duplicate-suite',
        testId: 'a',
        target: 'x',
        source: {
          evalFilePath: 'evals/b/cases.eval.yaml',
          evalFileAbsolutePath: '/repo/evals/b/cases.eval.yaml',
          testId: 'a',
          testSnapshotYaml: 'id: a\n',
          graderDefinitions: [],
          references: [],
        },
      }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(deduplicateByTestIdTarget([])).toHaveLength(0);
  });

  it('preserves order with no duplicates', () => {
    const results = [
      makeResult({ testId: 'a', target: 'x' }),
      makeResult({ testId: 'b', target: 'x' }),
      makeResult({ testId: 'c', target: 'x' }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped.map((r) => r.testId)).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates multiple duplicate pairs', () => {
    const results = [
      makeResult({ testId: 'a', target: 'x', score: 0.1 }),
      makeResult({ testId: 'b', target: 'x', score: 0.2 }),
      makeResult({ testId: 'a', target: 'x', score: 0.3 }),
      makeResult({ testId: 'b', target: 'x', score: 0.4 }),
    ];
    const deduped = deduplicateByTestIdTarget(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].score).toBe(0.3);
    expect(deduped[1].score).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// aggregateRunDir
// ---------------------------------------------------------------------------

describe('aggregateRunDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'aggregate-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads index.jsonl, deduplicates, and writes summary.json with timing rollups', async () => {
    writeJsonlIndex(tmpDir, [
      { testId: 'a', target: 'x', score: 0.1, executionStatus: 'execution_error' },
      { testId: 'a', target: 'x', score: 0.9, executionStatus: 'ok' },
      { testId: 'b', target: 'x', score: 0.8, executionStatus: 'ok' },
    ]);

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(2);
    expect(result.targetCount).toBe(1);

    const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    expect(summary.manifest_path).toBe(RESULT_INDEX_FILENAME);
    expect(summary.metadata.tests_run).toContain('a');
    expect(summary.metadata.tests_run).toContain('b');
    expect(summary.run_summary.x).toBeDefined();
    expect(summary.timing.total_tokens).toBeGreaterThanOrEqual(0);
  });

  it('reads canonical index.jsonl bundles', async () => {
    writeJsonlIndex(
      tmpDir,
      [
        { testId: 'case-a', target: 'x', score: 0.9, executionStatus: 'ok' },
        { testId: 'case-b', target: 'x', score: 0.8, executionStatus: 'ok' },
      ],
      'index.jsonl',
    );

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(2);

    const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    expect(summary.manifest_path).toBe(RESULT_INDEX_FILENAME);
    expect(summary.metadata.tests_run).toEqual(['case-a', 'case-b']);
  });

  it('uses last entry for duplicates in benchmark stats', async () => {
    writeJsonlIndex(tmpDir, [
      { testId: 'a', target: 'x', score: 0.0, executionStatus: 'execution_error' },
      { testId: 'a', target: 'x', score: 1.0, executionStatus: 'ok' },
    ]);

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(1);

    const benchmark = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    // Should have 100% pass rate since the last entry is ok with score 1.0
    expect(benchmark.run_summary.x.pass_rate.mean).toBe(1);
  });

  it('handles multi-target results', async () => {
    writeJsonlIndex(tmpDir, [
      { testId: 'a', target: 'x', score: 0.9 },
      { testId: 'a', target: 'y', score: 0.8 },
    ]);

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(2);
    expect(result.targetCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// writePerTestArtifacts
// ---------------------------------------------------------------------------

describe('writePerTestArtifacts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'per-test-artifacts-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes grading.json and timing.json for each result', async () => {
    const results = [makeResult({ testId: 'test-1' }), makeResult({ testId: 'test-2' })];

    await writePerTestArtifacts(results, tmpDir);

    const grading1 = JSON.parse(
      readFileSync(rowRunPath(tmpDir, 'test-1', 'run-1', 'grading.json'), 'utf8'),
    );
    expect(grading1.assertions).toHaveLength(1);

    const timing1 = JSON.parse(
      readFileSync(rowRunPath(tmpDir, 'test-1', 'run-1', 'timing.json'), 'utf8'),
    );
    expect(timing1.total_tokens).toBeGreaterThanOrEqual(0);

    const grading2 = JSON.parse(
      readFileSync(rowRunPath(tmpDir, 'test-2', 'run-1', 'grading.json'), 'utf8'),
    );
    expect(grading2.assertions).toHaveLength(1);
  });

  it('writes outputs/answer.md for results with output', async () => {
    const results = [makeResult({ testId: 'test-1', output: 'hello' })];

    await writePerTestArtifacts(results, tmpDir);

    const answer = readFileSync(
      rowRunPath(tmpDir, 'test-1', 'run-1', 'outputs', 'answer.md'),
      'utf8',
    );
    expect(answer).toContain('hello');
  });
});
