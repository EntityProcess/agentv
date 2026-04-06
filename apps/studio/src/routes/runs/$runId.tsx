/**
 * Run detail route: shows per-eval breakdown with score bars.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { RunDetail } from '~/components/RunDetail';
import { RunEvalModal } from '~/components/RunEvalModal';
import { useRunDetail } from '~/lib/api';

export const Route = createFileRoute('/runs/$runId')({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { data, isLoading, error } = useRunDetail(runId);
  const [showRunEval, setShowRunEval] = useState(false);

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

  // Derive prefill from run data
  const firstResult = data?.results?.[0];
  const prefill = firstResult?.target ? { target: firstResult.target } : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Run: {runId}</h1>
          <p className="mt-1 text-sm text-gray-400">Source: {data?.source}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowRunEval(true)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          ▶ Re-run with Filters
        </button>
      </div>
      <RunDetail results={data?.results ?? []} runId={runId} />
      <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} prefill={prefill} />
    </div>
  );
}
