/**
 * Context-aware sidebar navigation.
 *
 * Adapts its content based on the current route depth:
 * - At root: shows list of runs
 * - At run detail: shows eval list for that run
 * - At eval detail: shows evaluator breakdown
 */

import { Link, useMatchRoute } from '@tanstack/react-router';

import { useRunList } from '~/lib/api';

export function Sidebar() {
  const matchRoute = useMatchRoute();
  const { data } = useRunList();

  const isHome = matchRoute({ to: '/' });
  const runMatch = matchRoute({ to: '/runs/$runId', fuzzy: true });

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900/50">
      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Link to="/" className="text-lg font-semibold text-white hover:text-cyan-400">
          AgentV Studio
        </Link>
      </div>

      {/* Navigation */}
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
