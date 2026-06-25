/**
 * Pure view model for Dashboard result tables.
 *
 * Result browsing appears on run detail and drill-down screens. Keep the
 * filtering, preset, grader-column, and display-column rules here so routes
 * can share one dense table contract without adding a new product mode.
 */

import { isExecutionError } from './result-summary';
import type { AssertionEntry, EvalCaseRun, EvalResult, ScoreEntry } from './types';

export type ResultTableViewId =
  | 'all'
  | 'passing'
  | 'failing'
  | 'errors'
  | 'grader_errors'
  | 'unreviewed';

export const RESULT_TABLE_VIEW_PRESETS: readonly {
  id: ResultTableViewId;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'passing', label: 'Passing' },
  { id: 'failing', label: 'Failing' },
  { id: 'errors', label: 'Errors' },
  { id: 'grader_errors', label: 'Grader errors' },
  { id: 'unreviewed', label: 'Unreviewed' },
];

export interface ResultTableState {
  readonly view: ResultTableViewId;
  readonly search: string;
  readonly target: string;
  readonly grader: string;
  readonly visibleColumnIds: readonly string[];
}

export interface ResultTableStateInput {
  readonly view?: string;
  readonly search?: string;
  readonly target?: string;
  readonly grader?: string;
  readonly visibleColumnIds?: readonly string[];
}

export interface ResultTableColumn {
  readonly id: string;
  readonly label: string;
  readonly kind: 'base' | 'grader';
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
  readonly graderError: boolean;
  readonly reviewed: boolean;
  readonly targetLabel: string;
  readonly modelLabel?: string;
  readonly suiteLabel?: string;
  readonly categoryLabel?: string;
  readonly tokenTotal?: number;
  readonly graderNames: readonly string[];
  readonly graderScores: ReadonlyMap<string, ScoreEntry>;
  readonly searchText: string;
}

export interface RepeatRunGroup {
  readonly row: ResultTableRow;
  readonly runs: readonly EvalCaseRun[];
  readonly runCount: number;
  readonly passedRuns: number;
  readonly failedRuns: number;
  readonly passRate: number;
  readonly meanScore: number;
  readonly assertionCount: number;
  readonly passedAssertions: number;
  readonly assertionPassRate?: number;
  readonly meanDurationMs?: number;
  readonly totalToolCalls?: number;
  readonly artifactCount: number;
}

export interface ResultTableModel {
  readonly rows: readonly ResultTableRow[];
  readonly filteredRows: readonly ResultTableRow[];
  readonly repeatGroups: readonly RepeatRunGroup[];
  readonly filteredRepeatGroups: readonly RepeatRunGroup[];
  readonly columns: readonly ResultTableColumn[];
  readonly visibleColumns: readonly ResultTableColumn[];
  readonly state: ResultTableState;
  readonly targetOptions: readonly string[];
  readonly graderOptions: readonly string[];
  readonly viewCounts: Readonly<Record<ResultTableViewId, number>>;
}

export interface BuildResultTableModelInput {
  readonly results: readonly EvalResult[];
  readonly passThreshold: number;
  readonly state?: ResultTableStateInput;
  readonly reviewedTestIds?: readonly string[];
}

const DEFAULT_TARGET = 'all';
const DEFAULT_GRADER = 'all';

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
  return cleanString(score.name) ?? cleanString(score.type) ?? `Grader ${index + 1}`;
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

function scoreAssertions(scores: readonly ScoreEntry[] | undefined): AssertionEntry[] {
  if (!scores || scores.length === 0) return [];
  return scores.flatMap((score) => [...(score.assertions ?? []), ...scoreAssertions(score.scores)]);
}

function uniqueAssertions(assertions: readonly AssertionEntry[]): AssertionEntry[] {
  const seen = new Set<string>();
  return assertions.filter((assertion) => {
    const key = `${assertion.text}\0${assertion.evidence ?? ''}\0${assertion.passed}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildGraderMap(
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

function numeric(values: readonly (number | undefined)[]): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

function caseRunPassed(caseRun: EvalCaseRun, passThreshold: number): boolean {
  if (caseRun.verdict === 'pass') return true;
  if (caseRun.verdict === 'fail') return false;
  return typeof caseRun.score === 'number' ? caseRun.score >= passThreshold : false;
}

function caseRunArtifactCount(caseRun: EvalCaseRun): number {
  return [
    caseRun.metrics_path,
    caseRun.timing_path,
    caseRun.grading_path,
    caseRun.transcript_path,
    caseRun.answer_path,
  ].filter(Boolean).length;
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
  const graderScores = buildGraderMap(result.scores);
  const graderNames = [...graderScores.keys()];
  const graderError =
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
    graderError,
    reviewed: reviewedTestIds.has(result.testId),
    targetLabel: target,
    ...(model && { modelLabel: model }),
    ...(suite && { suiteLabel: suite }),
    ...(category && { categoryLabel: category }),
    ...(tokenTotal !== undefined && { tokenTotal }),
    graderNames,
    graderScores,
    searchText: searchParts.join(' ').toLowerCase(),
  };
}

function buildRepeatGroup(row: ResultTableRow, passThreshold: number): RepeatRunGroup | undefined {
  const runs = row.result.runs?.filter((caseRun) => caseRun.run_path || caseRun.verdict);
  if (!runs || runs.length <= 1) return undefined;

  const passedRuns = runs.filter((caseRun) => caseRunPassed(caseRun, passThreshold)).length;
  const durationValues = numeric(runs.map((caseRun) => caseRun.duration_ms));
  const scoreValues = numeric(runs.map((caseRun) => caseRun.score));
  const toolCallValues = numeric(runs.map((caseRun) => caseRun.total_tool_calls));
  const artifactCount = runs.reduce((sum, caseRun) => sum + caseRunArtifactCount(caseRun), 0);
  const assertions = uniqueAssertions([
    ...(row.result.assertions ?? []),
    ...scoreAssertions(row.result.scores),
  ]);
  const passedAssertions = assertions.filter((assertion) => assertion.passed).length;

  return {
    row,
    runs,
    runCount: runs.length,
    passedRuns,
    failedRuns: runs.length - passedRuns,
    passRate: runs.length > 0 ? passedRuns / runs.length : 0,
    meanScore:
      scoreValues.length > 0
        ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length
        : row.result.score,
    assertionCount: assertions.length,
    passedAssertions,
    ...(assertions.length > 0 && { assertionPassRate: passedAssertions / assertions.length }),
    ...(durationValues.length > 0 && {
      meanDurationMs: durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length,
    }),
    ...(toolCallValues.length > 0 && {
      totalToolCalls: toolCallValues.reduce((sum, value) => sum + value, 0),
    }),
    artifactCount,
  };
}

function buildColumns(rows: readonly ResultTableRow[], graderOptions: readonly string[]) {
  const hasRepeatRows = rows.some((row) => (row.result.runs?.length ?? 0) > 1);
  const hasSuite = rows.some((row) => row.suiteLabel);
  const hasCategory = rows.some((row) => row.categoryLabel);
  const hasDuration = rows.some(
    (row) =>
      row.result.durationMs != null ||
      row.result.runs?.some((caseRun) => caseRun.duration_ms != null),
  );
  const hasCostOrTokens = rows.some(
    (row) =>
      row.result.costUsd != null ||
      row.tokenTotal != null ||
      row.result.runs?.some(
        (caseRun) =>
          caseRun.cost_usd != null || caseRun.total_tokens != null || caseRun.token_usage != null,
      ),
  );
  const hasError = rows.some((row) => row.result.error);

  const columns: ResultTableColumn[] = [
    { id: 'status', label: 'Status', kind: 'base', defaultVisible: true },
    ...(hasRepeatRows
      ? [{ id: 'expander', label: 'Expand', kind: 'base' as const, defaultVisible: true }]
      : []),
    { id: 'test', label: 'Test ID', kind: 'base', defaultVisible: true },
    { id: 'target', label: 'Target', kind: 'base', defaultVisible: true },
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
    ...graderOptions.map((name) => ({
      id: `grader:${name}`,
      label: name,
      kind: 'grader' as const,
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

function includeStructuralColumn(
  requestedColumns: readonly string[],
  columns: readonly ResultTableColumn[],
): string[] {
  if (!columns.some((column) => column.id === 'expander')) return [...requestedColumns];
  if (requestedColumns.includes('expander') || !requestedColumns.includes('test')) {
    return [...requestedColumns];
  }

  const next = [...requestedColumns];
  const statusIndex = next.indexOf('status');
  const testIndex = next.indexOf('test');
  const insertIndex = statusIndex >= 0 ? statusIndex + 1 : testIndex;
  next.splice(insertIndex, 0, 'expander');
  return next;
}

function normalizeState(
  input: ResultTableStateInput | undefined,
  columns: readonly ResultTableColumn[],
  targetOptions: readonly string[],
  graderOptions: readonly string[],
): ResultTableState {
  const columnIds = new Set(columns.map((column) => column.id));
  const requestedColumns = input?.visibleColumnIds?.filter((id) => columnIds.has(id)) ?? [];
  const visibleColumnIds =
    requestedColumns.length > 0
      ? includeStructuralColumn(requestedColumns, columns)
      : defaultVisibleColumnIds(columns);
  const target =
    input?.target && targetOptions.includes(input.target) ? input.target : DEFAULT_TARGET;
  const grader =
    input?.grader && graderOptions.includes(input.grader) ? input.grader : DEFAULT_GRADER;

  return {
    view: normalizeView(input?.view),
    search: input?.search?.trim() ?? '',
    target,
    grader,
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
    case 'grader_errors':
      return row.graderError;
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
    grader_errors: rows.filter((row) => row.graderError).length,
    unreviewed: rows.filter((row) => !row.reviewed).length,
  };
}

export function buildResultTableModel(input: BuildResultTableModelInput): ResultTableModel {
  const reviewedTestIds = new Set(input.reviewedTestIds ?? []);
  const rows = input.results.map((result, index) =>
    buildRow(result, index, input.passThreshold, reviewedTestIds),
  );
  const targetOptions = uniqueSorted(rows.map((row) => row.targetLabel));
  const graderOptions = uniqueSorted(rows.flatMap((row) => row.graderNames));
  const columns = buildColumns(rows, graderOptions);
  const state = normalizeState(input.state, columns, targetOptions, graderOptions);
  const query = state.search.toLowerCase();
  const visibleColumnIds = new Set(state.visibleColumnIds);

  const filteredRows = rows.filter((row) => {
    if (!matchesView(row, state.view)) return false;
    if (state.target !== DEFAULT_TARGET && row.targetLabel !== state.target) return false;
    if (state.grader !== DEFAULT_GRADER && !row.graderScores.has(state.grader)) return false;
    if (query && !row.searchText.includes(query)) return false;
    return true;
  });
  const repeatGroups = rows
    .map((row) => buildRepeatGroup(row, input.passThreshold))
    .filter((group): group is RepeatRunGroup => Boolean(group));
  const filteredRowKeys = new Set(filteredRows.map((row) => row.key));
  const filteredRepeatGroups = repeatGroups.filter((group) => filteredRowKeys.has(group.row.key));

  return {
    rows,
    filteredRows,
    repeatGroups,
    filteredRepeatGroups,
    columns,
    visibleColumns: columns.filter((column) => visibleColumnIds.has(column.id)),
    state,
    targetOptions,
    graderOptions,
    viewCounts: viewCounts(rows),
  };
}
