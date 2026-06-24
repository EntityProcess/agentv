/**
 * Canonical dense result table for Dashboard run-result browsing.
 *
 * The table keeps view/search/filter/display state in the URL using
 * `results_*` query params so run and project links remain stable while a
 * user tunes the local view.
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { artifactFileContentUrl, useFeedback } from '~/lib/api';
import {
  RESULT_TABLE_VIEW_PRESETS,
  type RepeatRunGroup,
  type ResultTableColumn,
  type ResultTableRow,
  type ResultTableState,
  type ResultTableStateInput,
  buildResultTableModel,
} from '~/lib/result-table';
import type { EvalResult, ScoreEntry } from '~/lib/types';

import { EvalDetail } from './EvalDetail';
import { PassRatePill } from './PassRatePill';

interface ResultTableProps {
  results: readonly EvalResult[];
  runId: string;
  projectId?: string;
  passThreshold: number;
  title?: string;
  emptyMessage?: React.ReactNode;
}

const QUERY_KEYS = {
  view: 'results_view',
  search: 'results_q',
  target: 'results_target',
  grader: 'results_grader',
  legacyScorer: 'results_scorer',
  columns: 'results_cols',
  detail: 'results_detail',
} as const;

function readUrlState(): ResultTableStateInput {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get(QUERY_KEYS.view) ?? undefined,
    search: params.get(QUERY_KEYS.search) ?? undefined,
    target: params.get(QUERY_KEYS.target) ?? undefined,
    grader: params.get(QUERY_KEYS.grader) ?? params.get(QUERY_KEYS.legacyScorer) ?? undefined,
    visibleColumnIds:
      params
        .get(QUERY_KEYS.columns)
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? undefined,
  };
}

function writeUrlState(state: ResultTableState) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);

  if (state.view === 'all') params.delete(QUERY_KEYS.view);
  else params.set(QUERY_KEYS.view, state.view);

  if (state.search) params.set(QUERY_KEYS.search, state.search);
  else params.delete(QUERY_KEYS.search);

  if (state.target === 'all') params.delete(QUERY_KEYS.target);
  else params.set(QUERY_KEYS.target, state.target);

  params.delete(QUERY_KEYS.legacyScorer);
  if (state.grader === 'all') params.delete(QUERY_KEYS.grader);
  else params.set(QUERY_KEYS.grader, state.grader);

  if (state.visibleColumnIds.length > 0) {
    params.set(QUERY_KEYS.columns, state.visibleColumnIds.join(','));
  } else {
    params.delete(QUERY_KEYS.columns);
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function readSelectedRowKey(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(QUERY_KEYS.detail);
}

function writeSelectedRowKey(rowKey: string | null) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (rowKey) params.set(QUERY_KEYS.detail, rowKey);
  else params.delete(QUERY_KEYS.detail);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs == null) return '-';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(costUsd: number | undefined): string | undefined {
  if (costUsd == null) return undefined;
  if (costUsd === 0) return '$0';
  if (costUsd < 0.01) return `$${costUsd.toFixed(5)}`;
  return `$${costUsd.toFixed(4)}`;
}

function formatTokens(tokens: number | undefined): string | undefined {
  if (tokens == null) return undefined;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

function compactTokenBreakdown(result: EvalResult): string | undefined {
  const usage = result.tokenUsage;
  if (!usage) return undefined;
  const parts = [
    usage.input != null ? `${usage.input} in` : undefined,
    usage.output != null ? `${usage.output} out` : undefined,
    usage.reasoning != null ? `${usage.reasoning} reason` : undefined,
    usage.cached != null ? `${usage.cached} cached` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

function scoreTone(score: number): string {
  if (score >= 0.8) return 'text-emerald-300';
  if (score >= 0.5) return 'text-yellow-300';
  return 'text-red-300';
}

function graderFailed(score: ScoreEntry): boolean {
  return score.verdict === 'fail' || score.assertions?.some((assertion) => !assertion.passed)
    ? true
    : (score.scores?.some(graderFailed) ?? false);
}

export function ResultTable({
  results,
  runId,
  projectId,
  passThreshold,
  title = 'Results',
  emptyMessage,
}: ResultTableProps) {
  const [urlState, setUrlState] = useState<ResultTableStateInput>(() => readUrlState());
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(() => readSelectedRowKey());
  const [collapsedRepeatRows, setCollapsedRepeatRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { data: feedback } = useFeedback(projectId);
  const reviewedTestIds = useMemo(
    () => feedback?.reviews.map((review) => review.test_id) ?? [],
    [feedback?.reviews],
  );
  const model = useMemo(
    () =>
      buildResultTableModel({
        results,
        passThreshold,
        reviewedTestIds,
        state: urlState,
      }),
    [passThreshold, results, reviewedTestIds, urlState],
  );
  const visibleColumnIds = new Set(model.state.visibleColumnIds);
  const selectedRow =
    selectedRowKey != null
      ? (model.filteredRows.find((row) => row.key === selectedRowKey) ?? null)
      : null;

  useEffect(() => {
    const handlePopState = () => {
      setUrlState(readUrlState());
      setSelectedRowKey(readSelectedRowKey());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!selectedRowKey || selectedRow) return;
    writeSelectedRowKey(null);
    setSelectedRowKey(null);
  }, [selectedRow, selectedRowKey]);

  function updateState(partial: Partial<ResultTableState>) {
    const nextState = { ...model.state, ...partial };
    writeUrlState(nextState);
    setUrlState(readUrlState());
  }

  function resetState() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    for (const key of Object.values(QUERY_KEYS)) {
      params.delete(key);
    }
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
    setUrlState({});
    setSelectedRowKey(null);
  }

  function toggleColumn(columnId: string) {
    const next = new Set(model.state.visibleColumnIds);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    updateState({ visibleColumnIds: [...next] });
  }

  function openRowDetail(rowKey: string) {
    writeSelectedRowKey(rowKey);
    setSelectedRowKey(rowKey);
  }

  function closeRowDetail() {
    writeSelectedRowKey(null);
    setSelectedRowKey(null);
  }

  function toggleRepeatGroup(rowKey: string) {
    setCollapsedRepeatRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        {emptyMessage ?? <p className="text-lg text-gray-400">No evaluations found</p>}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-sm font-medium text-gray-400">{title}</h3>
        <p className="text-xs text-gray-500">
          {model.filteredRows.length} of {model.rows.length} rows
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex flex-wrap gap-2">
          {RESULT_TABLE_VIEW_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => updateState({ view: preset.id })}
              className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                model.state.view === preset.id
                  ? 'border-cyan-900/60 bg-cyan-950/30 text-cyan-300'
                  : 'border-gray-800 bg-gray-950/70 text-gray-400 hover:border-gray-700 hover:text-gray-200'
              }`}
            >
              <span>{preset.label}</span>
              <span className="tabular-nums text-xs text-gray-500">
                {model.viewCounts[preset.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_minmax(150px,220px)_minmax(150px,220px)_auto_auto]">
          <label className="min-w-0">
            <span className="sr-only">Search results</span>
            <input
              type="search"
              value={model.state.search}
              onChange={(event) => updateState({ search: event.target.value })}
              placeholder="Search tests, targets, graders, assertions"
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </label>

          <label>
            <span className="sr-only">Filter by target</span>
            <select
              value={model.state.target}
              onChange={(event) => updateState({ target: event.target.value })}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All targets</option>
              {model.targetOptions.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">Filter by grader</span>
            <select
              value={model.state.grader}
              onChange={(event) => updateState({ grader: event.target.value })}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All graders</option>
              {model.graderOptions.map((grader) => (
                <option key={grader} value={grader}>
                  {grader}
                </option>
              ))}
            </select>
          </label>

          <details className="group relative">
            <summary className="list-none rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500">
              Display
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                Columns
              </div>
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {model.columns.map((column) => (
                  <label key={column.id} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={visibleColumnIds.has(column.id)}
                      onChange={() => toggleColumn(column.id)}
                      className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-cyan-500"
                    />
                    <span className="min-w-0 truncate" title={column.label}>
                      {column.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </details>

          <button
            type="button"
            onClick={resetState}
            className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        className={
          selectedRow ? 'grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,42rem)]' : ''
        }
      >
        <div className="min-w-0">
          {model.filteredRows.length === 0 ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
              <p className="text-lg text-gray-400">No matching evaluations</p>
              <p className="mt-2 text-sm text-gray-500">
                Adjust the result filters or display preset.
              </p>
            </div>
          ) : model.filteredRepeatGroups.length > 0 ? (
            <div className="space-y-4">
              <RepeatRunList
                groups={model.filteredRepeatGroups}
                runId={runId}
                projectId={projectId}
                passThreshold={passThreshold}
                collapsedRowKeys={collapsedRepeatRows}
                onToggleGroup={toggleRepeatGroup}
                onOpenDetail={openRowDetail}
                selectedRowKey={selectedRowKey}
              />
              {model.filteredRows.length > model.filteredRepeatGroups.length ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Single-run results
                  </h4>
                  <ResultRowsTable
                    rows={model.filteredRows.filter(
                      (row) =>
                        !model.filteredRepeatGroups.some((group) => group.row.key === row.key),
                    )}
                    visibleColumns={model.visibleColumns}
                    passThreshold={passThreshold}
                    selectedRowKey={selectedRowKey}
                    onOpenDetail={openRowDetail}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <ResultRowsTable
              rows={model.filteredRows}
              visibleColumns={model.visibleColumns}
              passThreshold={passThreshold}
              selectedRowKey={selectedRowKey}
              onOpenDetail={openRowDetail}
            />
          )}
        </div>

        {selectedRow && (
          <ResultDetailPanel
            row={selectedRow}
            runId={runId}
            projectId={projectId}
            onClose={closeRowDetail}
          />
        )}
      </div>
    </section>
  );
}

function ResultRowsTable({
  rows,
  visibleColumns,
  passThreshold,
  selectedRowKey,
  onOpenDetail,
}: {
  rows: readonly ResultTableRow[];
  visibleColumns: readonly ResultTableColumn[];
  passThreshold: number;
  selectedRowKey: string | null;
  onOpenDetail: (rowKey: string) => void;
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
      <table
        className="w-full whitespace-nowrap text-left text-sm"
        style={{ minWidth: `${Math.max(860, visibleColumns.length * 136)}px` }}
      >
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column.id}
                className={`px-4 py-3 font-medium text-gray-400 ${
                  isNumericColumn(column.id) ? 'text-right' : ''
                }`}
                title={column.label}
              >
                <span className="block max-w-48 truncate">{column.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {rows.map((row) => {
            const isSelected = selectedRowKey === row.key;
            return (
              <tr
                key={row.key}
                className={`transition-colors ${
                  isSelected ? 'bg-cyan-950/20' : 'hover:bg-gray-900/30'
                }`}
              >
                {visibleColumns.map((column) => (
                  <td
                    key={`${row.key}:${column.id}`}
                    className={`px-4 py-3 align-middle ${
                      isNumericColumn(column.id) ? 'text-right tabular-nums' : ''
                    }`}
                  >
                    <ResultCell
                      column={column}
                      row={row}
                      passThreshold={passThreshold}
                      onOpenDetail={onOpenDetail}
                      isSelected={isSelected}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RepeatRunList({
  groups,
  runId,
  projectId,
  passThreshold,
  collapsedRowKeys,
  onToggleGroup,
  onOpenDetail,
  selectedRowKey,
}: {
  groups: readonly RepeatRunGroup[];
  runId: string;
  projectId?: string;
  passThreshold: number;
  collapsedRowKeys: ReadonlySet<string>;
  onToggleGroup: (rowKey: string) => void;
  onOpenDetail: (rowKey: string) => void;
  selectedRowKey: string | null;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No repeated evaluations match this view</p>
        <p className="mt-2 text-sm text-gray-500">Clear filters to see repeated-run case groups.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const collapsed = collapsedRowKeys.has(group.row.key);
        const selected = selectedRowKey === group.row.key;
        return (
          <article
            key={group.row.key}
            className={`overflow-hidden rounded-lg border bg-gray-900/50 ${
              selected ? 'border-cyan-800/70' : 'border-gray-800'
            }`}
          >
            <div className="p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleGroup(group.row.key)}
                      className="shrink-0 rounded-md border border-gray-800 px-2 py-0.5 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.row.testId}`}
                    >
                      {collapsed ? '+' : '-'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(group.row.key)}
                      className="min-w-0 truncate text-left font-semibold text-gray-100 transition-colors hover:text-cyan-300 hover:underline"
                      title={group.row.testId}
                    >
                      {group.row.testId}
                    </button>
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${
                        group.passedRuns === group.runCount
                          ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                          : group.passedRuns > 0
                            ? 'border-yellow-900/60 bg-yellow-950/20 text-yellow-300'
                            : 'border-red-900/60 bg-red-950/20 text-red-300'
                      }`}
                    >
                      {group.passedRuns}/{group.runCount} passed
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className={`h-full rounded-full ${
                        group.passRate >= 1
                          ? 'bg-emerald-500'
                          : group.passRate > 0
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.max(2, Math.round(group.passRate * 100))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>{formatPercent(group.passRate)} run success</span>
                    <span>{formatPercent(group.meanScore)} mean score</span>
                    {group.totalToolCalls != null ? (
                      <span>{group.totalToolCalls} total tool calls</span>
                    ) : null}
                    {group.artifactCount > 0 ? <span>{group.artifactCount} artifacts</span> : null}
                  </div>
                </div>
                <div className="shrink-0 text-left lg:text-right">
                  <div className="text-xs font-medium uppercase text-gray-500">Mean duration</div>
                  <div className="mt-1 tabular-nums text-sm text-gray-200">
                    {formatDuration(group.meanDurationMs ?? group.row.result.durationMs)}
                  </div>
                </div>
              </div>
            </div>

            {!collapsed && (
              <div className="space-y-2 border-t border-gray-800 bg-gray-950/40 p-3">
                {group.runs.map((caseRun, index) => (
                  <RepeatRunRow
                    key={`${group.row.key}:${caseRun.run_path ?? index}`}
                    caseRun={caseRun}
                    index={index}
                    runId={runId}
                    evalId={group.row.testId}
                    artifactDir={group.row.result.artifact_dir}
                    projectId={projectId}
                    passThreshold={passThreshold}
                  />
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function RepeatRunRow({
  caseRun,
  index,
  runId,
  evalId,
  artifactDir,
  projectId,
  passThreshold,
}: {
  caseRun: RepeatRunGroup['runs'][number];
  index: number;
  runId: string;
  evalId: string;
  artifactDir?: string;
  projectId?: string;
  passThreshold: number;
}) {
  const passed =
    caseRun.verdict === 'pass' ||
    (caseRun.verdict !== 'fail' && (caseRun.score ?? 0) >= passThreshold);
  const label = caseRun.run_path ?? `run-${caseRun.run ?? index + 1}`;
  const artifactLinks = [
    { label: 'metrics', path: caseRun.metrics_path },
    { label: 'timing', path: caseRun.timing_path },
    { label: 'grading', path: caseRun.grading_path },
    { label: 'transcript', path: caseRun.transcript_path },
    { label: 'output', path: caseRun.answer_path },
  ].filter((item): item is { label: string; path: string } => Boolean(item.path));

  return (
    <div className="grid gap-3 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm md:grid-cols-[minmax(10rem,1fr)_auto_auto_minmax(12rem,auto)] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-gray-200" title={label}>
            {label}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
              passed ? 'bg-emerald-950/40 text-emerald-300' : 'bg-red-950/40 text-red-300'
            }`}
          >
            {passed ? 'passed' : 'failed'}
          </span>
        </div>
        {caseRun.error ? (
          <p className="mt-1 truncate text-xs text-red-300" title={caseRun.error}>
            {caseRun.error}
          </p>
        ) : null}
      </div>
      <div className="tabular-nums text-gray-400">{formatPercent(caseRun.score ?? 0)}</div>
      <div className="tabular-nums text-gray-400">{formatDuration(caseRun.duration_ms)}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
        {caseRun.total_tool_calls != null ? (
          <span className="text-xs text-gray-500">{caseRun.total_tool_calls} tool calls</span>
        ) : null}
        {artifactLinks.map((artifact) => (
          <a
            key={artifact.label}
            href={artifactFileContentUrl({
              runId,
              projectId,
              evalId,
              artifactDir,
              filePath: artifact.path,
              raw: true,
            })}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-gray-800 px-2 py-0.5 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
          >
            {artifact.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function isNumericColumn(columnId: string): boolean {
  return ['duration', 'cost_tokens'].includes(columnId) || columnId.startsWith('grader:');
}

function ResultCell({
  column,
  row,
  passThreshold,
  onOpenDetail,
  isSelected,
}: {
  column: ResultTableColumn;
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
  passThreshold: number;
  onOpenDetail: (rowKey: string) => void;
  isSelected: boolean;
}) {
  if (column.id.startsWith('grader:')) {
    const graderName = column.id.slice('grader:'.length);
    return (
      <GraderScoreCell score={row.graderScores.get(graderName)} passThreshold={passThreshold} />
    );
  }

  switch (column.id) {
    case 'status':
      return <StatusCell status={row.status} label={row.statusLabel} />;
    case 'test':
      return <TestCell row={row} onOpenDetail={onOpenDetail} isSelected={isSelected} />;
    case 'model_target':
      return <ModelTargetCell row={row} />;
    case 'score':
      return row.executionError ? (
        <span className="inline-flex rounded-md border border-amber-900/60 bg-amber-950/20 px-2 py-0.5 text-xs font-medium text-amber-300">
          Execution error
        </span>
      ) : (
        <PassRatePill rate={row.result.score} />
      );
    case 'suite':
      return <TruncatedMuted value={row.suiteLabel} />;
    case 'category':
      return <TruncatedMuted value={row.categoryLabel} />;
    case 'duration':
      return <span className="text-gray-400">{formatDuration(row.result.durationMs)}</span>;
    case 'cost_tokens':
      return <CostTokenCell row={row} />;
    case 'review':
      return (
        <span className={row.reviewed ? 'text-emerald-300' : 'text-gray-500'}>
          {row.reviewed ? 'Reviewed' : 'Unreviewed'}
        </span>
      );
    case 'error':
      return <TruncatedMuted value={row.result.error} tone="text-red-300" />;
    default:
      return <span className="text-gray-600">-</span>;
  }
}

function StatusCell({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'passing'
      ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
      : status === 'error'
        ? 'border-amber-900/60 bg-amber-950/20 text-amber-300'
        : 'border-red-900/60 bg-red-950/20 text-red-300';
  const dot =
    status === 'passing' ? 'bg-emerald-400' : status === 'error' ? 'bg-amber-400' : 'bg-red-400';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function TestCell({
  row,
  onOpenDetail,
  isSelected,
}: {
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
  onOpenDetail: (rowKey: string) => void;
  isSelected: boolean;
}) {
  const className =
    'block min-w-0 truncate text-left font-medium text-cyan-400 hover:text-cyan-300 hover:underline';

  return (
    <div className="max-w-[24rem] min-w-0">
      <button
        type="button"
        onClick={() => onOpenDetail(row.key)}
        className={className}
        title={row.testId}
        aria-pressed={isSelected}
      >
        {row.testId}
      </button>
      {row.result.error ? (
        <div className="mt-0.5 truncate text-xs text-red-300" title={row.result.error}>
          {row.result.error}
        </div>
      ) : null}
    </div>
  );
}

function buildEvalDetailHref(options: {
  projectId?: string;
  runId: string;
  evalId: string;
  artifactDir?: string;
}): string {
  const base = options.projectId
    ? `/projects/${encodeURIComponent(options.projectId)}/evals/${encodeURIComponent(options.runId)}/${encodeURIComponent(options.evalId)}`
    : `/evals/${encodeURIComponent(options.runId)}/${encodeURIComponent(options.evalId)}`;
  if (!options.artifactDir) {
    return base;
  }
  return `${base}?artifact_dir=${encodeURIComponent(options.artifactDir)}`;
}

function ResultDetailPanel({
  row,
  runId,
  projectId,
  onClose,
}: {
  row: ResultTableRow;
  runId: string;
  projectId?: string;
  onClose: () => void;
}) {
  const evalDetailHref = buildEvalDetailHref({
    projectId,
    runId,
    evalId: row.testId,
    artifactDir: row.result.artifact_dir,
  });
  return (
    <aside className="min-w-0 rounded-lg border border-gray-800 bg-gray-950/80 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Row detail</p>
          <h4 className="mt-1 truncate text-base font-semibold text-white" title={row.testId}>
            {row.testId}
          </h4>
          <p className="mt-1 truncate text-xs text-gray-500" title={row.targetLabel}>
            {row.targetLabel}
            {row.suiteLabel ? ` · ${row.suiteLabel}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={evalDetailHref}
            className="rounded-md border border-gray-800 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
          >
            Full page
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-800 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
      <div className="h-[36rem] min-h-[28rem] overflow-hidden xl:h-[calc(100vh-9rem)]">
        <EvalDetail eval={row.result} runId={runId} projectId={projectId} />
      </div>
    </aside>
  );
}

function ModelTargetCell({
  row,
}: {
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
}) {
  return (
    <div className="max-w-[16rem] min-w-0">
      <div className="truncate text-gray-300" title={row.targetLabel}>
        {row.targetLabel}
      </div>
      {row.modelLabel ? (
        <div className="mt-0.5 truncate text-xs text-gray-500" title={row.modelLabel}>
          {row.modelLabel}
        </div>
      ) : null}
    </div>
  );
}

function CostTokenCell({
  row,
}: {
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
}) {
  const cost = formatCost(row.result.costUsd);
  const tokens = formatTokens(row.tokenTotal);
  const breakdown = compactTokenBreakdown(row.result);
  if (!cost && !tokens) return <span className="text-gray-600">-</span>;

  return (
    <div className="min-w-0 text-right">
      {cost ? <div className="tabular-nums text-gray-300">{cost}</div> : null}
      {tokens ? (
        <div className="text-xs tabular-nums text-gray-500" title={breakdown}>
          {tokens}
        </div>
      ) : null}
    </div>
  );
}

function GraderScoreCell({
  score,
  passThreshold,
}: {
  score: ScoreEntry | undefined;
  passThreshold: number;
}) {
  if (!score) return <span className="text-gray-600">-</span>;
  const failed = score.score < passThreshold || graderFailed(score);
  return (
    <div className="min-w-0 text-right">
      <div className={`tabular-nums ${scoreTone(score.score)}`}>{formatPercent(score.score)}</div>
      <div className={failed ? 'text-xs text-red-300' : 'text-xs text-gray-500'}>
        {failed ? 'Fail' : (score.verdict ?? 'Pass')}
      </div>
    </div>
  );
}

function TruncatedMuted({
  value,
  tone = 'text-gray-400',
}: {
  value: string | undefined;
  tone?: string;
}) {
  if (!value) return <span className="text-gray-600">-</span>;
  return (
    <span className={`block max-w-[14rem] truncate ${tone}`} title={value}>
      {value}
    </span>
  );
}
