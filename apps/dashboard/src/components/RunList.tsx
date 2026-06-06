/**
 * Sortable run table component.
 *
 * Displays all available runs with a pass/fail status dot, human-readable name,
 * source badge, date, test count, and coloured pass-rate pill.
 * Clicking a row navigates to the run detail view.
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
import { formatRunLabel } from '~/lib/run-label';
import type { RunMeta } from '~/lib/types';

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
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const requestingNextPageRef = useRef(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [combineError, setCombineError] = useState<string | null>(null);
  const [combineInFlight, setCombineInFlight] = useState(false);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const selectableRunIds = useMemo(
    () =>
      runs
        .filter(
          (run) =>
            enableCombine &&
            run.source === 'local' &&
            run.status !== 'starting' &&
            run.status !== 'running',
        )
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
    const node = sentinelRef.current;
    if (!node) {
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
    observer.observe(node);
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
    setCombineError(null);
    setCombineInFlight(true);
    try {
      try {
        await combineRunsApi(selectedRunIds, 'error', projectId);
      } catch (err) {
        if (!(err instanceof CombineRunsApiError) || err.status !== 409) {
          throw err;
        }
        const count = err.duplicates.length;
        const confirmed = window.confirm(
          `${count} duplicate (test_id, target) pair${count === 1 ? '' : 's'} found. Replace duplicates with the latest timestamp?`,
        );
        if (!confirmed) return;
        await combineRunsApi(selectedRunIds, 'latest', projectId);
      }
      setSelectedRunIds([]);
      await invalidateRunQueries();
    } catch (err) {
      setCombineError((err as Error).message);
    } finally {
      setCombineInFlight(false);
    }
  }

  async function handleDelete() {
    if (selectedRunIds.length === 0 || deleteInFlight) return;
    const count = selectedRunIds.length;
    const confirmed = window.confirm(
      `Delete ${count} local run${count === 1 ? '' : 's'}? This removes the run workspace and artifacts from disk.`,
    );
    if (!confirmed) return;

    setCombineError(null);
    setDeleteInFlight(true);
    try {
      for (const runId of selectedRunIds) {
        await deleteRunApi(runId, projectId);
      }
      setSelectedRunIds([]);
      await invalidateRunQueries();
    } catch (err) {
      setCombineError((err as Error).message);
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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-200">
              {selectedRunIds.length} local run{selectedRunIds.length === 1 ? '' : 's'} selected
            </p>
            {combineError && <p className="mt-1 text-xs text-red-400">{combineError}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={selectedRunIds.length === 0 || deleteInFlight || combineInFlight}
              className="rounded-md border border-red-900/70 px-3 py-1.5 text-sm font-medium text-red-300 hover:border-red-700 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
            >
              {deleteInFlight ? 'Deleting...' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={() => void handleCombine()}
              disabled={selectedRunIds.length < 2 || combineInFlight || deleteInFlight}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
            >
              {combineInFlight ? 'Combining...' : 'Combine'}
            </button>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              {enableCombine && <th className="w-10 px-4 py-3" />}
              <th className="w-8 px-4 py-3" />
              <th className="px-4 py-3 font-medium text-gray-400">Run</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Passed</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Failed</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Total</th>
              <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
              <th className="px-4 py-3 font-medium text-gray-400">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {runs.map((run) => {
              const ts = formatDate(run.timestamp);
              const passing = run.pass_rate >= passThreshold;
              const isActive = run.status === 'starting' || run.status === 'running';
              const label = formatRunLabel(run);
              const passedCount = Math.round(run.pass_rate * run.test_count);
              const failedCount = run.test_count - passedCount;
              const selectable = selectableRunIds.includes(run.filename);
              const metadataDirty = run.metadata_dirty === true;
              return (
                <tr key={run.filename} className="transition-colors hover:bg-gray-900/30">
                  {enableCombine && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(run.filename)}
                        disabled={!selectable}
                        onChange={() => toggleRun(run.filename)}
                        aria-label={`Select ${label}`}
                        className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-cyan-500 disabled:opacity-30"
                      />
                    </td>
                  )}
                  {/* Status dot — spinner for active runs, otherwise pass/fail */}
                  <td className="px-4 py-3 text-center">
                    {isActive ? (
                      <span
                        className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400"
                        title={run.status === 'starting' ? 'Starting…' : 'Running…'}
                        aria-label={run.status === 'starting' ? 'Starting' : 'Running'}
                      />
                    ) : (
                      <span
                        className={`text-base font-bold ${passing ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {passing ? '✓' : '✗'}
                      </span>
                    )}
                  </td>

                  {/* Run name */}
                  <td className="px-4 py-3">
                    {projectId ? (
                      <Link
                        to="/projects/$projectId/runs/$runId"
                        params={{ projectId, runId: run.filename }}
                        className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <Link
                        to="/runs/$runId"
                        params={{ runId: run.filename }}
                        className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                      >
                        {label}
                      </Link>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 ${
                          run.source === 'remote'
                            ? 'border-cyan-900/60 bg-cyan-950/20 text-cyan-300'
                            : 'border-gray-800 bg-gray-900/70 text-gray-500'
                        }`}
                      >
                        {run.source === 'remote' ? 'Remote' : 'Local'}
                      </span>
                      {metadataDirty ? (
                        <span className="rounded-md border border-yellow-900/60 bg-yellow-950/20 px-1.5 py-0.5 text-yellow-300">
                          Pending metadata
                        </span>
                      ) : null}
                    </div>
                  </td>

                  {/* Passed / Failed / Total */}
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-300">
                    {passedCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-400">
                    {failedCount > 0 ? failedCount : <span className="text-gray-600">0</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {run.test_count}
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
              <tr ref={sentinelRef}>
                <td
                  colSpan={enableCombine ? 8 : 7}
                  className="px-4 py-3 text-center text-xs text-gray-500"
                >
                  {isFetchingNextPage ? 'Loading more runs…' : 'Scroll to load more…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
