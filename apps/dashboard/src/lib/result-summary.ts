/**
 * Shared result-summary helpers for Dashboard views.
 *
 * AgentV result rows use `executionStatus` to separate rows that reached
 * quality grading from rows that failed during execution. Use these helpers
 * anywhere the UI shows pass rates, average scores, or failure counts so
 * execution errors are visible but do not depress quality metrics.
 */

export interface ResultSummaryInput {
  readonly score: number;
  readonly executionStatus?: string;
}

export interface QualitySummary {
  readonly total: number;
  readonly qualityTotal: number;
  readonly passed: number;
  readonly failed: number;
  readonly executionErrors: number;
  readonly passRate: number;
  readonly avgScore: number;
}

export function isExecutionError(result: ResultSummaryInput): boolean {
  return result.executionStatus === 'execution_error';
}

export function summarizeQuality(
  results: readonly ResultSummaryInput[],
  passThreshold: number,
): QualitySummary {
  let qualityTotal = 0;
  let passed = 0;
  let executionErrors = 0;
  let scoreSum = 0;

  for (const result of results) {
    if (isExecutionError(result)) {
      executionErrors++;
      continue;
    }

    qualityTotal++;
    scoreSum += result.score;
    if (result.score >= passThreshold) {
      passed++;
    }
  }

  const failed = qualityTotal - passed;
  return {
    total: results.length,
    qualityTotal,
    passed,
    failed,
    executionErrors,
    passRate: qualityTotal > 0 ? passed / qualityTotal : 0,
    avgScore: qualityTotal > 0 ? scoreSum / qualityTotal : 0,
  };
}

export function executionErrorCount(value: { execution_error_count?: number }): number {
  return value.execution_error_count ?? 0;
}

export function qualityTotal(value: { total: number; execution_error_count?: number }): number {
  return Math.max(0, value.total - executionErrorCount(value));
}

export function aggregateQualityCount(value: {
  readonly eval_count: number;
  readonly quality_count?: number;
  readonly execution_error_count?: number;
}): number {
  return value.quality_count ?? Math.max(0, value.eval_count - executionErrorCount(value));
}
