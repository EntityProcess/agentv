/**
 * Suite drill-down route: shows evals filtered to a single suite.
 *
 * Uses the `$runId_` trailing-underscore convention so that
 * `/runs/:runId/suite/:suite` is a sibling of `/runs/:runId`,
 * not a child route.
 */

import { Link, createFileRoute } from '@tanstack/react-router';

import { PassRatePill } from '~/components/PassRatePill';
import { StatsCards } from '~/components/StatsCards';
import { isPassing, useRunDetail, useStudioConfig } from '~/lib/api';

export const Route = createFileRoute('/runs/$runId_/suite/$suite')({
  component: SuitePage,
});

function SuitePage() {
  const { runId, suite } = Route.useParams();
  const { data, isLoading, error } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

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
        Failed to load run: {error.message}
      </div>
    );
  }

  const results = (data?.results ?? []).filter((r) => (r.suite ?? 'Uncategorized') === suite);
  const total = results.length;
  const passed = results.filter((r) => isPassing(r.score, passThreshold)).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{suite}</h1>
        <p className="mt-1 text-sm text-gray-400">Suite in run: {runId}</p>
      </div>

      <StatsCards
        total={total}
        passed={passed}
        failed={failed}
        passRate={passRate}
        totalCost={totalCost > 0 ? totalCost : undefined}
      />

      {total === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No evaluations in this suite</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-400">Test ID</th>
                <th className="px-4 py-3 font-medium text-gray-400">Target</th>
                <th className="w-48 px-4 py-3 font-medium text-gray-400">Score</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Duration</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {results.map((result, idx) => (
                <tr
                  key={`${result.testId}-${idx}`}
                  className="transition-colors hover:bg-gray-900/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/evals/$runId/$evalId"
                      params={{ runId, evalId: result.testId }}
                      className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                    >
                      {result.testId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{result.target ?? '-'}</td>
                  <td className="px-4 py-3">
                    {result.executionStatus === 'execution_error' ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-900/50 text-red-400">
                        ERR
                      </span>
                    ) : (
                      <PassRatePill rate={result.score} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : '-'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
