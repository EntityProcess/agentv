/**
 * Canonical dense result table for Dashboard run-result browsing.
 *
 * The table keeps view/search/filter/display state in the URL using
 * `results_*` query params so run and project links remain stable while a
 * user tunes the local view.
 */

import type React from 'react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { useFeedback } from '~/lib/api';
import {
  RESULT_TABLE_VIEW_PRESETS,
  type RepeatRunGroup,
  type ResultTableColumn,
  type ResultTableRow,
  type ResultTableState,
  type ResultTableStateInput,
  buildResultTableModel,
  buildScoreEntryMap,
} from '~/lib/result-table';
import type { EvalCaseRun, EvalResult, ScoreEntry } from '~/lib/types';

import { EvalDetail } from './EvalDetail';
import { PassRatePill } from './PassRatePill';

type DetailTab = 'checks' | 'transcript' | 'source' | 'files' | 'feedback';

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
  columns: 'results_cols',
  detail: 'results_detail',
} as const;

const CHECK_MARK = '\u2713';
const CROSS_MARK = '\u2717';

function readUrlState(): ResultTableStateInput {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get(QUERY_KEYS.view) ?? undefined,
    search: params.get(QUERY_KEYS.search) ?? undefined,
    target: params.get(QUERY_KEYS.target) ?? undefined,
    grader: params.get(QUERY_KEYS.grader) ?? undefined,
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

function tokenUsageTotal(
  usage: EvalCaseRun['token_usage'] | EvalResult['tokenUsage'],
): number | undefined {
  if (!usage) return undefined;
  const values = [usage.input, usage.output, usage.reasoning, usage.cached].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function caseRunTokenTotal(caseRun: EvalCaseRun): number | undefined {
  return caseRun.total_tokens ?? tokenUsageTotal(caseRun.token_usage);
}

function caseRunPath(caseRun: EvalCaseRun, index = 0): string {
  return caseRun.run_path ?? `run-${caseRun.run ?? index + 1}`;
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
  const [selectedRunPath, setSelectedRunPath] = useState<string | null>(null);
  const [selectedDetailFilePath, setSelectedDetailFilePath] = useState<string | null>(null);
  const [selectedDetailTab, setSelectedDetailTab] = useState<DetailTab>('checks');
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
  const repeatGroupsByRowKey = useMemo(
    () => new Map(model.repeatGroups.map((group) => [group.row.key, group])),
    [model.repeatGroups],
  );
  const selectedRepeatGroup = selectedRow ? repeatGroupsByRowKey.get(selectedRow.key) : undefined;
  const selectedCaseRun =
    selectedRepeatGroup && selectedRunPath
      ? (selectedRepeatGroup.runs.find(
          (caseRun, index) => caseRunPath(caseRun, index) === selectedRunPath,
        ) ?? null)
      : null;

  useEffect(() => {
    const handlePopState = () => {
      setUrlState(readUrlState());
      setSelectedRowKey(readSelectedRowKey());
      setSelectedRunPath(null);
      setSelectedDetailFilePath(null);
      setSelectedDetailTab('checks');
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
    setSelectedRunPath(null);
    setSelectedDetailFilePath(null);
    setSelectedDetailTab('checks');
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
    setSelectedRunPath(null);
    setSelectedDetailFilePath(null);
    setSelectedDetailTab('checks');
  }

  function openRunDetail(rowKey: string, caseRun: EvalCaseRun, initialTab: DetailTab = 'checks') {
    writeSelectedRowKey(rowKey);
    setSelectedRowKey(rowKey);
    setSelectedRunPath(caseRunPath(caseRun));
    setSelectedDetailTab(initialTab);
    setSelectedDetailFilePath(primaryRunArtifactPath(caseRun));
  }

  function closeRowDetail() {
    writeSelectedRowKey(null);
    setSelectedRowKey(null);
    setSelectedRunPath(null);
    setSelectedDetailFilePath(null);
    setSelectedDetailTab('checks');
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
          ) : (
            <ResultRowsTable
              rows={model.filteredRows}
              visibleColumns={model.visibleColumns}
              passThreshold={passThreshold}
              selectedRowKey={selectedRowKey}
              selectedRunPath={selectedRunPath}
              repeatGroupsByRowKey={repeatGroupsByRowKey}
              collapsedRepeatRows={collapsedRepeatRows}
              onToggleRepeatGroup={toggleRepeatGroup}
              onOpenDetail={openRowDetail}
              onOpenRunDetail={openRunDetail}
            />
          )}
        </div>

        {selectedRow && (
          <ResultDetailPanel
            row={selectedRow}
            runId={runId}
            projectId={projectId}
            repeatGroup={selectedRepeatGroup}
            selectedCaseRun={selectedCaseRun}
            selectedRunPath={selectedRunPath}
            initialTab={selectedDetailTab}
            initialFilePath={selectedDetailFilePath}
            onOpenRunDetail={(caseRun, initialTab) =>
              openRunDetail(selectedRow.key, caseRun, initialTab)
            }
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
  selectedRunPath,
  repeatGroupsByRowKey,
  collapsedRepeatRows,
  onToggleRepeatGroup,
  onOpenDetail,
  onOpenRunDetail,
}: {
  rows: readonly ResultTableRow[];
  visibleColumns: readonly ResultTableColumn[];
  passThreshold: number;
  selectedRowKey: string | null;
  selectedRunPath: string | null;
  repeatGroupsByRowKey: ReadonlyMap<string, RepeatRunGroup>;
  collapsedRepeatRows: ReadonlySet<string>;
  onToggleRepeatGroup: (rowKey: string) => void;
  onOpenDetail: (rowKey: string) => void;
  onOpenRunDetail: (rowKey: string, caseRun: EvalCaseRun) => void;
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
      <table
        className="w-full whitespace-nowrap text-left text-sm"
        style={{ minWidth: `${resultTableMinWidth(visibleColumns)}px` }}
      >
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
            {visibleColumns.map((column) => (
              <th key={column.id} className={columnHeaderClassName(column.id)} title={column.label}>
                <span
                  className={
                    isVisuallyHiddenHeader(column.id) ? 'sr-only' : 'block max-w-48 truncate'
                  }
                >
                  {column.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {rows.map((row) => {
            const repeatGroup = repeatGroupsByRowKey.get(row.key);
            const isSelected = selectedRowKey === row.key && !selectedRunPath;
            const collapsed = repeatGroup ? collapsedRepeatRows.has(row.key) : true;
            return (
              <Fragment key={row.key}>
                <tr
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-cyan-950/20' : 'hover:bg-gray-900/30'
                  }`}
                  onClick={() => onOpenDetail(row.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenDetail(row.key);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={isSelected}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={`${row.key}:${column.id}`}
                      className={columnCellClassName(column.id, 'py-3')}
                    >
                      <ResultCell
                        column={column}
                        row={row}
                        repeatGroup={repeatGroup}
                        repeatCollapsed={collapsed}
                        passThreshold={passThreshold}
                        isSelected={isSelected}
                        onToggleRepeatGroup={onToggleRepeatGroup}
                      />
                    </td>
                  ))}
                </tr>
                {repeatGroup && !collapsed
                  ? repeatGroup.runs.map((caseRun, index) => {
                      const runPath = caseRunPath(caseRun, index);
                      const runSelected = selectedRowKey === row.key && selectedRunPath === runPath;
                      return (
                        <tr
                          key={`${row.key}:${runPath}`}
                          className={`cursor-pointer bg-gray-950/40 transition-colors ${
                            runSelected ? 'bg-cyan-950/20' : 'hover:bg-gray-900/50'
                          }`}
                          onClick={() => onOpenRunDetail(row.key, caseRun)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onOpenRunDetail(row.key, caseRun);
                            }
                          }}
                          tabIndex={0}
                          aria-selected={runSelected}
                        >
                          {visibleColumns.map((column) => (
                            <td
                              key={`${row.key}:${runPath}:${column.id}`}
                              className={columnCellClassName(column.id, 'py-2')}
                            >
                              <RunResultCell
                                column={column}
                                row={row}
                                caseRun={caseRun}
                                index={index}
                                passThreshold={passThreshold}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function caseRunPassed(caseRun: EvalCaseRun, passThreshold: number): boolean {
  if (caseRun.verdict === 'pass') return true;
  if (caseRun.verdict === 'fail') return false;
  return typeof caseRun.score === 'number' ? caseRun.score >= passThreshold : false;
}

function primaryRunArtifactPath(caseRun: EvalCaseRun): string | null {
  return (
    caseRun.grading_path ??
    caseRun.metrics_path ??
    caseRun.timing_path ??
    caseRun.transcript_path ??
    caseRun.answer_path ??
    null
  );
}

function RunResultCell({
  column,
  row,
  caseRun,
  index,
  passThreshold,
}: {
  column: ResultTableColumn;
  row: ResultTableRow;
  caseRun: EvalCaseRun;
  index: number;
  passThreshold: number;
}) {
  const passed = caseRunPassed(caseRun, passThreshold);
  const isExecutionError = caseRun.execution_status === 'execution_error';
  const status = isExecutionError ? 'error' : passed ? 'passing' : 'failing';
  const statusLabel = isExecutionError ? 'Error' : passed ? 'Passing' : 'Failing';
  const label = caseRunPath(caseRun, index);
  if (column.id.startsWith('grader:')) {
    const graderName = column.id.slice('grader:'.length);
    return (
      <GraderScoreCell
        score={buildScoreEntryMap(caseRun.scores).get(graderName)}
        passThreshold={passThreshold}
      />
    );
  }

  switch (column.id) {
    case 'status':
      return <ResultStatusSymbol status={status} label={statusLabel} />;
    case 'expander':
      return <span aria-hidden="true" className="block h-5" />;
    case 'test':
      return <RunTestCell label={label} caseRun={caseRun} />;
    case 'target':
      return <TargetCell target={row.targetLabel} tone="text-gray-500" />;
    case 'score':
      return <PassRatePill rate={caseRun.score ?? 0} />;
    case 'suite':
      return <TruncatedMuted value={row.suiteLabel} tone="text-gray-500" />;
    case 'category':
      return <TruncatedMuted value={row.categoryLabel} tone="text-gray-500" />;
    case 'duration':
      return <span className="text-gray-500">{formatDuration(caseRun.duration_ms)}</span>;
    case 'cost_tokens':
      return <RunCostTokenCell caseRun={caseRun} />;
    case 'review':
      return <span className="text-gray-700">-</span>;
    case 'error':
      return <TruncatedMuted value={caseRun.error} tone="text-red-300" />;
    default:
      return <span className="text-gray-700">-</span>;
  }
}

function RunTestCell({ label, caseRun }: { label: string; caseRun: EvalCaseRun }) {
  return (
    <div className="max-w-[24rem] min-w-0 pl-6">
      <div className="truncate font-medium text-gray-300" title={label}>
        {label}
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
        {caseRun.total_tool_calls != null ? (
          <span>{caseRun.total_tool_calls} tool calls</span>
        ) : null}
      </div>
      {caseRun.error ? (
        <div className="mt-0.5 truncate text-xs text-red-300" title={caseRun.error}>
          {caseRun.error}
        </div>
      ) : null}
    </div>
  );
}

function ResultStatusSymbol({ status, label }: { status: string; label: string }) {
  const passing = status === 'passing';
  const warning = status === 'error' || status === 'partial';
  const symbol = passing ? CHECK_MARK : CROSS_MARK;
  const tone = passing ? 'text-emerald-300' : warning ? 'text-amber-300' : 'text-red-300';
  return (
    <span className={`inline-flex text-base font-semibold ${tone}`} title={label}>
      {symbol}
    </span>
  );
}

function RepeatStatusCell({
  group,
  passThreshold,
}: {
  group: RepeatRunGroup;
  passThreshold: number;
}) {
  const passesThreshold = group.passRate >= passThreshold;
  const status = passesThreshold ? 'passing' : group.passedRuns > 0 ? 'partial' : 'failing';
  return (
    <ResultStatusSymbol
      status={status}
      label={`${group.passedRuns}/${group.runCount} runs passed`}
    />
  );
}

function RepeatSummaryText({ group }: { group: RepeatRunGroup }) {
  const parts = [
    `${group.runCount} runs`,
    `${formatPercent(group.passRate)} run success`,
    `${formatPercent(group.meanScore)} mean score`,
    group.assertionPassRate != null
      ? `${formatPercent(group.assertionPassRate)} assertions (${group.passedAssertions}/${group.assertionCount})`
      : undefined,
    group.totalToolCalls != null ? `${group.totalToolCalls} tool calls` : undefined,
    group.artifactCount > 0 ? `${group.artifactCount} artifacts` : undefined,
  ].filter((part): part is string => Boolean(part));
  return (
    <div className="mt-0.5 truncate text-xs text-gray-500" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </div>
  );
}

function RepeatScoreCell({ group }: { group: RepeatRunGroup }) {
  return <PassRatePill rate={group.meanScore} />;
}

function RepeatDurationCell({ group, row }: { group: RepeatRunGroup; row: ResultTableRow }) {
  return (
    <span className="text-gray-400">
      {formatDuration(group.meanDurationMs ?? row.result.durationMs)}
    </span>
  );
}

function isNumericColumn(columnId: string): boolean {
  return ['duration', 'cost_tokens'].includes(columnId) || columnId.startsWith('grader:');
}

function isCompactColumn(columnId: string): boolean {
  return columnId === 'status' || columnId === 'expander';
}

function isVisuallyHiddenHeader(columnId: string): boolean {
  return isCompactColumn(columnId);
}

function resultTableMinWidth(columns: readonly ResultTableColumn[]): number {
  const width = columns.reduce((sum, column) => sum + (isCompactColumn(column.id) ? 44 : 136), 0);
  return Math.max(760, width);
}

function columnHeaderClassName(columnId: string): string {
  if (isCompactColumn(columnId)) {
    return 'w-11 min-w-11 max-w-11 px-2 py-3 text-center font-medium text-gray-400';
  }
  return `px-4 py-3 font-medium text-gray-400 ${isNumericColumn(columnId) ? 'text-right' : ''}`;
}

function columnCellClassName(columnId: string, paddingY: 'py-2' | 'py-3'): string {
  if (isCompactColumn(columnId)) {
    return `w-11 min-w-11 max-w-11 px-2 ${paddingY} text-center align-middle`;
  }
  return `px-4 ${paddingY} align-middle ${
    isNumericColumn(columnId) ? 'text-right tabular-nums' : ''
  }`;
}

function ResultCell({
  column,
  row,
  repeatGroup,
  repeatCollapsed,
  passThreshold,
  isSelected,
  onToggleRepeatGroup,
}: {
  column: ResultTableColumn;
  row: ResultTableRow;
  repeatGroup?: RepeatRunGroup;
  repeatCollapsed: boolean;
  passThreshold: number;
  isSelected: boolean;
  onToggleRepeatGroup: (rowKey: string) => void;
}) {
  if (column.id.startsWith('grader:')) {
    const graderName = column.id.slice('grader:'.length);
    return (
      <GraderScoreCell score={row.graderScores.get(graderName)} passThreshold={passThreshold} />
    );
  }

  switch (column.id) {
    case 'status':
      return repeatGroup ? (
        <RepeatStatusCell group={repeatGroup} passThreshold={passThreshold} />
      ) : (
        <ResultStatusSymbol status={row.status} label={row.statusLabel} />
      );
    case 'expander':
      return repeatGroup ? (
        <ExpanderCell
          row={row}
          repeatCollapsed={repeatCollapsed}
          onToggleRepeatGroup={onToggleRepeatGroup}
        />
      ) : (
        <span aria-hidden="true" className="block h-5" />
      );
    case 'test':
      return <TestCell row={row} repeatGroup={repeatGroup} isSelected={isSelected} />;
    case 'target':
      return <TargetCell target={row.targetLabel} />;
    case 'score':
      return row.executionError ? (
        <span className="inline-flex rounded-md border border-amber-900/60 bg-amber-950/20 px-2 py-0.5 text-xs font-medium text-amber-300">
          Execution error
        </span>
      ) : repeatGroup ? (
        <RepeatScoreCell group={repeatGroup} />
      ) : (
        <PassRatePill rate={row.result.score} />
      );
    case 'suite':
      return <TruncatedMuted value={row.suiteLabel} />;
    case 'category':
      return <TruncatedMuted value={row.categoryLabel} />;
    case 'duration':
      return repeatGroup ? (
        <RepeatDurationCell group={repeatGroup} row={row} />
      ) : (
        <span className="text-gray-400">{formatDuration(row.result.durationMs)}</span>
      );
    case 'cost_tokens':
      return <CostTokenCell row={row} repeatGroup={repeatGroup} />;
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

function TargetCell({ target, tone = 'text-gray-300' }: { target: string; tone?: string }) {
  return (
    <div className={`max-w-[14rem] truncate ${tone}`} title={target}>
      {target}
    </div>
  );
}

function ExpanderCell({
  row,
  repeatCollapsed,
  onToggleRepeatGroup,
}: {
  row: ResultTableRow;
  repeatCollapsed: boolean;
  onToggleRepeatGroup: (rowKey: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggleRepeatGroup(row.key);
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-800 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
      aria-expanded={!repeatCollapsed}
      aria-label={`${repeatCollapsed ? 'Expand' : 'Collapse'} ${row.testId}`}
    >
      {repeatCollapsed ? '+' : '-'}
    </button>
  );
}

function TestCell({
  row,
  repeatGroup,
  isSelected,
}: {
  row: ResultTableRow;
  repeatGroup?: RepeatRunGroup;
  isSelected: boolean;
}) {
  return (
    <div className="max-w-[24rem] min-w-0">
      <span
        className={`block min-w-0 truncate text-left font-medium ${
          isSelected ? 'text-cyan-200' : 'text-cyan-400'
        }`}
        title={row.testId}
      >
        {row.testId}
      </span>
      {repeatGroup ? <RepeatSummaryText group={repeatGroup} /> : null}
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

function scrollPanelIntoView(panel: HTMLElement | null) {
  if (!panel) return;
  window.requestAnimationFrame(() => {
    panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function ResultDetailPanel({
  row,
  runId,
  projectId,
  repeatGroup,
  selectedCaseRun,
  selectedRunPath,
  initialTab,
  initialFilePath,
  onOpenRunDetail,
  onClose,
}: {
  row: ResultTableRow;
  runId: string;
  projectId?: string;
  repeatGroup?: RepeatRunGroup;
  selectedCaseRun: EvalCaseRun | null;
  selectedRunPath: string | null;
  initialTab: DetailTab;
  initialFilePath: string | null;
  onOpenRunDetail: (caseRun: EvalCaseRun, initialTab?: DetailTab) => void;
  onClose: () => void;
}) {
  const evalDetailHref = buildEvalDetailHref({
    projectId,
    runId,
    evalId: row.testId,
    artifactDir: row.result.artifact_dir,
  });
  const title = selectedRunPath ? `${row.testId} · ${selectedRunPath}` : row.testId;
  const showAggregateRepeatDetail = repeatGroup && !selectedCaseRun;
  const panelScrollKey = `${row.key}:${selectedRunPath ?? ''}:${initialTab}`;

  return (
    <aside
      key={panelScrollKey}
      ref={scrollPanelIntoView}
      className="min-w-0 rounded-lg border border-gray-800 bg-gray-950/80 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Row detail</p>
          <h4 className="mt-1 truncate text-base font-semibold text-white" title={title}>
            {title}
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
        <EvalDetail
          key={`${row.key}:${selectedRunPath ?? 'aggregate'}:${initialFilePath ?? ''}`}
          eval={row.result}
          runId={runId}
          projectId={projectId}
          repeatGroup={showAggregateRepeatDetail ? repeatGroup : undefined}
          selectedCaseRun={selectedCaseRun}
          initialTab={initialTab}
          initialSelectedFilePath={initialFilePath}
          onSelectCaseRun={onOpenRunDetail}
        />
      </div>
    </aside>
  );
}

function CostTokenCell({
  row,
  repeatGroup,
}: {
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
  repeatGroup?: RepeatRunGroup;
}) {
  const repeatCosts =
    repeatGroup?.runs
      .map((caseRun) => caseRun.cost_usd)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ??
    [];
  const repeatTokens =
    repeatGroup?.runs
      .map(caseRunTokenTotal)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ??
    [];
  const repeatCostTotal =
    repeatCosts.length > 0 ? repeatCosts.reduce((sum, value) => sum + value, 0) : undefined;
  const repeatTokenTotal =
    repeatTokens.length > 0 ? repeatTokens.reduce((sum, value) => sum + value, 0) : undefined;
  const cost = formatCost(row.result.costUsd ?? repeatCostTotal);
  const tokens = formatTokens(row.tokenTotal ?? repeatTokenTotal);
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

function RunCostTokenCell({ caseRun }: { caseRun: EvalCaseRun }) {
  const cost = formatCost(caseRun.cost_usd);
  const tokens = formatTokens(caseRunTokenTotal(caseRun));
  if (!cost && !tokens) return <span className="text-gray-700">-</span>;
  return (
    <div className="min-w-0 text-right">
      {cost ? <div className="tabular-nums text-gray-500">{cost}</div> : null}
      {tokens ? <div className="text-xs tabular-nums text-gray-600">{tokens}</div> : null}
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
