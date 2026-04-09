/**
 * Project-scoped eval detail route.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { EvalDetail } from '~/components/EvalDetail';
import { RunEvalModal } from '~/components/RunEvalModal';
import { useBenchmarkRunDetail, useStudioConfig } from '~/lib/api';

export const Route = createFileRoute('/projects/$benchmarkId_/evals/$runId/$evalId')({
  component: ProjectEvalDetailPage,
});

function ProjectEvalDetailPage() {
  const { benchmarkId, runId, evalId } = Route.useParams();
  const { data, isLoading, error } = useBenchmarkRunDetail(benchmarkId, runId);
  const { data: config } = useStudioConfig();
  const [showRunEval, setShowRunEval] = useState(false);
  const isReadOnly = config?.read_only === true;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-800" />
        <div className="h-48 animate-pulse rounded-lg bg-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load eval: {error.message}
      </div>
    );
  }

  const result = data?.results.find((r) => r.testId === evalId);

  if (!result) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center">
        <p className="text-gray-400">
          Eval <code className="text-cyan-400">{evalId}</code> not found in run{' '}
          <code className="text-cyan-400">{runId}</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">
            Run: {runId} / Eval: {evalId}
          </p>
          <h1 className="text-2xl font-semibold text-white">{evalId}</h1>
        </div>
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => setShowRunEval(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ▶ Run this Test
          </button>
        )}
      </div>
      <EvalDetail eval={result} runId={runId} benchmarkId={benchmarkId} />
      {!isReadOnly && (
        <RunEvalModal
          open={showRunEval}
          onClose={() => setShowRunEval(false)}
          benchmarkId={benchmarkId}
          prefill={{
            testIds: [evalId],
            target: result.target,
          }}
        />
      )}
    </div>
  );
}
