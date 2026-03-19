import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseAssertSpec } from '../../../src/commands/trace/score.js';
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
  eval_set: 'demo',
  score: 1,
  assertions: [{ text: 'criterion-1', passed: true }],
  target: 'default',
  trace: {
    event_count: 5,
    tool_calls: { read: 3, write: 2 },
    error_count: 0,
    llm_call_count: 2,
  },
  token_usage: { input: 1000, output: 500 },
  cost_usd: 0.05,
  duration_ms: 3200,
});

const RESULT_WITHOUT_TRACE = JSON.stringify({
  timestamp: '2026-02-20T21:38:06.000Z',
  test_id: 'test-2',
  eval_set: 'demo',
  score: 0.75,
  assertions: [
    { text: 'criterion-1', passed: true },
    { text: 'criterion-2', passed: false },
  ],
  target: 'default',
});

const RESULT_FAILING = JSON.stringify({
  timestamp: '2026-02-20T21:38:07.000Z',
  test_id: 'test-3',
  eval_set: 'demo',
  score: 0,
  assertions: [
    { text: 'criterion-1', passed: false },
    { text: 'criterion-2', passed: false },
  ],
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
      expect(results[0].cost_usd).toBe(0.05);

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

describe('parseAssertSpec', () => {
  describe('deterministic evaluators', () => {
    it('should parse contains spec', () => {
      const config = parseAssertSpec('contains:Hello world');
      expect(config.type).toBe('contains');
      expect(config.name).toBe('contains');
      expect((config as { value: string }).value).toBe('Hello world');
    });

    it('should parse contains with colons in value', () => {
      const config = parseAssertSpec('contains:key: value');
      expect(config.type).toBe('contains');
      expect((config as { value: string }).value).toBe('key: value');
    });

    it('should throw on contains without value', () => {
      expect(() => parseAssertSpec('contains')).toThrow('contains requires a value');
    });

    it('should parse regex spec', () => {
      const config = parseAssertSpec('regex:^Dear User');
      expect(config.type).toBe('regex');
      expect((config as { value: string }).value).toBe('^Dear User');
    });

    it('should throw on regex without pattern', () => {
      expect(() => parseAssertSpec('regex')).toThrow('regex requires a pattern');
    });

    it('should parse is-json spec', () => {
      const config = parseAssertSpec('is-json');
      expect(config.type).toBe('is-json');
    });

    it('should parse equals spec', () => {
      const config = parseAssertSpec('equals:4');
      expect(config.type).toBe('equals');
      expect((config as { value: string }).value).toBe('4');
    });

    it('should throw on equals without value', () => {
      expect(() => parseAssertSpec('equals')).toThrow('equals requires a value');
    });
  });

  describe('trace-based evaluators', () => {
    it('should parse latency spec', () => {
      const config = parseAssertSpec('latency:5000');
      expect(config.type).toBe('latency');
      expect((config as { threshold: number }).threshold).toBe(5000);
    });

    it('should throw on invalid latency value', () => {
      expect(() => parseAssertSpec('latency:abc')).toThrow('latency requires a threshold');
    });

    it('should throw on latency without value', () => {
      expect(() => parseAssertSpec('latency')).toThrow('latency requires a threshold');
    });

    it('should parse cost spec', () => {
      const config = parseAssertSpec('cost:0.10');
      expect(config.type).toBe('cost');
      expect((config as { budget: number }).budget).toBe(0.1);
    });

    it('should throw on cost without value', () => {
      expect(() => parseAssertSpec('cost')).toThrow('cost requires a budget');
    });

    it('should parse token-usage spec with params', () => {
      const config = parseAssertSpec('token_usage:max_total=2000,max_input=1500');
      expect(config.type).toBe('token-usage');
      expect((config as { max_total: number }).max_total).toBe(2000);
      expect((config as { max_input: number }).max_input).toBe(1500);
    });

    it('should parse token-usage spec without params', () => {
      const config = parseAssertSpec('token-usage');
      expect(config.type).toBe('token-usage');
    });

    it('should parse execution-metrics spec', () => {
      const config = parseAssertSpec('execution_metrics:max_tool_calls=10,max_tokens=3000');
      expect(config.type).toBe('execution-metrics');
      expect((config as { max_tool_calls: number }).max_tool_calls).toBe(10);
      expect((config as { max_tokens: number }).max_tokens).toBe(3000);
    });
  });

  describe('unsupported types', () => {
    it('should throw on unknown evaluator type', () => {
      expect(() => parseAssertSpec('llm-grader')).toThrow('Unsupported evaluator type');
    });

    it('should throw on empty spec', () => {
      expect(() => parseAssertSpec('')).toThrow('Unsupported evaluator type');
    });
  });
});
