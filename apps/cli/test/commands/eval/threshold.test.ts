import { describe, expect, it } from 'bun:test';

import {
  type EvaluationSummary,
  formatThresholdSummary,
} from '../../../src/commands/eval/statistics.js';

function makeSummary(passed: number, total: number): EvaluationSummary {
  return {
    total,
    mean: 0,
    median: 0,
    min: 0,
    max: 0,
    histogram: [],
    topResults: [],
    bottomResults: [],
    errorCount: 0,
    errors: [],
    executionErrorCount: 0,
    qualityFailureCount: total - passed,
    passedCount: passed,
    byFailureStage: {},
    byFailureReason: {},
  };
}

describe('formatThresholdSummary', () => {
  it('returns PASS when pass rate meets threshold', () => {
    const result = formatThresholdSummary(makeSummary(9, 10), 0.6);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('90.0%');
    expect(result.message).toContain('60.0%');
    expect(result.message).toContain('PASS');
  });

  it('returns FAIL when pass rate is below threshold', () => {
    const result = formatThresholdSummary(makeSummary(5, 10), 0.6);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('50.0%');
    expect(result.message).toContain('60.0%');
    expect(result.message).toContain('FAIL');
  });

  it('returns PASS when pass rate exactly equals threshold', () => {
    const result = formatThresholdSummary(makeSummary(6, 10), 0.6);
    expect(result.passed).toBe(true);
  });

  it('returns PASS for threshold 0 with any pass rate', () => {
    const result = formatThresholdSummary(makeSummary(0, 10), 0);
    expect(result.passed).toBe(true);
  });

  it('excludes execution errors from pass rate calculation', () => {
    const summary = makeSummary(8, 10);
    // 2 execution errors, so graded = 10 - 2 = 8, pass rate = 8/8 = 100%
    (summary as { executionErrorCount: number }).executionErrorCount = 2;
    (summary as { qualityFailureCount: number }).qualityFailureCount = 0;
    const result = formatThresholdSummary(summary, 1.0);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('100.0%');
  });
});
