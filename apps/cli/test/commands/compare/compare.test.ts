import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  classifyOutcome,
  compareResults,
  determineExitCode,
  loadJsonlResults,
} from '../../../src/commands/compare/index.js';

describe('compare command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-compare-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadJsonlResults', () => {
    it('should load valid JSONL file with evalId results', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(
        filePath,
        '{"evalId": "case-1", "score": 0.8}\n{"evalId": "case-2", "score": 0.9}\n',
      );

      const results = loadJsonlResults(filePath);

      expect(results).toEqual([
        { evalId: 'case-1', score: 0.8 },
        { evalId: 'case-2', score: 0.9 },
      ]);
    });

    it('should accept snake_case eval_id keys', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(
        filePath,
        '{"eval_id": "case-1", "score": 0.8}\n{"eval_id": "case-2", "score": 0.9}\n',
      );

      const results = loadJsonlResults(filePath);

      expect(results).toEqual([
        { evalId: 'case-1', score: 0.8 },
        { evalId: 'case-2', score: 0.9 },
      ]);
    });

    it('should handle empty lines in JSONL', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(
        filePath,
        '{"eval_id": "case-1", "score": 0.8}\n\n{"eval_id": "case-2", "score": 0.9}\n',
      );

      const results = loadJsonlResults(filePath);

      expect(results).toHaveLength(2);
    });

    it('should throw error for missing eval_id', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, '{"score": 0.8}\n');

      expect(() => loadJsonlResults(filePath)).toThrow('Missing evalId/eval_id');
    });

    it('should throw error for missing score', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, '{"eval_id": "case-1"}\n');

      expect(() => loadJsonlResults(filePath)).toThrow('Missing or invalid score');
    });
  });

  describe('classifyOutcome', () => {
    const threshold = 0.1;

    it('should classify as win when delta >= threshold', () => {
      expect(classifyOutcome(0.1, threshold)).toBe('win');
      expect(classifyOutcome(0.5, threshold)).toBe('win');
    });

    it('should classify as loss when delta <= -threshold', () => {
      expect(classifyOutcome(-0.1, threshold)).toBe('loss');
      expect(classifyOutcome(-0.5, threshold)).toBe('loss');
    });

    it('should classify as tie when |delta| < threshold', () => {
      expect(classifyOutcome(0, threshold)).toBe('tie');
      expect(classifyOutcome(0.05, threshold)).toBe('tie');
      expect(classifyOutcome(-0.05, threshold)).toBe('tie');
      expect(classifyOutcome(0.09, threshold)).toBe('tie');
      expect(classifyOutcome(-0.09, threshold)).toBe('tie');
    });

    it('should handle custom threshold', () => {
      expect(classifyOutcome(0.05, 0.05)).toBe('win');
      expect(classifyOutcome(-0.05, 0.05)).toBe('loss');
      expect(classifyOutcome(0.04, 0.05)).toBe('tie');
    });
  });

  describe('compareResults', () => {
    it('should match results by evalId and compute deltas', () => {
      // Use values that avoid floating point precision issues
      const results1 = [
        { evalId: 'case-1', score: 0.5 },
        { evalId: 'case-2', score: 0.75 },
      ];
      const results2 = [
        { evalId: 'case-1', score: 0.7 }, // +0.2 win
        { evalId: 'case-2', score: 0.5 }, // -0.25 loss
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.matched).toHaveLength(2);
      expect(comparison.matched[0].evalId).toBe('case-1');
      expect(comparison.matched[0].score1).toBe(0.5);
      expect(comparison.matched[0].score2).toBe(0.7);
      expect(comparison.matched[0].delta).toBeCloseTo(0.2, 10);
      expect(comparison.matched[0].outcome).toBe('win');

      expect(comparison.matched[1].evalId).toBe('case-2');
      expect(comparison.matched[1].score1).toBe(0.75);
      expect(comparison.matched[1].score2).toBe(0.5);
      expect(comparison.matched[1].delta).toBeCloseTo(-0.25, 10);
      expect(comparison.matched[1].outcome).toBe('loss');
    });

    it('should count unmatched results', () => {
      const results1 = [
        { evalId: 'case-1', score: 0.8 },
        { evalId: 'only-in-1', score: 0.5 },
      ];
      const results2 = [
        { evalId: 'case-1', score: 0.9 },
        { evalId: 'only-in-2', score: 0.6 },
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.unmatched).toEqual({ file1: 1, file2: 1 });
    });

    it('should compute summary statistics', () => {
      // Use values that produce clear deltas above/below threshold
      const results1 = [
        { evalId: 'case-1', score: 0.5 },
        { evalId: 'case-2', score: 0.75 },
        { evalId: 'case-3', score: 0.6 },
      ];
      const results2 = [
        { evalId: 'case-1', score: 0.7 }, // win (+0.2)
        { evalId: 'case-2', score: 0.5 }, // loss (-0.25)
        { evalId: 'case-3', score: 0.65 }, // tie (+0.05)
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.summary.total).toBe(6);
      expect(comparison.summary.matched).toBe(3);
      expect(comparison.summary.wins).toBe(1);
      expect(comparison.summary.losses).toBe(1);
      expect(comparison.summary.ties).toBe(1);
      // meanDelta = (0.2 + (-0.25) + 0.05) / 3 = 0 / 3 = 0
      expect(comparison.summary.meanDelta).toBe(0);
    });

    it('should handle empty results', () => {
      const comparison = compareResults([], [], 0.1);

      expect(comparison.matched).toHaveLength(0);
      expect(comparison.summary.meanDelta).toBe(0);
    });
  });

  describe('determineExitCode', () => {
    it('should return 0 when file2 has better or equal mean score', () => {
      expect(determineExitCode(0)).toBe(0);
      expect(determineExitCode(0.1)).toBe(0);
      expect(determineExitCode(1.0)).toBe(0);
    });

    it('should return 1 when file1 has better mean score', () => {
      expect(determineExitCode(-0.1)).toBe(1);
      expect(determineExitCode(-0.001)).toBe(1);
      expect(determineExitCode(-1.0)).toBe(1);
    });
  });
});
