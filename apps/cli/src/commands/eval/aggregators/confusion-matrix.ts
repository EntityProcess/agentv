import type { EvaluationResult } from '@agentv/core';

/**
 * Result of confusion matrix aggregation.
 */
export interface ConfusionMatrixResult {
  readonly summary: {
    readonly totalSamples: number;
    readonly parsedSamples: number;
    readonly unparsedSamples: number;
    readonly samplesPerClass: Record<string, number>;
    readonly accuracy: number;
  };
  readonly confusionMatrix: {
    readonly classes: readonly string[];
    readonly matrix: Record<string, Record<string, number>>;
    readonly description: string;
  };
  readonly metricsPerClass: Record<
    string,
    {
      readonly truePositives: number;
      readonly falsePositives: number;
      readonly falseNegatives: number;
      readonly precision: number;
      readonly recall: number;
      readonly f1: number;
    }
  >;
  readonly overallMetrics: {
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  };
}

/**
 * Parse classification comparison from evaluator hits/misses strings.
 *
 * Recognized patterns:
 * - "Correct: AI=High, Expected=High"
 * - "Mismatch: AI=Low, Expected=High"
 * - Other patterns with AI=X, Expected=Y
 */
function parseClassification(
  result: EvaluationResult,
): { predicted: string; actual: string } | undefined {
  const comparisonPattern = /AI=(\w+),?\s*Expected=(\w+)/;

  // Check misses first (misclassifications)
  for (const miss of result.misses) {
    const match = comparisonPattern.exec(miss);
    if (match) {
      return { predicted: match[1], actual: match[2] };
    }
  }

  // Check hits (correct classifications)
  for (const hit of result.hits) {
    const match = comparisonPattern.exec(hit);
    if (match) {
      return { predicted: match[1], actual: match[2] };
    }
  }

  return undefined;
}

/**
 * Build a confusion matrix from evaluation results.
 */
function buildConfusionMatrix(
  results: readonly EvaluationResult[],
  classes: readonly string[],
): {
  matrix: Record<string, Record<string, number>>;
  parsedCount: number;
  unparsedCount: number;
} {
  // Initialize matrix
  const matrix: Record<string, Record<string, number>> = {};
  for (const expected of classes) {
    matrix[expected] = {};
    for (const predicted of classes) {
      matrix[expected][predicted] = 0;
    }
  }

  let parsedCount = 0;
  let unparsedCount = 0;

  for (const result of results) {
    const classification = parseClassification(result);
    if (classification) {
      const { predicted, actual } = classification;
      if (classes.includes(predicted) && classes.includes(actual)) {
        matrix[actual][predicted] += 1;
        parsedCount += 1;
      } else {
        unparsedCount += 1;
      }
    } else {
      unparsedCount += 1;
    }
  }

  return { matrix, parsedCount, unparsedCount };
}

/**
 * Compute precision, recall, F1 for a single class.
 */
function computeClassMetrics(
  matrix: Record<string, Record<string, number>>,
  classes: readonly string[],
  targetClass: string,
): {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
} {
  // True positives: predicted targetClass when actual was targetClass
  const tp = matrix[targetClass][targetClass];

  // False positives: predicted targetClass when actual was different
  let fp = 0;
  for (const actual of classes) {
    if (actual !== targetClass) {
      fp += matrix[actual][targetClass];
    }
  }

  // False negatives: predicted different when actual was targetClass
  let fn = 0;
  for (const predicted of classes) {
    if (predicted !== targetClass) {
      fn += matrix[targetClass][predicted];
    }
  }

  // Calculate metrics (return 0 for division by zero)
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: roundTo4(precision),
    recall: roundTo4(recall),
    f1: roundTo4(f1),
  };
}

/**
 * Compute macro-averaged metrics across classes.
 */
function computeOverallMetrics(
  perClassMetrics: Record<
    string,
    { truePositives: number; falseNegatives: number; precision: number; recall: number; f1: number }
  >,
): { precision: number; recall: number; f1: number } {
  // Only include classes that have support (TP + FN > 0)
  const activeClasses = Object.entries(perClassMetrics).filter(
    ([, metrics]) => metrics.truePositives + metrics.falseNegatives > 0,
  );

  if (activeClasses.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const macroPrecision =
    activeClasses.reduce((sum, [, m]) => sum + m.precision, 0) / activeClasses.length;
  const macroRecall =
    activeClasses.reduce((sum, [, m]) => sum + m.recall, 0) / activeClasses.length;
  const macroF1 = activeClasses.reduce((sum, [, m]) => sum + m.f1, 0) / activeClasses.length;

  return {
    precision: roundTo4(macroPrecision),
    recall: roundTo4(macroRecall),
    f1: roundTo4(macroF1),
  };
}

/**
 * Compute overall accuracy.
 */
function computeAccuracy(
  matrix: Record<string, Record<string, number>>,
  classes: readonly string[],
): number {
  let correct = 0;
  let total = 0;

  for (const cls of classes) {
    correct += matrix[cls][cls];
    for (const predicted of classes) {
      total += matrix[cls][predicted];
    }
  }

  return total > 0 ? roundTo4(correct / total) : 0;
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Discover classes from the results.
 * Returns all unique class names found in parsed classifications.
 */
function discoverClasses(results: readonly EvaluationResult[]): string[] {
  const classSet = new Set<string>();

  for (const result of results) {
    const classification = parseClassification(result);
    if (classification) {
      classSet.add(classification.predicted);
      classSet.add(classification.actual);
    }
  }

  // Sort alphabetically for consistent ordering
  return Array.from(classSet).sort();
}

/**
 * Aggregate evaluation results into a confusion matrix with P/R/F1 metrics.
 */
export function aggregateConfusionMatrix(
  results: readonly EvaluationResult[],
): ConfusionMatrixResult {
  if (results.length === 0) {
    return {
      summary: {
        totalSamples: 0,
        parsedSamples: 0,
        unparsedSamples: 0,
        samplesPerClass: {},
        accuracy: 0,
      },
      confusionMatrix: {
        classes: [],
        matrix: {},
        description: 'matrix[actual][predicted] = count',
      },
      metricsPerClass: {},
      overallMetrics: { precision: 0, recall: 0, f1: 0 },
    };
  }

  // Discover classes from data
  const classes = discoverClasses(results);

  if (classes.length === 0) {
    return {
      summary: {
        totalSamples: results.length,
        parsedSamples: 0,
        unparsedSamples: results.length,
        samplesPerClass: {},
        accuracy: 0,
      },
      confusionMatrix: {
        classes: [],
        matrix: {},
        description: 'matrix[actual][predicted] = count',
      },
      metricsPerClass: {},
      overallMetrics: { precision: 0, recall: 0, f1: 0 },
    };
  }

  // Build confusion matrix
  const { matrix, parsedCount, unparsedCount } = buildConfusionMatrix(results, classes);

  // Compute per-class metrics
  const perClassMetrics: Record<
    string,
    {
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
      precision: number;
      recall: number;
      f1: number;
    }
  > = {};
  for (const cls of classes) {
    perClassMetrics[cls] = computeClassMetrics(matrix, classes, cls);
  }

  // Compute overall metrics
  const overallMetrics = computeOverallMetrics(perClassMetrics);
  const accuracy = computeAccuracy(matrix, classes);

  // Count samples per class (by actual/ground truth)
  const samplesPerClass: Record<string, number> = {};
  for (const cls of classes) {
    samplesPerClass[cls] = Object.values(matrix[cls]).reduce((sum, count) => sum + count, 0);
  }

  return {
    summary: {
      totalSamples: results.length,
      parsedSamples: parsedCount,
      unparsedSamples: unparsedCount,
      samplesPerClass,
      accuracy,
    },
    confusionMatrix: {
      classes,
      matrix,
      description: 'matrix[actual][predicted] = count',
    },
    metricsPerClass: perClassMetrics,
    overallMetrics,
  };
}

/**
 * Format confusion matrix result for terminal display.
 */
export function formatConfusionMatrixSummary(result: ConfusionMatrixResult): string {
  const lines: string[] = [];

  lines.push('\n==================================================');
  lines.push('CONFUSION MATRIX');
  lines.push('==================================================');

  const { summary, confusionMatrix, metricsPerClass, overallMetrics } = result;

  lines.push(`Total samples: ${summary.totalSamples}`);
  lines.push(`Parsed samples: ${summary.parsedSamples}`);
  if (summary.unparsedSamples > 0) {
    lines.push(`Unparsed samples: ${summary.unparsedSamples}`);
  }
  lines.push(`Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);

  if (confusionMatrix.classes.length > 0) {
    lines.push('\nConfusion Matrix (rows=actual, cols=predicted):');

    // Header row
    const colWidth = 10;
    const headerRow = [''.padStart(colWidth)].concat(
      confusionMatrix.classes.map((cls) => cls.padStart(colWidth)),
    );
    lines.push(headerRow.join(' '));
    lines.push('-'.repeat(headerRow.join(' ').length));

    // Matrix rows
    for (const actual of confusionMatrix.classes) {
      const row = [actual.padStart(colWidth)].concat(
        confusionMatrix.classes.map((predicted) =>
          String(confusionMatrix.matrix[actual][predicted]).padStart(colWidth),
        ),
      );
      lines.push(row.join(' '));
    }

    lines.push('\nPer-class Metrics:');
    lines.push(
      `${'Class'.padStart(colWidth)} | ${'Precision'.padStart(10)} ${'Recall'.padStart(10)} ${'F1'.padStart(10)}`,
    );
    lines.push('-'.repeat(48));

    for (const cls of confusionMatrix.classes) {
      const m = metricsPerClass[cls];
      lines.push(
        `${cls.padStart(colWidth)} | ${(m.precision * 100).toFixed(1).padStart(9)}% ${(m.recall * 100).toFixed(1).padStart(9)}% ${(m.f1 * 100).toFixed(1).padStart(9)}%`,
      );
    }

    lines.push('-'.repeat(48));
    lines.push(
      `${'Macro Avg'.padStart(colWidth)} | ${(overallMetrics.precision * 100).toFixed(1).padStart(9)}% ${(overallMetrics.recall * 100).toFixed(1).padStart(9)}% ${(overallMetrics.f1 * 100).toFixed(1).padStart(9)}%`,
    );
  }

  return lines.join('\n');
}
