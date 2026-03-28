/**
 * Experiment detail route: shows aggregate stats and the run list.
 *
 * Fetches experiment data from the experiments API for stats,
 * and the full run list for the table below.
 */

import { createFileRoute } from '@tanstack/react-router';

import { RunList } from '~/components/RunList';
import { useExperiments, useRunList } from '~/lib/api';

export const Route = createFileRoute('/experiments/$experimentName')({
  component: ExperimentDetailPage,
});

function ExperimentDetailPage() {
  const { experimentName } = Route.useParams();
  const { data: experimentsData, isLoading: expLoading } = useExperiments();
  const { data: runListData, isLoading: runsLoading } = useRunList();

  const isLoading = expLoading || runsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-800" />
        <div className="grid grid-cols-4 gap-4">
          {['s1', 's2', 's3', 's4'].map((id) => (
            <div key={id} className="h-20 animate-pulse rounded-lg bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  const experiment = experimentsData?.experiments?.find((e) => e.name === experimentName);
  const runs = runListData?.runs ?? [];

  // Derive stats from the experiment summary if available
  const passRate = experiment?.pass_rate ?? 0;
  const runCount = experiment?.run_count ?? 0;
  const targetCount = experiment?.target_count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{experimentName}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {runCount} run{runCount !== 1 ? 's' : ''} &middot; {targetCount} target
          {targetCount !== 1 ? 's' : ''}
          {experiment?.last_run && (
            <span className="ml-2">&middot; Last run: {formatTimestamp(experiment.last_run)}</span>
          )}
        </p>
      </div>

      {experiment && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Runs" value={String(runCount)} />
          <StatCard label="Targets" value={String(targetCount)} />
          <StatCard
            label="Pass Rate"
            value={`${Math.round(passRate * 100)}%`}
            accent="text-cyan-400"
          />
          <StatCard label="Last Run" value={formatTimestamp(experiment.last_run)} />
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-medium text-gray-200">All Runs</h2>
        <RunList runs={runs} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? 'text-white'}`}>
        {value}
      </p>
    </div>
  );
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
