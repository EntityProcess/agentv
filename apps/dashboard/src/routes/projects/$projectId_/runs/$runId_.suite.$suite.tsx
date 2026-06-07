/**
 * Project-scoped suite drill-down route.
 */

import { Link, createFileRoute } from '@tanstack/react-router';

import { PassRatePill } from '~/components/PassRatePill';
import { StatsCards } from '~/components/StatsCards';
import { useProjectRunDetail, useStudioConfig } from '~/lib/api';
import { isExecutionError, summarizeQuality } from '~/lib/result-summary';

export const Route = createFileRoute('/projects/$projectId_/runs/$runId_/suite/$suite')({
  component: ProjectSuitePage,
});

function ProjectSuitePage() {
  const { projectId, runId, suite } = Route.useParams();
  const { data, isLoading, error } = useProjectRunDetail(projectId, runId);
  const { data: config } = useStudioConfig(projectId);
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

  const results = (data?.results ?? []).filter(
    (result) => (result.suite ?? 'Uncategorized') === suite,
  );
  const total = results.length;
  const summary = summarizeQuality(results, passThreshold);
  const totalCost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{suite}</h1>
        <p className="mt-1 text-sm text-gray-400">Suite in run: {runId}</p>
      </div>

      <StatsCards
        total={total}
        passed={summary.passed}
        failed={summary.failed}
        passRate={summary.passRate}
        executionErrors={summary.executionErrors}
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
                <th className="w-48 px-4 py-3 font-medium text-gray-400">Quality Score</th>
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
                      to="/projects/$projectId/evals/$runId/$evalId"
                      params={{ projectId, runId, evalId: result.testId }}
                      className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                    >
                      {result.testId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{result.target ?? '-'}</td>
                  <td className="px-4 py-3">
                    {isExecutionError(result) ? (
                      <span className="inline-flex rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300">
                        Execution error
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
