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
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function RunList({ runs }: RunListProps) {
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
            <th className="px-4 py-3 font-medium text-gray-400">Timestamp</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Tests</th>
            <th className="w-48 px-4 py-3 font-medium text-gray-400">Pass Rate</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Avg Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {runs.map((run) => (
            <tr key={run.filename} className="transition-colors hover:bg-gray-900/30">
              <td className="px-4 py-3">
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.filename }}
                  className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  {run.filename}
                </Link>
              </td>
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
