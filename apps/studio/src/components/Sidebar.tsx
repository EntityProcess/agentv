/**
 * Context-aware sidebar navigation.
 *
 * Adapts its content based on the current route:
 * - At root or run detail: shows list of runs
 * - At eval detail: shows list of evals in the current run with pass/fail indicators
 * - At suite detail: shows evals filtered to that suite
 * - At experiment detail: shows list of experiments
 */

import { Link, useMatchRoute } from '@tanstack/react-router';

import {
  isPassing,
  useAllProjectRuns,
  useCategorySuites,
  useExperiments,
  useProjectList,
  useProjectRunDetail,
  useProjectRunList,
  useRunDetail,
  useRunList,
  useStudioConfig,
} from '~/lib/api';

export function Sidebar() {
  const matchRoute = useMatchRoute();

  // ── Project-scoped route matching ────────────────────────────────────
  const projectEvalMatch = matchRoute({
    to: '/projects/$projectId/evals/$runId/$evalId',
    fuzzy: true,
  });
  const projectRunMatch = matchRoute({
    to: '/projects/$projectId/runs/$runId',
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

  // Project-scoped run detail
  if (projectRunMatch && typeof projectRunMatch === 'object' && 'projectId' in projectRunMatch) {
    const { projectId, runId } = projectRunMatch as { projectId: string; runId: string };
    return <ProjectRunDetailSidebar projectId={projectId} currentRunId={runId} />;
  }

  // Project home (runs/experiments/targets)
  if (projectMatch && typeof projectMatch === 'object' && 'projectId' in projectMatch) {
    const { projectId } = projectMatch as { projectId: string };
    return <ProjectRunDetailSidebar projectId={projectId} />;
  }

  // ── Unscoped route matching ──────────────────────────────────────────
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

  return <RunSidebar />;
}

function RunSidebar() {
  const matchRoute = useMatchRoute();
  const { data: projectData } = useProjectList();
  const hasProjects = (projectData?.projects.length ?? 0) > 0;

  const isHome = matchRoute({ to: '/' });
  const runMatch = matchRoute({ to: '/runs/$runId', fuzzy: true });

  // On the projects landing page, show aggregated runs from all projects
  const useAggregated = hasProjects && isHome !== false;

  const { data: localData } = useRunList();
  const { data: aggregatedData } = useAllProjectRuns();
  const data = useAggregated ? aggregatedData : localData;

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Runs
        </div>

        {data?.runs.map((run) => {
          const isActive =
            isHome === false &&
            runMatch &&
            typeof runMatch === 'object' &&
            'runId' in runMatch &&
            (runMatch as { runId: string }).runId === run.filename;

          // Aggregated runs link to their project's run detail
          if (run.project_id) {
            return (
              <Link
                key={`${run.project_id}/${run.filename}`}
                to="/projects/$projectId/runs/$runId"
                params={{ projectId: run.project_id, runId: run.filename }}
                className="mb-0.5 block truncate rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-gray-200"
                title={run.project_name}
              >
                {run.filename}
              </Link>
            );
          }

          return (
            <Link
              key={run.filename}
              to="/runs/$runId"
              params={{ runId: run.filename }}
              className={`mb-0.5 block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              {run.filename}
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
    </aside>
  );
}

function EvalSidebar({ runId, currentEvalId }: { runId: string; currentEvalId: string }) {
  const { data } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const passThreshold = config?.pass_threshold ?? 0.8;

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

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
    </aside>
  );
}

function SuiteSidebar({ runId, suite }: { runId: string; suite: string }) {
  const { data } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const passThreshold = config?.pass_threshold ?? 0.8;
  const suiteResults = (data?.results ?? []).filter((r) => (r.suite ?? 'Uncategorized') === suite);

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

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
    </aside>
  );
}

function CategorySidebar({ runId, category }: { runId: string; category: string }) {
  const { data } = useCategorySuites(runId, category);
  const suites = data?.suites ?? [];

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

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
    </aside>
  );
}

// ── Project-scoped sidebars ──────────────────────────────────────────────

function ProjectRunDetailSidebar({
  projectId,
  currentRunId,
}: {
  projectId: string;
  currentRunId?: string;
}) {
  const { data } = useProjectRunList(projectId);

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

      <div className="border-b border-gray-800 px-4 py-2">
        <Link to="/" className="text-xs text-gray-400 hover:text-cyan-400">
          &larr; All Projects
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-gray-300">{projectId}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Runs
        </div>
        {data?.runs.map((run) => {
          const isActive = currentRunId === run.filename;
          return (
            <Link
              key={run.filename}
              to="/projects/$projectId/runs/$runId"
              params={{ projectId, runId: run.filename }}
              className={`mb-0.5 block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-cyan-400'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              {run.filename}
            </Link>
          );
        })}
      </nav>
    </aside>
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
  const { data: config } = useStudioConfig();
  const passThreshold = config?.pass_threshold ?? 0.8;

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

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
    </aside>
  );
}

function ExperimentSidebar({ currentExperiment }: { currentExperiment: string }) {
  const { data } = useExperiments();
  const experiments = data?.experiments ?? [];

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

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
    </aside>
  );
}
