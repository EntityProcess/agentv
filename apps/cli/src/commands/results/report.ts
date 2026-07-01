import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { command, option, optional, string } from 'cmd-ts';

import type { EvaluationResult, RunRuntimeSourceMetadata } from '@agentv/core';

import { loadManifestResults, parseResultManifest, resolveResultSourcePath } from './manifest.js';
import { RESULTS_REPORT_TEMPLATE } from './report-template.js';
import { resolveSourceFile, sourceArg } from './shared.js';

const DEFAULT_REPORT_SUBTITLE =
  'Dashboard-themed HTML generated from an existing AgentV results workspace.';

interface ReportManifestRecord {
  readonly eval_file?: string;
  readonly experiment?: string;
  readonly runtime_source?: RunRuntimeSourceMetadata;
}

interface RunSummaryReportMetadata {
  readonly evalFile?: string;
  readonly experiment?: string;
  readonly runtimeSource?: RunRuntimeSourceMetadata;
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

function readSummaryEvalFile(sourceFile: string): string | undefined {
  return readSummaryReportMetadata(sourceFile).evalFile;
}

function readSummaryReportMetadata(sourceFile: string): RunSummaryReportMetadata {
  const summaryPath = path.join(path.dirname(sourceFile), 'summary.json');
  if (!existsSync(summaryPath)) {
    return {};
  }

  try {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      metadata?: {
        eval_file?: string;
        experiment?: string;
        runtime_source?: RunRuntimeSourceMetadata;
      };
    };
    return {
      evalFile: normalizeEvalFileLabel(summary.metadata?.eval_file),
      ...(summary.metadata?.experiment && { experiment: summary.metadata.experiment }),
      ...(summary.metadata?.runtime_source && { runtimeSource: summary.metadata.runtime_source }),
    };
  } catch {
    return {};
  }
}

export function deriveReportPath(sourceFile: string): string {
  return path.join(path.dirname(sourceFile), 'report.html');
}

function serializeReportResult(
  result: EvaluationResult,
  sourceFile: string,
  manifestRecord?: ReportManifestRecord,
  summaryMetadata?: RunSummaryReportMetadata,
): Record<string, unknown> {
  const runtimeSource = manifestRecord?.runtime_source ?? summaryMetadata?.runtimeSource;
  const resultExperiment = (result as EvaluationResult & { experiment?: string }).experiment;
  const experimentNamespace =
    runtimeSource?.experiment_namespace ??
    manifestRecord?.experiment ??
    summaryMetadata?.experiment ??
    resultExperiment;
  const fallbackEvalFile =
    normalizeEvalFileLabel(manifestRecord?.eval_file) ??
    summaryMetadata?.evalFile ??
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
    experiment: experimentNamespace,
    experiment_namespace: experimentNamespace,
    runtime_source: runtimeSource,
    runtime_source_label: formatRuntimeSourceLabel(runtimeSource),
    runtime_config_source_label: formatRuntimeConfigSourceLabel(runtimeSource?.config_source),
    eval_file: fallbackEvalFile,
  };
}

function formatRuntimeKindLabel(kind: RunRuntimeSourceMetadata['kind'] | undefined): string {
  switch (kind) {
    case 'direct_suite':
      return 'Direct suite';
    case 'wrapper_eval':
      return 'Wrapper eval';
    case 'multi_eval':
      return 'Multi-eval';
    default:
      return 'Unknown source';
  }
}

function formatRuntimeConfigSourceLabel(
  source: RunRuntimeSourceMetadata['config_source'] | undefined,
): string {
  switch (source) {
    case 'inline_experiment':
      return 'Inline experiment config';
    case 'cli_flags':
      return 'CLI runtime flags';
    case 'mixed':
      return 'Mixed runtime config';
    case 'defaults':
      return 'Default runtime config';
    default:
      return '';
  }
}

function formatNamespaceSourceLabel(
  source: RunRuntimeSourceMetadata['experiment_namespace_source'] | undefined,
): string {
  switch (source) {
    case 'cli':
      return 'CLI namespace';
    case 'tags':
      return 'Tags namespace';
    case 'eval_metadata':
      return 'Eval metadata namespace';
    case 'eval_filename':
      return 'Eval filename namespace';
    case 'multi_eval':
      return 'Multi-eval namespace';
    default:
      return '';
  }
}

function formatRuntimeSourceLabel(runtimeSource: RunRuntimeSourceMetadata | undefined): string {
  if (!runtimeSource) {
    return '';
  }
  return [
    formatRuntimeKindLabel(runtimeSource.kind),
    formatNamespaceSourceLabel(runtimeSource.experiment_namespace_source),
    formatRuntimeConfigSourceLabel(runtimeSource.config_source),
  ]
    .filter(Boolean)
    .join(' · ');
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  ].sort();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReportHeaderContext(rows: readonly Record<string, unknown>[]): string {
  const experiments = uniqueStrings(
    rows.map((row) =>
      typeof row.experiment_namespace === 'string'
        ? row.experiment_namespace
        : typeof row.experiment === 'string'
          ? row.experiment
          : undefined,
    ),
  );
  const runtimeSources = uniqueStrings(
    rows.map((row) =>
      typeof row.runtime_source_label === 'string' ? row.runtime_source_label : undefined,
    ),
  );
  const parts = [
    experiments.length === 1
      ? `Experiment namespace: ${experiments[0]}`
      : experiments.length > 1
        ? `Experiment namespaces: ${experiments.join(', ')}`
        : undefined,
    runtimeSources.length === 1
      ? `Runtime source: ${runtimeSources[0]}`
      : runtimeSources.length > 1
        ? `Runtime sources: ${runtimeSources.join(', ')}`
        : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' · ') : DEFAULT_REPORT_SUBTITLE;
}

export async function loadReportSource(
  source: string | undefined,
  cwd: string,
): Promise<{
  sourceFile: string;
  results: EvaluationResult[];
  records: readonly ReportManifestRecord[];
  summaryEvalFile?: string;
  summaryMetadata?: RunSummaryReportMetadata;
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
    summaryEvalFile: readSummaryEvalFile(resolvedSourceFile),
    summaryMetadata: readSummaryReportMetadata(resolvedSourceFile),
  };
}

export function renderResultsReport(
  results: readonly EvaluationResult[],
  sourceFile: string,
  records: readonly ReportManifestRecord[],
  summaryMetadata?: RunSummaryReportMetadata,
): string {
  if (!RESULTS_REPORT_TEMPLATE.includes('__DATA_PLACEHOLDER__')) {
    throw new Error('Report template is missing __DATA_PLACEHOLDER__');
  }

  const rows = results.map((result, index) =>
    serializeReportResult(result, sourceFile, records[index], summaryMetadata),
  );
  const dataJson = JSON.stringify(rows).replace(/<\//g, '<\\/');
  return RESULTS_REPORT_TEMPLATE.replace('__DATA_PLACEHOLDER__', () => dataJson).replace(
    DEFAULT_REPORT_SUBTITLE,
    escapeHtml(formatReportHeaderContext(rows)),
  );
}

export async function writeResultsReport(
  source: string | undefined,
  outputPath: string | undefined,
  cwd: string,
): Promise<{ sourceFile: string; outputPath: string; html: string }> {
  const { sourceFile, results, records, summaryMetadata } = await loadReportSource(source, cwd);
  const resolvedOutputPath = outputPath
    ? path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(cwd, outputPath)
    : deriveReportPath(sourceFile);
  const html = renderResultsReport(results, sourceFile, records, summaryMetadata);

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
  description: 'Generate a static HTML report from a run workspace or run manifest',
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
