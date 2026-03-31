import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';

import { calculateEvaluationSummary } from '../../../src/commands/eval/statistics.js';

function makeResult(testId: string, score: number): EvaluationResult {
  return {
    testId,
    score,
    executionStatus: score >= 0.8 ? 'ok' : 'quality_failure',
  } as EvaluationResult;
}

describe('calculateEvaluationSummary with threshold', () => {
  const results: EvaluationResult[] = [
    makeResult('test-1', 1.0),
    makeResult('test-2', 0.6),
    makeResult('test-3', 0.9),
    makeResult('test-4', 0.4),
  ];

  it('uses default 0.8 threshold when no threshold provided', () => {
    const summary = calculateEvaluationSummary(results);
    // test-1 (1.0) and test-3 (0.9) pass at 0.8
    expect(summary.passedCount).toBe(2);
    expect(summary.qualityFailureCount).toBe(2);
  });

  it('recomputes passed/failed with custom threshold', () => {
    const summary = calculateEvaluationSummary(results, { threshold: 0.5 });
    // test-1 (1.0), test-2 (0.6), test-3 (0.9) pass at 0.5
    expect(summary.passedCount).toBe(3);
    expect(summary.qualityFailureCount).toBe(1);
  });

  it('stricter threshold reduces pass count', () => {
    const summary = calculateEvaluationSummary(results, { threshold: 0.95 });
    // only test-1 (1.0) passes at 0.95
    expect(summary.passedCount).toBe(1);
    expect(summary.qualityFailureCount).toBe(3);
  });

  it('threshold 0 passes everything', () => {
    const summary = calculateEvaluationSummary(results, { threshold: 0 });
    expect(summary.passedCount).toBe(4);
    expect(summary.qualityFailureCount).toBe(0);
  });
});
