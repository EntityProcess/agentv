import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { command, option, optional, string } from 'cmd-ts';

import type { EvaluationResult } from '@agentv/core';

import { loadManifestResults, parseResultManifest, resolveResultSourcePath } from './manifest.js';
import { RESULTS_REPORT_TEMPLATE } from './report-template.js';
import { resolveSourceFile, sourceArg } from './shared.js';

interface ReportManifestRecord {
  readonly eval_file?: string;
}

interface BenchmarkMetadata {
  readonly metadata?: {
    readonly eval_file?: string;
  };
}

function normalizeEvalFileLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return path
    .basename(trimmed)
    .replace(/\.results\.jsonl$/i, '')
    .replace(/\.eval\.ya?ml$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.jsonl$/i, '');
}

function readBenchmarkEvalFile(sourceFile: string): string | undefined {
  const benchmarkPath = path.join(path.dirname(sourceFile), 'benchmark.json');
  if (!existsSync(benchmarkPath)) {
    return undefined;
  }

  try {
    const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as BenchmarkMetadata;
    return normalizeEvalFileLabel(benchmark.metadata?.eval_file);
  } catch {
    return undefined;
  }
}

export function deriveReportPath(sourceFile: string): string {
  return path.join(path.dirname(sourceFile), 'report.html');
}

function serializeReportResult(
  result: EvaluationResult,
  sourceFile: string,
  manifestRecord?: ReportManifestRecord,
  benchmarkEvalFile?: string,
): Record<string, unknown> {
  const fallbackEvalFile =
    normalizeEvalFileLabel(manifestRecord?.eval_file) ??
    benchmarkEvalFile ??
    normalizeEvalFileLabel(result.suite) ??
    path.basename(path.dirname(sourceFile));

  return {
    timestamp: result.timestamp,
    test_id: result.testId,
    suite: result.suite,
    category: result.category,
    target: result.target,
    score: result.score,
    scores: result.scores,
    execution_status: result.executionStatus,
    error: result.error,
    duration_ms: result.durationMs,
    token_usage: result.tokenUsage,
    cost_usd: result.costUsd,
    input: result.input,
    output: result.output,
    assertions: result.assertions,
    eval_file: fallbackEvalFile,
  };
}

export async function loadReportSource(
  source: string | undefined,
  cwd: string,
): Promise<{
  sourceFile: string;
  results: EvaluationResult[];
  records: readonly ReportManifestRecord[];
  benchmarkEvalFile?: string;
}> {
  const { sourceFile } = await resolveSourceFile(source, cwd);
  const resolvedSourceFile = resolveResultSourcePath(sourceFile, cwd);
  const content = readFileSync(resolvedSourceFile, 'utf8');
  const records = parseResultManifest(content) as ReportManifestRecord[];
  const results = loadManifestResults(resolvedSourceFile);

  if (results.length === 0) {
    throw new Error(`No results found in ${resolvedSourceFile}`);
  }

  return {
    sourceFile: resolvedSourceFile,
    results,
    records,
    benchmarkEvalFile: readBenchmarkEvalFile(resolvedSourceFile),
  };
}

export function renderResultsReport(
  results: readonly EvaluationResult[],
  sourceFile: string,
  records: readonly ReportManifestRecord[],
  benchmarkEvalFile?: string,
): string {
  if (!RESULTS_REPORT_TEMPLATE.includes('__DATA_PLACEHOLDER__')) {
    throw new Error('Report template is missing __DATA_PLACEHOLDER__');
  }

  const rows = results.map((result, index) =>
    serializeReportResult(result, sourceFile, records[index], benchmarkEvalFile),
  );
  const dataJson = JSON.stringify(rows).replace(/<\//g, '<\\/');
  return RESULTS_REPORT_TEMPLATE.replace('__DATA_PLACEHOLDER__', dataJson);
}

export async function writeResultsReport(
  source: string | undefined,
  outputPath: string | undefined,
  cwd: string,
): Promise<{ sourceFile: string; outputPath: string; html: string }> {
  const { sourceFile, results, records, benchmarkEvalFile } = await loadReportSource(source, cwd);
  const resolvedOutputPath = outputPath
    ? path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(cwd, outputPath)
    : deriveReportPath(sourceFile);
  const html = renderResultsReport(results, sourceFile, records, benchmarkEvalFile);

  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, html, 'utf8');

  const written = readFileSync(resolvedOutputPath, 'utf8');
  if (written.includes('__DATA_PLACEHOLDER__')) {
    throw new Error('Report placeholder substitution failed');
  }

  return { sourceFile, outputPath: resolvedOutputPath, html: written };
}

export const resultsReportCommand = command({
  name: 'report',
  description: 'Generate a static HTML report from a run workspace or index.jsonl manifest',
  args: {
    source: sourceArg,
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output HTML file (defaults to <run-dir>/report.html)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, out, dir }) => {
    const cwd = dir ?? process.cwd();

    try {
      const { sourceFile, outputPath } = await writeResultsReport(source, out, cwd);
      console.log(`Report written to ${outputPath}`);
      console.log(`Source: ${sourceFile}`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
