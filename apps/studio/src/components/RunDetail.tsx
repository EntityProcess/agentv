/**
 * Run detail component showing per-eval breakdown with score bars.
 *
 * Displays each eval result as a row with test ID, target, score bar,
 * status, duration, and cost. Clicking a row navigates to eval detail.
 */

import { Link } from '@tanstack/react-router';

import type { EvalResult } from '~/lib/types';

import { ScoreBar } from './ScoreBar';
import { StatsCards } from './StatsCards';

interface RunDetailProps {
  results: EvalResult[];
  runId: string;
}

export function RunDetail({ results, runId }: RunDetailProps) {
  const total = results.length;
  const passed = results.filter((r) => r.score >= 1).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  return (
    <div className="space-y-6">
      <StatsCards
        total={total}
        passed={passed}
        failed={failed}
        passRate={passRate}
        totalCost={totalCost > 0 ? totalCost : undefined}
      />

      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">Test ID</th>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="w-48 px-4 py-3 font-medium text-gray-400">Score</th>
              <th className="px-4 py-3 font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Duration</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {results.map((result, idx) => (
              <tr
                key={`${result.testId}-${idx}`}
                className="transition-colors hover:bg-gray-900/30"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/evals/$runId/$evalId"
                    params={{ runId, evalId: result.testId }}
                    className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    {result.testId}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-400">{result.target ?? '-'}</td>
                <td className="px-4 py-3">
                  <ScoreBar score={result.score} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={result.executionStatus} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-gray-500">-</span>;

  const isSuccess = status === 'success' || status === 'completed';
  const isError = status === 'error' || status === 'failed';

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isSuccess
          ? 'bg-emerald-900/50 text-emerald-400'
          : isError
            ? 'bg-red-900/50 text-red-400'
            : 'bg-gray-800 text-gray-400'
      }`}
    >
      {status}
    </span>
  );
}
