/**
 * Context-aware sidebar navigation.
 *
 * Adapts its content based on the current route:
 * - At dashboard and project roots: shows global navigation
 * - At run detail: shows nearby runs as local review context
 * - At eval detail: shows evals in the current run with pass/fail indicators
 * - At suite/category detail: shows the filtered review context
 * - At experiment detail: shows nearby experiments
 *
 * Responsive behavior is handled by SidebarShell:
 * - md+ (≥768px): always-visible fixed left panel
 * - <md: hidden by default, slides in as an overlay when toggled via the hamburger
 */

import { type ReactNode, useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useMatchRoute } from '@tanstack/react-router';

import {
  DEFAULT_APP_NAME,
  isPassing,
  projectCategorySuitesOptions,
  projectExperimentsOptions,
  useCategorySuites,
  useEvalRuns,
  useExperiments,
  useProjectList,
  useProjectRunDetail,
  useProjectRunList,
  useRunDetail,
  useRunList,
  useStudioConfig,
} from '~/lib/api';
import { formatRunDisplay } from '~/lib/run-label';
import { useSidebarContext } from '~/lib/sidebar-context';

import { BrandName } from './BrandName';

/** Responsive <aside> wrapper. Handles mobile overlay and desktop static placement. */
function SidebarShell({ children }: { children: ReactNode }) {
  const { isOpen, close } = useSidebarContext();
  const location = useLocation();
  const navigationHref = location.href;

  // Close sidebar on navigation, including same-route tab changes.
  useEffect(() => {
    if (navigationHref) close();
  }, [close, navigationHref]);

  return (
    <>
      {/* Backdrop — mobile only, shown when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={close}
          onKeyDown={(e) => e.key === 'Escape' && close()}
          role="button"
          tabIndex={-1}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-800 bg-gray-950 transition-transform duration-200 ease-in-out md:static md:z-auto md:translate-x-0 md:bg-gray-900/50 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {children}
      </aside>
    </>
  );
}

function BrandHeader({ projectId }: { projectId?: string }) {
  const { data: config } = useStudioConfig(projectId);
  const appName = config?.app_name ?? DEFAULT_APP_NAME;

  return (
    <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
      <Link to="/" className="truncate text-lg font-semibold text-white hover:text-cyan-400">
        <BrandName appName={appName} />
      </Link>
    </div>
  );
}

function SidebarRunText({ display }: { display: ReturnType<typeof formatRunDisplay> }) {
  return (
    <>
      <span className="block truncate">{display.primary}</span>
      {display.secondary ? (
        <span className="block truncate text-xs text-gray-600">{display.secondary}</span>
      ) : null}
    </>
  );
}

type ProjectTabId = 'runs' | 'experiments' | 'analytics' | 'targets';

const projectNavItems: { id: ProjectTabId; label: string; description: string }[] = [
  { id: 'runs', label: 'Recent Runs', description: 'Run review' },
  { id: 'experiments', label: 'Experiments', description: 'Grouped runs' },
  { id: 'analytics', label: 'Analytics', description: 'Compare scores' },
  { id: 'targets', label: 'Targets', description: 'Target results' },
];

function sidebarLinkClass(isActive: boolean): string {
  return `mb-0.5 flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
    isActive
      ? 'bg-gray-800 text-cyan-400'
      : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
  }`;
}

function ProjectNavigationSidebar({ projectId }: { projectId?: string }) {
  const location = useLocation();
  const { data: projectData } = useProjectList();
  const projects = projectData?.projects ?? [];
  const search = location.search as Record<string, string>;
  const activeTab = projectNavItems.some((item) => item.id === search.tab)
    ? (search.tab as ProjectTabId)
    : 'runs';
  const showWorkspaceTabs = !projectId && projects.length === 0;

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-4">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            Navigate
          </div>
          <Link to="/" className={sidebarLinkClass(location.pathname === '/')}>
            <span className="truncate">Projects</span>
            {projects.length > 0 ? (
              <span className="shrink-0 text-xs tabular-nums text-gray-500">{projects.length}</span>
            ) : null}
          </Link>
          <Link to="/settings" className={sidebarLinkClass(location.pathname === '/settings')}>
            <span className="truncate">Settings</span>
          </Link>
        </div>

        {showWorkspaceTabs ? (
          <div className="mb-4">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
              Workspace
            </div>
            {projectNavItems.map((item) => (
              <Link
                key={item.id}
                to="/"
                search={{ tab: item.id } as Record<string, string>}
                className={sidebarLinkClass(activeTab === item.id)}
                title={item.description}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-gray-500">{item.description}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </nav>
    </SidebarShell>
  );
}

export function Sidebar() {
  const matchRoute = useMatchRoute();

  // ── Project-scoped route matching ──────────────────────────────────
  const projectEvalMatch = matchRoute({
    to: '/projects/$projectId/evals/$runId/$evalId',
    fuzzy: true,
  });
  const projectRunMatch = matchRoute({
    to: '/projects/$projectId/runs/$runId',
    fuzzy: true,
  });
  const projectExperimentMatch = matchRoute({
    to: '/projects/$projectId/experiments/$experimentName',
    fuzzy: true,
  });
  const projectCategoryMatch = matchRoute({
    to: '/projects/$projectId/runs/$runId/category/$category',
    fuzzy: true,
  });
  const projectSuiteMatch = matchRoute({
    to: '/projects/$projectId/runs/$runId/suite/$suite',
    fuzzy: true,
  });
  const projectJobMatch = matchRoute({
    to: '/projects/$projectId/jobs/$runId',
    fuzzy: true,
  });
  const projectMatch = matchRoute({
    to: '/projects/$projectId',
    fuzzy: true,
  });

  // Project-scoped eval detail
  if (projectEvalMatch && typeof projectEvalMatch === 'object' && 'projectId' in projectEvalMatch) {
    const { projectId, runId, evalId } = projectEvalMatch as {
      projectId: string;
      runId: string;
      evalId: string;
    };
    return <ProjectEvalSidebar projectId={projectId} runId={runId} currentEvalId={evalId} />;
  }

  if (
    projectCategoryMatch &&
    typeof projectCategoryMatch === 'object' &&
    'projectId' in projectCategoryMatch
  ) {
    const { projectId, runId, category } = projectCategoryMatch as {
      projectId: string;
      runId: string;
      category: string;
    };
    return <ProjectCategorySidebar projectId={projectId} runId={runId} category={category} />;
  }

  if (
    projectSuiteMatch &&
    typeof projectSuiteMatch === 'object' &&
    'projectId' in projectSuiteMatch
  ) {
    const { projectId, runId, suite } = projectSuiteMatch as {
      projectId: string;
      runId: string;
      suite: string;
    };
    return <ProjectSuiteSidebar projectId={projectId} runId={runId} suite={suite} />;
  }

  // Project-scoped run detail
  if (projectRunMatch && typeof projectRunMatch === 'object' && 'projectId' in projectRunMatch) {
    const { projectId, runId } = projectRunMatch as { projectId: string; runId: string };
    return <ProjectRunDetailSidebar projectId={projectId} currentRunId={runId} />;
  }

  if (projectJobMatch && typeof projectJobMatch === 'object' && 'projectId' in projectJobMatch) {
    const { projectId } = projectJobMatch as { projectId: string };
    return <ProjectRunDetailSidebar projectId={projectId} />;
  }

  if (
    projectExperimentMatch &&
    typeof projectExperimentMatch === 'object' &&
    'projectId' in projectExperimentMatch
  ) {
    const { projectId, experimentName } = projectExperimentMatch as {
      projectId: string;
      experimentName: string;
    };
    return <ProjectExperimentSidebar projectId={projectId} currentExperiment={experimentName} />;
  }

  // Project home (runs/experiments/targets)
  if (projectMatch && typeof projectMatch === 'object' && 'projectId' in projectMatch) {
    const { projectId } = projectMatch as { projectId: string };
    return <ProjectNavigationSidebar projectId={projectId} />;
  }

  // ── Unscoped route matching ──────────────────────────────────────────
  const runMatch = matchRoute({ to: '/runs/$runId', fuzzy: true });
  const evalMatch = matchRoute({ to: '/evals/$runId/$evalId', fuzzy: true });
  const categoryMatch = matchRoute({
    to: '/runs/$runId/category/$category',
    fuzzy: true,
  });
  const suiteMatch = matchRoute({
    to: '/runs/$runId/suite/$suite',
    fuzzy: true,
  });
  const experimentMatch = matchRoute({
    to: '/experiments/$experimentName',
    fuzzy: true,
  });

  if (categoryMatch && typeof categoryMatch === 'object' && 'runId' in categoryMatch) {
    const { runId, category } = categoryMatch as { runId: string; category: string };
    return <CategorySidebar runId={runId} category={category} />;
  }

  if (suiteMatch && typeof suiteMatch === 'object' && 'runId' in suiteMatch) {
    const { runId, suite } = suiteMatch as { runId: string; suite: string };
    return <SuiteSidebar runId={runId} suite={suite} />;
  }

  if (evalMatch && typeof evalMatch === 'object' && 'runId' in evalMatch) {
    const { runId, evalId } = evalMatch as { runId: string; evalId: string };
    return <EvalSidebar runId={runId} currentEvalId={evalId} />;
  }

  if (
    experimentMatch &&
    typeof experimentMatch === 'object' &&
    'experimentName' in experimentMatch
  ) {
    const { experimentName } = experimentMatch as { experimentName: string };
    return <ExperimentSidebar currentExperiment={experimentName} />;
  }

  if (runMatch && typeof runMatch === 'object' && 'runId' in runMatch) {
    const { runId } = runMatch as { runId: string };
    return <RunDetailSidebar currentRunId={runId} />;
  }

  return <ProjectNavigationSidebar />;
}

function RunDetailSidebar({ currentRunId }: { currentRunId: string }) {
  const { data } = useRunList();
  const { data: config } = useStudioConfig();
  const { data: evalRunsData } = useEvalRuns();
  const activeRunCount = (evalRunsData?.runs ?? []).filter(
    (r) => r.status === 'starting' || r.status === 'running',
  ).length;

  return (
    <SidebarShell>
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="truncate text-lg font-semibold text-white hover:text-cyan-400">
          <BrandName appName={config?.app_name ?? DEFAULT_APP_NAME} />
        </Link>
        {activeRunCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-cyan-900/40 px-2 py-0.5 text-xs text-cyan-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            {activeRunCount}
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Run history
        </div>

        {data?.runs.map((run) => {
          const display = formatRunDisplay(run);
          const isActive = currentRunId === run.filename;

          return (
            <Link
              key={run.filename}
              to="/runs/$runId"
              params={{ runId: run.filename }}
              className={`mb-0.5 block rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
              title={display.title}
            >
              <SidebarRunText display={display} />
            </Link>
          );
        })}
      </nav>

      {/* Settings link at bottom */}
      <div className="border-t border-gray-800 px-4 py-3">
        <Link
          to="/settings"
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-cyan-400"
        >
          Settings
        </Link>
      </div>
    </SidebarShell>
  );
}

function EvalSidebar({ runId, currentEvalId }: { runId: string; currentEvalId: string }) {
  const { data } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  return (
    <SidebarShell>
      <BrandHeader />

      {/* Back to run link */}
      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/runs/$runId"
          params={{ runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Evaluations
        </div>

        {data?.results.map((result) => {
          const isActive = result.testId === currentEvalId;
          const passed = isPassing(result.score, passThreshold);

          return (
            <Link
              key={result.testId}
              to="/evals/$runId/$evalId"
              params={{ runId, evalId: result.testId }}
              className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              <span className={`text-xs ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {passed ? '\u2713' : '\u2717'}
              </span>
              <span className="truncate">{result.testId}</span>
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function SuiteSidebar({ runId, suite }: { runId: string; suite: string }) {
  const { data } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;
  const suiteResults = (data?.results ?? []).filter((r) => (r.suite ?? 'Uncategorized') === suite);

  return (
    <SidebarShell>
      <BrandHeader />

      {/* Back to run link */}
      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/runs/$runId"
          params={{ runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
        <p className="truncate text-xs text-gray-500">{suite}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Evaluations
        </div>

        {suiteResults.map((result) => {
          const passed = isPassing(result.score, passThreshold);

          return (
            <Link
              key={result.testId}
              to="/evals/$runId/$evalId"
              params={{ runId, evalId: result.testId }}
              className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-gray-200"
            >
              <span className={`text-xs ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {passed ? '\u2713' : '\u2717'}
              </span>
              <span className="truncate">{result.testId}</span>
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function CategorySidebar({ runId, category }: { runId: string; category: string }) {
  const { data } = useCategorySuites(runId, category);
  const suites = data?.suites ?? [];

  return (
    <SidebarShell>
      <BrandHeader />

      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/runs/$runId"
          params={{ runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
        <p className="truncate text-xs text-gray-500">{category}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Suites
        </div>

        {suites.map((ds) => (
          <Link
            key={ds.name}
            to="/runs/$runId/suite/$suite"
            params={{ runId, suite: ds.name }}
            className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-gray-200"
          >
            <span
              className={`text-xs ${ds.passed === ds.total ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {ds.passed === ds.total ? '\u2713' : '\u2717'}
            </span>
            <span className="truncate">{ds.name}</span>
          </Link>
        ))}
      </nav>
    </SidebarShell>
  );
}

// ── Project-scoped sidebars ────────────────────────────────────────────

function ProjectRunDetailSidebar({
  projectId,
  currentRunId,
}: {
  projectId: string;
  currentRunId?: string;
}) {
  const { data } = useProjectRunList(projectId);

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Runs
        </div>
        {data?.runs.map((run) => {
          const display = formatRunDisplay(run);
          const isActive = currentRunId === run.filename;
          return (
            <Link
              key={run.filename}
              to="/projects/$projectId/runs/$runId"
              params={{ projectId, runId: run.filename }}
              className={`mb-0.5 block rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
              title={display.title}
            >
              <SidebarRunText display={display} />
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function ProjectEvalSidebar({
  projectId,
  runId,
  currentEvalId,
}: {
  projectId: string;
  runId: string;
  currentEvalId: string;
}) {
  const { data } = useProjectRunDetail(projectId, runId);
  const { data: config } = useStudioConfig(projectId);
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/projects/$projectId/runs/$runId"
          params={{ projectId, runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Evaluations
        </div>
        {data?.results.map((result) => {
          const isActive = result.testId === currentEvalId;
          const passed = isPassing(result.score, passThreshold);
          return (
            <Link
              key={result.testId}
              to="/projects/$projectId/evals/$runId/$evalId"
              params={{ projectId, runId, evalId: result.testId }}
              className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              <span className={`text-xs ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {passed ? '\u2713' : '\u2717'}
              </span>
              <span className="truncate">{result.testId}</span>
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function ProjectSuiteSidebar({
  projectId,
  runId,
  suite,
}: {
  projectId: string;
  runId: string;
  suite: string;
}) {
  const { data } = useProjectRunDetail(projectId, runId);
  const { data: config } = useStudioConfig(projectId);
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;
  const suiteResults = (data?.results ?? []).filter((r) => (r.suite ?? 'Uncategorized') === suite);

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/projects/$projectId/runs/$runId"
          params={{ projectId, runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
        <p className="truncate text-xs text-gray-500">{suite}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Evaluations
        </div>
        {suiteResults.map((result) => {
          const passed = isPassing(result.score, passThreshold);
          return (
            <Link
              key={result.testId}
              to="/projects/$projectId/evals/$runId/$evalId"
              params={{ projectId, runId, evalId: result.testId }}
              className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-gray-200"
            >
              <span className={`text-xs ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {passed ? '\u2713' : '\u2717'}
              </span>
              <span className="truncate">{result.testId}</span>
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function ProjectCategorySidebar({
  projectId,
  runId,
  category,
}: {
  projectId: string;
  runId: string;
  category: string;
}) {
  const { data } = useQuery(projectCategorySuitesOptions(projectId, runId, category));
  const suites = data?.suites ?? [];

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/projects/$projectId/runs/$runId"
          params={{ projectId, runId }}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; Back to run
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{runId}</p>
        <p className="truncate text-xs text-gray-500">{category}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Suites
        </div>

        {suites.map((ds) => (
          <Link
            key={ds.name}
            to="/projects/$projectId/runs/$runId/suite/$suite"
            params={{ projectId, runId, suite: ds.name }}
            className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-gray-200"
          >
            <span
              className={`text-xs ${ds.passed === ds.total ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {ds.passed === ds.total ? '\u2713' : '\u2717'}
            </span>
            <span className="truncate">{ds.name}</span>
          </Link>
        ))}
      </nav>
    </SidebarShell>
  );
}

function ProjectExperimentSidebar({
  projectId,
  currentExperiment,
}: {
  projectId: string;
  currentExperiment: string;
}) {
  const { data } = useQuery(projectExperimentsOptions(projectId));
  const experiments = data?.experiments ?? [];

  return (
    <SidebarShell>
      <BrandHeader projectId={projectId} />

      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: 'experiments' } as Record<string, string>}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; All experiments
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Experiments
        </div>

        {experiments.map((exp) => {
          const isActive = exp.name === currentExperiment;

          return (
            <Link
              key={exp.name}
              to="/projects/$projectId/experiments/$experimentName"
              params={{ projectId, experimentName: exp.name }}
              className={`mb-0.5 block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              {exp.name}
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}

function ExperimentSidebar({ currentExperiment }: { currentExperiment: string }) {
  const { data } = useExperiments();
  const experiments = data?.experiments ?? [];

  return (
    <SidebarShell>
      <BrandHeader />

      {/* Back to experiments tab */}
      <div className="border-b border-gray-800 px-4 py-2">
        <Link
          to="/"
          search={{ tab: 'experiments' } as Record<string, string>}
          className="text-xs text-gray-400 hover:text-cyan-400"
        >
          &larr; All experiments
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Experiments
        </div>

        {experiments.map((exp) => {
          const isActive = exp.name === currentExperiment;

          return (
            <Link
              key={exp.name}
              to="/experiments/$experimentName"
              params={{ experimentName: exp.name }}
              className={`mb-0.5 block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              {exp.name}
            </Link>
          );
        })}
      </nav>
    </SidebarShell>
  );
}
