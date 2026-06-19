/**
 * Canonical dense result table for Dashboard run-result browsing.
 *
 * The table keeps view/search/filter/display state in the URL using
 * `results_*` query params so run and project links remain stable while a
 * user tunes the local view.
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { Link } from '@tanstack/react-router';

import { useFeedback } from '~/lib/api';
import {
  RESULT_TABLE_VIEW_PRESETS,
  type ResultTableColumn,
  type ResultTableState,
  type ResultTableStateInput,
  buildResultTableModel,
} from '~/lib/result-table';
import type { EvalResult, ScoreEntry } from '~/lib/types';

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

  useEffect(() => {
    const handlePopState = () => setUrlState(readUrlState());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
  }

  function toggleColumn(columnId: string) {
    const next = new Set(model.state.visibleColumnIds);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    updateState({ visibleColumnIds: [...next] });
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

      {model.filteredRows.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No matching evaluations</p>
          <p className="mt-2 text-sm text-gray-500">Adjust the result filters or display preset.</p>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
          <table
            className="w-full whitespace-nowrap text-left text-sm"
            style={{ minWidth: `${Math.max(860, model.visibleColumns.length * 136)}px` }}
          >
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                {model.visibleColumns.map((column) => (
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
              {model.filteredRows.map((row) => (
                <tr key={row.key} className="transition-colors hover:bg-gray-900/30">
                  {model.visibleColumns.map((column) => (
                    <td
                      key={`${row.key}:${column.id}`}
                      className={`px-4 py-3 align-middle ${
                        isNumericColumn(column.id) ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      <ResultCell
                        column={column}
                        row={row}
                        runId={runId}
                        projectId={projectId}
                        passThreshold={passThreshold}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function isNumericColumn(columnId: string): boolean {
  return ['duration', 'cost_tokens'].includes(columnId) || columnId.startsWith('grader:');
}

function ResultCell({
  column,
  row,
  runId,
  projectId,
  passThreshold,
}: {
  column: ResultTableColumn;
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
  runId: string;
  projectId?: string;
  passThreshold: number;
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
      return <TestCell row={row} runId={runId} projectId={projectId} />;
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
  runId,
  projectId,
}: {
  row: ReturnType<typeof buildResultTableModel>['filteredRows'][number];
  runId: string;
  projectId?: string;
}) {
  const className =
    'block min-w-0 truncate font-medium text-cyan-400 hover:text-cyan-300 hover:underline';

  return (
    <div className="max-w-[24rem] min-w-0">
      {projectId ? (
        <Link
          to="/projects/$projectId/evals/$runId/$evalId"
          params={{ projectId, runId, evalId: row.testId }}
          className={className}
          title={row.testId}
        >
          {row.testId}
        </Link>
      ) : (
        <Link
          to="/evals/$runId/$evalId"
          params={{ runId, evalId: row.testId }}
          className={className}
          title={row.testId}
        >
          {row.testId}
        </Link>
      )}
      {row.result.error ? (
        <div className="mt-0.5 truncate text-xs text-red-300" title={row.result.error}>
          {row.result.error}
        </div>
      ) : null}
    </div>
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
