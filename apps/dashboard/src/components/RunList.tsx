/**
 * Sortable run table component.
 *
 * Displays all available runs with a pass/fail status dot, human-readable name,
 * source badge, date, quality test count, execution-error count, and coloured pass-rate pill.
 * Clicking a row navigates to the run detail view.
 *
 * On phone-width viewports the rows collapse to dense cards so right-side table
 * data stays visible without touch-scroll hunting. Tablet and desktop keep the
 * existing horizontally scrollable table.
 *
 * In-progress runs (status `starting` / `running`, surfaced by the backend
 * via the RunMeta `status` field while a Dashboard-launched run is still
 * tracked in-memory) render a pulsing cyan dot instead of the pass/fail
 * dot — otherwise a 0% pass rate during the warm-up window would show as
 * a misleading red ✗.
 */

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import {
  CombineRunsApiError,
  DEFAULT_PASS_THRESHOLD,
  combineRunsApi,
  deleteRunApi,
  useStudioConfig,
} from '~/lib/api';
import { executionErrorCount } from '~/lib/result-summary';
import { formatRunLabel } from '~/lib/run-label';
import {
  buildCombineSuccessMessage,
  buildDeleteSuccessMessage,
  formatSelectedRunCount,
  runSelectionDisabledReason,
} from '~/lib/run-list-actions';
import type { CombineRunsResponse, RunMeta } from '~/lib/types';

import { PassRatePill } from './PassRatePill';

interface RunListProps {
  runs: RunMeta[];
  projectId?: string;
  emptyMessage?: React.ReactNode;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  enableCombine?: boolean;
}

interface RunActionFeedback {
  kind: 'success' | 'error';
  message: string;
  combinedRunId?: string;
  sourceRunIds?: string[];
}

interface RunListItemView {
  run: RunMeta;
  ts: { date: string; full: string };
  isActive: boolean;
  label: string;
  errors: number;
  qualityCount: number;
  passing: boolean;
  passedCount: number;
  failedCount: number;
  metadataDirty: boolean;
}

function formatDate(ts: string | undefined | null): { date: string; full: string } {
  if (!ts) return { date: 'N/A', full: 'N/A' };
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: 'N/A', full: 'N/A' };
    const full = d.toLocaleString();
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHour = Math.floor(diffMs / 3_600_000);
    let date: string;
    if (diffMin < 1) date = 'just now';
    else if (diffMin < 60) date = `${diffMin} min ago`;
    else if (diffHour < 24) date = `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    else date = d.toLocaleDateString();
    return { date, full };
  } catch {
    return { date: 'N/A', full: 'N/A' };
  }
}

export function buildRunListItemView(run: RunMeta, passThreshold: number): RunListItemView {
  const ts = formatDate(run.timestamp);
  const isActive = run.status === 'starting' || run.status === 'running';
  const label = formatRunLabel(run);
  const errors = executionErrorCount(run);
  const qualityCount = Math.max(0, run.test_count - errors);
  const passing = qualityCount > 0 ? run.pass_rate >= passThreshold : errors === 0;
  const passedCount = Math.round(run.pass_rate * qualityCount);
  const failedCount = qualityCount - passedCount;
  const metadataDirty = run.metadata_dirty === true;

  return {
    run,
    ts,
    isActive,
    label,
    errors,
    qualityCount,
    passing,
    passedCount,
    failedCount,
    metadataDirty,
  };
}

export function RunList({
  runs,
  projectId,
  emptyMessage,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  enableCombine = false,
}: RunListProps) {
  const { data: config } = useStudioConfig(projectId);
  const queryClient = useQueryClient();
  const passThreshold = config?.threshold ?? DEFAULT_PASS_THRESHOLD;
  const tableSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const mobileSentinelRef = useRef<HTMLDivElement | null>(null);
  const requestingNextPageRef = useRef(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [actionFeedback, setActionFeedback] = useState<RunActionFeedback | null>(null);
  const [combineInFlight, setCombineInFlight] = useState(false);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const runViews = useMemo(
    () => runs.map((run) => buildRunListItemView(run, passThreshold)),
    [passThreshold, runs],
  );
  const selectableRunIds = useMemo(
    () =>
      runs
        .filter((run) => enableCombine && !runSelectionDisabledReason(run))
        .map((run) => run.filename),
    [enableCombine, runs],
  );
  const selectedSet = new Set(selectedRunIds);

  useEffect(() => {
    if (!isFetchingNextPage) {
      requestingNextPageRef.current = false;
    }
  }, [isFetchingNextPage]);

  useEffect(() => {
    if (!hasNextPage || !onLoadMore) {
      return;
    }
    const nodes: Element[] = [];
    if (tableSentinelRef.current) nodes.push(tableSentinelRef.current);
    if (mobileSentinelRef.current) nodes.push(mobileSentinelRef.current);
    if (nodes.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !isFetchingNextPage &&
          !requestingNextPageRef.current
        ) {
          requestingNextPageRef.current = true;
          onLoadMore();
        }
      },
      { rootMargin: '200px 0px' },
    );
    for (const node of nodes) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  useEffect(() => {
    const available = new Set(selectableRunIds);
    setSelectedRunIds((current) => current.filter((runId) => available.has(runId)));
  }, [selectableRunIds]);

  async function invalidateRunQueries() {
    if (projectId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compare'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'targets'] }),
      ]);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['runs'] }),
      queryClient.invalidateQueries({ queryKey: ['experiments'] }),
      queryClient.invalidateQueries({ queryKey: ['compare'] }),
      queryClient.invalidateQueries({ queryKey: ['targets'] }),
    ]);
  }

  async function handleCombine() {
    if (selectedRunIds.length < 2 || combineInFlight) return;
    const sourceRunIds = [...selectedRunIds];
    setActionFeedback(null);
    setCombineInFlight(true);
    try {
      let result: CombineRunsResponse;
      try {
        result = await combineRunsApi(sourceRunIds, 'error', projectId);
      } catch (err) {
        if (!(err instanceof CombineRunsApiError) || err.status !== 409) {
          throw err;
        }
        const count = err.duplicates.length;
        const confirmed = window.confirm(
          `${count} duplicate (test_id, target) pair${count === 1 ? '' : 's'} found. Replace duplicates with the latest timestamp?`,
        );
        if (!confirmed) return;
        result = await combineRunsApi(sourceRunIds, 'latest', projectId);
      }
      setSelectedRunIds([]);
      setActionFeedback({
        kind: 'success',
        message: buildCombineSuccessMessage(sourceRunIds.length, result.display_name),
        combinedRunId: result.run_id,
        sourceRunIds,
      });
      await invalidateRunQueries();
    } catch (err) {
      setActionFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setCombineInFlight(false);
    }
  }

  async function handleDelete() {
    if (selectedRunIds.length === 0 || deleteInFlight) return;
    await deleteRuns(selectedRunIds, 'selected');
  }

  async function handleDeleteCombinedSources() {
    const sourceRunIds = actionFeedback?.sourceRunIds ?? [];
    if (sourceRunIds.length === 0 || deleteInFlight) return;
    await deleteRuns(sourceRunIds, 'combined-sources');
  }

  async function deleteRuns(runIds: readonly string[], reason: 'selected' | 'combined-sources') {
    const count = runIds.length;
    const noun = count === 1 ? 'run' : 'runs';
    const prompt =
      reason === 'combined-sources'
        ? `Delete the ${count} source local ${noun} used for the combined run? The combined run will remain.`
        : `Delete ${count} local ${noun}? This removes the run workspace and artifacts from disk.`;
    const confirmed = window.confirm(prompt);
    if (!confirmed) return;

    setActionFeedback(null);
    setDeleteInFlight(true);
    try {
      for (const runId of runIds) {
        await deleteRunApi(runId, projectId);
      }
      setSelectedRunIds([]);
      setActionFeedback({ kind: 'success', message: buildDeleteSuccessMessage(count) });
      await invalidateRunQueries();
    } catch (err) {
      setActionFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setDeleteInFlight(false);
    }
  }

  function toggleRun(runId: string) {
    setSelectedRunIds((current) =>
      current.includes(runId) ? current.filter((id) => id !== runId) : [...current, runId],
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        {emptyMessage ?? (
          <>
            <p className="text-lg text-gray-400">No evaluation runs found.</p>
            <p className="mt-2 text-sm text-gray-500">
              Run an evaluation first:{' '}
              <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">
                agentv eval &lt;eval-file&gt;
              </code>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {enableCombine && (
        <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-gray-200">
              {formatSelectedRunCount(selectedRunIds.length)}
            </p>
            <p className="text-xs text-gray-500">
              Select completed local runs to combine or delete. Remote runs stay read-only here.
            </p>
            {actionFeedback && (
              <div
                className={`mt-2 rounded-md border px-3 py-2 text-sm ${
                  actionFeedback.kind === 'success'
                    ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                    : 'border-red-900/60 bg-red-950/20 text-red-300'
                }`}
                role={actionFeedback.kind === 'error' ? 'alert' : 'status'}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{actionFeedback.message}</span>
                  {actionFeedback.combinedRunId ? (
                    projectId ? (
                      <Link
                        to="/projects/$projectId/runs/$runId"
                        params={{ projectId, runId: actionFeedback.combinedRunId }}
                        className="font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
                      >
                        Open combined run
                      </Link>
                    ) : (
                      <Link
                        to="/runs/$runId"
                        params={{ runId: actionFeedback.combinedRunId }}
                        className="font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
                      >
                        Open combined run
                      </Link>
                    )
                  ) : null}
                  {actionFeedback.sourceRunIds && actionFeedback.sourceRunIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteCombinedSources()}
                      disabled={deleteInFlight || combineInFlight}
                      className="font-medium text-red-300 hover:text-red-200 hover:underline disabled:cursor-not-allowed disabled:text-gray-500"
                    >
                      {deleteInFlight ? 'Deleting sources...' : 'Delete source runs'}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={selectedRunIds.length === 0 || deleteInFlight || combineInFlight}
              className="whitespace-nowrap rounded-md border border-red-900/70 px-3 py-1.5 text-sm font-medium text-red-300 hover:border-red-700 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
            >
              {deleteInFlight ? 'Deleting...' : 'Delete selected'}
            </button>
            <button
              type="button"
              onClick={() => void handleCombine()}
              disabled={selectedRunIds.length < 2 || combineInFlight || deleteInFlight}
              className="whitespace-nowrap rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
            >
              {combineInFlight ? 'Combining...' : 'Combine selected'}
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2 sm:hidden">
        {runViews.map((view) => {
          const { run, ts, label, errors, qualityCount, passedCount, failedCount, metadataDirty } =
            view;
          const selectionDisabledReason = runSelectionDisabledReason(run);
          const selectable = !selectionDisabledReason && selectableRunIds.includes(run.filename);

          return (
            <article
              key={run.filename}
              className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-3"
            >
              <div className="flex items-start gap-3">
                {enableCombine && (
                  <input
                    type="checkbox"
                    checked={selectedSet.has(run.filename)}
                    disabled={!selectable}
                    onChange={() => toggleRun(run.filename)}
                    title={selectionDisabledReason}
                    aria-label={
                      selectionDisabledReason
                        ? `${label}: ${selectionDisabledReason}`
                        : `Select ${label}`
                    }
                    className="mt-1 h-4 w-4 shrink-0 rounded border-gray-700 bg-gray-900 text-cyan-500 disabled:opacity-30"
                  />
                )}
                <RunStatusMark view={view} className="mt-1 shrink-0" />
                <div className="min-w-0 flex-1">
                  <RunNameLink
                    projectId={projectId}
                    runId={run.filename}
                    label={label}
                    className="block break-all text-sm font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <SourceBadge source={run.source} />
                    {metadataDirty ? <PendingSyncBadge /> : null}
                    <span className="text-xs text-gray-500" title={ts.full}>
                      {ts.date}
                    </span>
                  </div>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-800/70 pt-3">
                <MobileRunMetric label="Pass Rate" valueClassName="text-gray-300">
                  <PassRatePill rate={run.pass_rate} />
                </MobileRunMetric>
                <MobileRunMetric label="Total" valueClassName="text-gray-300">
                  {qualityCount}
                </MobileRunMetric>
                <MobileRunMetric label="Passed" valueClassName="text-emerald-300">
                  {passedCount}
                </MobileRunMetric>
                <MobileRunMetric label="Failures" valueClassName="text-red-400">
                  {failedCount > 0 ? failedCount : <span className="text-gray-600">0</span>}
                </MobileRunMetric>
                <MobileRunMetric label="Errors" valueClassName="text-amber-300">
                  {errors > 0 ? errors : <span className="text-gray-600">0</span>}
                </MobileRunMetric>
                <MobileRunMetric label="Source" valueClassName="text-gray-400">
                  {run.source === 'remote' ? 'Remote' : 'Local'}
                </MobileRunMetric>
              </dl>
            </article>
          );
        })}
        {(hasNextPage || isFetchingNextPage) && (
          <div
            ref={mobileSentinelRef}
            className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-center text-xs text-gray-500"
          >
            {isFetchingNextPage ? 'Loading more runs...' : 'Scroll to load more...'}
          </div>
        )}
      </div>

      <div className="hidden max-w-full overflow-x-auto rounded-lg border border-gray-800 sm:block">
        <table className="min-w-[780px] w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              {enableCombine && <th className="w-10 px-4 py-3" />}
              <th className="w-8 px-4 py-3" />
              <th className="w-[22rem] px-4 py-3 font-medium text-gray-400">Run</th>
              <th className="px-4 py-3 font-medium text-gray-400">Source</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Passed</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Failures</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Errors</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Total</th>
              <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
              <th className="px-4 py-3 font-medium text-gray-400">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {runViews.map((view) => {
              const {
                run,
                ts,
                label,
                errors,
                qualityCount,
                passedCount,
                failedCount,
                metadataDirty,
              } = view;
              const selectionDisabledReason = runSelectionDisabledReason(run);
              const selectable =
                !selectionDisabledReason && selectableRunIds.includes(run.filename);
              return (
                <tr key={run.filename} className="transition-colors hover:bg-gray-900/30">
                  {enableCombine && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(run.filename)}
                        disabled={!selectable}
                        onChange={() => toggleRun(run.filename)}
                        title={selectionDisabledReason}
                        aria-label={
                          selectionDisabledReason
                            ? `${label}: ${selectionDisabledReason}`
                            : `Select ${label}`
                        }
                        className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-cyan-500 disabled:opacity-30"
                      />
                    </td>
                  )}
                  {/* Status dot — spinner for active runs, otherwise quality pass/fail. */}
                  <td className="px-4 py-3 text-center">
                    <RunStatusMark view={view} />
                  </td>

                  {/* Run name */}
                  <td className="w-[22rem] max-w-[22rem] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <RunNameLink
                        projectId={projectId}
                        runId={run.filename}
                        label={label}
                        className="block min-w-0 truncate font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                      />
                      {metadataDirty ? <PendingSyncBadge /> : null}
                    </div>
                  </td>

                  {/* Source */}
                  <td className="px-4 py-3">
                    <SourceBadge source={run.source} />
                  </td>

                  {/* Passed / Failed / Total */}
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-300">
                    {passedCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-400">
                    {failedCount > 0 ? failedCount : <span className="text-gray-600">0</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {errors > 0 ? (
                      <span className="text-amber-300">{errors}</span>
                    ) : (
                      <span className="text-gray-600">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {qualityCount}
                  </td>

                  {/* Pass rate pill */}
                  <td className="px-4 py-3">
                    <PassRatePill rate={run.pass_rate} />
                  </td>

                  {/* When */}
                  <td className="px-4 py-3 text-gray-400" title={ts.full}>
                    {ts.date}
                  </td>
                </tr>
              );
            })}
            {(hasNextPage || isFetchingNextPage) && (
              <tr ref={tableSentinelRef}>
                <td
                  colSpan={enableCombine ? 10 : 9}
                  className="px-4 py-3 text-center text-xs text-gray-500"
                >
                  {isFetchingNextPage ? 'Loading more runs...' : 'Scroll to load more...'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunNameLink({
  projectId,
  runId,
  label,
  className,
}: {
  projectId?: string;
  runId: string;
  label: string;
  className: string;
}) {
  return projectId ? (
    <Link
      to="/projects/$projectId/runs/$runId"
      params={{ projectId, runId }}
      className={className}
      title={label}
    >
      {label}
    </Link>
  ) : (
    <Link to="/runs/$runId" params={{ runId }} className={className} title={label}>
      {label}
    </Link>
  );
}

function SourceBadge({ source }: { source: RunMeta['source'] }) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
        source === 'remote'
          ? 'border-cyan-900/60 bg-cyan-950/20 text-cyan-300'
          : 'border-gray-800 bg-gray-900/70 text-gray-400'
      }`}
    >
      {source === 'remote' ? 'Remote' : 'Local'}
    </span>
  );
}

function PendingSyncBadge() {
  return (
    <span
      className="shrink-0 rounded-md border border-yellow-900/60 bg-yellow-950/20 px-1.5 py-0.5 text-xs text-yellow-300"
      title="Use Sync Metadata to push this metadata to the results repo."
    >
      Pending sync
    </span>
  );
}

function RunStatusMark({ view, className = '' }: { view: RunListItemView; className?: string }) {
  if (view.isActive) {
    return (
      <span
        className={`inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 ${className}`}
        title={view.run.status === 'starting' ? 'Starting...' : 'Running...'}
        aria-label={view.run.status === 'starting' ? 'Starting' : 'Running'}
      />
    );
  }

  if (view.qualityCount === 0 && view.errors > 0) {
    return (
      <span className={`text-base font-bold text-amber-300 ${className}`} title="Execution errors">
        !
      </span>
    );
  }

  return (
    <span
      className={`text-base font-bold ${view.passing ? 'text-emerald-400' : 'text-red-400'} ${className}`}
    >
      {view.passing ? '✓' : '✗'}
    </span>
  );
}

function MobileRunMetric({
  label,
  valueClassName,
  children,
}: {
  label: string;
  valueClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-1 min-w-0 text-sm tabular-nums ${valueClassName}`}>{children}</dd>
    </div>
  );
}
