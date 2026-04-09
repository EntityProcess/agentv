/**
 * Sortable run table component.
 *
 * Displays all available runs with filename, timestamp, test count,
 * pass rate score bar, and avg score. Clicking a row navigates to
 * the run detail view.
 */

import { Link } from '@tanstack/react-router';

import type { RunMeta } from '~/lib/types';

import { ScoreBar } from './ScoreBar';

interface RunListProps {
  runs: RunMeta[];
  projectId?: string;
}

function formatTimestamp(ts: string | undefined | null): string {
  if (!ts) return 'N/A';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString();
  } catch {
    return 'N/A';
  }
}

export function RunList({ runs, projectId }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No evaluation runs found.</p>
        <p className="mt-2 text-sm text-gray-500">
          Run an evaluation first:{' '}
          <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">
            agentv eval &lt;eval-file&gt;
          </code>
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-400">Run</th>
            <th className="px-4 py-3 font-medium text-gray-400">Source</th>
            <th className="px-4 py-3 font-medium text-gray-400">Target</th>
            <th className="px-4 py-3 font-medium text-gray-400">Experiment</th>
            <th className="px-4 py-3 font-medium text-gray-400">Timestamp</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Tests</th>
            <th
              className="w-48 px-4 py-3 font-medium text-gray-400"
              title="Percentage of tests with a perfect score (1.0)"
            >
              Tests Passing
            </th>
            <th
              className="px-4 py-3 text-right font-medium text-gray-400"
              title="Mean score across all tests (0-100%)"
            >
              Mean Score
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {runs.map((run) => (
            <tr key={run.filename} className="transition-colors hover:bg-gray-900/30">
              <td className="px-4 py-3">
                {projectId ? (
                  <Link
                    to="/projects/$projectId/runs/$runId"
                    params={{ projectId, runId: run.filename }}
                    className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    {run.display_name ?? run.filename}
                  </Link>
                ) : (
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.filename }}
                    className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    {run.display_name ?? run.filename}
                  </Link>
                )}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    run.source === 'remote'
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'bg-emerald-500/10 text-emerald-300'
                  }`}
                >
                  {run.source}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-400">{run.target ?? '-'}</td>
              <td className="px-4 py-3 text-gray-400">{run.experiment ?? '-'}</td>
              <td className="px-4 py-3 text-gray-400">{formatTimestamp(run.timestamp)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{run.test_count}</td>
              <td className="px-4 py-3">
                <ScoreBar score={run.pass_rate} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {(run.avg_score * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
