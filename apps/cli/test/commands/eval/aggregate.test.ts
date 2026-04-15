import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';
import { toSnakeCaseDeep } from '../../../src/utils/case-conversion.js';

import {
  aggregateRunDir,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  writePerTestArtifacts,
} from '../../../src/commands/eval/artifact-writer.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2026-04-13T00:00:00.000Z',
    testId: 'test-1',
    score: 0.9,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: [{ role: 'assistant' as const, content: 'test answer' }],
    target: 'test-target',
    executionStatus: 'ok',
    ...overrides,
  } as EvaluationResult;
}

function writeJsonlIndex(dir: string, results: Partial<EvaluationResult>[]): string {
  const indexPath = path.join(dir, 'index.jsonl');
  const lines = results.map((r) => JSON.stringify(toSnakeCaseDeep(makeResult(r)))).join('\n');
  writeFileSync(indexPath, `${lines}\n`);
  return indexPath;
}

// ---------------------------------------------------------------------------
// deduplicateByTestIdTarget
// ---------------------------------------------------------------------------

describe('deduplicateByTestIdTarget', () => {
  it('keeps last entry per (testId, target) pair', () => {
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

  it('reads index.jsonl, deduplicates, writes benchmark.json and timing.json', async () => {
    writeJsonlIndex(tmpDir, [
      { testId: 'a', target: 'x', score: 0.1, executionStatus: 'execution_error' },
      { testId: 'a', target: 'x', score: 0.9, executionStatus: 'ok' },
      { testId: 'b', target: 'x', score: 0.8, executionStatus: 'ok' },
    ]);

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(2);
    expect(result.targetCount).toBe(1);

    const benchmark = JSON.parse(readFileSync(result.benchmarkPath, 'utf8'));
    expect(benchmark.metadata.tests_run).toContain('a');
    expect(benchmark.metadata.tests_run).toContain('b');
    expect(benchmark.run_summary.x).toBeDefined();

    const timing = JSON.parse(readFileSync(result.timingPath, 'utf8'));
    expect(timing.total_tokens).toBeGreaterThanOrEqual(0);
  });

  it('uses last entry for duplicates in benchmark stats', async () => {
    writeJsonlIndex(tmpDir, [
      { testId: 'a', target: 'x', score: 0.0, executionStatus: 'execution_error' },
      { testId: 'a', target: 'x', score: 1.0, executionStatus: 'ok' },
    ]);

    const result = await aggregateRunDir(tmpDir);
    expect(result.testCount).toBe(1);

    const benchmark = JSON.parse(readFileSync(result.benchmarkPath, 'utf8'));
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

    const grading1 = JSON.parse(readFileSync(path.join(tmpDir, 'test-1', 'grading.json'), 'utf8'));
    expect(grading1.assertions).toHaveLength(1);

    const timing1 = JSON.parse(readFileSync(path.join(tmpDir, 'test-1', 'timing.json'), 'utf8'));
    expect(timing1.total_tokens).toBeGreaterThanOrEqual(0);

    const grading2 = JSON.parse(readFileSync(path.join(tmpDir, 'test-2', 'grading.json'), 'utf8'));
    expect(grading2.assertions).toHaveLength(1);
  });

  it('writes response.md for results with output', async () => {
    const results = [
      makeResult({ testId: 'test-1', output: [{ role: 'assistant' as const, content: 'hello' }] }),
    ];

    await writePerTestArtifacts(results, tmpDir);

    const response = readFileSync(path.join(tmpDir, 'test-1', 'outputs', 'response.md'), 'utf8');
    expect(response).toContain('hello');
  });
});
