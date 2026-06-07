import { describe, expect, it } from 'bun:test';

import { aggregateQualityCount, executionErrorCount, summarizeQuality } from './result-summary';

describe('result-summary', () => {
  it('summarizes quality results separately from execution errors', () => {
    const summary = summarizeQuality(
      [
        { score: 1, executionStatus: 'ok' },
        { score: 0.2, executionStatus: 'quality_failure' },
        { score: 0, executionStatus: 'execution_error' },
      ],
      0.8,
    );

    expect(summary).toEqual({
      total: 3,
      qualityTotal: 2,
      passed: 1,
      failed: 1,
      executionErrors: 1,
      passRate: 0.5,
      avgScore: 0.6,
    });
  });

  it('derives aggregate quality counts from snake_case API counters', () => {
    expect(
      aggregateQualityCount({
        eval_count: 5,
        execution_error_count: 2,
      }),
    ).toBe(3);
    expect(executionErrorCount({ execution_error_count: 2 })).toBe(2);
  });
});
