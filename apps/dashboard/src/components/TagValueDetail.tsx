/**
 * Tag-value detail view for both single-project and project-scoped routes.
 *
 * Generalizes the old experiment detail: given a tag `key` and `value`, it
 * shows the matching group summary and every run whose promptfoo `run_tags`
 * map resolves to that value for the key. For the reserved `experiment` key we
 * honour the lockstep fallback (`run.experiment ?? run.run_tags?.experiment`)
 * so old runs without a tags map still resolve.
 */

import { useQuery } from '@tanstack/react-query';

import {
  projectRunListOptions,
  projectTagGroupsOptions,
  runListOptions,
  tagGroupsOptions,
} from '~/lib/api';
import { dedupeSyncedRuns } from '~/lib/run-dedupe';
import type { RunMeta } from '~/lib/types';

import { RunList } from './RunList';

interface TagValueDetailProps {
  tagKey: string;
  tagValue: string;
  projectId?: string;
}

/** Title-case a tag key for display (e.g. `team` → `Team`). */
function keyLabel(key: string): string {
  if (!key) return 'Tag';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Resolve the value a run contributes for the selected key, with the reserved-`experiment` fallback. */
function runTagValue(run: RunMeta, key: string): string {
  if (key === 'experiment') {
    return run.experiment ?? run.run_tags?.experiment ?? 'default';
  }
  return run.run_tags?.[key] ?? '';
}

export function TagValueDetail({ tagKey, tagValue, projectId }: TagValueDetailProps) {
  const { data: groupsData, isLoading: groupsLoading } = useQuery(
    projectId ? projectTagGroupsOptions(projectId, tagKey) : tagGroupsOptions(tagKey),
  );
  const { data: runListData, isLoading: runsLoading } = useQuery(
    projectId ? projectRunListOptions(projectId) : runListOptions,
  );

  const isLoading = groupsLoading || runsLoading;

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

  const group = groupsData?.groups?.find((entry) => entry.name === tagValue);
  const runs = dedupeSyncedRuns(
    (runListData?.runs ?? []).filter((run) => runTagValue(run, tagKey) === tagValue),
  );

  const passRate = group?.pass_rate ?? 0;
  const runCount = runs.length;
  const targetCount = group?.target_count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          {keyLabel(tagKey)}
        </p>
        <h1 className="text-2xl font-semibold text-white">{tagValue}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {runCount} run{runCount !== 1 ? 's' : ''} &middot; {targetCount} target
          {targetCount !== 1 ? 's' : ''}
          {group?.last_run && (
            <span className="ml-2">&middot; Last run: {formatTimestamp(group.last_run)}</span>
          )}
        </p>
      </div>

      {group && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Runs" value={String(runCount)} />
          <StatCard label="Targets" value={String(targetCount)} />
          <StatCard
            label="Pass Rate"
            value={`${Math.round(passRate * 100)}%`}
            accent="text-cyan-400"
          />
          <StatCard label="Last Run" value={formatTimestamp(group.last_run)} />
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-medium text-gray-200">All Runs</h2>
        <RunList
          runs={runs}
          projectId={projectId}
          emptyMessage={
            <div>
              <p className="text-lg text-gray-400">
                No evaluation runs found for {keyLabel(tagKey)} <code>{tagValue}</code>.
              </p>
              <p className="mt-2 text-sm text-gray-500">
                Runs will appear here once this value has execution results.
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
