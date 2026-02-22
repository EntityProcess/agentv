import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { percentile } from '../../../src/commands/trace/stats.js';
import {
  extractTimestampFromFilename,
  formatDuration,
  listResultFiles,
  loadResultFile,
} from '../../../src/commands/trace/utils.js';

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

    it('should throw on missing score', () => {
      const filePath = path.join(tempDir, 'no-score.jsonl');
      writeFileSync(filePath, '{"test_id": "test-1"}\n');

      expect(() => loadResultFile(filePath)).toThrow('Missing or invalid score');
    });

    it('should throw on non-numeric score', () => {
      const filePath = path.join(tempDir, 'bad-score.jsonl');
      writeFileSync(filePath, '{"test_id": "test-1", "score": "high"}\n');

      expect(() => loadResultFile(filePath)).toThrow('Missing or invalid score');
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

  describe('extractTimestampFromFilename', () => {
    it('should extract and format timestamp from eval filename', () => {
      const result = extractTimestampFromFilename('eval_2026-02-20T21-38-05-833Z.jsonl');
      expect(result).toBe('2026-02-20T21:38:05.833Z');
    });

    it('should return undefined for non-matching filenames', () => {
      expect(extractTimestampFromFilename('random-file.jsonl')).toBeUndefined();
      expect(extractTimestampFromFilename('results.jsonl')).toBeUndefined();
    });

    it('should handle different timestamp values', () => {
      const result = extractTimestampFromFilename('eval_2026-01-01T00-00-00-000Z.jsonl');
      expect(result).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(50)).toBe('50ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(1500)).toBe('1.5s');
      expect(formatDuration(15080)).toBe('15.1s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60000)).toBe('1m0s');
      expect(formatDuration(90000)).toBe('1m30s');
    });
  });
});

describe('percentile', () => {
  it('should return 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('should return the value for single element', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it('should compute P50 (median) correctly', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('should compute P0 and P100', () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it('should interpolate for fractional indices', () => {
    // P25 of [1,2,3,4,5]: index = 0.25 * 4 = 1.0 → exact at index 1 → 2
    expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);

    // P75 of [1,2,3,4,5]: index = 0.75 * 4 = 3.0 → exact at index 3 → 4
    expect(percentile([1, 2, 3, 4, 5], 75)).toBe(4);

    // P90 of [1,2,3,4,5]: index = 0.9 * 4 = 3.6 → interpolate between 4 and 5
    expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6);
  });

  it('should work with two elements', () => {
    // P50 of [10, 20]: index = 0.5 * 1 = 0.5 → interpolate between 10 and 20
    expect(percentile([10, 20], 50)).toBe(15);
  });
});
