import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadErrorTestIds, loadNonErrorResults } from '../../src/commands/eval/retry-errors.js';

describe('retry-errors', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createJsonlFile(lines: object[]): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-test-'));
    const filePath = path.join(tmpDir, 'results.jsonl');
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
    return filePath;
  }

  function createIndexFile(lines: object[]): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-index-test-'));
    const filePath = path.join(tmpDir, 'index.jsonl');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
    return filePath;
  }

  it('loadErrorTestIds returns only execution_error test IDs', async () => {
    const filePath = createJsonlFile([
      { testId: 'case-1', executionStatus: 'ok', score: 0.9 },
      { testId: 'case-2', executionStatus: 'execution_error', score: 0, error: 'timeout' },
      { testId: 'case-3', executionStatus: 'quality_failure', score: 0.3 },
      { testId: 'case-4', executionStatus: 'execution_error', score: 0, error: 'provider failed' },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-2', 'case-4']);
  });

  it('loadErrorTestIds deduplicates IDs', async () => {
    const filePath = createJsonlFile([
      { testId: 'case-1', executionStatus: 'execution_error', score: 0 },
      { testId: 'case-1', executionStatus: 'execution_error', score: 0 },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-1']);
  });

  it('loadErrorTestIds returns empty array when no errors', async () => {
    const filePath = createJsonlFile([
      { testId: 'case-1', executionStatus: 'ok', score: 0.9 },
      { testId: 'case-2', executionStatus: 'quality_failure', score: 0.5 },
    ]);

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual([]);
  });

  it('loadNonErrorResults returns only non-error results', async () => {
    const filePath = createJsonlFile([
      { testId: 'case-1', executionStatus: 'ok', score: 0.9 },
      { testId: 'case-2', executionStatus: 'execution_error', score: 0 },
      { testId: 'case-3', executionStatus: 'quality_failure', score: 0.5 },
    ]);

    const results = await loadNonErrorResults(filePath);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('case-1');
    expect(results[1].testId).toBe('case-3');
  });

  it('supports snake_case result files written by the CLI', async () => {
    const filePath = createJsonlFile([
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

  it('supports index.jsonl manifests during the migration', async () => {
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

  it('skips malformed JSON lines', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'retry-errors-test-'));
    const filePath = path.join(tmpDir, 'results.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({ testId: 'case-1', executionStatus: 'execution_error', score: 0 }),
        'not valid json',
        '',
        JSON.stringify({ testId: 'case-2', executionStatus: 'ok', score: 0.9 }),
      ].join('\n'),
    );

    const ids = await loadErrorTestIds(filePath);
    expect(ids).toEqual(['case-1']);

    const results = await loadNonErrorResults(filePath);
    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('case-2');
  });
});
