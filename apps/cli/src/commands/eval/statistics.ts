import type { EvaluationResult } from '@agentv/core';

export interface HistogramBin {
  readonly range: readonly [number, number];
  count: number;
}

export interface EvaluationSummary {
  readonly total: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation?: number;
  readonly histogram: readonly HistogramBin[];
  readonly topResults: readonly EvaluationResult[];
  readonly bottomResults: readonly EvaluationResult[];
  readonly errorCount: number;
  readonly errors: readonly { readonly testId: string; readonly error: string }[];
}

const HISTOGRAM_BREAKPOINTS = [0, 0.2, 0.4, 0.6, 0.8, 1];

function computeMean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function computeMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeStandardDeviation(values: readonly number[]): number | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const mean = computeMean(values);
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildHistogram(values: readonly number[]): readonly HistogramBin[] {
  const bins: HistogramBin[] = [];
  for (let index = 0; index < HISTOGRAM_BREAKPOINTS.length - 1; index += 1) {
    bins.push({
      range: [HISTOGRAM_BREAKPOINTS[index], HISTOGRAM_BREAKPOINTS[index + 1]] as const,
      count: 0,
    });
  }

  for (const value of values) {
    for (const bin of bins) {
      const [start, end] = bin.range;
      const isLastBin = end === HISTOGRAM_BREAKPOINTS[HISTOGRAM_BREAKPOINTS.length - 1];
      const withinRange = isLastBin
        ? value >= start && value <= end
        : value >= start && value < end + 1e-9;
      if (withinRange) {
        bin.count += 1;
        break;
      }
    }
  }

  return bins;
}

export function calculateEvaluationSummary(
  results: readonly EvaluationResult[],
): EvaluationSummary {
  const scores = results.map((result) => result.score);
  const total = results.length;

  // Track errors
  const errors = results
    .filter((result) => result.error !== undefined)
    .map((result) => ({ testId: result.testId, error: result.error as string }));
  const errorCount = errors.length;

  if (total === 0) {
    return {
      total: 0,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      standardDeviation: undefined,
      histogram: buildHistogram([]),
      topResults: [],
      bottomResults: [],
      errorCount: 0,
      errors: [],
    };
  }

  const mean = computeMean(scores);
  const median = computeMedian(scores);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const standardDeviation = computeStandardDeviation(scores);
  const histogram = buildHistogram(scores);

  const sortedResults = [...results].sort((a, b) => b.score - a.score);
  const topResults = sortedResults.slice(0, Math.min(3, sortedResults.length));
  const bottomResults = sortedResults.slice(-Math.min(3, sortedResults.length));

  return {
    total,
    mean,
    median,
    min,
    max,
    standardDeviation,
    histogram,
    topResults,
    bottomResults,
    errorCount,
    errors,
  };
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

export function formatEvaluationSummary(summary: EvaluationSummary): string {
  if (summary.total === 0) {
    return '\nNo results to summarize';
  }

  const lines: string[] = [];

  // Display errors first if any exist
  if (summary.errorCount > 0) {
    lines.push('\n==================================================');
    lines.push('ERRORS');
    lines.push('==================================================');
    for (const error of summary.errors) {
      lines.push(`\n❌ ${error.testId}`);
      lines.push(`   ${error.error}`);
    }
    lines.push('');
  }

  lines.push('\n==================================================');
  lines.push('EVALUATION SUMMARY');
  lines.push('==================================================');
  lines.push(`Total tests: ${summary.total}`);

  if (summary.errorCount > 0) {
    lines.push(`Failed: ${summary.errorCount}`);
    lines.push(`Passed: ${summary.total - summary.errorCount}`);
  }

  lines.push(`Mean score: ${formatScore(summary.mean)}`);
  lines.push(`Median score: ${formatScore(summary.median)}`);
  lines.push(`Min score: ${formatScore(summary.min)}`);
  lines.push(`Max score: ${formatScore(summary.max)}`);
  if (typeof summary.standardDeviation === 'number') {
    lines.push(`Std deviation: ${formatScore(summary.standardDeviation)}`);
  }

  lines.push('\nScore distribution:');
  for (const bin of summary.histogram) {
    const [start, end] = bin.range;
    lines.push(`  ${start.toFixed(1)}-${end.toFixed(1)}: ${bin.count}`);
  }

  lines.push('\nTop performing tests:');
  summary.topResults.forEach((result, index) => {
    lines.push(`  ${index + 1}. ${result.testId}: ${formatScore(result.score)}`);
  });

  lines.push('\nLowest performing tests:');
  summary.bottomResults.forEach((result, index) => {
    lines.push(`  ${index + 1}. ${result.testId}: ${formatScore(result.score)}`);
  });

  return lines.join('\n');
}

/**
 * Format a matrix summary table showing tests × targets.
 */
export function formatMatrixSummary(results: readonly EvaluationResult[]): string {
  // Collect unique targets and test IDs
  const targetSet = new Set<string>();
  const testIdSet = new Set<string>();
  for (const result of results) {
    targetSet.add(result.target);
    testIdSet.add(result.testId);
  }

  const targets = [...targetSet].sort();
  const testIds = [...testIdSet].sort();

  if (targets.length < 2) {
    return '';
  }

  // Build lookup: testId -> target -> score
  const scoreMap = new Map<string, Map<string, number>>();
  for (const result of results) {
    if (!scoreMap.has(result.testId)) {
      scoreMap.set(result.testId, new Map());
    }
    scoreMap.get(result.testId)?.set(result.target, result.score);
  }

  const lines: string[] = [];
  lines.push('\n==================================================');
  lines.push('MATRIX RESULTS (tests × targets)');
  lines.push('==================================================');

  // Header row
  const testIdColWidth = Math.max(7, ...testIds.map((id) => id.length));
  const targetColWidth = Math.max(7, ...targets.map((t) => t.length));
  const header = `${'Test'.padEnd(testIdColWidth)}  ${targets.map((t) => t.padEnd(targetColWidth)).join('  ')}`;
  lines.push(header);
  lines.push('-'.repeat(header.length));

  // Data rows
  for (const testId of testIds) {
    const cells = targets.map((target) => {
      const score = scoreMap.get(testId)?.get(target);
      return score !== undefined
        ? formatScore(score).padEnd(targetColWidth)
        : '-'.padEnd(targetColWidth);
    });
    lines.push(`${testId.padEnd(testIdColWidth)}  ${cells.join('  ')}`);
  }

  // Per-target averages
  lines.push('-'.repeat(header.length));
  const avgCells = targets.map((target) => {
    const scores = results.filter((r) => r.target === target).map((r) => r.score);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return formatScore(avg).padEnd(targetColWidth);
  });
  lines.push(`${'Average'.padEnd(testIdColWidth)}  ${avgCells.join('  ')}`);

  return lines.join('\n');
}
