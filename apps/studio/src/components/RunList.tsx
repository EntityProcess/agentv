/**
 * Sortable run table component.
 *
 * Displays all available runs with a pass/fail status dot, human-readable name,
 * source badge, date, test count, and coloured pass-rate pill.
 * Clicking a row navigates to the run detail view.
 */

import type React from 'react';

import { Link } from '@tanstack/react-router';

import type { RunMeta } from '~/lib/types';

import { PassRatePill } from './PassRatePill';

interface RunListProps {
  runs: RunMeta[];
  projectId?: string;
  emptyMessage?: React.ReactNode;
}

function formatDate(ts: string | undefined | null): { date: string; full: string } {
  if (!ts) return { date: 'N/A', full: 'N/A' };
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: 'N/A', full: 'N/A' };
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en', { month: 'short' });
    const date = `${day} ${month} ${d.getFullYear()}`;
    return { date, full: d.toLocaleString() };
  } catch {
    return { date: 'N/A', full: 'N/A' };
  }
}

/** Human-readable run label: "target · experiment" or filename fallback. */
function runLabel(run: RunMeta): string {
  const parts = [run.target, run.experiment].filter((p) => p && p !== 'default' && p !== '-');
  if (parts.length > 0) return parts.join(' · ');
  if (run.target) return run.target;
  return run.display_name ?? run.filename;
}

export function RunList({ runs, projectId, emptyMessage }: RunListProps) {
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
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
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
            const passing = run.pass_rate >= 0.8;
            const label = runLabel(run);
            const passedCount = Math.round(run.pass_rate * run.test_count);
            const failedCount = run.test_count - passedCount;
            return (
              <tr key={run.filename} className="transition-colors hover:bg-gray-900/30">
                {/* Status dot */}
                <td className="px-4 py-3 text-center">
                  <span
                    className={`text-base font-bold ${passing ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {passing ? '✓' : '✗'}
                  </span>
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
        </tbody>
      </table>
    </div>
  );
}
