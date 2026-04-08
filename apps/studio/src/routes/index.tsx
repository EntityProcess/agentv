/**
 * Home route: shows Projects Dashboard when projects are registered,
 * or the existing tabbed landing page (Runs, Experiments, Targets)
 * when in single-project mode.
 *
 * Uses URL search param `?tab=` for tab persistence.
 */

import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { ExperimentsTab } from '~/components/ExperimentsTab';
import { ProjectCard } from '~/components/ProjectCard';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunList } from '~/components/RunList';
import { TargetsTab } from '~/components/TargetsTab';
import {
  addProjectApi,
  discoverProjectsApi,
  useProjectList,
  useRunList,
  useStudioConfig,
} from '~/lib/api';

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
  const { data: projectData, isLoading: projectsLoading } = useProjectList();
  const hasProjects = (projectData?.projects.length ?? 0) > 0;

  if (projectsLoading) {
    return <LoadingSkeleton />;
  }

  if (hasProjects) {
    return <ProjectsDashboard />;
  }

  return <SingleProjectHome />;
}

// ── Projects Dashboard ──────────────────────────────────────────────────

function ProjectsDashboard() {
  const { data } = useProjectList();
  const { data: config } = useStudioConfig();
  const queryClient = useQueryClient();
  const [addPath, setAddPath] = useState('');
  const [discoverPath, setDiscoverPath] = useState('');
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

  async function handleDiscover(e: React.FormEvent) {
    e.preventDefault();
    if (!discoverPath.trim()) return;
    setError(null);
    try {
      const discovered = await discoverProjectsApi(discoverPath.trim());
      setDiscoverPath('');
      if (discovered.length === 0) {
        setError('No projects with .agentv/ found in that directory.');
      }
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
              placeholder="Project path (e.g., /home/user/projects/my-app)"
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Add
            </button>
          </form>
          <form onSubmit={handleDiscover} className="flex gap-2">
            <input
              type="text"
              value={discoverPath}
              onChange={(e) => setDiscoverPath(e.target.value)}
              placeholder="Discover projects in directory..."
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600"
            >
              Discover
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
    </div>
  );
}

// ── Single-project home (existing behavior) ─────────────────────────────

function SingleProjectHome() {
  const routerState = useRouterState();
  const searchParams = routerState.location.search as Record<string, string>;
  const tab = searchParams.tab as TabId | undefined;
  const navigate = useNavigate();
  const { data, isLoading, error } = useRunList();
  const { data: config } = useStudioConfig();
  const [showRunEval, setShowRunEval] = useState(false);
  const isReadOnly = config?.read_only === true;

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'experiments';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Evaluation Runs</h1>
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
      {activeTab === 'runs' && <RunsTabContent data={data} isLoading={isLoading} error={error} />}
      {activeTab === 'experiments' && <ExperimentsTab />}
      {activeTab === 'targets' && <TargetsTab />}

      {!isReadOnly && <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} />}
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
