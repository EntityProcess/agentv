import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listResultFiles, loadResultFile } from '../../../src/commands/trace/utils.js';

// Test JSONL content with trace data
const RESULT_WITH_TRACE = JSON.stringify({
  timestamp: '2026-02-20T21:38:05.833Z',
  test_id: 'test-1',
  dataset: 'demo',
  score: 1,
  hits: ['criterion-1'],
  misses: [],
  target: 'default',
  reasoning: 'Perfect score.',
  trace: {
    event_count: 5,
    tool_names: ['read', 'write'],
    tool_calls_by_name: { read: 3, write: 2 },
    error_count: 0,
    token_usage: { input: 1000, output: 500 },
    cost_usd: 0.05,
    duration_ms: 3200,
    llm_call_count: 2,
  },
});

const RESULT_WITHOUT_TRACE = JSON.stringify({
  timestamp: '2026-02-20T21:38:06.000Z',
  test_id: 'test-2',
  dataset: 'demo',
  score: 0.75,
  hits: ['criterion-1'],
  misses: ['criterion-2'],
  target: 'default',
  reasoning: 'Partial pass.',
});

const RESULT_FAILING = JSON.stringify({
  timestamp: '2026-02-20T21:38:07.000Z',
  test_id: 'test-3',
  dataset: 'demo',
  score: 0,
  hits: [],
  misses: ['criterion-1', 'criterion-2'],
  target: 'gpt-4',
  error: 'Agent timed out.',
});

describe('trace utils', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-trace-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadResultFile', () => {
    it('should load valid JSONL with trace data', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RESULT_WITH_TRACE}\n${RESULT_WITHOUT_TRACE}\n`);

      const results = loadResultFile(filePath);

      expect(results).toHaveLength(2);
      expect(results[0].test_id).toBe('test-1');
      expect(results[0].score).toBe(1);
      expect(results[0].trace).toBeDefined();
      expect(results[0].trace?.event_count).toBe(5);
      expect(results[0].trace?.cost_usd).toBe(0.05);

      expect(results[1].test_id).toBe('test-2');
      expect(results[1].score).toBe(0.75);
      expect(results[1].trace).toBeUndefined();
    });

    it('should handle empty lines', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RESULT_WITH_TRACE}\n\n${RESULT_WITHOUT_TRACE}\n`);

      const results = loadResultFile(filePath);
      expect(results).toHaveLength(2);
    });

    it('should throw on invalid JSON', () => {
      const filePath = path.join(tempDir, 'bad.jsonl');
      writeFileSync(filePath, 'not json\n');

      expect(() => loadResultFile(filePath)).toThrow();
    });
  });

  describe('listResultFiles', () => {
    it('should return empty array when no results directory exists', () => {
      const metas = listResultFiles(tempDir);
      expect(metas).toEqual([]);
    });

    it('should enumerate JSONL files in .agentv/results/', () => {
      const resultsDir = path.join(tempDir, '.agentv', 'results');
      mkdirSync(resultsDir, { recursive: true });

      // Create two result files
      writeFileSync(
        path.join(resultsDir, 'eval_2026-02-20T21-38-05-833Z.jsonl'),
        `${RESULT_WITH_TRACE}\n${RESULT_WITHOUT_TRACE}\n`,
      );
      writeFileSync(
        path.join(resultsDir, 'eval_2026-02-21T10-00-00-000Z.jsonl'),
        `${RESULT_FAILING}\n`,
      );

      const metas = listResultFiles(tempDir);

      expect(metas).toHaveLength(2);
      // Most recent first
      expect(metas[0].filename).toBe('eval_2026-02-21T10-00-00-000Z.jsonl');
      expect(metas[0].testCount).toBe(1);
      expect(metas[0].passRate).toBe(0);

      expect(metas[1].filename).toBe('eval_2026-02-20T21-38-05-833Z.jsonl');
      expect(metas[1].testCount).toBe(2);
      expect(metas[1].passRate).toBe(0.5);
    });

    it('should respect limit', () => {
      const resultsDir = path.join(tempDir, '.agentv', 'results');
      mkdirSync(resultsDir, { recursive: true });

      writeFileSync(
        path.join(resultsDir, 'eval_2026-02-20T21-38-05-833Z.jsonl'),
        `${RESULT_WITH_TRACE}\n`,
      );
      writeFileSync(
        path.join(resultsDir, 'eval_2026-02-21T10-00-00-000Z.jsonl'),
        `${RESULT_FAILING}\n`,
      );

      const metas = listResultFiles(tempDir, 1);
      expect(metas).toHaveLength(1);
      expect(metas[0].filename).toBe('eval_2026-02-21T10-00-00-000Z.jsonl');
    });

    it('should ignore non-JSONL files', () => {
      const resultsDir = path.join(tempDir, '.agentv', 'results');
      mkdirSync(resultsDir, { recursive: true });

      writeFileSync(path.join(resultsDir, 'notes.txt'), 'not a result file');
      writeFileSync(
        path.join(resultsDir, 'eval_2026-02-20T21-38-05-833Z.jsonl'),
        `${RESULT_WITH_TRACE}\n`,
      );

      const metas = listResultFiles(tempDir);
      expect(metas).toHaveLength(1);
    });
  });
});
