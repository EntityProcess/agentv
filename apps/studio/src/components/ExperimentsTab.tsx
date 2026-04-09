/**
 * Experiments table showing experiments grouped across all runs.
 *
 * Displays experiment name, number of runs, targets, pass rate, and
 * last run timestamp. Each row links to the experiment detail page.
 */

import { Link } from '@tanstack/react-router';

import { useExperiments } from '~/lib/api';
import type { ExperimentSummary } from '~/lib/types';

import { PassRatePill } from './PassRatePill';

export function ExperimentsTab() {
  const { data, isLoading } = useExperiments();

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const experiments = data?.experiments ?? [];

  if (experiments.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No experiments found</p>
        <p className="mt-2 text-sm text-gray-500">
          Experiments will appear here once evaluations are run with experiment labels.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-400">Experiment</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Runs</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Targets</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Evals</th>
            <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
            <th className="px-4 py-3 font-medium text-gray-400">Last Run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {experiments.map((exp: ExperimentSummary) => (
            <tr key={exp.name} className="transition-colors hover:bg-gray-900/30">
              <td className="px-4 py-3">
                <Link
                  to="/experiments/$experimentName"
                  params={{ experimentName: exp.name }}
                  className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  {exp.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">{exp.run_count}</td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                {exp.target_count}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                <span className="text-emerald-400">{exp.passed_count}</span>
                <span className="text-gray-600"> / </span>
                {exp.eval_count}
              </td>
              <td className="px-4 py-3">
                <PassRatePill rate={exp.pass_rate} />
              </td>
              <td className="px-4 py-3 text-gray-400" title={formatTimestamp(exp.last_run).full}>
                {formatTimestamp(exp.last_run).date}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTimestamp(ts: string | undefined | null): { date: string; full: string } {
  if (!ts) return { date: 'N/A', full: 'N/A' };
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: 'N/A', full: 'N/A' };
    return {
      date: d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }),
      full: d.toLocaleString(),
    };
  } catch {
    return { date: 'N/A', full: 'N/A' };
  }
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
            <div className="h-4 w-24 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
