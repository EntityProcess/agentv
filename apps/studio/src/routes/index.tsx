/**
 * Home route: shows the multi-benchmark dashboard when the server enables it,
 * or the existing tabbed landing page (Runs, Experiments, Analytics, Targets)
 * in single-benchmark mode.
 *
 * Uses URL search param `?tab=` for tab persistence.
 */

import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { AnalyticsTab } from '~/components/AnalyticsTab';
import { BenchmarkCard } from '~/components/BenchmarkCard';
import { ExperimentsTab } from '~/components/ExperimentsTab';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { type RunSourceFilter, RunSourceToolbar } from '~/components/RunSourceToolbar';
import { TargetsTab } from '~/components/TargetsTab';
import {
  addBenchmarkApi,
  addDiscoveryRootApi,
  syncRemoteResultsApi,
  useBenchmarkList,
  useCompare,
  useEvalRuns,
  useRemoteStatus,
  useRunList,
  useStudioConfig,
} from '~/lib/api';

type TabId = 'runs' | 'experiments' | 'analytics' | 'targets';

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
  const { data: benchmarkData, isLoading: benchmarksLoading } = useBenchmarkList();
  const { data: config, isLoading: configLoading } = useStudioConfig();
  const hasBenchmarks = (benchmarkData?.benchmarks.length ?? 0) > 0;
  const multiBenchmarkDashboard = config?.multi_benchmark_dashboard;

  if (benchmarksLoading || configLoading) {
    return <LoadingSkeleton />;
  }

  if (
    multiBenchmarkDashboard === true ||
    (multiBenchmarkDashboard === undefined && hasBenchmarks)
  ) {
    return <BenchmarksDashboard />;
  }

  return <SingleBenchmarkHome />;
}

// ── Benchmarks Dashboard ────────────────────────────────────────────────

function BenchmarksDashboard() {
  const { data } = useBenchmarkList();
  const { data: config } = useStudioConfig();
  const queryClient = useQueryClient();
  const [addPath, setAddPath] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRunEval, setShowRunEval] = useState(false);

  const benchmarks = data?.benchmarks ?? [];
  const isReadOnly = config?.read_only === true;

  async function handleAddBenchmark(e: React.FormEvent) {
    e.preventDefault();
    if (!addPath.trim()) return;
    setError(null);
    try {
      await addBenchmarkApi(addPath.trim());
      setAddPath('');
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ['benchmarks'] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddDiscoveryRoot(e: React.FormEvent) {
    e.preventDefault();
    if (!rootPath.trim()) return;
    setError(null);
    try {
      await addDiscoveryRootApi(rootPath.trim());
      setRootPath('');
      queryClient.invalidateQueries({ queryKey: ['benchmarks'] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Benchmarks</h1>
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
                {showAddForm ? 'Cancel' : 'Add Benchmark'}
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
          <form onSubmit={handleAddBenchmark} className="flex gap-2">
            <input
              type="text"
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              placeholder="Benchmark path (e.g., /home/user/projects/my-evals)"
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Add
            </button>
          </form>
          <form onSubmit={handleAddDiscoveryRoot} className="flex gap-2">
            <input
              type="text"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="Watch a directory for .agentv/ repos..."
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600"
            >
              Watch
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {benchmarks.map((benchmark) => (
          <BenchmarkCard key={benchmark.id} benchmark={benchmark} />
        ))}
      </div>

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
    </div>
  );
}

// ── Single-benchmark home (existing behavior) ───────────────────────────

function SingleBenchmarkHome() {
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useRunList();
  const { data: remoteStatus } = useRemoteStatus();
  const { data: config } = useStudioConfig();
  const [showRunEval, setShowRunEval] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<RunSourceFilter>('all');
  const [syncInFlight, setSyncInFlight] = useState(false);
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'experiments';
  const filteredRuns =
    sourceFilter === 'all'
      ? (data?.runs ?? [])
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
          {config?.benchmark_name && (
            <p className="mt-0.5 text-sm text-gray-500">{config.benchmark_name}</p>
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
}: {
  runs: NonNullable<ReturnType<typeof useRunList>['data']>['runs'];
  isLoading: boolean;
  error: Error | null;
  sourceFilter: RunSourceFilter;
  onSourceFilterChange: (filter: RunSourceFilter) => void;
  remoteStatus: ReturnType<typeof useRemoteStatus>['data'];
  syncInFlight: boolean;
  onSyncRemote: () => void;
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
                  Add{' '}
                  <code className="rounded bg-gray-800 px-2 py-1 text-cyan-400">
                    results.export
                  </code>{' '}
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
