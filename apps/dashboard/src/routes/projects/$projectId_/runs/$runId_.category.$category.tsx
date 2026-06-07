/**
 * Project-scoped category drill-down route.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import { ScoreBar } from '~/components/ScoreBar';
import { StatsCards } from '~/components/StatsCards';
import { projectCategorySuitesOptions } from '~/lib/api';
import { executionErrorCount, qualityTotal } from '~/lib/result-summary';

export const Route = createFileRoute('/projects/$projectId_/runs/$runId_/category/$category')({
  component: ProjectCategoryPage,
});

function ProjectCategoryPage() {
  const { projectId, runId, category } = Route.useParams();
  const { data, isLoading, error } = useQuery(
    projectCategorySuitesOptions(projectId, runId, category),
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-800" />
        <div className="grid grid-cols-5 gap-4">
          {['s1', 's2', 's3', 's4', 's5'].map((id) => (
            <div key={id} className="h-20 animate-pulse rounded-lg bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load category: {error.message}
      </div>
    );
  }

  const suites = data?.suites ?? [];
  const total = suites.reduce((sum, suite) => sum + suite.total, 0);
  const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
  const failed = suites.reduce((sum, suite) => sum + suite.failed, 0);
  const executionErrors = suites.reduce((sum, suite) => sum + executionErrorCount(suite), 0);
  const qualityCount = total - executionErrors;
  const passRate = qualityCount > 0 ? passed / qualityCount : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{category}</h1>
        <p className="mt-1 text-sm text-gray-400">Category in run: {runId}</p>
      </div>

      <StatsCards
        total={total}
        passed={passed}
        failed={failed}
        passRate={passRate}
        executionErrors={executionErrors}
      />

      {suites.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No suites in this category</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Suites</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {suites.map((suite) => (
              <Link
                key={suite.name}
                to="/projects/$projectId/runs/$runId/suite/$suite"
                params={{ projectId, runId, suite: suite.name }}
                className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-left transition-colors hover:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-gray-200">{suite.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {suite.passed}/{qualityTotal(suite)}
                  </span>
                </div>
                <div className="mt-2">
                  <ScoreBar score={suite.avg_score} />
                </div>
                <div className="mt-1 flex gap-3 text-xs">
                  <span className="text-emerald-400">{suite.passed} passed</span>
                  {suite.failed > 0 && <span className="text-red-400">{suite.failed} failed</span>}
                  {executionErrorCount(suite) > 0 && (
                    <span className="text-amber-400">
                      {executionErrorCount(suite)} execution errors
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
