#!/usr/bin/env bun
/**
 * CI/CD Threshold Check for Export Risk Classification
 *
 * Validates that classification metrics meet CI/CD quality gates.
 * Returns structured JSON result and appropriate exit code for pipeline integration.
 *
 * Usage:
 *   # Full flow: run eval then check threshold
 *   bun run ci_check.ts --eval dataset.yaml --threshold 0.95 --check-class High
 *
 *   # Check existing results JSONL file
 *   bun run ci_check.ts results.jsonl --threshold 0.95 --check-class High
 *
 * Options:
 *   --eval FILE         Run agentv eval on this dataset first
 *   --threshold FLOAT   F1 score threshold (default: 0.95)
 *   --check-class STR   Risk class to check (default: High)
 *   --output FILE       Output JSON file (optional, defaults next to results.jsonl)
 *
 * Exit Codes:
 *   0 - Pass (F1 >= threshold)
 *   1 - Fail (F1 < threshold)
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'bun';

function logInfo(message: string): void {
  console.log(message);
}

function logError(message: string): void {
  console.error(message);
}

interface EvaluationResultJsonlRecord {
  hits?: string[];
  misses?: string[];
}

interface ConfusionMatrixMetrics {
  confusionMatrix: {
    classes: string[];
    matrix: Record<string, Record<string, number>>;
    description: string;
  };
  metricsPerClass: Record<string, { f1: number; precision: number; recall: number }>;
  overallMetrics: { f1: number; precision: number; recall: number };
  summary: {
    accuracy: number;
    totalSamples: number;
    parsedSamples: number;
    unparsedSamples: number;
  };
}

interface PolicyWeightedOverall {
  /**
   * Spreadsheet-compatible "overall precision":
   * SUM(precision * recall) / SUM(recall)
   */
  precision: number;
  /**
   * Spreadsheet-compatible "overall recall":
   * AVERAGE(recall)
   */
  recall: number;
  /**
   * Spreadsheet-compatible "overall F1":
   * 2 * SUM(precision * recall) / SUM(precision + recall)
   */
  f1: number;
}

interface ThresholdResult {
  result: 'pass' | 'fail';
  checkedClass: string;
  threshold: number;
  actualF1: number;
  margin: number;
  message: string;
  policyWeightedOverall: PolicyWeightedOverall;
  metrics: ConfusionMatrixMetrics;
}

function findRepoRoot(startPath: string): string {
  let current = resolve(startPath);

  while (current !== dirname(current)) {
    const pkgPath = join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        // Ignore parse errors
      }
    }
    current = dirname(current);
  }

  return process.cwd();
}

async function runEval(evalFile: string): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentv-'));
  const resultsFile = join(tempDir, 'results.jsonl');

  const repoRoot = findRepoRoot(dirname(evalFile));
  const evalPath = resolve(evalFile);

  const cmd = ['bun', 'agentv', 'eval', evalPath, '--out', resultsFile];

  logInfo(`Running: ${cmd.join(' ')}`);
  logInfo(`Working directory: ${repoRoot}`);

  const proc = spawn({
    cmd,
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logError('Error running agentv eval:');
    logError(stderr);
    process.exit(1);
  }

  if (stdout) {
    logInfo(stdout);
  }

  if (!existsSync(resultsFile)) {
    logError(`Error: Eval did not produce results file: ${resultsFile}`);
    process.exit(1);
  }

  return resultsFile;
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseClassificationFromResult(
  record: EvaluationResultJsonlRecord,
): { predicted: string; actual: string } | null {
  const hits = Array.isArray(record.hits) ? record.hits : [];
  const misses = Array.isArray(record.misses) ? record.misses : [];

  const comparisonPattern = /AI=([^\s,]+),?\s*Expected=([^\s,]+)/;

  for (const miss of misses) {
    const match = comparisonPattern.exec(miss);
    if (match) {
      return { predicted: match[1], actual: match[2] };
    }
  }

  for (const hit of hits) {
    const match = comparisonPattern.exec(hit);
    if (match) {
      return { predicted: match[1], actual: match[2] };
    }
  }

  return null;
}

function loadResults(
  resultsFile: string,
): { records: EvaluationResultJsonlRecord[] } | { error: string } {
  try {
    const text = readFileSync(resultsFile, 'utf-8');
    const records: EvaluationResultJsonlRecord[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as EvaluationResultJsonlRecord);
      } catch {
        // Ignore invalid JSONL line.
      }
    }
    return { records };
  } catch (e) {
    return { error: `Failed to read results JSONL: ${e}` };
  }
}

function buildConfusionMatrix(
  records: readonly EvaluationResultJsonlRecord[],
  classes: readonly string[],
): {
  matrix: Record<string, Record<string, number>>;
  parsedSamples: number;
  unparsedSamples: number;
} {
  const matrix: Record<string, Record<string, number>> = {};
  for (const actual of classes) {
    matrix[actual] = {};
    for (const predicted of classes) {
      matrix[actual][predicted] = 0;
    }
  }

  let parsedSamples = 0;
  let unparsedSamples = 0;

  for (const record of records) {
    const classification = parseClassificationFromResult(record);
    if (!classification) {
      unparsedSamples += 1;
      continue;
    }
    const { predicted, actual } = classification;
    if (!classes.includes(predicted) || !classes.includes(actual)) {
      unparsedSamples += 1;
      continue;
    }
    matrix[actual][predicted] += 1;
    parsedSamples += 1;
  }

  return { matrix, parsedSamples, unparsedSamples };
}

function computePerClassMetrics(
  matrix: Record<string, Record<string, number>>,
  classes: readonly string[],
): Record<string, { precision: number; recall: number; f1: number }> {
  const metrics: Record<string, { precision: number; recall: number; f1: number }> = {};

  for (const cls of classes) {
    const tp = matrix[cls][cls];
    let fp = 0;
    let fn = 0;

    for (const actual of classes) {
      if (actual !== cls) {
        fp += matrix[actual][cls];
      }
    }

    for (const predicted of classes) {
      if (predicted !== cls) {
        fn += matrix[cls][predicted];
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    metrics[cls] = {
      precision: roundTo4(precision),
      recall: roundTo4(recall),
      f1: roundTo4(f1),
    };
  }

  return metrics;
}

function computeAccuracy(
  matrix: Record<string, Record<string, number>>,
  classes: readonly string[],
): number {
  let correct = 0;
  let total = 0;

  for (const actual of classes) {
    correct += matrix[actual][actual];
    for (const predicted of classes) {
      total += matrix[actual][predicted];
    }
  }

  return total > 0 ? roundTo4(correct / total) : 0;
}

function computeMacroOverall(
  metricsPerClass: Record<string, { precision: number; recall: number; f1: number }>,
  classes: readonly string[],
): { precision: number; recall: number; f1: number } {
  if (classes.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const precision =
    classes.reduce((sum, cls) => sum + (metricsPerClass[cls]?.precision ?? 0), 0) / classes.length;
  const recall =
    classes.reduce((sum, cls) => sum + (metricsPerClass[cls]?.recall ?? 0), 0) / classes.length;
  const f1 =
    classes.reduce((sum, cls) => sum + (metricsPerClass[cls]?.f1 ?? 0), 0) / classes.length;

  return { precision: roundTo4(precision), recall: roundTo4(recall), f1: roundTo4(f1) };
}

function computeMetricsFromResults(
  resultsFile: string,
): ConfusionMatrixMetrics | { error: string } {
  const loaded = loadResults(resultsFile);
  if ('error' in loaded) return loaded;

  const classes = ['Low', 'Medium', 'High'];
  const { matrix, parsedSamples, unparsedSamples } = buildConfusionMatrix(loaded.records, classes);

  const metricsPerClass = computePerClassMetrics(matrix, classes);
  const accuracy = computeAccuracy(matrix, classes);
  const overallMetrics = computeMacroOverall(metricsPerClass, classes);

  const totalSamples = loaded.records.length;

  return {
    confusionMatrix: {
      classes,
      matrix,
      description: 'matrix[actual][predicted] = count',
    },
    metricsPerClass,
    overallMetrics,
    summary: {
      accuracy,
      totalSamples,
      parsedSamples,
      unparsedSamples,
    },
  };
}

function computePolicyWeightedOverall(metrics: ConfusionMatrixMetrics): PolicyWeightedOverall {
  const perClass = metrics.metricsPerClass ?? {};
  const classList = ['Low', 'Medium', 'High'].filter((cls) => cls in perClass);

  let sumRecall = 0;
  let sumPrecisionTimesRecall = 0;
  let sumPrecisionPlusRecall = 0;

  for (const cls of classList) {
    const precision = perClass[cls]?.precision ?? 0;
    const recall = perClass[cls]?.recall ?? 0;
    sumRecall += recall;
    sumPrecisionTimesRecall += precision * recall;
    sumPrecisionPlusRecall += precision + recall;
  }

  const precision = sumRecall > 0 ? sumPrecisionTimesRecall / sumRecall : 0;
  const recall = classList.length > 0 ? sumRecall / classList.length : 0;
  const f1 =
    sumPrecisionPlusRecall > 0 ? (2 * sumPrecisionTimesRecall) / sumPrecisionPlusRecall : 0;

  return {
    precision: roundTo4(precision),
    recall: roundTo4(recall),
    f1: roundTo4(f1),
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatConfusionMatrixReport(
  metrics: ConfusionMatrixMetrics,
  policyWeightedOverall: PolicyWeightedOverall,
): string {
  const classes = metrics.confusionMatrix.classes;
  const matrix = metrics.confusionMatrix.matrix;

  const colWidth = 10;
  const lines: string[] = [];

  lines.push('\n==================================================');
  lines.push('CONFUSION MATRIX');
  lines.push('==================================================');
  lines.push(`Total samples: ${metrics.summary.totalSamples}`);
  lines.push(`Parsed samples: ${metrics.summary.parsedSamples}`);
  if (metrics.summary.unparsedSamples > 0) {
    lines.push(`Unparsed samples: ${metrics.summary.unparsedSamples}`);
  }
  lines.push(`Accuracy: ${formatPercent(metrics.summary.accuracy)}`);

  lines.push('\nConfusion Matrix (rows=expert/actual, cols=ai/predicted):');
  const header = [''.padStart(colWidth)].concat(classes.map((cls) => cls.padStart(colWidth)));
  lines.push(header.join(' '));
  lines.push('-'.repeat(header.join(' ').length));

  for (const actual of classes) {
    const row = [actual.padStart(colWidth)].concat(
      classes.map((predicted) => String(matrix[actual]?.[predicted] ?? 0).padStart(colWidth)),
    );
    lines.push(row.join(' '));
  }

  lines.push('\nPer-class Metrics:');
  lines.push(
    `${'Class'.padStart(colWidth)} | ${'Precision'.padStart(10)} ${'Recall'.padStart(10)} ${'F1'.padStart(10)}`,
  );
  lines.push('-'.repeat(48));

  for (const cls of classes) {
    const per = metrics.metricsPerClass[cls] ?? { precision: 0, recall: 0, f1: 0 };
    lines.push(
      `${cls.padStart(colWidth)} | ${formatPercent(per.precision).padStart(10)} ${formatPercent(per.recall).padStart(10)} ${formatPercent(per.f1).padStart(10)}`,
    );
  }

  lines.push('-'.repeat(48));
  lines.push(
    `${'Overall'.padStart(colWidth)} | ${formatPercent(policyWeightedOverall.precision).padStart(10)} ${formatPercent(policyWeightedOverall.recall).padStart(10)} ${formatPercent(policyWeightedOverall.f1).padStart(10)}`,
  );

  return lines.join('\n');
}

function checkThreshold(
  metrics: ConfusionMatrixMetrics,
  checkClass: string,
  threshold: number,
): ThresholdResult {
  const perClass = metrics.metricsPerClass ?? {};
  const classMetrics = perClass[checkClass] ?? {};
  const actualF1 = classMetrics.f1 ?? 0.0;

  const passed = actualF1 >= threshold;

  const policyWeightedOverall = computePolicyWeightedOverall(metrics);

  return {
    result: passed ? 'pass' : 'fail',
    checkedClass: checkClass,
    threshold,
    actualF1,
    margin: Math.round((actualF1 - threshold) * 10000) / 10000,
    message: passed
      ? `PASS: ${checkClass} F1 score ${(actualF1 * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}% threshold`
      : `FAIL: ${checkClass} F1 score ${(actualF1 * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}% threshold`,
    policyWeightedOverall,
    metrics,
  };
}

function printUsage(): void {
  logInfo(`
Usage: bun run ci_check.ts [options] [results.jsonl]

Options:
  --eval <file>        Run agentv eval on this dataset first
  --threshold <num>    F1 score threshold (default: 0.95)
  --check-class <str>  Risk class to check: Low, Medium, High (default: High)
  --output <file>      Output JSON file (defaults next to results.jsonl)
  --help               Show this help message

Exit Codes:
  0  Pass (F1 >= threshold)
  1  Fail (F1 < threshold)

Examples:
  # Full flow - run eval then check
  bun run ci_check.ts --eval dataset.yaml --threshold 0.95

  # Check existing results file
  bun run ci_check.ts results.jsonl --threshold 0.95
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      eval: { type: 'string' },
      threshold: { type: 'string', default: '0.95' },
      'check-class': { type: 'string', default: 'High' },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const threshold = Number.parseFloat(values.threshold ?? '0.95');
  const checkClass = values['check-class'] ?? 'High';

  if (!['Low', 'Medium', 'High'].includes(checkClass)) {
    logError('Error: --check-class must be Low, Medium, or High');
    process.exit(1);
  }

  // Determine results file
  let resultsFile: string;

  if (values.eval) {
    if (!existsSync(values.eval)) {
      logError(`Error: Eval file not found: ${values.eval}`);
      process.exit(1);
    }
    resultsFile = await runEval(values.eval);
  } else if (positionals.length > 0) {
    resultsFile = positionals[0];
    if (!existsSync(resultsFile)) {
      logError(`Error: Results file not found: ${resultsFile}`);
      process.exit(1);
    }
  } else {
    logError('Error: Provide either --eval <dataset.yaml> or <results.jsonl>');
    printUsage();
    process.exit(1);
  }

  // Compute metrics from AgentV JSONL results
  const metrics = computeMetricsFromResults(resultsFile);

  if ('error' in metrics) {
    logError(`Error: ${metrics.error}`);
    process.exit(1);
  }

  // Check threshold
  const result = checkThreshold(metrics, checkClass, threshold);

  // Output JSON
  const outputJson = JSON.stringify(result, null, 2);
  const defaultOutputFile = join(
    dirname(resultsFile),
    basename(resultsFile).replace(/\.jsonl$/i, '.ci_check.json'),
  );
  const outputFile = values.output ?? defaultOutputFile;

  writeFileSync(outputFile, outputJson);
  logInfo(`Result written to: ${outputFile}`);

  logInfo(formatConfusionMatrixReport(metrics, result.policyWeightedOverall));

  // Print summary to stdout
  logInfo(`\n${result.message}`);

  // Exit with appropriate code
  process.exit(result.result === 'pass' ? 0 : 1);
}

main();
