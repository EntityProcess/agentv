/**
 * Context-aware sidebar navigation.
 *
 * Adapts its content based on the current route:
 * - At root or run detail: shows list of runs
 * - At eval detail: shows list of evals in the current run with pass/fail indicators
 * - At category detail: shows evals filtered to that category
 * - At experiment detail: shows list of experiments
 */

import { Link, useMatchRoute } from '@tanstack/react-router';

import { useExperiments, useRunDetail, useRunList } from '~/lib/api';

export function Sidebar() {
  const matchRoute = useMatchRoute();
  const evalMatch = matchRoute({ to: '/evals/$runId/$evalId', fuzzy: true });
  const categoryMatch = matchRoute({
    to: '/runs/$runId/category/$category',
    fuzzy: true,
  });
  const experimentMatch = matchRoute({
    to: '/experiments/$experimentName',
    fuzzy: true,
  });

  // If on a category detail page, show evals filtered to that category
  if (categoryMatch && typeof categoryMatch === 'object' && 'runId' in categoryMatch) {
    const { runId, category } = categoryMatch as { runId: string; category: string };
    return <CategorySidebar runId={runId} category={category} />;
  }

  // If on an eval detail page, show the eval sidebar
  if (evalMatch && typeof evalMatch === 'object' && 'runId' in evalMatch) {
    const { runId, evalId } = evalMatch as { runId: string; evalId: string };
    return <EvalSidebar runId={runId} currentEvalId={evalId} />;
  }

  // If on an experiment detail page, show the experiment list
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
  const { data } = useRunList();

  const isHome = matchRoute({ to: '/' });
  const runMatch = matchRoute({ to: '/runs/$runId', fuzzy: true });

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
    </aside>
  );
}

function EvalSidebar({ runId, currentEvalId }: { runId: string; currentEvalId: string }) {
  const { data } = useRunDetail(runId);

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
          const passed = result.score >= 1;

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

function CategorySidebar({ runId, category }: { runId: string; category: string }) {
  const { data } = useRunDetail(runId);
  const categoryResults = (data?.results ?? []).filter(
    (r) => (r.eval_set ?? 'Uncategorized') === category,
  );

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
        <p className="truncate text-xs text-gray-500">{category}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Evaluations
        </div>

        {categoryResults.map((result) => {
          const passed = result.score >= 1;

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
