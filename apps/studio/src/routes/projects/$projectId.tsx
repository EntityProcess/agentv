/**
 * Project home route: tabbed view (Runs, Experiments, Analytics, Targets) scoped to a project.
 *
 * Mirrors the single-project home page but fetches from project-scoped API endpoints.
 */

import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnalyticsTab } from '~/components/AnalyticsTab';
import { ExperimentsTab } from '~/components/ExperimentsTab';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { type RunSourceFilter, RunSourceToolbar } from '~/components/RunSourceToolbar';
import { TargetsTab } from '~/components/TargetsTab';
import {
  projectCompareOptions,
  syncRemoteResultsApi,
  useEvalRuns,
  useProjectRunList,
  useRemoteStatus,
  useStudioConfig,
} from '~/lib/api';

type TabId = 'runs' | 'experiments' | 'analytics' | 'targets';

const tabs: { id: TabId; label: string }[] = [
  { id: 'runs', label: '🏃 Recent Runs' },
  { id: 'experiments', label: '🧪 Experiments' },
  { id: 'analytics', label: '📊 Analytics' },
  { id: 'targets', label: '🤖 Targets' },
];

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectHomePage,
});

function ProjectHomePage() {
  const { projectId } = Route.useParams();
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const [showRunEval, setShowRunEval] = useState(false);
  const { data: config } = useStudioConfig(projectId);
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'experiments';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">{projectId}</h1>
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
                  to: '/projects/$projectId',
                  params: { projectId },
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

      {activeTab === 'runs' && <ProjectRunsTab projectId={projectId} />}
      {activeTab === 'experiments' && <ExperimentsTab projectId={projectId} />}
      {activeTab === 'analytics' && (
        <ProjectAnalyticsTab projectId={projectId} readOnly={isReadOnly} />
      )}
      {activeTab === 'targets' && <TargetsTab projectId={projectId} />}

      {!isReadOnly && (
        <RunEvalModal
          open={showRunEval}
          onClose={() => setShowRunEval(false)}
          projectId={projectId}
        />
      )}
    </div>
  );
}

function ProjectRunsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useProjectRunList(projectId);
  const { data: activeRunsData } = useEvalRuns(projectId);
  const { data: remoteStatus } = useRemoteStatus(projectId);
  const [sourceFilter, setSourceFilter] = useState<RunSourceFilter>('all');
  const [syncInFlight, setSyncInFlight] = useState(false);
  const activeRuns = (activeRunsData?.runs ?? []).filter(
    (run) => run.status === 'starting' || run.status === 'running',
  );

  const filteredRuns =
    sourceFilter === 'all'
      ? (data?.runs ?? [])
      : (data?.runs ?? []).filter((run) => run.source === sourceFilter);

  async function handleSyncRemote() {
    setSyncInFlight(true);
    try {
      await syncRemoteResultsApi(projectId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compare'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', projectId] }),
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
      {activeRuns.length > 0 && (
        <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10">
          <div className="border-b border-cyan-900/30 px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wider text-cyan-400">
              Active
            </span>
          </div>
          <ul className="divide-y divide-gray-800/50">
            {activeRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex items-center gap-3">
                  <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-cyan-400" />
                  <span className="truncate font-mono text-sm text-gray-300">{run.id}</span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {new Date(run.started_at).toLocaleTimeString()}
                  </span>
                </div>
                <Link
                  to="/projects/$projectId/jobs/$runId"
                  params={{ projectId, runId: run.id }}
                  className="flex-shrink-0 text-xs text-cyan-400 hover:text-cyan-300"
                >
                  View Log →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <RunSourceToolbar
        filter={sourceFilter}
        onFilterChange={setSourceFilter}
        remoteStatus={remoteStatus}
        syncInFlight={syncInFlight}
        onSync={handleSyncRemote}
      />
      <RunList runs={filteredRuns} projectId={projectId} />
    </div>
  );
}

function ProjectAnalyticsTab({
  projectId,
  readOnly,
}: {
  projectId: string;
  readOnly: boolean;
}) {
  const { data, isLoading, isError, error } = useQuery(projectCompareOptions(projectId));
  return (
    <AnalyticsTab
      data={data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
