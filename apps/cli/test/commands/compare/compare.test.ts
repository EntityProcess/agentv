import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  classifyOutcome,
  compareMatrix,
  compareResults,
  computeNormalizedGain,
  determineExitCode,
  determineMatrixExitCode,
  formatMatrix,
  loadCombinedResults,
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
    it('should load index.jsonl manifests from a run workspace', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "case-1", "score": 0.8, "grading_path": "case-1/grading.json", "timing_path": "case-1/timing.json"}\n{"test_id": "case-2", "score": 0.9, "grading_path": "case-2/grading.json", "timing_path": "case-2/timing.json"}\n',
      );

      const results = loadJsonlResults(filePath);

      expect(results).toEqual([
        { testId: 'case-1', score: 0.8 },
        { testId: 'case-2', score: 0.9 },
      ]);
    });

    it('should handle empty lines in index.jsonl manifests', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "case-1", "score": 0.8, "grading_path": "case-1/grading.json", "timing_path": "case-1/timing.json"}\n\n{"test_id": "case-2", "score": 0.9, "grading_path": "case-2/grading.json", "timing_path": "case-2/timing.json"}\n',
      );

      const results = loadJsonlResults(filePath);

      expect(results).toHaveLength(2);
    });

    it('should throw error for missing test_id', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"score": 0.8, "grading_path": "case-1/grading.json", "timing_path": "case-1/timing.json"}\n',
      );

      expect(() => loadJsonlResults(filePath)).toThrow('Missing test_id');
    });

    it('should throw error for missing score', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "case-1", "grading_path": "case-1/grading.json", "timing_path": "case-1/timing.json"}\n',
      );

      expect(() => loadJsonlResults(filePath)).toThrow('Missing or invalid score');
    });

    it('should reject flat JSONL result files', () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      writeFileSync(filePath, '{"test_id": "case-1", "score": 0.8}\n');

      expect(() => loadJsonlResults(filePath)).toThrow(
        'Expected a run workspace directory or index.jsonl manifest',
      );
    });
  });

  describe('loadCombinedResults', () => {
    it('should group records by target field', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        [
          '{"test_id": "t1", "score": 0.8, "target": "model-a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
          '{"test_id": "t2", "score": 0.9, "target": "model-a", "grading_path": "t2/grading.json", "timing_path": "t2/timing.json"}',
          '{"test_id": "t1", "score": 0.7, "target": "model-b", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
          '{"test_id": "t2", "score": 0.85, "target": "model-b", "grading_path": "t2/grading.json", "timing_path": "t2/timing.json"}',
        ].join('\n'),
      );

      const groups = loadCombinedResults(filePath);

      expect(groups.size).toBe(2);
      expect(groups.get('model-a')).toEqual([
        { testId: 't1', score: 0.8 },
        { testId: 't2', score: 0.9 },
      ]);
      expect(groups.get('model-b')).toEqual([
        { testId: 't1', score: 0.7 },
        { testId: 't2', score: 0.85 },
      ]);
    });

    it('should handle three or more targets', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        [
          '{"test_id": "t1", "score": 0.8, "target": "a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
          '{"test_id": "t1", "score": 0.7, "target": "b", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
          '{"test_id": "t1", "score": 0.9, "target": "c", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
        ].join('\n'),
      );

      const groups = loadCombinedResults(filePath);

      expect(groups.size).toBe(3);
      expect(groups.has('a')).toBe(true);
      expect(groups.has('b')).toBe(true);
      expect(groups.has('c')).toBe(true);
    });

    it('should throw error for missing target field', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "t1", "score": 0.8, "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}\n',
      );

      expect(() => loadCombinedResults(filePath)).toThrow('Missing target field');
    });

    it('should throw error for missing test_id', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"score": 0.8, "target": "a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}\n',
      );

      expect(() => loadCombinedResults(filePath)).toThrow('Missing test_id');
    });

    it('should throw error for missing score', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "t1", "target": "a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}\n',
      );

      expect(() => loadCombinedResults(filePath)).toThrow('Missing or invalid score');
    });

    it('should handle empty lines', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        '{"test_id": "t1", "score": 0.8, "target": "a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}\n\n{"test_id": "t2", "score": 0.9, "target": "a", "grading_path": "t2/grading.json", "timing_path": "t2/timing.json"}\n',
      );

      const groups = loadCombinedResults(filePath);
      expect(groups.get('a')).toHaveLength(2);
    });

    it('should group records from index.jsonl manifests', () => {
      const runDir = path.join(tempDir, 'eval_2026-03-24T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      const filePath = path.join(runDir, 'index.jsonl');
      writeFileSync(
        filePath,
        [
          '{"test_id": "t1", "score": 0.8, "target": "model-a", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
          '{"test_id": "t1", "score": 0.7, "target": "model-b", "grading_path": "t1/grading.json", "timing_path": "t1/timing.json"}',
        ].join('\n'),
      );

      const groups = loadCombinedResults(filePath);

      expect(groups.get('model-a')).toEqual([{ testId: 't1', score: 0.8 }]);
      expect(groups.get('model-b')).toEqual([{ testId: 't1', score: 0.7 }]);
    });

    it('should reject flat combined JSONL files', () => {
      const filePath = path.join(tempDir, 'combined-results.jsonl');
      writeFileSync(filePath, '{"test_id": "t1", "score": 0.8, "target": "a"}\n');

      expect(() => loadCombinedResults(filePath)).toThrow(
        'Expected a run workspace directory or index.jsonl manifest',
      );
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
    it('should match results by testId and compute deltas', () => {
      // Use values that avoid floating point precision issues
      const results1 = [
        { testId: 'case-1', score: 0.5 },
        { testId: 'case-2', score: 0.75 },
      ];
      const results2 = [
        { testId: 'case-1', score: 0.7 }, // +0.2 win
        { testId: 'case-2', score: 0.5 }, // -0.25 loss
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.matched).toHaveLength(2);
      expect(comparison.matched[0].testId).toBe('case-1');
      expect(comparison.matched[0].score1).toBe(0.5);
      expect(comparison.matched[0].score2).toBe(0.7);
      expect(comparison.matched[0].delta).toBeCloseTo(0.2, 10);
      expect(comparison.matched[0].outcome).toBe('win');

      expect(comparison.matched[1].testId).toBe('case-2');
      expect(comparison.matched[1].score1).toBe(0.75);
      expect(comparison.matched[1].score2).toBe(0.5);
      expect(comparison.matched[1].delta).toBeCloseTo(-0.25, 10);
      expect(comparison.matched[1].outcome).toBe('loss');
    });

    it('should count unmatched results', () => {
      const results1 = [
        { testId: 'case-1', score: 0.8 },
        { testId: 'only-in-1', score: 0.5 },
      ];
      const results2 = [
        { testId: 'case-1', score: 0.9 },
        { testId: 'only-in-2', score: 0.6 },
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.unmatched).toEqual({ file1: 1, file2: 1 });
    });

    it('should compute summary statistics', () => {
      // Use values that produce clear deltas above/below threshold
      const results1 = [
        { testId: 'case-1', score: 0.5 },
        { testId: 'case-2', score: 0.75 },
        { testId: 'case-3', score: 0.6 },
      ];
      const results2 = [
        { testId: 'case-1', score: 0.7 }, // win (+0.2)
        { testId: 'case-2', score: 0.5 }, // loss (-0.25)
        { testId: 'case-3', score: 0.65 }, // tie (+0.05)
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

  describe('compareMatrix', () => {
    it('should produce matrix with all test IDs and targets', () => {
      const groups = new Map([
        [
          'model-a',
          [
            { testId: 't1', score: 0.8 },
            { testId: 't2', score: 0.9 },
          ],
        ],
        [
          'model-b',
          [
            { testId: 't1', score: 0.7 },
            { testId: 't2', score: 0.85 },
          ],
        ],
      ]);

      const result = compareMatrix(groups, 0.1);

      expect(result.targets).toEqual(['model-a', 'model-b']);
      expect(result.matrix).toHaveLength(2);
      expect(result.matrix[0].testId).toBe('t1');
      expect(result.matrix[0].scores).toEqual({ 'model-a': 0.8, 'model-b': 0.7 });
      expect(result.matrix[1].testId).toBe('t2');
      expect(result.matrix[1].scores).toEqual({ 'model-a': 0.9, 'model-b': 0.85 });
    });

    it('should generate pairwise comparisons for all target pairs', () => {
      const groups = new Map([
        ['a', [{ testId: 't1', score: 0.8 }]],
        ['b', [{ testId: 't1', score: 0.7 }]],
        ['c', [{ testId: 't1', score: 0.9 }]],
      ]);

      const result = compareMatrix(groups, 0.1);

      // 3 targets = 3 pairwise comparisons: a→b, a→c, b→c
      expect(result.pairwise).toHaveLength(3);
      expect(result.pairwise[0].baseline).toBe('a');
      expect(result.pairwise[0].candidate).toBe('b');
      expect(result.pairwise[1].baseline).toBe('a');
      expect(result.pairwise[1].candidate).toBe('c');
      expect(result.pairwise[2].baseline).toBe('b');
      expect(result.pairwise[2].candidate).toBe('c');
    });

    it('should handle missing test IDs in some targets', () => {
      const groups = new Map([
        [
          'a',
          [
            { testId: 't1', score: 0.8 },
            { testId: 't2', score: 0.9 },
          ],
        ],
        ['b', [{ testId: 't1', score: 0.7 }]], // missing t2
      ]);

      const result = compareMatrix(groups, 0.1);

      expect(result.matrix).toHaveLength(2);
      expect(result.matrix[0].scores).toEqual({ a: 0.8, b: 0.7 });
      // t2 has no score for b
      expect(result.matrix[1].scores).toEqual({ a: 0.9 });
    });

    it('should sort targets alphabetically', () => {
      const groups = new Map([
        ['z-model', [{ testId: 't1', score: 0.5 }]],
        ['a-model', [{ testId: 't1', score: 0.5 }]],
        ['m-model', [{ testId: 't1', score: 0.5 }]],
      ]);

      const result = compareMatrix(groups, 0.1);
      expect(result.targets).toEqual(['a-model', 'm-model', 'z-model']);
    });

    it('should sort test IDs alphabetically', () => {
      const groups = new Map([
        [
          'a',
          [
            { testId: 'z-test', score: 0.5 },
            { testId: 'a-test', score: 0.5 },
          ],
        ],
      ]);

      const result = compareMatrix(groups, 0.1);
      expect(result.matrix[0].testId).toBe('a-test');
      expect(result.matrix[1].testId).toBe('z-test');
    });

    it('should compute correct pairwise deltas', () => {
      const groups = new Map([
        ['baseline', [{ testId: 't1', score: 0.5 }]],
        ['candidate', [{ testId: 't1', score: 0.75 }]],
      ]);

      const result = compareMatrix(groups, 0.1);

      expect(result.pairwise).toHaveLength(1);
      expect(result.pairwise[0].summary.meanDelta).toBeCloseTo(0.25, 10);
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

  describe('determineMatrixExitCode', () => {
    it('should return 0 when no baseline is specified', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [],
        targets: ['a', 'b'],
      };
      expect(determineMatrixExitCode(matrixOutput)).toBe(0);
    });

    it('should return 0 when no target regresses vs baseline', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 1,
              losses: 0,
              ties: 0,
              meanDelta: 0.1,
              meanNormalizedGain: null,
            },
            baseline: 'base',
            candidate: 'cand',
          },
        ],
        targets: ['base', 'cand'],
      };
      expect(determineMatrixExitCode(matrixOutput, 'base')).toBe(0);
    });

    it('should return 1 when any target regresses vs baseline', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 0,
              losses: 1,
              ties: 0,
              meanDelta: -0.1,
              meanNormalizedGain: null,
            },
            baseline: 'base',
            candidate: 'cand1',
          },
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 1,
              losses: 0,
              ties: 0,
              meanDelta: 0.1,
              meanNormalizedGain: null,
            },
            baseline: 'base',
            candidate: 'cand2',
          },
        ],
        targets: ['base', 'cand1', 'cand2'],
      };
      expect(determineMatrixExitCode(matrixOutput, 'base')).toBe(1);
    });

    it('should only check pairs involving the baseline target', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 1,
              losses: 0,
              ties: 0,
              meanDelta: 0.05,
              meanNormalizedGain: null,
            },
            baseline: 'base',
            candidate: 'cand1',
          },
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 0,
              losses: 1,
              ties: 0,
              meanDelta: -0.2,
              meanNormalizedGain: null,
            },
            baseline: 'cand1',
            candidate: 'cand2',
          },
        ],
        targets: ['base', 'cand1', 'cand2'],
      };
      // Only the base→cand1 pair matters; cand1→cand2 regression is irrelevant
      expect(determineMatrixExitCode(matrixOutput, 'base')).toBe(0);
    });

    it('should detect regression when baseline sorts after another target', () => {
      // Bug regression: when the designated baseline sorts alphabetically AFTER
      // another target, it appears as .candidate in the pair, not .baseline.
      // e.g. targets: [alpha, zeta] → pair: alpha→zeta, baseline="zeta"
      // delta = zeta_score - alpha_score. If delta > 0, zeta > alpha → alpha regressed.
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            // delta > 0 means candidate (zeta/baseline) scored higher → alpha regressed
            summary: {
              total: 2,
              matched: 1,
              wins: 1,
              losses: 0,
              ties: 0,
              meanDelta: 0.2,
              meanNormalizedGain: null,
            },
            baseline: 'alpha',
            candidate: 'zeta',
          },
        ],
        targets: ['alpha', 'zeta'],
      };
      // zeta is the designated baseline; alpha regressed vs zeta
      expect(determineMatrixExitCode(matrixOutput, 'zeta')).toBe(1);
    });

    it('should return 0 when baseline sorts after but no regression', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            // delta < 0 means candidate (zeta/baseline) scored lower → alpha is better
            // That means alpha did NOT regress vs baseline zeta
            summary: {
              total: 2,
              matched: 1,
              wins: 0,
              losses: 1,
              ties: 0,
              meanDelta: -0.1,
              meanNormalizedGain: null,
            },
            baseline: 'alpha',
            candidate: 'zeta',
          },
        ],
        targets: ['alpha', 'zeta'],
      };
      expect(determineMatrixExitCode(matrixOutput, 'zeta')).toBe(0);
    });

    it('should detect regression with real compareMatrix output where baseline sorts last', () => {
      // End-to-end: use compareMatrix to generate pairs, then check exit code.
      // gemini sorts before gpt-4.1, so gpt-4.1 is the candidate in that pair.
      const groups = new Map([
        ['gemini', [{ testId: 't1', score: 0.5 }]], // gemini regressed vs gpt-4.1
        ['gpt-4.1', [{ testId: 't1', score: 0.9 }]], // baseline
      ]);
      const result = compareMatrix(groups, 0.1);
      // gpt-4.1 is baseline; gemini scored 0.5 vs 0.9 → regression
      expect(determineMatrixExitCode(result, 'gpt-4.1')).toBe(1);
    });
  });

  describe('formatMatrix', () => {
    it('should render matrix table with test IDs as rows and targets as columns', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [
          { testId: 'greeting', scores: { 'model-a': 0.9, 'model-b': 0.85 } },
          { testId: 'code-gen', scores: { 'model-a': 0.7, 'model-b': 0.8 } },
        ],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 4,
              matched: 2,
              wins: 1,
              losses: 1,
              ties: 0,
              meanDelta: 0.025,
              meanNormalizedGain: null,
            },
            baseline: 'model-a',
            candidate: 'model-b',
          },
        ],
        targets: ['model-a', 'model-b'],
      };

      const output = formatMatrix(matrixOutput);

      expect(output).toContain('Score Matrix');
      expect(output).toContain('model-a');
      expect(output).toContain('model-b');
      expect(output).toContain('greeting');
      expect(output).toContain('code-gen');
      expect(output).toContain('0.90');
      expect(output).toContain('0.85');
      expect(output).toContain('Pairwise Summary');
    });

    it('should display empty results message when no data', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [],
        pairwise: [],
        targets: [],
      };

      const output = formatMatrix(matrixOutput);
      expect(output).toContain('No results found');
    });

    it('should include pairwise summary with win/loss/tie counts and delta', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [{ testId: 't1', scores: { a: 0.8, b: 0.9 } }],
        pairwise: [
          {
            matched: [],
            unmatched: { file1: 0, file2: 0 },
            summary: {
              total: 2,
              matched: 1,
              wins: 1,
              losses: 0,
              ties: 0,
              meanDelta: 0.1,
              meanNormalizedGain: null,
            },
            baseline: 'a',
            candidate: 'b',
          },
        ],
        targets: ['a', 'b'],
      };

      const output = formatMatrix(matrixOutput);
      expect(output).toContain('a');
      expect(output).toContain('b');
      expect(output).toContain('1 win');
      expect(output).toContain('0 losses');
    });

    it('should handle missing scores with dashes', () => {
      const matrixOutput: ReturnType<typeof compareMatrix> = {
        matrix: [{ testId: 't1', scores: { a: 0.8 } }], // no score for b
        pairwise: [],
        targets: ['a', 'b'],
      };

      const output = formatMatrix(matrixOutput);
      expect(output).toContain('--');
    });
  });

  describe('computeNormalizedGain', () => {
    it('should compute gain relative to remaining headroom', () => {
      // baseline 0.5, candidate 0.75 → gained 0.25 out of 0.5 headroom = 0.5
      expect(computeNormalizedGain(0.5, 0.75)).toBeCloseTo(0.5, 10);
    });

    it('should return 1.0 when candidate reaches perfect score', () => {
      expect(computeNormalizedGain(0.5, 1.0)).toBeCloseTo(1.0, 10);
    });

    it('should return negative values when candidate regresses', () => {
      // baseline 0.5, candidate 0.25 → lost 0.25 out of 0.5 headroom = -0.5
      expect(computeNormalizedGain(0.5, 0.25)).toBeCloseTo(-0.5, 10);
    });

    it('should return null when baseline is perfect (no headroom)', () => {
      expect(computeNormalizedGain(1.0, 1.0)).toBeNull();
      expect(computeNormalizedGain(1.0, 0.5)).toBeNull();
    });

    it('should return 0 when scores are equal', () => {
      expect(computeNormalizedGain(0.5, 0.5)).toBeCloseTo(0, 10);
    });

    it('should handle low baseline correctly', () => {
      // baseline 0.1, candidate 0.55 → gained 0.45 out of 0.9 headroom = 0.5
      expect(computeNormalizedGain(0.1, 0.55)).toBeCloseTo(0.5, 10);
    });
  });

  describe('compareResults normalized gain', () => {
    it('should include normalizedGain in matched results', () => {
      const results1 = [{ testId: 'case-1', score: 0.5 }];
      const results2 = [{ testId: 'case-1', score: 0.75 }];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.matched[0].normalizedGain).toBeCloseTo(0.5, 10);
    });

    it('should compute meanNormalizedGain in summary', () => {
      const results1 = [
        { testId: 'case-1', score: 0.5 },
        { testId: 'case-2', score: 0.8 },
      ];
      const results2 = [
        { testId: 'case-1', score: 0.75 }, // g = 0.25/0.5 = 0.5
        { testId: 'case-2', score: 0.9 }, // g = 0.1/0.2 = 0.5
      ];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.summary.meanNormalizedGain).toBeCloseTo(0.5, 10);
    });

    it('should set normalizedGain to null when baseline is 1.0', () => {
      const results1 = [{ testId: 'case-1', score: 1.0 }];
      const results2 = [{ testId: 'case-1', score: 1.0 }];

      const comparison = compareResults(results1, results2, 0.1);

      expect(comparison.matched[0].normalizedGain).toBeNull();
      expect(comparison.summary.meanNormalizedGain).toBeNull();
    });

    it('should exclude null gains from mean computation', () => {
      const results1 = [
        { testId: 'case-1', score: 0.5 },
        { testId: 'case-2', score: 1.0 }, // perfect baseline, gain is null
      ];
      const results2 = [
        { testId: 'case-1', score: 0.75 }, // g = 0.5
        { testId: 'case-2', score: 1.0 },
      ];

      const comparison = compareResults(results1, results2, 0.1);

      // Only case-1 contributes to mean (g=0.5); case-2 is excluded
      expect(comparison.summary.meanNormalizedGain).toBeCloseTo(0.5, 10);
    });
  });
});
