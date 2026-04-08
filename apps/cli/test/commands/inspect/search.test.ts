import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type SearchMatch, searchJsonlFile } from '../../../src/commands/inspect/search.js';

// Minimal JSONL records for search testing
const RECORD_A = JSON.stringify({
  test_id: 'test-alpha',
  target: 'claude',
  experiment: 'baseline',
  score: 1,
  output: 'The quick brown fox jumps over the lazy dog',
});

const RECORD_B = JSON.stringify({
  test_id: 'test-beta',
  target: 'gpt-4',
  experiment: 'baseline',
  score: 0.5,
  output: 'Hello world from the agent',
  error: 'partial failure',
});

const RECORD_C = JSON.stringify({
  test_id: 'test-gamma',
  target: 'claude',
  experiment: 'with-skills',
  score: 0,
  output: 'Something completely different',
});

describe('inspect search', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-search-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('searchJsonlFile', () => {
    it('finds matches in JSONL content', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

      const matches = searchJsonlFile(filePath, /quick brown fox/i);

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('test-alpha');
      expect(matches[0].lineNumber).toBe(1);
      expect(matches[0].snippet).toContain('quick brown fox');
      expect(matches[0].target).toBe('claude');
      expect(matches[0].experiment).toBe('baseline');
      expect(matches[0].score).toBe(1);
    });

    it('returns empty array when no matches', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n`);

      const matches = searchJsonlFile(filePath, /nonexistent pattern/);

      expect(matches).toHaveLength(0);
    });

    it('matches across multiple lines', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

      // "test-" appears in all records
      const matches = searchJsonlFile(filePath, /test-/);

      expect(matches).toHaveLength(3);
      expect(matches.map((m) => m.id)).toEqual(['test-alpha', 'test-beta', 'test-gamma']);
    });

    it('applies target filter', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

      // Search for "test-" but only target=claude
      const matches = searchJsonlFile(filePath, /test-/, 'claude');

      expect(matches).toHaveLength(2);
      expect(matches.every((m) => m.target === 'claude')).toBe(true);
    });

    it('applies experiment filter', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

      const matches = searchJsonlFile(filePath, /test-/, undefined, 'with-skills');

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('test-gamma');
      expect(matches[0].experiment).toBe('with-skills');
    });

    it('applies both target and experiment filters', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, `${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

      const matches = searchJsonlFile(filePath, /test-/, 'claude', 'with-skills');

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('test-gamma');
    });

    it('returns empty array for unreadable files', () => {
      const matches = searchJsonlFile(path.join(tempDir, 'nonexistent.jsonl'), /pattern/);

      expect(matches).toHaveLength(0);
    });

    it('skips invalid JSON lines', () => {
      const filePath = path.join(tempDir, 'mixed.jsonl');
      writeFileSync(filePath, `not json\n${RECORD_A}\n{broken\n`);

      const matches = searchJsonlFile(filePath, /quick brown fox/);

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('test-alpha');
    });

    it('uses line number as fallback id when test_id is missing', () => {
      const recordNoId = JSON.stringify({
        score: 0.5,
        output: 'something searchable',
      });
      const filePath = path.join(tempDir, 'no-id.jsonl');
      writeFileSync(filePath, `${recordNoId}\n`);

      const matches = searchJsonlFile(filePath, /searchable/);

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('line-1');
    });

    it('extracts snippet with context around the match', () => {
      const longOutput = `${'A'.repeat(100)}NEEDLE${'B'.repeat(100)}`;
      const record = JSON.stringify({
        test_id: 'test-long',
        score: 1,
        output: longOutput,
      });
      const filePath = path.join(tempDir, 'long.jsonl');
      writeFileSync(filePath, `${record}\n`);

      const matches = searchJsonlFile(filePath, /NEEDLE/);

      expect(matches).toHaveLength(1);
      expect(matches[0].snippet).toContain('NEEDLE');
      // Snippet should be truncated (not the full line)
      expect(matches[0].snippet.length).toBeLessThan(record.length);
    });
  });
});
