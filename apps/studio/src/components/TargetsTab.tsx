/**
 * Targets table showing targets grouped across all runs.
 *
 * Displays target name, number of runs, experiments, pass rate, and
 * eval counts (passed/total). Links are not needed since targets are
 * informational groupings.
 */

import { useTargets } from '~/lib/api';
import type { TargetSummary } from '~/lib/types';

import { ScoreBar } from './ScoreBar';

export function TargetsTab() {
  const { data, isLoading } = useTargets();

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const targets = data?.targets ?? [];

  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No targets found</p>
        <p className="mt-2 text-sm text-gray-500">
          Targets will appear here once evaluations are run with target labels.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-400">Target</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Runs</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Experiments</th>
            <th className="w-48 px-4 py-3 font-medium text-gray-400">Pass Rate</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Evals</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {targets.map((target: TargetSummary) => (
            <tr key={target.name} className="transition-colors hover:bg-gray-900/30">
              <td className="px-4 py-3 font-medium text-gray-200">{target.name}</td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                {target.run_count}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                {target.experiment_count}
              </td>
              <td className="px-4 py-3">
                <ScoreBar score={target.pass_rate} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                <span className="text-emerald-400">{target.passed}</span>
                <span className="text-gray-600">/</span>
                <span>{target.total}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <div className="animate-pulse">
        <div className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <div className="h-4 w-48 rounded bg-gray-800" />
        </div>
        {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5'].map((id) => (
          <div key={id} className="flex gap-4 border-b border-gray-800/50 px-4 py-3">
            <div className="h-4 w-32 rounded bg-gray-800" />
            <div className="h-4 w-12 rounded bg-gray-800" />
            <div className="h-4 w-12 rounded bg-gray-800" />
            <div className="h-4 w-48 rounded bg-gray-800" />
            <div className="h-4 w-20 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
