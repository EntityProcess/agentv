#!/usr/bin/env bun
/**
 * Aggregated Metrics Reporter
 *
 * Parses JSONL evaluation results and aggregates TP/TN/FP/FN counts
 * per attribute across the whole dataset.
 *
 * Usage:
 *   bun run scripts/aggregate_metrics.ts results.jsonl
 *   bun run scripts/aggregate_metrics.ts results.jsonl --evaluator header_confusion
 *   bun run scripts/aggregate_metrics.ts results.jsonl --format csv
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';

interface FieldMetrics {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision?: number;
  recall?: number;
  f1?: number;
}

interface EvaluatorResult {
  name: string;
  type: string;
  score: number;
  details?: {
    metrics?: Record<string, FieldMetrics>;
    summary?: {
      total_tp?: number;
      total_tn?: number;
      total_fp?: number;
      total_fn?: number;
      macro_f1?: number;
    };
    alignment?: Array<{ expectedIdx: number; parsedIdx: number; similarity: number }>;
  };
  scores?: EvaluatorResult[];
}

interface EvaluationResult {
  test_id: string;
  score: number;
  scores?: EvaluatorResult[];
}

interface AggregatedMetrics {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  count: number;
}

function computeDerivedMetrics(metrics: AggregatedMetrics): AggregatedMetrics & {
  precision?: number;
  recall?: number;
  f1?: number;
} {
  const { tp, fp, fn } = metrics;
  const precision = tp + fp > 0 ? tp / (tp + fp) : undefined;
  const recall = tp + fn > 0 ? tp / (tp + fn) : undefined;
  const f1 =
    precision !== undefined && recall !== undefined && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : undefined;
  return { ...metrics, precision, recall, f1 };
}

function extractMetricsFromResults(
  results: EvaluatorResult[],
  evaluatorFilter?: string,
): Record<string, AggregatedMetrics> {
  const aggregated: Record<string, AggregatedMetrics> = {};

  function processResult(result: EvaluatorResult): void {
    // Skip if filter is set and doesn't match
    if (evaluatorFilter && result.name !== evaluatorFilter) {
      // Still process children
      if (result.scores) {
        for (const child of result.scores) {
          processResult(child);
        }
      }
      return;
    }

    // Extract metrics from details
    if (result.details?.metrics) {
      for (const [field, metrics] of Object.entries(result.details.metrics)) {
        if (!aggregated[field]) {
          aggregated[field] = { tp: 0, tn: 0, fp: 0, fn: 0, count: 0 };
        }
        aggregated[field].tp += metrics.tp ?? 0;
        aggregated[field].tn += metrics.tn ?? 0;
        aggregated[field].fp += metrics.fp ?? 0;
        aggregated[field].fn += metrics.fn ?? 0;
        aggregated[field].count += 1;
      }
    }

    // Process nested evaluator results
    if (result.scores) {
      for (const child of result.scores) {
        processResult(child);
      }
    }
  }

  for (const result of results) {
    processResult(result);
  }

  return aggregated;
}

function printTable(aggregated: Record<string, AggregatedMetrics>): void {
  const fields = Object.keys(aggregated).sort();

  if (fields.length === 0) {
    console.log('No metrics found in evaluation results.');
    console.log('Make sure your code judges emit a `details.metrics` object.');
    return;
  }

  // Calculate column widths
  const headers = ['Field', 'TP', 'TN', 'FP', 'FN', 'Precision', 'Recall', 'F1', 'Count'];
  const widths = headers.map((h) => h.length);

  const rows: string[][] = [];
  for (const field of fields) {
    const m = computeDerivedMetrics(aggregated[field]);
    const row = [
      field,
      String(m.tp),
      String(m.tn),
      String(m.fp),
      String(m.fn),
      m.precision !== undefined ? m.precision.toFixed(3) : '-',
      m.recall !== undefined ? m.recall.toFixed(3) : '-',
      m.f1 !== undefined ? m.f1.toFixed(3) : '-',
      String(m.count),
    ];
    rows.push(row);
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');
  console.log(headerLine);
  console.log(separator);

  // Print rows
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join(' | '));
  }

  // Print summary
  console.log();
  const totalTp = Object.values(aggregated).reduce((sum, m) => sum + m.tp, 0);
  const totalTn = Object.values(aggregated).reduce((sum, m) => sum + m.tn, 0);
  const totalFp = Object.values(aggregated).reduce((sum, m) => sum + m.fp, 0);
  const totalFn = Object.values(aggregated).reduce((sum, m) => sum + m.fn, 0);
  const totalMetrics = computeDerivedMetrics({
    tp: totalTp,
    tn: totalTn,
    fp: totalFp,
    fn: totalFn,
    count: fields.length,
  });

  console.log(`Total: TP=${totalTp} TN=${totalTn} FP=${totalFp} FN=${totalFn}`);
  if (totalMetrics.precision !== undefined) {
    console.log(`Micro-Precision: ${totalMetrics.precision.toFixed(3)}`);
  }
  if (totalMetrics.recall !== undefined) {
    console.log(`Micro-Recall: ${totalMetrics.recall.toFixed(3)}`);
  }
  if (totalMetrics.f1 !== undefined) {
    console.log(`Micro-F1: ${totalMetrics.f1.toFixed(3)}`);
  }

  // Compute macro-F1 (treating undefined as 0 when errors occurred, excluding TN-only fields)
  const f1Scores: number[] = [];
  for (const m of Object.values(aggregated)) {
    const derived = computeDerivedMetrics(m);
    const hasErrors = m.fp > 0 || m.fn > 0;
    if (derived.f1 !== undefined) {
      f1Scores.push(derived.f1);
    } else if (hasErrors) {
      // Treat undefined F1 as 0 when errors occurred (wrong/hallucinated/missing)
      f1Scores.push(0);
    }
    // Exclude TN-only fields (TP=0, FP=0, FN=0) from macro-F1
  }
  if (f1Scores.length > 0) {
    const macroF1 = f1Scores.reduce((a, b) => a + b, 0) / f1Scores.length;
    console.log(`Macro-F1: ${macroF1.toFixed(3)}`);
  }
}

function printCsv(aggregated: Record<string, AggregatedMetrics>): void {
  const fields = Object.keys(aggregated).sort();
  console.log('field,tp,tn,fp,fn,precision,recall,f1,count');

  for (const field of fields) {
    const m = computeDerivedMetrics(aggregated[field]);
    console.log(
      [
        field,
        m.tp,
        m.tn,
        m.fp,
        m.fn,
        m.precision !== undefined ? m.precision.toFixed(4) : '',
        m.recall !== undefined ? m.recall.toFixed(4) : '',
        m.f1 !== undefined ? m.f1.toFixed(4) : '',
        m.count,
      ].join(','),
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`Usage: bun run scripts/aggregate_metrics.ts <results.jsonl> [options]

Options:
  --evaluator <name>  Only aggregate metrics from evaluators with this name
  --format <format>   Output format: table (default) or csv
  --help              Show this help message

Example:
  bun run scripts/aggregate_metrics.ts .agentv/results/eval-001.jsonl
  bun run scripts/aggregate_metrics.ts results.jsonl --evaluator header_confusion --format csv
`);
    process.exit(0);
  }

  const inputFile = args[0];
  let evaluatorFilter: string | undefined;
  let format: 'table' | 'csv' = 'table';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--evaluator' && args[i + 1]) {
      evaluatorFilter = args[++i];
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[++i] as 'table' | 'csv';
    }
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  const aggregated: Record<string, AggregatedMetrics> = {};
  let lineCount = 0;

  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const result = JSON.parse(line) as EvaluationResult;
      lineCount++;

      if (result.scores) {
        const metrics = extractMetricsFromResults(result.scores, evaluatorFilter);
        for (const [field, m] of Object.entries(metrics)) {
          if (!aggregated[field]) {
            aggregated[field] = { tp: 0, tn: 0, fp: 0, fn: 0, count: 0 };
          }
          aggregated[field].tp += m.tp;
          aggregated[field].tn += m.tn;
          aggregated[field].fp += m.fp;
          aggregated[field].fn += m.fn;
          aggregated[field].count += m.count;
        }
      }
    } catch (e) {
      console.error(`Warning: Failed to parse line ${lineCount + 1}: ${e}`);
    }
  }

  console.log(`Processed ${lineCount} evaluation results from ${inputFile}\n`);

  if (format === 'csv') {
    printCsv(aggregated);
  } else {
    printTable(aggregated);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
