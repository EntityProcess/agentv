import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendToRunIndex, readRunIndex } from '../../src/evaluation/results-repo.js';
import type { RunIndexEntry } from '../../src/evaluation/results-repo.js';

const ENTRY_A: RunIndexEntry = {
  run_id: '2026-05-21T10-00-00-000Z',
  timestamp: '2026-05-21T10:00:01.000Z',
  experiment: 'default',
  target: 'gpt-4o',
  test_count: 5,
  passed: 4,
  pass_rate: 0.8,
  avg_score: 0.85,
  size_bytes: 12345,
  tags: [],
};

const ENTRY_B: RunIndexEntry = {
  run_id: 'myexp::2026-05-22T11-00-00-000Z',
  timestamp: '2026-05-22T11:00:01.000Z',
  experiment: 'myexp',
  target: 'claude-3-5-sonnet-20241022',
  test_count: 3,
  passed: 3,
  pass_rate: 1.0,
  avg_score: 0.95,
  size_bytes: 8000,
  tags: ['regression'],
  sha: 'abc123',
};

describe('appendToRunIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agentv-run-index-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the file and parent dirs if absent', () => {
    const indexFile = path.join(tmpDir, 'deep', 'index', 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_A);
    expect(existsSync(indexFile)).toBe(true);
  });

  it('writes a valid JSON line per entry', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_A);
    const entries = readRunIndex(indexFile);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(ENTRY_A);
  });

  it('appends successive entries without overwriting', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_A);
    appendToRunIndex(indexFile, ENTRY_B);
    const entries = readRunIndex(indexFile);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(ENTRY_A);
    expect(entries[1]).toEqual(ENTRY_B);
  });

  it('preserves optional sha field when present', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_B);
    const entries = readRunIndex(indexFile);
    expect(entries[0]?.sha).toBe('abc123');
  });

  it('omits sha from JSON when not provided', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_A); // no sha
    const entries = readRunIndex(indexFile);
    expect(entries[0]?.sha).toBeUndefined();
  });
});

describe('readRunIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agentv-run-index-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for missing file', () => {
    const indexFile = path.join(tmpDir, 'nonexistent.jsonl');
    expect(readRunIndex(indexFile)).toEqual([]);
  });

  it('skips blank lines', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    appendToRunIndex(indexFile, ENTRY_A);
    appendToRunIndex(indexFile, ENTRY_B);
    const entries = readRunIndex(indexFile);
    expect(entries).toHaveLength(2);
  });

  it('skips malformed lines without throwing', () => {
    const indexFile = path.join(tmpDir, 'runs.jsonl');
    writeFileSync(indexFile, `${JSON.stringify(ENTRY_A)}\nnot-json\n${JSON.stringify(ENTRY_B)}\n`);
    const entries = readRunIndex(indexFile);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(ENTRY_A);
    expect(entries[1]).toEqual(ENTRY_B);
  });
});
