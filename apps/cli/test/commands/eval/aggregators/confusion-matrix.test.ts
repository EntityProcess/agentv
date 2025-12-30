import { describe, expect, it } from 'bun:test';
import type { EvaluationResult } from '@agentv/core';

import {
  aggregateConfusionMatrix,
  formatConfusionMatrixSummary,
} from '../../../../src/commands/eval/aggregators/confusion-matrix.js';

function createMockResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: new Date().toISOString(),
    eval_id: 'test-case-1',
    score: 1.0,
    hits: [],
    misses: [],
    candidate_answer: 'test answer',
    target: 'test-target',
    ...overrides,
  };
}

describe('confusion-matrix aggregator', () => {
  describe('aggregateConfusionMatrix', () => {
    it('handles empty results', () => {
      const result = aggregateConfusionMatrix([]);

      expect(result.summary.totalSamples).toBe(0);
      expect(result.summary.parsedSamples).toBe(0);
      expect(result.summary.unparsedSamples).toBe(0);
      expect(result.confusionMatrix.classes).toEqual([]);
      expect(result.overallMetrics.precision).toBe(0);
      expect(result.overallMetrics.recall).toBe(0);
      expect(result.overallMetrics.f1).toBe(0);
    });

    it('parses hits with correct classification format', () => {
      const results = [
        createMockResult({
          eval_id: 'case-1',
          hits: ['Correct: AI=High, Expected=High'],
          misses: [],
        }),
        createMockResult({
          eval_id: 'case-2',
          hits: ['Correct: AI=Low, Expected=Low'],
          misses: [],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.totalSamples).toBe(2);
      expect(result.summary.parsedSamples).toBe(2);
      expect(result.summary.accuracy).toBe(1.0);
      expect(result.confusionMatrix.classes).toContain('High');
      expect(result.confusionMatrix.classes).toContain('Low');
    });

    it('parses misses with mismatch format', () => {
      const results = [
        createMockResult({
          eval_id: 'case-1',
          hits: [],
          misses: ['Mismatch: AI=Low, Expected=High'],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.totalSamples).toBe(1);
      expect(result.summary.parsedSamples).toBe(1);
      expect(result.summary.accuracy).toBe(0);
      expect(result.confusionMatrix.matrix.High.Low).toBe(1);
    });

    it('computes per-class precision, recall, and F1', () => {
      // Create a scenario:
      // - 2 true positives for High (predicted High, actual High)
      // - 1 false positive for High (predicted High, actual Low)
      // - 1 false negative for High (predicted Low, actual High)
      const results = [
        // True positives for High
        createMockResult({
          eval_id: 'case-1',
          hits: ['Correct: AI=High, Expected=High'],
        }),
        createMockResult({
          eval_id: 'case-2',
          hits: ['Correct: AI=High, Expected=High'],
        }),
        // False positive for High (actual was Low)
        createMockResult({
          eval_id: 'case-3',
          misses: ['Mismatch: AI=High, Expected=Low'],
        }),
        // False negative for High (predicted Low, actual High)
        createMockResult({
          eval_id: 'case-4',
          misses: ['Mismatch: AI=Low, Expected=High'],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      // For High class:
      // TP = 2, FP = 1, FN = 1
      // Precision = 2 / (2 + 1) = 0.6667
      // Recall = 2 / (2 + 1) = 0.6667
      // F1 = 2 * 0.6667 * 0.6667 / (0.6667 + 0.6667) = 0.6667
      expect(result.metricsPerClass.High.truePositives).toBe(2);
      expect(result.metricsPerClass.High.falsePositives).toBe(1);
      expect(result.metricsPerClass.High.falseNegatives).toBe(1);
      expect(result.metricsPerClass.High.precision).toBeCloseTo(0.6667, 3);
      expect(result.metricsPerClass.High.recall).toBeCloseTo(0.6667, 3);
      expect(result.metricsPerClass.High.f1).toBeCloseTo(0.6667, 3);
    });

    it('computes accuracy correctly', () => {
      const results = [
        // 3 correct predictions
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ hits: ['Correct: AI=Low, Expected=Low'] }),
        createMockResult({ hits: ['Correct: AI=Medium, Expected=Medium'] }),
        // 1 incorrect prediction
        createMockResult({ misses: ['Mismatch: AI=Low, Expected=High'] }),
      ];

      const result = aggregateConfusionMatrix(results);

      // Accuracy = 3 correct / 4 total = 0.75
      expect(result.summary.accuracy).toBe(0.75);
    });

    it('computes macro-averaged metrics', () => {
      const results = [
        // High: 1 TP, 1 FP (precision = 0.5)
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ misses: ['Mismatch: AI=High, Expected=Low'] }),
        // Low: 2 TP (precision = 1.0)
        createMockResult({ hits: ['Correct: AI=Low, Expected=Low'] }),
        createMockResult({ hits: ['Correct: AI=Low, Expected=Low'] }),
      ];

      const result = aggregateConfusionMatrix(results);

      // Macro precision = (0.5 + 1.0) / 2 = 0.75
      // High: precision = 1/(1+1) = 0.5, recall = 1/(1+0) = 1.0
      // Low: precision = 2/(2+0) = 1.0, recall = 2/(2+1) = 0.6667
      expect(result.overallMetrics.precision).toBeGreaterThan(0);
      expect(result.overallMetrics.recall).toBeGreaterThan(0);
      expect(result.overallMetrics.f1).toBeGreaterThan(0);
    });

    it('handles unparseable results', () => {
      const results = [
        createMockResult({
          eval_id: 'case-1',
          hits: ['Valid JSON', 'Some other hit'],
          misses: [],
        }),
        createMockResult({
          eval_id: 'case-2',
          hits: ['Correct: AI=High, Expected=High'],
          misses: [],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.totalSamples).toBe(2);
      expect(result.summary.parsedSamples).toBe(1);
      expect(result.summary.unparsedSamples).toBe(1);
    });

    it('handles all unparseable results', () => {
      const results = [
        createMockResult({
          eval_id: 'case-1',
          hits: ['Valid JSON'],
          misses: [],
        }),
        createMockResult({
          eval_id: 'case-2',
          hits: ['Something else'],
          misses: [],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.totalSamples).toBe(2);
      expect(result.summary.parsedSamples).toBe(0);
      expect(result.summary.unparsedSamples).toBe(2);
      expect(result.confusionMatrix.classes).toEqual([]);
    });

    it('handles division by zero gracefully', () => {
      // Only misses with no true positives for a class
      const results = [
        createMockResult({
          misses: ['Mismatch: AI=High, Expected=Low'],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      // Low has TP=0, FP=0, FN=1, so precision = 0/(0+0) = 0
      expect(result.metricsPerClass.Low.precision).toBe(0);
      expect(result.metricsPerClass.Low.recall).toBe(0);
      expect(result.metricsPerClass.Low.f1).toBe(0);
    });

    it('discovers classes automatically from results', () => {
      const results = [
        createMockResult({ hits: ['Correct: AI=Alpha, Expected=Alpha'] }),
        createMockResult({ hits: ['Correct: AI=Beta, Expected=Beta'] }),
        createMockResult({ misses: ['Mismatch: AI=Gamma, Expected=Alpha'] }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.confusionMatrix.classes).toContain('Alpha');
      expect(result.confusionMatrix.classes).toContain('Beta');
      expect(result.confusionMatrix.classes).toContain('Gamma');
      expect(result.confusionMatrix.classes).toHaveLength(3);
    });

    it('counts samples per class by actual label', () => {
      const results = [
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ misses: ['Mismatch: AI=Low, Expected=High'] }),
        createMockResult({ hits: ['Correct: AI=Low, Expected=Low'] }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.samplesPerClass.High).toBe(3);
      expect(result.summary.samplesPerClass.Low).toBe(1);
    });
  });

  describe('export-screening scenario', () => {
    it('handles typical export-screening results (High/Medium/Low)', () => {
      // Simulate results from export-screening showcase
      const results = [
        // High risk cases - correctly classified
        createMockResult({
          eval_id: 'exp-high-001',
          hits: [
            'Valid JSON with required keys',
            'riskLevel=High',
            'Correct: AI=High, Expected=High',
          ],
        }),
        createMockResult({
          eval_id: 'exp-high-002',
          hits: [
            'Valid JSON with required keys',
            'riskLevel=High',
            'Correct: AI=High, Expected=High',
          ],
        }),
        // High risk - misclassified as Medium
        createMockResult({
          eval_id: 'exp-high-003',
          hits: ['Valid JSON with required keys', 'riskLevel=Medium'],
          misses: ['Mismatch: AI=Medium, Expected=High'],
        }),
        // Medium risk - correctly classified
        createMockResult({
          eval_id: 'exp-med-001',
          hits: [
            'Valid JSON with required keys',
            'riskLevel=Medium',
            'Correct: AI=Medium, Expected=Medium',
          ],
        }),
        // Medium risk - misclassified as Low
        createMockResult({
          eval_id: 'exp-med-002',
          hits: ['Valid JSON with required keys', 'riskLevel=Low'],
          misses: ['Mismatch: AI=Low, Expected=Medium'],
        }),
        // Low risk - correctly classified
        createMockResult({
          eval_id: 'exp-low-001',
          hits: ['Valid JSON with required keys', 'riskLevel=Low', 'Correct: AI=Low, Expected=Low'],
        }),
        createMockResult({
          eval_id: 'exp-low-002',
          hits: ['Valid JSON with required keys', 'riskLevel=Low', 'Correct: AI=Low, Expected=Low'],
        }),
      ];

      const result = aggregateConfusionMatrix(results);

      expect(result.summary.totalSamples).toBe(7);
      expect(result.summary.parsedSamples).toBe(7);
      expect(result.confusionMatrix.classes).toEqual(['High', 'Low', 'Medium']);

      // Verify confusion matrix values
      expect(result.confusionMatrix.matrix.High.High).toBe(2); // 2 correct High
      expect(result.confusionMatrix.matrix.High.Medium).toBe(1); // 1 High misclassified as Medium
      expect(result.confusionMatrix.matrix.Medium.Medium).toBe(1); // 1 correct Medium
      expect(result.confusionMatrix.matrix.Medium.Low).toBe(1); // 1 Medium misclassified as Low
      expect(result.confusionMatrix.matrix.Low.Low).toBe(2); // 2 correct Low

      // Accuracy = 5 correct / 7 total
      expect(result.summary.accuracy).toBeCloseTo(5 / 7, 3);
    });
  });

  describe('formatConfusionMatrixSummary', () => {
    it('formats empty results', () => {
      const result = aggregateConfusionMatrix([]);
      const formatted = formatConfusionMatrixSummary(result);

      expect(formatted).toContain('CONFUSION MATRIX');
      expect(formatted).toContain('Total samples: 0');
    });

    it('formats results with confusion matrix table', () => {
      const results = [
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ misses: ['Mismatch: AI=Low, Expected=High'] }),
      ];

      const result = aggregateConfusionMatrix(results);
      const formatted = formatConfusionMatrixSummary(result);

      expect(formatted).toContain('CONFUSION MATRIX');
      expect(formatted).toContain('Total samples: 2');
      expect(formatted).toContain('Accuracy:');
      expect(formatted).toContain('Confusion Matrix');
      expect(formatted).toContain('Per-class Metrics:');
      expect(formatted).toContain('Macro Avg');
    });

    it('shows unparsed samples when present', () => {
      const results = [
        createMockResult({ hits: ['Correct: AI=High, Expected=High'] }),
        createMockResult({ hits: ['Some other hit that cannot be parsed'] }),
      ];

      const result = aggregateConfusionMatrix(results);
      const formatted = formatConfusionMatrixSummary(result);

      expect(formatted).toContain('Unparsed samples: 1');
    });
  });
});
