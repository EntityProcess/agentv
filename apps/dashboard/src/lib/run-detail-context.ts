/**
 * Pure helpers for run detail headings and labels.
 *
 * The API returns local and remote runs through the same shape, but remote
 * runs carry extra source identity (`source_label`, results repo). Keep that
 * presentation logic here so route components stay thin and tests can pin
 * the remote-context contract without rendering React.
 *
 * Eval source labels are displayed only when a run mixes eval files or has
 * partial legacy suite metadata. Keep the table/sidebar dense by suppressing
 * repeated labels for single-eval runs.
 */

import { experimentNamespaceLabel, runtimeSourceSummary } from './runtime-source';
import type { EvalResult, RunDetailResponse } from './types';

type RunSource = RunDetailResponse['source'];
type RunRuntimeSource = RunDetailResponse['runtime_source'];

type HeaderResult = Pick<EvalResult, 'experiment' | 'target' | 'timestamp'>;
type SuiteLabelResult = Pick<EvalResult, 'suite'>;
type EvalSourceLabelResult = Pick<EvalResult, 'eval_path' | 'suite'>;

export interface RunDetailHeaderInput {
  runId: string;
  results: readonly HeaderResult[];
  source?: RunSource;
  sourceLabel?: string;
  runtimeSource?: RunRuntimeSource;
  remoteRepo?: string;
  formatTimestamp?: (timestamp: string) => string;
}

export interface RunDetailHeaderContextItem {
  label: string;
  value: string;
}

export interface RunDetailHeader {
  heading: string;
  meta: string;
  sourceBadge?: 'Remote';
  sourceLabel?: string;
  sourceContext: RunDetailHeaderContextItem[];
}

export interface CategoryDisplay {
  label: string;
  mutedLabel?: string;
}

export interface SuiteDisplay {
  label: string;
  title: string;
}

function nonDefaultExperiment(experiment: string | undefined): string | undefined {
  return experiment && experiment !== 'default' ? experiment : undefined;
}

function resultHeading(runId: string, firstResult: HeaderResult | undefined): string {
  const parts = [nonDefaultExperiment(firstResult?.experiment), firstResult?.target].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(' · ') : runId;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildRunDetailHeader(input: RunDetailHeaderInput): RunDetailHeader {
  const firstResult = input.results[0];
  const sourceLabel = cleanOptional(input.sourceLabel);
  const isRemote = input.source === 'remote';
  const heading = isRemote && sourceLabel ? sourceLabel : resultHeading(input.runId, firstResult);
  const formattedTimestamp =
    firstResult?.timestamp && input.formatTimestamp
      ? input.formatTimestamp(firstResult.timestamp)
      : firstResult?.timestamp;

  const metaItems = [
    firstResult?.target,
    nonDefaultExperiment(firstResult?.experiment),
    formattedTimestamp,
    isRemote ? undefined : input.source,
  ].filter((item): item is string => Boolean(item));

  const remoteRepo = cleanOptional(input.remoteRepo);
  const sourceContext: RunDetailHeaderContextItem[] = [];
  sourceContext.push({
    label: 'Experiment namespace',
    value: experimentNamespaceLabel({
      experiment: firstResult?.experiment,
      runtime_source: input.runtimeSource,
    }),
  });
  if (input.runtimeSource) {
    sourceContext.push({
      label: 'Runtime source',
      value: runtimeSourceSummary(input.runtimeSource),
    });
  }
  if (isRemote) {
    if (sourceLabel && sourceLabel !== heading) {
      sourceContext.push({ label: 'Source', value: sourceLabel });
    }
    if (remoteRepo) {
      sourceContext.push({ label: 'Repo', value: remoteRepo });
    }
  }

  return {
    heading,
    meta: metaItems.join(' · '),
    ...(isRemote && { sourceBadge: 'Remote' as const }),
    ...(sourceLabel && { sourceLabel }),
    sourceContext,
  };
}

function isTraversalLikeCategory(category: string): boolean {
  const normalized = category.replace(/\\/g, '/');
  return (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes('/../') ||
    normalized.includes('/./')
  );
}

function basenameFromCategory(category: string): string | undefined {
  const segment = category
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.' && part !== '..')
    .at(-1)
    ?.trim();
  return segment || undefined;
}

export function formatCategoryDisplay(category: string | undefined): CategoryDisplay {
  const raw = cleanOptional(category) ?? 'Uncategorized';
  if (!isTraversalLikeCategory(raw)) {
    return { label: raw };
  }

  return {
    label: basenameFromCategory(raw) ?? 'Uncategorized',
    mutedLabel: raw,
  };
}

function stripEvalFileExtension(fileName: string): string {
  return fileName.replace(/\.eval\.(ya?ml|json|jsonl)$/i, '').replace(/\.(ya?ml|json|jsonl)$/i, '');
}

export function formatSuiteDisplay(suite: string | undefined): SuiteDisplay | undefined {
  const raw = cleanOptional(suite);
  if (!raw || raw === 'Uncategorized') {
    return undefined;
  }

  const normalized = raw.replace(/\\/g, '/');
  const basename =
    normalized
      .split('/')
      .filter((part) => part.length > 0)
      .at(-1) ?? raw;
  const label = normalized.includes('/') ? stripEvalFileExtension(basename) : raw;

  return {
    label: label || raw,
    title: raw,
  };
}

export function evalSourceValue(result: EvalSourceLabelResult): string | undefined {
  return cleanOptional(result.eval_path) ?? cleanOptional(result.suite);
}

export function formatEvalSourceDisplay(result: EvalSourceLabelResult): SuiteDisplay | undefined {
  return formatSuiteDisplay(evalSourceValue(result));
}

export function shouldShowSuiteLabels(results: readonly SuiteLabelResult[]): boolean {
  const normalizedSuites = results.map((result) => cleanOptional(result.suite) ?? '');
  const meaningfulSuites = normalizedSuites.filter((suite) => suite && suite !== 'Uncategorized');

  return meaningfulSuites.length > 0 && new Set(normalizedSuites).size > 1;
}

export function shouldShowEvalSourceLabels(results: readonly EvalSourceLabelResult[]): boolean {
  const normalizedSources = results.map((result) => evalSourceValue(result) ?? '');
  const meaningfulSources = normalizedSources.filter(
    (source) => source && source !== 'Uncategorized',
  );

  return meaningfulSources.length > 0 && new Set(normalizedSources).size > 1;
}
