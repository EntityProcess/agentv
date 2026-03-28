/**
 * Context-aware sidebar navigation.
 *
 * Adapts its content based on the current route:
 * - At root or run detail: shows list of runs
 * - At eval detail: shows list of evals in the current run with pass/fail indicators
 */

import { Link, useMatchRoute } from '@tanstack/react-router';

import { useRunDetail, useRunList } from '~/lib/api';

export function Sidebar() {
  const matchRoute = useMatchRoute();
  const evalMatch = matchRoute({ to: '/evals/$runId/$evalId', fuzzy: true });

  // If on an eval detail page, show the eval sidebar
  if (evalMatch && typeof evalMatch === 'object' && 'runId' in evalMatch) {
    const { runId, evalId } = evalMatch as { runId: string; evalId: string };
    return <EvalSidebar runId={runId} currentEvalId={evalId} />;
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
