/**
 * Category drill-down route: shows datasets filtered to a single category.
 *
 * Uses the `$runId_` trailing-underscore convention so that
 * `/runs/:runId/category/:category` is a sibling of `/runs/:runId`,
 * not a child route.
 */

import { Link, createFileRoute } from '@tanstack/react-router';

import { ScoreBar } from '~/components/ScoreBar';
import { StatsCards } from '~/components/StatsCards';
import { useCategoryDatasets } from '~/lib/api';

export const Route = createFileRoute('/runs/$runId_/category/$category')({
  component: CategoryPage,
});

function CategoryPage() {
  const { runId_, category } = Route.useParams();
  const { data, isLoading, error } = useCategoryDatasets(runId_, category);

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

  const datasets = data?.datasets ?? [];
  const total = datasets.reduce((s, d) => s + d.total, 0);
  const passed = datasets.reduce((s, d) => s + d.passed, 0);
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{category}</h1>
        <p className="mt-1 text-sm text-gray-400">Category in run: {runId_}</p>
      </div>

      <StatsCards total={total} passed={passed} failed={failed} passRate={passRate} />

      {datasets.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No datasets in this category</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Datasets</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {datasets.map((ds) => (
              <Link
                key={ds.name}
                to="/runs/$runId/dataset/$dataset"
                params={{ runId: runId_, dataset: ds.name }}
                className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-left transition-colors hover:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-200 truncate">{ds.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {ds.passed}/{ds.total}
                  </span>
                </div>
                <div className="mt-2">
                  <ScoreBar score={ds.avg_score} />
                </div>
                <div className="mt-1 flex gap-3 text-xs">
                  <span className="text-emerald-400">{ds.passed} passed</span>
                  {ds.failed > 0 && <span className="text-red-400">{ds.failed} failed</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
