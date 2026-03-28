/**
 * Home route: tabbed landing page with Recent Runs, Experiments, and Targets.
 *
 * Uses URL search param `?tab=` for tab persistence.
 */

import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';

import { ExperimentsTab } from '~/components/ExperimentsTab';
import { RunList } from '~/components/RunList';
import { TargetsTab } from '~/components/TargetsTab';
import { useRunList } from '~/lib/api';

type TabId = 'runs' | 'experiments' | 'targets';

const tabs: { id: TabId; label: string }[] = [
  { id: 'runs', label: 'Recent Runs' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'targets', label: 'Targets' },
];

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const { data, isLoading, error } = useRunList();

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'runs';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Evaluation Runs</h1>

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
      {activeTab === 'runs' && <RunsTabContent data={data} isLoading={isLoading} error={error} />}
      {activeTab === 'experiments' && <ExperimentsTab />}
      {activeTab === 'targets' && <TargetsTab />}
    </div>
  );
}

function RunsTabContent({
  data,
  isLoading,
  error,
}: {
  data: ReturnType<typeof useRunList>['data'];
  isLoading: boolean;
  error: Error | null;
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

  return <RunList runs={data?.runs ?? []} />;
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
