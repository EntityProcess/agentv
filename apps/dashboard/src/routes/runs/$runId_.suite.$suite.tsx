/**
 * Suite drill-down route: shows evals filtered to a single suite.
 *
 * Uses the `$runId_` trailing-underscore convention so that
 * `/runs/:runId/suite/:suite` is a sibling of `/runs/:runId`,
 * not a child route.
 */

import { createFileRoute } from '@tanstack/react-router';

import { ResultTable } from '~/components/ResultTable';
import { StatsCards } from '~/components/StatsCards';
import { useRunDetail, useStudioConfig } from '~/lib/api';
import { summarizeQuality } from '~/lib/result-summary';

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
  const summary = summarizeQuality(results, passThreshold);
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

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
        <ResultTable
          results={results}
          runId={runId}
          passThreshold={passThreshold}
          title="Suite Evals"
        />
      )}
    </div>
  );
}
