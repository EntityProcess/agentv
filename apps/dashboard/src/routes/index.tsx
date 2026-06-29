/**
 * Home route: thin entry layer that either auto-opens the cwd-backed project
 * on the first visit, shows the projects dashboard, or falls back to the
 * legacy single-project home when Dashboard is explicitly running in single mode.
 *
 * Uses URL search param `?tab=` for tab persistence.
 */

import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { AddProjectModal } from '~/components/AddProjectModal';
import { AnalyticsTab } from '~/components/AnalyticsTab';
import { ExperimentsTab } from '~/components/ExperimentsTab';
import { ProjectCard } from '~/components/ProjectCard';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { RunSourceToolbar } from '~/components/RunSourceToolbar';
import { TargetsTab } from '~/components/TargetsTab';
import {
  confirmRemoteResultsMergeApi,
  remoteStatusOptions,
  removeProjectApi,
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
import {
  buildProjectSyncErrorFeedback,
  buildProjectSyncFeedback,
  formatOnRemoteSummary,
} from '~/lib/project-sync-status';
import { dedupeSyncedRuns } from '~/lib/run-dedupe';
import type { ProjectListResponse, ProjectSummary, RunMeta } from '~/lib/types';
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
  const [showAddProject, setShowAddProject] = useState(false);
  const [showRunEval, setShowRunEval] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);

  const projects = data?.projects ?? [];
  const isReadOnly = config?.read_only === true;

  async function handleRemoveProject(project: ProjectSummary) {
    await removeProjectApi(project.id);
    queryClient.setQueryData<ProjectListResponse>(['projects'], (current) =>
      current
        ? {
            projects: current.projects.filter((entry) => entry.id !== project.id),
          }
        : current,
    );
    setProjectMessage(`Project removed from Dashboard: ${project.id}. Files were left on disk.`);
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
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
                onClick={() => {
                  setProjectMessage(null);
                  setShowAddProject(true);
                }}
                className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400"
              >
                Add Project
              </button>
            </>
          )}
        </div>
      </div>

      {projectMessage && (
        <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-3 text-sm text-cyan-300">
          {projectMessage}
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
            <ProjectCard
              key={project.id}
              project={project}
              canRemove={!isReadOnly}
              onRemove={handleRemoveProject}
            />
          ))}
        </div>
      )}

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
      {!isReadOnly && (
        <AddProjectModal
          open={showAddProject}
          onClose={() => setShowAddProject(false)}
          onAdded={(project) => {
            setProjectMessage(`Project registered: ${project.id}`);
            void queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}
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
  const [syncInFlight, setSyncInFlight] = useState(false);
  const [confirmMergeInFlight, setConfirmMergeInFlight] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    kind: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'runs';
  const runs = dedupeSyncedRuns(data?.runs ?? []);
  const onRemoteCount = runs.filter((run) => run.on_remote === true).length;
  const onRemoteSummary =
    remoteStatus?.configured === true
      ? formatOnRemoteSummary(onRemoteCount, runs.length, remoteStatus.branch)
      : undefined;

  async function handleSyncRemote() {
    setSyncInFlight(true);
    setSyncFeedback(null);
    try {
      const result = await syncRemoteResultsApi();
      queryClient.setQueryData(remoteStatusOptions().queryKey, result);
      setSyncFeedback(buildProjectSyncFeedback(result));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['compare'] }),
        queryClient.invalidateQueries({ queryKey: ['targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', ''] }),
      ]).catch(() => undefined);
    } catch (err) {
      setSyncFeedback(buildProjectSyncErrorFeedback(err, remoteStatus));
      void queryClient
        .invalidateQueries({ queryKey: ['remote-status', ''] })
        .catch(() => undefined);
    } finally {
      setSyncInFlight(false);
    }
  }

  useEffect(() => {
    if (syncFeedback?.kind !== 'success') {
      return;
    }

    const timeout = window.setTimeout(() => setSyncFeedback(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [syncFeedback]);

  async function handleConfirmMerge() {
    setConfirmMergeInFlight(true);
    setSyncFeedback(null);
    try {
      const result = await confirmRemoteResultsMergeApi();
      queryClient.setQueryData(remoteStatusOptions().queryKey, result);
      setSyncFeedback(buildProjectSyncFeedback(result));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['experiments'] }),
        queryClient.invalidateQueries({ queryKey: ['compare'] }),
        queryClient.invalidateQueries({ queryKey: ['targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', ''] }),
      ]).catch(() => undefined);
    } catch (err) {
      setSyncFeedback(buildProjectSyncErrorFeedback(err, remoteStatus));
      void queryClient
        .invalidateQueries({ queryKey: ['remote-status', ''] })
        .catch(() => undefined);
    } finally {
      setConfirmMergeInFlight(false);
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
        <div className="flex flex-wrap gap-1 sm:flex-nowrap">
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
          runs={runs}
          isLoading={isLoading}
          error={error}
          remoteStatus={remoteStatus}
          syncInFlight={syncInFlight}
          syncFeedback={syncFeedback}
          onSyncRemote={handleSyncRemote}
          onConfirmMerge={handleConfirmMerge}
          confirmMergeInFlight={confirmMergeInFlight}
          projectName={config?.project_name}
          onRemoteSummary={onRemoteSummary}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          readOnly={isReadOnly}
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
  remoteStatus,
  syncInFlight,
  syncFeedback,
  onSyncRemote,
  onConfirmMerge,
  confirmMergeInFlight,
  projectName,
  onRemoteSummary,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  readOnly,
}: {
  runs: RunMeta[];
  isLoading: boolean;
  error: Error | null;
  remoteStatus: ReturnType<typeof useRemoteStatus>['data'];
  syncInFlight: boolean;
  syncFeedback: { kind: 'success' | 'warning' | 'error'; message: string } | null;
  onSyncRemote: () => void;
  onConfirmMerge: () => void;
  confirmMergeInFlight: boolean;
  projectName?: string;
  onRemoteSummary?: string;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  readOnly: boolean;
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
        remoteStatus={remoteStatus}
        syncInFlight={syncInFlight}
        onSync={onSyncRemote}
        projectName={projectName}
        syncFeedback={syncFeedback}
        onRemoteSummary={onRemoteSummary}
        onConfirmMerge={onConfirmMerge}
        confirmMergeInFlight={confirmMergeInFlight}
      />
      <RunList
        runs={runs}
        enableCombine={!readOnly}
        remoteBranch={remoteStatus?.branch}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
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
