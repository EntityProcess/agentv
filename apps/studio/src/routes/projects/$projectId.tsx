/**
 * Project home route: tabbed view (Runs, Experiments, Targets) scoped to a project.
 *
 * Mirrors the single-project home page but fetches from project-scoped API endpoints.
 */

import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';

import { useQuery } from '@tanstack/react-query';
import { RunList } from '~/components/RunList';
import { useProjectRunList } from '~/lib/api';
import { projectExperimentsOptions, projectTargetsOptions } from '~/lib/api';
import type { ExperimentsResponse, TargetsResponse } from '~/lib/types';

type TabId = 'runs' | 'experiments' | 'targets';

const tabs: { id: TabId; label: string }[] = [
  { id: 'runs', label: 'Recent Runs' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'targets', label: 'Targets' },
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

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'runs';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">{projectId}</h1>

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
      {activeTab === 'experiments' && <ProjectExperimentsTab projectId={projectId} />}
      {activeTab === 'targets' && <ProjectTargetsTab projectId={projectId} />}
    </div>
  );
}

function ProjectRunsTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useProjectRunList(projectId);

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

  return <RunList runs={data?.runs ?? []} projectId={projectId} />;
}

function ProjectExperimentsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery(projectExperimentsOptions(projectId));
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

function ProjectTargetsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery(projectTargetsOptions(projectId));
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
