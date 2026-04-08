import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildExclusionFilter,
  loadErrorTestIds,
  loadFullyCompletedTestIds,
  loadNonErrorResults,
} from '../../src/commands/eval/retry-errors.js';

describe('retry-errors', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createIndexFile(lines: object[]): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-test-'));
    const filePath = path.join(tmpDir, 'index.jsonl');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
    return filePath;
  }

  function createFlatJsonlFile(lines: object[]): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-flat-test-'));
    const filePath = path.join(tmpDir, 'results.jsonl');
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
    return filePath;
  }

  it('loadErrorTestIds returns only execution_error test IDs', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0, error: 'timeout' },
      { test_id: 'case-3', execution_status: 'quality_failure', score: 0.3 },
      {
        test_id: 'case-4',
        execution_status: 'execution_error',
        score: 0,
        error: 'provider failed',
      },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-2', 'case-4']);
  });

  it('loadErrorTestIds deduplicates IDs', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'execution_error', score: 0 },
      { test_id: 'case-1', execution_status: 'execution_error', score: 0 },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-1']);
  });

  it('loadErrorTestIds returns empty array when no errors', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'quality_failure', score: 0.5 },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual([]);
  });

  it('loadNonErrorResults returns only non-error results', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0 },
      { test_id: 'case-3', execution_status: 'quality_failure', score: 0.5 },
    ]);

    const results = await loadNonErrorResults(filePath);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('case-1');
    expect(results[1].testId).toBe('case-3');
  });

  it('supports index.jsonl manifests written by the CLI', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0 },
      { test_id: 'case-3', execution_status: 'quality_failure', score: 0.5 },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-2']);

    const results = await loadNonErrorResults(filePath);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('case-1');
    expect(results[1].testId).toBe('case-3');
  });

  it('rejects flat JSONL result files', async () => {
    const filePath = createFlatJsonlFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0 },
    ]);

    await expect(loadErrorTestIds(filePath)).rejects.toThrow(
      'Expected a run workspace directory or index.jsonl manifest',
    );
    await expect(loadNonErrorResults(filePath)).rejects.toThrow(
      'Expected a run workspace directory or index.jsonl manifest',
    );
  });

  it('supports index.jsonl manifests', async () => {
    const filePath = createIndexFile([
      {
        test_id: 'case-1',
        execution_status: 'ok',
        score: 0.9,
        grading_path: 'case-1/grading.json',
        timing_path: 'case-1/timing.json',
      },
      {
        test_id: 'case-2',
        execution_status: 'execution_error',
        score: 0,
        grading_path: 'case-2/grading.json',
        timing_path: 'case-2/timing.json',
      },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-2']);
  });

  it('loadFullyCompletedTestIds returns only non-error test IDs', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0, error: 'timeout' },
      { test_id: 'case-3', execution_status: 'quality_failure', score: 0.3 },
      {
        test_id: 'case-4',
        execution_status: 'execution_error',
        score: 0,
        error: 'provider failed',
      },
    ]);

    const ids = await loadFullyCompletedTestIds(filePath);
    expect(ids).toEqual(['case-1', 'case-3']);
  });

  it('loadFullyCompletedTestIds returns empty array when all are errors', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'execution_error', score: 0 },
      { test_id: 'case-2', execution_status: 'execution_error', score: 0 },
    ]);

    const ids = await loadFullyCompletedTestIds(filePath);
    expect(ids).toEqual([]);
  });

  it('loadFullyCompletedTestIds excludes IDs that errored on any target (matrix safety)', async () => {
    const filePath = createIndexFile([
      { test_id: 'case-1', execution_status: 'ok', score: 0.9, target: 'gpt-4' },
      { test_id: 'case-1', execution_status: 'execution_error', score: 0, target: 'claude' },
      { test_id: 'case-2', execution_status: 'ok', score: 0.8, target: 'gpt-4' },
      { test_id: 'case-2', execution_status: 'ok', score: 0.7, target: 'claude' },
    ]);

    const ids = await loadFullyCompletedTestIds(filePath);
    // case-1 errored on claude, so it should NOT be excluded from retry
    expect(ids).toEqual(['case-2']);
  });

  it('buildExclusionFilter escapes glob metacharacters in test IDs', () => {
    expect(buildExclusionFilter(['simple'])).toBe('!simple');
    expect(buildExclusionFilter(['a', 'b'])).toBe('!{a,b}');
    // Braces, brackets, stars, question marks should be escaped
    expect(buildExclusionFilter(['test[1]'])).toBe('!test\\[1\\]');
    expect(buildExclusionFilter(['test{a}'])).toBe('!test\\{a\\}');
    expect(buildExclusionFilter(['test*'])).toBe('!test\\*');
    expect(buildExclusionFilter(['test?'])).toBe('!test\\?');
    expect(buildExclusionFilter(['!negated'])).toBe('!\\!negated');
  });

  it('throws on malformed index.jsonl lines', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-test-'));
    const filePath = path.join(tmpDir, 'index.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({ test_id: 'case-1', execution_status: 'execution_error', score: 0 }),
        'not valid json',
        '',
        JSON.stringify({ test_id: 'case-2', execution_status: 'ok', score: 0.9 }),
      ].join('\n'),
    );

    await expect(loadErrorTestIds(filePath)).rejects.toThrow();
    await expect(loadNonErrorResults(filePath)).rejects.toThrow();
  });
});
