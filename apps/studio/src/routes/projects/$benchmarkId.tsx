/**
 * Project home route: tabbed view (Runs, Experiments, Targets) scoped to a project.
 *
 * Mirrors the single-project home page but fetches from project-scoped API endpoints.
 */

import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CompareTab } from '~/components/CompareTab';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { type RunSourceFilter, RunSourceToolbar } from '~/components/RunSourceToolbar';
import {
  benchmarkCompareOptions,
  benchmarkExperimentsOptions,
  benchmarkTargetsOptions,
  syncRemoteResultsApi,
  useBenchmarkRunList,
  useRemoteStatus,
  useStudioConfig,
} from '~/lib/api';
import type { ExperimentsResponse, TargetsResponse } from '~/lib/types';

type TabId = 'runs' | 'experiments' | 'analytics' | 'targets';

const tabs: { id: TabId; label: string }[] = [
  { id: 'runs', label: 'Recent Runs' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'targets', label: 'Targets' },
];

export const Route = createFileRoute('/projects/$benchmarkId')({
  component: ProjectHomePage,
});

function ProjectHomePage() {
  const { benchmarkId } = Route.useParams();
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const [showRunEval, setShowRunEval] = useState(false);
  const { data: config } = useStudioConfig();
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'experiments';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">{benchmarkId}</h1>
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => setShowRunEval(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ▶ Run Eval
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-800">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() =>
                navigate({
                  to: '/projects/$benchmarkId',
                  params: { benchmarkId },
                  search: { tab: t.id } as Record<string, string>,
                })
              }
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? 'border-b-2 border-cyan-400 text-cyan-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'runs' && <ProjectRunsTab benchmarkId={benchmarkId} />}
      {activeTab === 'experiments' && <ProjectExperimentsTab benchmarkId={benchmarkId} />}
      {activeTab === 'analytics' && (
        <ProjectCompareTab benchmarkId={benchmarkId} readOnly={isReadOnly} />
      )}
      {activeTab === 'targets' && <ProjectTargetsTab benchmarkId={benchmarkId} />}

      {!isReadOnly && (
        <RunEvalModal
          open={showRunEval}
          onClose={() => setShowRunEval(false)}
          benchmarkId={benchmarkId}
        />
      )}
    </div>
  );
}

function ProjectRunsTab({ benchmarkId }: { benchmarkId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useBenchmarkRunList(benchmarkId);
  const { data: remoteStatus } = useRemoteStatus(benchmarkId);
  const [sourceFilter, setSourceFilter] = useState<RunSourceFilter>('all');
  const [syncInFlight, setSyncInFlight] = useState(false);

  const filteredRuns =
    sourceFilter === 'all'
      ? (data?.runs ?? [])
      : (data?.runs ?? []).filter((run) => run.source === sourceFilter);

  async function handleSyncRemote() {
    setSyncInFlight(true);
    try {
      await syncRemoteResultsApi(benchmarkId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'compare'] }),
        queryClient.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', benchmarkId] }),
      ]);
    } finally {
      setSyncInFlight(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {['s1', 's2', 's3'].map((id) => (
          <div key={id} className="h-12 animate-pulse rounded-lg bg-gray-900" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load runs: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RunSourceToolbar
        filter={sourceFilter}
        onFilterChange={setSourceFilter}
        remoteStatus={remoteStatus}
        syncInFlight={syncInFlight}
        onSync={handleSyncRemote}
      />
      <RunList runs={filteredRuns} benchmarkId={benchmarkId} />
    </div>
  );
}

function ProjectExperimentsTab({ benchmarkId }: { benchmarkId: string }) {
  const { data, isLoading } = useQuery(benchmarkExperimentsOptions(benchmarkId));
  const experiments = (data as ExperimentsResponse | undefined)?.experiments ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {['s1', 's2', 's3'].map((id) => (
          <div key={id} className="h-12 animate-pulse rounded-lg bg-gray-900" />
        ))}
      </div>
    );
  }

  if (experiments.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No experiments found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {experiments.map((exp) => (
        <div
          key={exp.name}
          className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 p-4"
        >
          <div>
            <p className="font-medium text-white">{exp.name}</p>
            <p className="text-sm text-gray-400">
              {exp.run_count} run{exp.run_count !== 1 ? 's' : ''}
            </p>
          </div>
          <span className="text-lg font-semibold tabular-nums text-cyan-400">
            {Math.round(exp.pass_rate * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ProjectCompareTab({
  benchmarkId,
  readOnly,
}: {
  benchmarkId: string;
  readOnly: boolean;
}) {
  const { data, isLoading, isError, error } = useQuery(benchmarkCompareOptions(benchmarkId));
  return (
    <CompareTab
      data={data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      benchmarkId={benchmarkId}
      readOnly={readOnly}
    />
  );
}

function ProjectTargetsTab({ benchmarkId }: { benchmarkId: string }) {
  const { data, isLoading } = useQuery(benchmarkTargetsOptions(benchmarkId));
  const targets = (data as TargetsResponse | undefined)?.targets ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {['s1', 's2', 's3'].map((id) => (
          <div key={id} className="h-12 animate-pulse rounded-lg bg-gray-900" />
        ))}
      </div>
    );
  }

  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No targets found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {targets.map((t) => (
        <div
          key={t.name}
          className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 p-4"
        >
          <div>
            <p className="font-medium text-white">{t.name}</p>
            <p className="text-sm text-gray-400">
              {t.run_count} run{t.run_count !== 1 ? 's' : ''} &middot; {t.experiment_count}{' '}
              experiment{t.experiment_count !== 1 ? 's' : ''}
            </p>
          </div>
          <span className="text-lg font-semibold tabular-nums text-cyan-400">
            {Math.round(t.pass_rate * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
