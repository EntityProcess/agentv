/**
 * Home route: thin entry layer that either auto-opens the cwd-backed project
 * on the first visit, shows the projects dashboard, or falls back to the
 * legacy single-project home when Studio is explicitly running in single mode.
 *
 * Uses URL search param `?tab=` for tab persistence.
 */

import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { AnalyticsTab } from '~/components/AnalyticsTab';
import { ExperimentsTab } from '~/components/ExperimentsTab';
import { ProjectCard } from '~/components/ProjectCard';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { type RunSourceFilter, RunSourceToolbar } from '~/components/RunSourceToolbar';
import { TargetsTab } from '~/components/TargetsTab';
import {
  addProjectApi,
  syncRemoteResultsApi,
  useCompare,
  useEvalRuns,
  useInfiniteRunList,
  useProjectList,
  useRemoteStatus,
  useStudioConfig,
} from '~/lib/api';
import {
  type StudioTabId,
  initialProjectRedirectStorageKey,
  resolveIndexRoute,
  resolveInitialProjectRedirect,
} from '~/lib/navigation';
import { dedupeSyncedRuns } from '~/lib/run-dedupe';
import type { RunMeta } from '~/lib/types';
type TabId = StudioTabId;

const tabs: { id: TabId; label: string }[] = [
  { id: 'runs', label: '🏃 Recent Runs' },
  { id: 'experiments', label: '🧪 Experiments' },
  { id: 'analytics', label: '📊 Analytics' },
  { id: 'targets', label: '🤖 Targets' },
];

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const { data: projectData, isLoading: projectsLoading } = useProjectList();
  const { data: config, isLoading: configLoading } = useStudioConfig();
  const projects = projectData?.projects ?? [];
  const [preferredProjectId, setPreferredProjectId] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (projectsLoading || configLoading) {
      return;
    }

    const projectId = config?.current_project_id;
    if (!projectId) {
      setPreferredProjectId(null);
      return;
    }

    const storageKey = initialProjectRedirectStorageKey(projectId);
    const alreadyRedirected =
      typeof window !== 'undefined' && window.sessionStorage.getItem(storageKey) === '1';
    const initialProjectId = resolveInitialProjectRedirect(
      projects.map((project) => project.id),
      projectId,
      alreadyRedirected,
    );

    if (typeof window !== 'undefined' && initialProjectId) {
      window.sessionStorage.setItem(storageKey, '1');
    }

    setPreferredProjectId(initialProjectId ?? null);
  }, [config?.current_project_id, configLoading, projects, projectsLoading]);

  const decision = resolveIndexRoute(
    projects.map((project) => project.id),
    config?.project_dashboard,
    preferredProjectId ?? undefined,
    tab,
  );

  useEffect(() => {
    if (decision.kind === 'redirect' && decision.redirectPath) {
      navigate({ to: decision.redirectPath, replace: true });
    }
  }, [decision, navigate]);

  if (projectsLoading || configLoading || preferredProjectId === undefined) {
    return <LoadingSkeleton />;
  }

  if (decision.kind === 'redirect') {
    return <LoadingSkeleton />;
  }

  if (decision.kind === 'dashboard') {
    return <ProjectsDashboard />;
  }

  return <SingleProjectHome />;
}

// ── Projects Dashboard ────────────────────────────────────────────────

function ProjectsDashboard() {
  const { data } = useProjectList();
  const { data: config } = useStudioConfig();
  const queryClient = useQueryClient();
  const [addPath, setAddPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRunEval, setShowRunEval] = useState(false);

  const projects = data?.projects ?? [];
  const isReadOnly = config?.read_only === true;

  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault();
    if (!addPath.trim()) return;
    setError(null);
    try {
      await addProjectApi(addPath.trim());
      setAddPath('');
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Projects</h1>
        <div className="flex gap-2">
          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={() => setShowRunEval(true)}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
              >
                ▶ Run Eval
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(!showAddForm)}
                className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
              >
                {showAddForm ? 'Cancel' : 'Add Project'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!isReadOnly && showAddForm && (
        <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <form onSubmit={handleAddProject} className="flex gap-2">
            <input
              type="text"
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              placeholder="Project path (e.g., /home/user/projects/my-evals)"
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Add
            </button>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-8 text-center">
          <p className="text-lg text-gray-300">No projects registered yet.</p>
          <p className="mt-2 text-sm text-gray-500">
            Add a project path to start browsing runs, experiments, analytics, and targets.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
    </div>
  );
}

// ── Single-project home (existing behavior) ───────────────────────────

function SingleProjectHome() {
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteRunList();
  const { data: remoteStatus } = useRemoteStatus();
  const { data: config } = useStudioConfig();
  const [showRunEval, setShowRunEval] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<RunSourceFilter>('all');
  const [syncInFlight, setSyncInFlight] = useState(false);
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'experiments';
  const filteredRuns =
    sourceFilter === 'all'
      ? dedupeSyncedRuns(data?.runs ?? [])
      : (data?.runs ?? []).filter((run) => run.source === sourceFilter);

  async function handleSyncRemote() {
    setSyncInFlight(true);
    try {
      await syncRemoteResultsApi();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['compare'] }),
        queryClient.invalidateQueries({ queryKey: ['targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', ''] }),
      ]);
    } finally {
      setSyncInFlight(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Evaluation Runs</h1>
          {config?.project_name && (
            <p className="mt-0.5 text-sm text-gray-500">{config.project_name}</p>
          )}
        </div>
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
              onClick={() => navigate({ to: '/', search: { tab: t.id } as Record<string, string> })}
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

      {/* Tab content */}
      {activeTab === 'runs' && (
        <RunsTabContent
          runs={filteredRuns}
          isLoading={isLoading}
          error={error}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          remoteStatus={remoteStatus}
          syncInFlight={syncInFlight}
          onSyncRemote={handleSyncRemote}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}
      {activeTab === 'experiments' && <ExperimentsTab />}
      {activeTab === 'analytics' && <AnalyticsTabContent readOnly={isReadOnly} />}
      {activeTab === 'targets' && <TargetsTab />}

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
    </div>
  );
}

function AnalyticsTabContent({ readOnly }: { readOnly: boolean }) {
  const { data, isLoading, isError, error } = useCompare();
  return (
    <AnalyticsTab
      data={data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      readOnly={readOnly}
    />
  );
}

function RunsTabContent({
  runs,
  isLoading,
  error,
  sourceFilter,
  onSourceFilterChange,
  remoteStatus,
  syncInFlight,
  onSyncRemote,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  runs: RunMeta[];
  isLoading: boolean;
  error: Error | null;
  sourceFilter: RunSourceFilter;
  onSourceFilterChange: (filter: RunSourceFilter) => void;
  remoteStatus: ReturnType<typeof useRemoteStatus>['data'];
  syncInFlight: boolean;
  onSyncRemote: () => void;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
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
      <ActiveRunsSection />
      <RunSourceToolbar
        filter={sourceFilter}
        onFilterChange={onSourceFilterChange}
        remoteStatus={remoteStatus}
        syncInFlight={syncInFlight}
        onSync={onSyncRemote}
      />
      <RunList
        runs={runs}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
        emptyMessage={
          sourceFilter === 'remote' ? (
            remoteStatus?.configured ? (
              <>
                <p className="text-lg text-gray-400">No remote runs found.</p>
                <p className="mt-2 text-sm text-gray-500">
                  Sync remote results or run an eval with{' '}
                  <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">
                    auto_push: true
                  </code>{' '}
                  in your config.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg text-gray-400">Remote results are not configured.</p>
                <p className="mt-2 text-sm text-gray-500">
                  Add <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">results</code>{' '}
                  to{' '}
                  <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">
                    .agentv/config.yaml
                  </code>{' '}
                  to enable remote result syncing.
                </p>
              </>
            )
          ) : undefined
        }
      />
    </div>
  );
}

// ── Active runs section ───────────────────────────────────────────────────

function ActiveRunsSection() {
  const { data } = useEvalRuns();
  const activeRuns = (data?.runs ?? []).filter(
    (r) => r.status === 'starting' || r.status === 'running',
  );

  if (activeRuns.length === 0) return null;

  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10">
      <div className="border-b border-cyan-900/30 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-cyan-400">Active</span>
      </div>
      <ul className="divide-y divide-gray-800/50">
        {activeRuns.map((run) => (
          <li key={run.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-cyan-400" />
              <span className="truncate font-mono text-sm text-gray-300">{run.id}</span>
              <span className="flex-shrink-0 text-xs text-gray-500">
                {new Date(run.started_at).toLocaleTimeString()}
              </span>
            </div>
            <Link
              to="/jobs/$runId"
              params={{ runId: run.id }}
              className="ml-4 flex-shrink-0 text-xs text-cyan-400 hover:text-cyan-300"
            >
              View Log →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {['s1', 's2', 's3', 's4', 's5'].map((id) => (
        <div key={id} className="h-12 animate-pulse rounded-lg bg-gray-900" />
      ))}
    </div>
  );
}
