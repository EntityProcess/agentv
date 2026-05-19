/**
 * Shared experiment detail view for both single-project and project-scoped routes.
 *
 * Reads experiment summary and run list from the matching API surface so the UI
 * stays on the same data source in both single and multi-project modes.
 */

import { useQuery } from '@tanstack/react-query';

import {
  experimentsOptions,
  projectExperimentsOptions,
  projectRunListOptions,
  runListOptions,
} from '~/lib/api';

import { RunList } from './RunList';

interface ExperimentDetailProps {
  experimentName: string;
  projectId?: string;
}

export function ExperimentDetail({ experimentName, projectId }: ExperimentDetailProps) {
  const { data: experimentsData, isLoading: expLoading } = useQuery(
    projectId ? projectExperimentsOptions(projectId) : experimentsOptions,
  );
  const { data: runListData, isLoading: runsLoading } = useQuery(
    projectId ? projectRunListOptions(projectId) : runListOptions,
  );

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

  const experiment = experimentsData?.experiments?.find((entry) => entry.name === experimentName);
  const runs = (runListData?.runs ?? []).filter(
    (run) => (run.experiment ?? 'default') === experimentName,
  );

  const passRate = experiment?.pass_rate ?? 0;
  const runCount = experiment?.run_count ?? runs.length;
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
        <RunList
          runs={runs}
          projectId={projectId}
          emptyMessage={
            <div>
              <p className="text-lg text-gray-400">No evaluation runs found for this experiment.</p>
              <p className="mt-2 text-sm text-gray-500">
                Runs will appear here once this experiment has execution results.
              </p>
            </div>
          }
        />
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
