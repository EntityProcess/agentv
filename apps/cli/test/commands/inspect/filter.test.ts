import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type FilterPredicate,
  type FilterableRecord,
  buildFilterPredicate,
  parseFilterableRecords,
} from '../../../src/commands/inspect/filter.js';

// Minimal index.jsonl records for filter testing
const PASS_RECORD = JSON.stringify({
  test_id: 'test-pass',
  target: 'claude',
  score: 1,
  execution_status: 'ok',
  timestamp: '2026-04-01T10:00:00.000Z',
  trace: { tool_calls: { read_file: 3, write_file: 1 } },
});

const FAIL_RECORD = JSON.stringify({
  test_id: 'test-fail',
  target: 'gpt-4',
  score: 0.3,
  execution_status: 'quality_failure',
  timestamp: '2026-04-01T10:01:00.000Z',
  trace: { tool_calls: { read_file: 1 } },
});

const ERROR_RECORD = JSON.stringify({
  test_id: 'test-error',
  target: 'claude',
  score: 0,
  execution_status: 'error',
  error: 'Agent timed out',
  timestamp: '2026-04-01T10:02:00.000Z',
});

const NO_STATUS_PASS = JSON.stringify({
  test_id: 'test-implicit-pass',
  target: 'codex',
  score: 1,
  timestamp: '2026-04-01T10:03:00.000Z',
});

const NO_STATUS_FAIL = JSON.stringify({
  test_id: 'test-implicit-fail',
  target: 'codex',
  score: 0.5,
  timestamp: '2026-04-01T10:04:00.000Z',
});

const OUTPUT_WITH_TOOLS = JSON.stringify({
  test_id: 'test-tools',
  target: 'claude',
  score: 0.8,
  output: [
    {
      role: 'assistant',
      tool_calls: [
        { tool: 'execute_command', input: 'ls' },
        { tool: 'read_file', input: 'README.md' },
      ],
    },
  ],
});

describe('inspect filter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-filter-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseFilterableRecords', () => {
    it('parses valid index.jsonl into filterable records', () => {
      const filePath = path.join(tempDir, 'index.jsonl');
      writeFileSync(filePath, `${PASS_RECORD}\n${FAIL_RECORD}\n`);

      const records = parseFilterableRecords(filePath);

      expect(records).toHaveLength(2);
      expect(records[0].test_id).toBe('test-pass');
      expect(records[0].target).toBe('claude');
      expect(records[0].score).toBe(1);
      expect(records[0].execution_status).toBe('ok');
      expect(records[0].tool_names).toContain('read_file');
      expect(records[0].tool_names).toContain('write_file');

      expect(records[1].test_id).toBe('test-fail');
      expect(records[1].target).toBe('gpt-4');
      expect(records[1].score).toBe(0.3);
    });

    it('extracts tool names from output messages', () => {
      const filePath = path.join(tempDir, 'index.jsonl');
      writeFileSync(filePath, `${OUTPUT_WITH_TOOLS}\n`);

      const records = parseFilterableRecords(filePath);

      expect(records).toHaveLength(1);
      expect(records[0].tool_names).toContain('execute_command');
      expect(records[0].tool_names).toContain('read_file');
    });

    it('returns empty array for unreadable files', () => {
      const records = parseFilterableRecords(
        path.join(tempDir, 'nonexistent.jsonl'),
      );

      expect(records).toHaveLength(0);
    });

    it('skips invalid JSON lines', () => {
      const filePath = path.join(tempDir, 'mixed.jsonl');
      writeFileSync(filePath, `not json\n${PASS_RECORD}\n{broken\n`);

      const records = parseFilterableRecords(filePath);

      expect(records).toHaveLength(1);
      expect(records[0].test_id).toBe('test-pass');
    });

    it('infers experiment name from directory path', () => {
      const expDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'runs',
        'my-experiment',
        '2026-04-01T10-00-00-000Z',
      );
      mkdirSync(expDir, { recursive: true });
      const filePath = path.join(expDir, 'index.jsonl');
      writeFileSync(filePath, `${PASS_RECORD}\n`);

      const records = parseFilterableRecords(filePath);

      expect(records).toHaveLength(1);
      expect(records[0].experiment).toBe('my-experiment');
    });

    it('defaults test_id to "unknown" when missing', () => {
      const record = JSON.stringify({ score: 0.5 });
      const filePath = path.join(tempDir, 'index.jsonl');
      writeFileSync(filePath, `${record}\n`);

      const records = parseFilterableRecords(filePath);

      expect(records).toHaveLength(1);
      expect(records[0].test_id).toBe('unknown');
    });
  });

  describe('buildFilterPredicate', () => {
    const makeRecord = (overrides: Partial<FilterableRecord> = {}): FilterableRecord => ({
      file: '/fake/path',
      test_id: 'test-1',
      score: 0.8,
      tool_names: [],
      ...overrides,
    });

    it('returns all records when no filters are specified', () => {
      const predicate = buildFilterPredicate({});
      expect(predicate(makeRecord())).toBe(true);
      expect(predicate(makeRecord({ score: 0 }))).toBe(true);
      expect(predicate(makeRecord({ score: 1, target: 'claude' }))).toBe(true);
    });

    it('filters by target', () => {
      const predicate = buildFilterPredicate({ target: 'claude' });

      expect(predicate(makeRecord({ target: 'claude' }))).toBe(true);
      expect(predicate(makeRecord({ target: 'gpt-4' }))).toBe(false);
      expect(predicate(makeRecord({}))).toBe(false);
    });

    it('filters by experiment', () => {
      const predicate = buildFilterPredicate({ experiment: 'baseline' });

      expect(predicate(makeRecord({ experiment: 'baseline' }))).toBe(true);
      expect(predicate(makeRecord({ experiment: 'with-skills' }))).toBe(false);
      expect(predicate(makeRecord({}))).toBe(false);
    });

    it('filters by score-below', () => {
      const predicate = buildFilterPredicate({ scoreBelow: 0.5 });

      expect(predicate(makeRecord({ score: 0.3 }))).toBe(true);
      expect(predicate(makeRecord({ score: 0.5 }))).toBe(false);
      expect(predicate(makeRecord({ score: 1 }))).toBe(false);
    });

    it('filters by score-above', () => {
      const predicate = buildFilterPredicate({ scoreAbove: 0.5 });

      expect(predicate(makeRecord({ score: 0.8 }))).toBe(true);
      expect(predicate(makeRecord({ score: 0.5 }))).toBe(false);
      expect(predicate(makeRecord({ score: 0 }))).toBe(false);
    });

    it('filters by status=pass using execution_status', () => {
      const predicate = buildFilterPredicate({ status: 'pass' });

      expect(predicate(makeRecord({ execution_status: 'ok' }))).toBe(true);
      expect(predicate(makeRecord({ execution_status: 'quality_failure' }))).toBe(false);
      expect(predicate(makeRecord({ execution_status: 'error' }))).toBe(false);
    });

    it('filters by status=fail using execution_status', () => {
      const predicate = buildFilterPredicate({ status: 'fail' });

      expect(predicate(makeRecord({ execution_status: 'quality_failure' }))).toBe(true);
      expect(predicate(makeRecord({ execution_status: 'ok' }))).toBe(false);
    });

    it('filters by status=error using execution_status', () => {
      const predicate = buildFilterPredicate({ status: 'error' });

      expect(predicate(makeRecord({ execution_status: 'error' }))).toBe(true);
      expect(predicate(makeRecord({ execution_status: 'timeout' }))).toBe(true);
      expect(predicate(makeRecord({ execution_status: 'ok' }))).toBe(false);
    });

    it('infers status from score when execution_status is missing', () => {
      const passPredicate = buildFilterPredicate({ status: 'pass' });
      expect(passPredicate(makeRecord({ score: 1 }))).toBe(true);
      expect(passPredicate(makeRecord({ score: 0.5 }))).toBe(false);

      const failPredicate = buildFilterPredicate({ status: 'fail' });
      expect(failPredicate(makeRecord({ score: 0.5 }))).toBe(true);
      expect(failPredicate(makeRecord({ score: 1 }))).toBe(false);

      const errorPredicate = buildFilterPredicate({ status: 'error' });
      expect(errorPredicate(makeRecord({ error: 'timeout' }))).toBe(true);
      expect(errorPredicate(makeRecord({}))).toBe(false);
    });

    it('filters by has-tool (substring match)', () => {
      const predicate = buildFilterPredicate({ hasTool: 'read' });

      expect(predicate(makeRecord({ tool_names: ['read_file', 'write_file'] }))).toBe(true);
      expect(predicate(makeRecord({ tool_names: ['execute_command'] }))).toBe(false);
      expect(predicate(makeRecord({ tool_names: [] }))).toBe(false);
    });

    it('combines multiple filters with AND logic', () => {
      const predicate = buildFilterPredicate({
        target: 'claude',
        scoreAbove: 0.5,
        hasTool: 'read',
      });

      // Matches all criteria
      expect(
        predicate(
          makeRecord({
            target: 'claude',
            score: 0.9,
            tool_names: ['read_file'],
          }),
        ),
      ).toBe(true);

      // Fails target
      expect(
        predicate(
          makeRecord({
            target: 'gpt-4',
            score: 0.9,
            tool_names: ['read_file'],
          }),
        ),
      ).toBe(false);

      // Fails score
      expect(
        predicate(
          makeRecord({
            target: 'claude',
            score: 0.3,
            tool_names: ['read_file'],
          }),
        ),
      ).toBe(false);

      // Fails tool
      expect(
        predicate(
          makeRecord({
            target: 'claude',
            score: 0.9,
            tool_names: ['write_file'],
          }),
        ),
      ).toBe(false);
    });
  });
});
