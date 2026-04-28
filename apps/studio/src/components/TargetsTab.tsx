/**
 * Targets tab with drill-down from target -> experiment-grouped runs.
 *
 * The summary table opens a target detail view. That detail view groups runs
 * by experiment and reuses the existing run-detail routes for the final click,
 * so category breakdowns and individual test cases stay consistent everywhere.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  benchmarkRunListOptions,
  benchmarkTargetsOptions,
  runListOptions,
  targetsOptions,
} from '~/lib/api';
import type { RunMeta, TargetsResponse } from '~/lib/types';

import { PassRatePill } from './PassRatePill';
import { RunList } from './RunList';

interface TargetsTabProps {
  benchmarkId?: string;
}

interface ExperimentRunGroup {
  name: string;
  runs: RunMeta[];
  latestTimestamp: string | null;
  evalCount: number;
  passedCount: number;
  passRate: number;
}

export function TargetsTab({ benchmarkId }: TargetsTabProps = {}) {
  const [selectedTargetName, setSelectedTargetName] = useState<string | null>(null);
  const targetsQuery = useQuery(
    benchmarkId ? benchmarkTargetsOptions(benchmarkId) : targetsOptions,
  );
  const runsQuery = useQuery(benchmarkId ? benchmarkRunListOptions(benchmarkId) : runListOptions);
  const targets = (targetsQuery.data as TargetsResponse | undefined)?.targets ?? [];
  const runs = runsQuery.data?.runs ?? [];
  const error = targetsQuery.error ?? runsQuery.error;
  const isLoading = targetsQuery.isLoading || runsQuery.isLoading;

  const selectedTarget = useMemo(
    () => targets.find((target) => target.name === selectedTargetName) ?? null,
    [selectedTargetName, targets],
  );

  useEffect(() => {
    if (selectedTargetName && !targets.some((target) => target.name === selectedTargetName)) {
      setSelectedTargetName(null);
    }
  }, [selectedTargetName, targets]);

  const experimentGroups = useMemo(() => {
    if (!selectedTarget) return [];

    const groups = new Map<string, RunMeta[]>();
    for (const run of runs) {
      const targetName = run.target ?? 'default';
      if (targetName !== selectedTarget.name) continue;

      const experimentName = run.experiment ?? 'default';
      const existing = groups.get(experimentName) ?? [];
      existing.push(run);
      groups.set(experimentName, existing);
    }

    return [...groups.entries()]
      .map(([name, experimentRuns]) => buildExperimentGroup(name, experimentRuns))
      .sort((a, b) => {
        if (a.latestTimestamp && b.latestTimestamp && a.latestTimestamp !== b.latestTimestamp) {
          return b.latestTimestamp.localeCompare(a.latestTimestamp);
        }
        if (a.latestTimestamp) return -1;
        if (b.latestTimestamp) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [runs, selectedTarget]);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load targets: {error.message}
      </div>
    );
  }

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

  if (!selectedTarget) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Runs</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Experiments</th>
              <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Evals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {targets.map((target) => (
              <tr key={target.name} className="transition-colors hover:bg-gray-900/30">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedTargetName(target.name)}
                    className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    {target.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {target.run_count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {target.experiment_count}
                </td>
                <td className="px-4 py-3">
                  <PassRatePill rate={target.pass_rate} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  <span className="text-emerald-400">{target.passed_count}</span>
                  <span className="text-gray-600"> / </span>
                  <span>{target.eval_count}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSelectedTargetName(null)}
          className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200"
        >
          ← Back to targets
        </button>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">{selectedTarget.name}</h2>
              <p className="mt-1 text-sm text-gray-400">
                {selectedTarget.run_count} run{selectedTarget.run_count === 1 ? '' : 's'} &middot;{' '}
                {selectedTarget.experiment_count} experiment
                {selectedTarget.experiment_count === 1 ? '' : 's'} &middot;{' '}
                <span className="text-emerald-400">{selectedTarget.passed_count}</span>
                <span className="text-gray-600"> / </span>
                {selectedTarget.eval_count} evals passed
              </p>
            </div>
            <div className="w-full max-w-52">
              <PassRatePill rate={selectedTarget.pass_rate} />
            </div>
          </div>
        </div>
      </div>

      {experimentGroups.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No runs found for this target</p>
          <p className="mt-2 text-sm text-gray-500">
            This target summary exists, but there are no matching runs to group by experiment.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {experimentGroups.map((group) => (
            <section key={group.name} className="space-y-3">
              <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-200">
                    {formatExperimentName(group.name)}
                  </h3>
                  <p className="mt-1 text-sm text-gray-400">
                    {group.runs.length} run{group.runs.length === 1 ? '' : 's'} &middot;{' '}
                    <span className="text-emerald-400">{group.passedCount}</span>
                    <span className="text-gray-600"> / </span>
                    {group.evalCount} evals passed
                    {group.latestTimestamp && (
                      <span className="ml-2 text-gray-500">
                        &middot; Last run {formatTimestamp(group.latestTimestamp)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="w-full max-w-52">
                  <PassRatePill rate={group.passRate} />
                </div>
              </div>
              <RunList runs={group.runs} benchmarkId={benchmarkId} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function buildExperimentGroup(name: string, runs: RunMeta[]): ExperimentRunGroup {
  let evalCount = 0;
  let passedCount = 0;
  let latestTimestamp: string | null = null;

  for (const run of runs) {
    evalCount += run.test_count;
    passedCount += Math.round(run.pass_rate * run.test_count);
    if (run.timestamp && (!latestTimestamp || run.timestamp > latestTimestamp)) {
      latestTimestamp = run.timestamp;
    }
  }

  return {
    name,
    runs,
    latestTimestamp,
    evalCount,
    passedCount,
    passRate: evalCount > 0 ? passedCount / evalCount : 0,
  };
}

function formatExperimentName(name: string): string {
  return name === 'default' ? 'Default experiment' : name;
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-800" />
        <div className="mt-3 h-4 w-72 animate-pulse rounded bg-gray-800" />
      </div>
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
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <div className="h-5 w-48 animate-pulse rounded bg-gray-800" />
        <div className="mt-3 h-4 w-56 animate-pulse rounded bg-gray-800" />
      </div>
    </div>
  );
}
