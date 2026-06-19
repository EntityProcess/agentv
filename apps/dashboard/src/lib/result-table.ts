/**
 * Pure view model for Dashboard result tables.
 *
 * Result browsing appears on run detail and drill-down screens. Keep the
 * filtering, preset, scorer-column, and display-column rules here so routes
 * can share one dense table contract without adding a new product mode.
 */

import { isExecutionError } from './result-summary';
import type { EvalResult, ScoreEntry } from './types';

export type ResultTableViewId =
  | 'all'
  | 'passing'
  | 'failing'
  | 'errors'
  | 'scorer_errors'
  | 'unreviewed';

export const RESULT_TABLE_VIEW_PRESETS: readonly {
  id: ResultTableViewId;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'passing', label: 'Passing' },
  { id: 'failing', label: 'Failing' },
  { id: 'errors', label: 'Errors' },
  { id: 'scorer_errors', label: 'Scorer errors' },
  { id: 'unreviewed', label: 'Unreviewed' },
];

export interface ResultTableState {
  readonly view: ResultTableViewId;
  readonly search: string;
  readonly target: string;
  readonly scorer: string;
  readonly visibleColumnIds: readonly string[];
}

export interface ResultTableStateInput {
  readonly view?: string;
  readonly search?: string;
  readonly target?: string;
  readonly scorer?: string;
  readonly visibleColumnIds?: readonly string[];
}

export interface ResultTableColumn {
  readonly id: string;
  readonly label: string;
  readonly kind: 'base' | 'scorer';
  readonly defaultVisible: boolean;
}

export type ResultTableRowStatus = 'passing' | 'failing' | 'error';

export interface ResultTableRow {
  readonly key: string;
  readonly result: EvalResult;
  readonly index: number;
  readonly testId: string;
  readonly status: ResultTableRowStatus;
  readonly statusLabel: 'Passing' | 'Failing' | 'Error';
  readonly passing: boolean;
  readonly executionError: boolean;
  readonly scorerError: boolean;
  readonly reviewed: boolean;
  readonly targetLabel: string;
  readonly modelLabel?: string;
  readonly suiteLabel?: string;
  readonly categoryLabel?: string;
  readonly tokenTotal?: number;
  readonly scorerNames: readonly string[];
  readonly scorerScores: ReadonlyMap<string, ScoreEntry>;
  readonly searchText: string;
}

export interface ResultTableModel {
  readonly rows: readonly ResultTableRow[];
  readonly filteredRows: readonly ResultTableRow[];
  readonly columns: readonly ResultTableColumn[];
  readonly visibleColumns: readonly ResultTableColumn[];
  readonly state: ResultTableState;
  readonly targetOptions: readonly string[];
  readonly scorerOptions: readonly string[];
  readonly viewCounts: Readonly<Record<ResultTableViewId, number>>;
}

export interface BuildResultTableModelInput {
  readonly results: readonly EvalResult[];
  readonly passThreshold: number;
  readonly state?: ResultTableStateInput;
  readonly reviewedTestIds?: readonly string[];
}

const DEFAULT_TARGET = 'all';
const DEFAULT_SCORER = 'all';

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function scoreLabel(score: ScoreEntry, index: number): string {
  return cleanString(score.name) ?? cleanString(score.type) ?? `Scorer ${index + 1}`;
}

function scoreHasFailure(score: ScoreEntry, passThreshold: number): boolean {
  if (score.verdict === 'fail') return true;
  if (score.score < passThreshold) return true;
  if (score.assertions?.some((assertion) => !assertion.passed)) return true;
  return score.scores?.some((child) => scoreHasFailure(child, passThreshold)) ?? false;
}

function flattenScoreText(scores: readonly ScoreEntry[] | undefined): string[] {
  if (!scores || scores.length === 0) return [];
  const parts: string[] = [];
  scores.forEach((score, index) => {
    parts.push(scoreLabel(score, index), score.type ?? '', score.verdict ?? '');
    for (const assertion of score.assertions ?? []) {
      parts.push(assertion.text, assertion.evidence ?? '');
    }
    parts.push(...flattenScoreText(score.scores));
  });
  return parts.filter((part) => part.length > 0);
}

function buildScorerMap(
  scores: readonly ScoreEntry[] | undefined,
): ReadonlyMap<string, ScoreEntry> {
  const map = new Map<string, ScoreEntry>();
  scores?.forEach((score, index) => {
    const label = scoreLabel(score, index);
    if (!map.has(label)) {
      map.set(label, score);
    }
  });
  return map;
}

function totalTokens(result: EvalResult): number | undefined {
  const usage = result.tokenUsage;
  if (!usage) return undefined;
  const values = [usage.input, usage.output, usage.reasoning, usage.cached].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function modelLabel(result: EvalResult): string | undefined {
  const direct = cleanString(result.model);
  if (direct) return direct;

  const metadata = result.metadata;
  if (!metadata) return undefined;
  return (
    cleanString(metadata.model) ??
    cleanString(metadata.model_name) ??
    cleanString(metadata.target_model) ??
    cleanString(metadata.provider_model)
  );
}

function targetLabel(result: EvalResult): string {
  const target = cleanString(result.target) ?? 'default';
  const targetUsed = cleanString(result.targetUsed);
  return targetUsed && targetUsed !== target ? `${target} -> ${targetUsed}` : target;
}

function buildRow(
  result: EvalResult,
  index: number,
  passThreshold: number,
  reviewedTestIds: ReadonlySet<string>,
): ResultTableRow {
  const executionError = isExecutionError(result);
  const passing = !executionError && result.score >= passThreshold;
  const status: ResultTableRowStatus = executionError ? 'error' : passing ? 'passing' : 'failing';
  const scorerScores = buildScorerMap(result.scores);
  const scorerNames = [...scorerScores.keys()];
  const scorerError =
    result.scores?.some((score) => scoreHasFailure(score, passThreshold)) ?? false;
  const model = modelLabel(result);
  const target = targetLabel(result);
  const suite = cleanString(result.suite);
  const category = cleanString(result.category);
  const tokenTotal = totalTokens(result);
  const searchParts = [
    result.testId,
    target,
    model ?? '',
    suite ?? '',
    category ?? '',
    result.executionStatus ?? '',
    result.error ?? '',
    ...flattenScoreText(result.scores),
    ...(result.assertions ?? []).flatMap((assertion) => [assertion.text, assertion.evidence ?? '']),
  ];

  return {
    key: `${result.testId}:${result.target ?? ''}:${result.timestamp ?? ''}:${index}`,
    result,
    index,
    testId: result.testId,
    status,
    statusLabel: executionError ? 'Error' : passing ? 'Passing' : 'Failing',
    passing,
    executionError,
    scorerError,
    reviewed: reviewedTestIds.has(result.testId),
    targetLabel: target,
    ...(model && { modelLabel: model }),
    ...(suite && { suiteLabel: suite }),
    ...(category && { categoryLabel: category }),
    ...(tokenTotal !== undefined && { tokenTotal }),
    scorerNames,
    scorerScores,
    searchText: searchParts.join(' ').toLowerCase(),
  };
}

function hasMeaningfulTarget(rows: readonly ResultTableRow[]): boolean {
  return rows.some((row) => row.targetLabel !== 'default' || row.modelLabel);
}

function buildColumns(rows: readonly ResultTableRow[], scorerOptions: readonly string[]) {
  const hasSuite = rows.some((row) => row.suiteLabel);
  const hasCategory = rows.some((row) => row.categoryLabel);
  const hasDuration = rows.some((row) => row.result.durationMs != null);
  const hasCostOrTokens = rows.some((row) => row.result.costUsd != null || row.tokenTotal != null);
  const hasError = rows.some((row) => row.result.error);

  const columns: ResultTableColumn[] = [
    { id: 'status', label: 'Status', kind: 'base', defaultVisible: true },
    { id: 'test', label: 'Test ID', kind: 'base', defaultVisible: true },
    {
      id: 'model_target',
      label: 'Model / Target',
      kind: 'base',
      defaultVisible: hasMeaningfulTarget(rows),
    },
    { id: 'score', label: 'Score', kind: 'base', defaultVisible: true },
    ...(hasSuite
      ? [{ id: 'suite', label: 'Suite', kind: 'base' as const, defaultVisible: true }]
      : []),
    ...(hasCategory
      ? [{ id: 'category', label: 'Category', kind: 'base' as const, defaultVisible: false }]
      : []),
    ...(hasDuration
      ? [{ id: 'duration', label: 'Duration', kind: 'base' as const, defaultVisible: true }]
      : []),
    ...(hasCostOrTokens
      ? [
          {
            id: 'cost_tokens',
            label: 'Cost / Tokens',
            kind: 'base' as const,
            defaultVisible: true,
          },
        ]
      : []),
    { id: 'review', label: 'Review', kind: 'base', defaultVisible: false },
    ...(hasError
      ? [{ id: 'error', label: 'Error', kind: 'base' as const, defaultVisible: false }]
      : []),
    ...scorerOptions.map((name) => ({
      id: `scorer:${name}`,
      label: name,
      kind: 'scorer' as const,
      defaultVisible: true,
    })),
  ];

  return columns;
}

function normalizeView(value: string | undefined): ResultTableViewId {
  return RESULT_TABLE_VIEW_PRESETS.some((preset) => preset.id === value)
    ? (value as ResultTableViewId)
    : 'all';
}

function defaultVisibleColumnIds(columns: readonly ResultTableColumn[]): string[] {
  const defaults = columns.filter((column) => column.defaultVisible).map((column) => column.id);
  return defaults.length > 0 ? defaults : columns.slice(0, 4).map((column) => column.id);
}

function normalizeState(
  input: ResultTableStateInput | undefined,
  columns: readonly ResultTableColumn[],
  targetOptions: readonly string[],
  scorerOptions: readonly string[],
): ResultTableState {
  const columnIds = new Set(columns.map((column) => column.id));
  const requestedColumns = input?.visibleColumnIds?.filter((id) => columnIds.has(id)) ?? [];
  const visibleColumnIds =
    requestedColumns.length > 0 ? requestedColumns : defaultVisibleColumnIds(columns);
  const target =
    input?.target && targetOptions.includes(input.target) ? input.target : DEFAULT_TARGET;
  const scorer =
    input?.scorer && scorerOptions.includes(input.scorer) ? input.scorer : DEFAULT_SCORER;

  return {
    view: normalizeView(input?.view),
    search: input?.search?.trim() ?? '',
    target,
    scorer,
    visibleColumnIds,
  };
}

function matchesView(row: ResultTableRow, view: ResultTableViewId): boolean {
  switch (view) {
    case 'passing':
      return row.status === 'passing';
    case 'failing':
      return row.status === 'failing';
    case 'errors':
      return row.status === 'error';
    case 'scorer_errors':
      return row.scorerError;
    case 'unreviewed':
      return !row.reviewed;
    case 'all':
      return true;
  }
}

function viewCounts(rows: readonly ResultTableRow[]): Readonly<Record<ResultTableViewId, number>> {
  return {
    all: rows.length,
    passing: rows.filter((row) => row.status === 'passing').length,
    failing: rows.filter((row) => row.status === 'failing').length,
    errors: rows.filter((row) => row.status === 'error').length,
    scorer_errors: rows.filter((row) => row.scorerError).length,
    unreviewed: rows.filter((row) => !row.reviewed).length,
  };
}

export function buildResultTableModel(input: BuildResultTableModelInput): ResultTableModel {
  const reviewedTestIds = new Set(input.reviewedTestIds ?? []);
  const rows = input.results.map((result, index) =>
    buildRow(result, index, input.passThreshold, reviewedTestIds),
  );
  const targetOptions = uniqueSorted(rows.map((row) => row.targetLabel));
  const scorerOptions = uniqueSorted(rows.flatMap((row) => row.scorerNames));
  const columns = buildColumns(rows, scorerOptions);
  const state = normalizeState(input.state, columns, targetOptions, scorerOptions);
  const query = state.search.toLowerCase();
  const visibleColumnIds = new Set(state.visibleColumnIds);

  const filteredRows = rows.filter((row) => {
    if (!matchesView(row, state.view)) return false;
    if (state.target !== DEFAULT_TARGET && row.targetLabel !== state.target) return false;
    if (state.scorer !== DEFAULT_SCORER && !row.scorerScores.has(state.scorer)) return false;
    if (query && !row.searchText.includes(query)) return false;
    return true;
  });

  return {
    rows,
    filteredRows,
    columns,
    visibleColumns: columns.filter((column) => visibleColumnIds.has(column.id)),
    state,
    targetOptions,
    scorerOptions,
    viewCounts: viewCounts(rows),
  };
}
