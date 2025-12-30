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
 *   # Check existing aggregator results file
 *   bun run ci_check.ts metrics.aggregators.json --threshold 0.95 --check-class High
 *
 * Options:
 *   --eval FILE         Run agentv eval on this dataset first
 *   --threshold FLOAT   F1 score threshold (default: 0.95)
 *   --check-class STR   Risk class to check (default: High)
 *   --output FILE       Output JSON file (optional, prints to stdout if omitted)
 *
 * Exit Codes:
 *   0 - Pass (F1 >= threshold)
 *   1 - Fail (F1 < threshold)
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'bun';

interface ConfusionMatrixMetrics {
  type: string;
  metricsPerClass: Record<string, { f1: number; precision: number; recall: number }>;
  overallMetrics: { f1: number; precision: number; recall: number };
  summary: { accuracy: number; totalSamples: number };
}

interface ThresholdResult {
  result: 'pass' | 'fail';
  checkedClass: string;
  threshold: number;
  actualF1: number;
  margin: number;
  message: string;
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
  const aggregatorFile = join(tempDir, 'results.aggregators.json');

  const repoRoot = findRepoRoot(dirname(evalFile));
  const evalPath = resolve(evalFile);

  const cmd = [
    'bun',
    'agentv',
    'eval',
    evalPath,
    '--out',
    resultsFile,
    '--aggregator',
    'confusion-matrix',
  ];

  console.error(`Running: ${cmd.join(' ')}`);
  console.error(`Working directory: ${repoRoot}`);

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
    console.error('Error running agentv eval:');
    console.error(stderr);
    process.exit(1);
  }

  if (stdout) {
    console.error(stdout);
  }

  if (!existsSync(aggregatorFile)) {
    console.error(`Error: Eval did not produce aggregator file: ${aggregatorFile}`);
    process.exit(1);
  }

  return aggregatorFile;
}

function loadMetrics(aggregatorFile: string): ConfusionMatrixMetrics | { error: string } {
  try {
    const data = JSON.parse(readFileSync(aggregatorFile, 'utf-8')) as unknown[];

    for (const item of data) {
      if (
        typeof item === 'object' &&
        item !== null &&
        (item as { type?: string }).type === 'confusion-matrix'
      ) {
        return item as ConfusionMatrixMetrics;
      }
    }

    return { error: 'No confusion-matrix aggregator found in results' };
  } catch (e) {
    return { error: `Failed to parse aggregator JSON: ${e}` };
  }
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

  return {
    result: passed ? 'pass' : 'fail',
    checkedClass: checkClass,
    threshold,
    actualF1,
    margin: Math.round((actualF1 - threshold) * 10000) / 10000,
    message: passed
      ? `PASS: ${checkClass} F1 score ${(actualF1 * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}% threshold`
      : `FAIL: ${checkClass} F1 score ${(actualF1 * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}% threshold`,
    metrics,
  };
}

function printUsage(): void {
  console.error(`
Usage: bun run ci_check.ts [options] [aggregator_file]

Options:
  --eval <file>        Run agentv eval on this dataset first
  --threshold <num>    F1 score threshold (default: 0.95)
  --check-class <str>  Risk class to check: Low, Medium, High (default: High)
  --output <file>      Output JSON file (prints to stdout if omitted)
  --help               Show this help message

Exit Codes:
  0  Pass (F1 >= threshold)
  1  Fail (F1 < threshold)

Examples:
  # Full flow - run eval then check
  bun run ci_check.ts --eval dataset.yaml --threshold 0.95

  # Check existing aggregator results
  bun run ci_check.ts metrics.aggregators.json --threshold 0.95
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
    console.error('Error: --check-class must be Low, Medium, or High');
    process.exit(1);
  }

  // Determine aggregator file
  let aggregatorFile: string;

  if (values.eval) {
    if (!existsSync(values.eval)) {
      console.error(`Error: Eval file not found: ${values.eval}`);
      process.exit(1);
    }
    aggregatorFile = await runEval(values.eval);
  } else if (positionals.length > 0) {
    aggregatorFile = positionals[0];
    if (!existsSync(aggregatorFile)) {
      console.error(`Error: Aggregator file not found: ${aggregatorFile}`);
      process.exit(1);
    }
  } else {
    console.error('Error: Provide either --eval <dataset.yaml> or <aggregators.json>');
    printUsage();
    process.exit(1);
  }

  // Load metrics from aggregator output
  const metrics = loadMetrics(aggregatorFile);

  if ('error' in metrics) {
    console.error(`Error: ${metrics.error}`);
    process.exit(1);
  }

  // Check threshold
  const result = checkThreshold(metrics, checkClass, threshold);

  // Output JSON
  const outputJson = JSON.stringify(result, null, 2);

  if (values.output) {
    writeFileSync(values.output, outputJson);
    console.error(`Result written to: ${values.output}`);
  } else {
    console.log(outputJson);
  }

  // Print summary to stderr
  console.error(`\n${result.message}`);

  // Exit with appropriate code
  process.exit(result.result === 'pass' ? 0 : 1);
}

main();
