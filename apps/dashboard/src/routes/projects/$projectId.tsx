/**
 * Project home route: tabbed view (Runs, Tags, Analytics, Targets) scoped to a project.
 *
 * Mirrors the single-project home page but fetches from project-scoped API endpoints.
 */

import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnalyticsTab } from '~/components/AnalyticsTab';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { RunSourceToolbar } from '~/components/RunSourceToolbar';
import { TagsTab } from '~/components/TagsTab';
import { TargetsTab } from '~/components/TargetsTab';
import {
  DEFAULT_TAG_KEY,
  confirmRemoteResultsMergeApi,
  projectCompareOptions,
  remoteStatusOptions,
  syncRemoteResultsApi,
  useEvalRuns,
  useInfiniteProjectRunList,
  useRemoteStatus,
  useStudioConfig,
} from '~/lib/api';
import {
  buildProjectSyncErrorFeedback,
  buildProjectSyncFeedback,
  formatOnRemoteSummary,
} from '~/lib/project-sync-status';
import { dedupeSyncedRuns } from '~/lib/run-dedupe';

type TabId = 'runs' | 'tags' | 'analytics' | 'targets';

const tabs: { id: TabId; label: string; title: string }[] = [
  { id: 'runs', label: '🏃 Recent Runs', title: 'Recent Runs' },
  { id: 'tags', label: '🏷️ Tags', title: 'Tags' },
  { id: 'analytics', label: '📊 Analytics', title: 'Analytics' },
  { id: 'targets', label: '🤖 Targets', title: 'Targets' },
];

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectHomePage,
});

function ProjectHomePage() {
  const { projectId } = Route.useParams();
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const tagKey = searchParams.key?.trim() ? searchParams.key : DEFAULT_TAG_KEY;
  const navigate = useNavigate();
  const [showRunEval, setShowRunEval] = useState(false);
  const { data: config } = useStudioConfig(projectId);
  const isReadOnly = config?.read_only === true;
  const projectName = projectId;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'runs';
  const activeTabTitle = tabs.find((t) => t.id === activeTab)?.title ?? 'Recent Runs';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">{activeTabTitle}</h1>
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
      <div className="border-b border-gray-800 sm:overflow-x-auto">
        <div className="flex flex-wrap gap-1 sm:min-w-max sm:flex-nowrap">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() =>
                navigate({
                  to: '/projects/$projectId',
                  params: { projectId },
                  search: (t.id === 'tags' ? { tab: t.id, key: tagKey } : { tab: t.id }) as Record<
                    string,
                    string
                  >,
                })
              }
              className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
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

      {activeTab === 'runs' && (
        <ProjectRunsTab projectId={projectId} projectName={projectName} readOnly={isReadOnly} />
      )}
      {activeTab === 'tags' && (
        <TagsTab
          projectId={projectId}
          tagKey={tagKey}
          onTagKeyChange={(key) =>
            navigate({
              to: '/projects/$projectId',
              params: { projectId },
              search: { tab: 'tags', key } as Record<string, string>,
            })
          }
        />
      )}
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

function ProjectRunsTab({
  projectId,
  projectName,
  readOnly,
}: {
  projectId: string;
  projectName: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteProjectRunList(projectId);
  const { data: activeRunsData } = useEvalRuns(projectId);
  const { data: remoteStatus } = useRemoteStatus(projectId);
  const [syncInFlight, setSyncInFlight] = useState(false);
  const [confirmMergeInFlight, setConfirmMergeInFlight] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    kind: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const activeRuns = (activeRunsData?.runs ?? []).filter(
    (run) => run.status === 'starting' || run.status === 'running',
  );

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
      const result = await syncRemoteResultsApi(projectId);
      queryClient.setQueryData(remoteStatusOptions(projectId).queryKey, result);
      const feedback = buildProjectSyncFeedback(result);
      setSyncFeedback(feedback);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tags'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compare'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', projectId] }),
      ]).catch(() => undefined);
    } catch (err) {
      setSyncFeedback(buildProjectSyncErrorFeedback(err, remoteStatus));
      void queryClient
        .invalidateQueries({ queryKey: ['remote-status', projectId] })
        .catch(() => undefined);
    } finally {
      setSyncInFlight(false);
    }
  }

  async function handleConfirmMerge() {
    setConfirmMergeInFlight(true);
    setSyncFeedback(null);
    try {
      const result = await confirmRemoteResultsMergeApi(projectId);
      queryClient.setQueryData(remoteStatusOptions(projectId).queryKey, result);
      setSyncFeedback(buildProjectSyncFeedback(result));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tags'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compare'] }),
        queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'targets'] }),
        queryClient.invalidateQueries({ queryKey: ['remote-status', projectId] }),
      ]).catch(() => undefined);
    } catch (err) {
      setSyncFeedback(buildProjectSyncErrorFeedback(err, remoteStatus));
      void queryClient
        .invalidateQueries({ queryKey: ['remote-status', projectId] })
        .catch(() => undefined);
    } finally {
      setConfirmMergeInFlight(false);
    }
  }

  useEffect(() => {
    if (syncFeedback?.kind !== 'success') {
      return;
    }

    const timeout = window.setTimeout(() => setSyncFeedback(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [syncFeedback]);

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
        remoteStatus={remoteStatus}
        syncInFlight={syncInFlight}
        onSync={handleSyncRemote}
        projectName={projectName}
        syncFeedback={syncFeedback}
        onRemoteSummary={onRemoteSummary}
        onConfirmMerge={handleConfirmMerge}
        confirmMergeInFlight={confirmMergeInFlight}
      />
      <RunList
        runs={runs}
        projectId={projectId}
        enableCombine={!readOnly}
        remoteBranch={remoteStatus?.branch}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={() => void fetchNextPage()}
      />
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
