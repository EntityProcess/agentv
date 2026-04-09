/**
 * Project-scoped run detail route.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { RunDetail } from '~/components/RunDetail';
import { RunEvalModal } from '~/components/RunEvalModal';
import { useBenchmarkRunDetail, useStudioConfig } from '~/lib/api';

export const Route = createFileRoute('/projects/$benchmarkId_/runs/$runId')({
  component: ProjectRunDetailPage,
});

function ProjectRunDetailPage() {
  const { benchmarkId, runId } = Route.useParams();
  const { data, isLoading, error } = useBenchmarkRunDetail(benchmarkId, runId);
  const { data: config } = useStudioConfig();
  const [showRunEval, setShowRunEval] = useState(false);
  const isReadOnly = config?.read_only === true;

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

  const firstResult = data?.results?.[0];
  const target = firstResult?.target;
  const experiment = firstResult?.experiment;
  const timestamp = firstResult?.timestamp;
  const prefill = target ? { target } : undefined;

  const heading = (() => {
    const parts = [experiment, target].filter((p) => p && p !== 'default');
    return parts.length > 0 ? parts.join(' · ') : runId;
  })();

  const meta = [
    target,
    experiment && experiment !== 'default' ? experiment : null,
    timestamp ? new Date(timestamp).toLocaleString() : null,
    data?.source,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{heading}</h1>
          <p className="mt-1 text-sm text-gray-500">{meta}</p>
        </div>
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => setShowRunEval(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ▶ Re-run with Filters
          </button>
        )}
      </div>
      <RunDetail results={data?.results ?? []} runId={runId} benchmarkId={benchmarkId} />
      {!isReadOnly && (
        <RunEvalModal
          open={showRunEval}
          onClose={() => setShowRunEval(false)}
          benchmarkId={benchmarkId}
          prefill={prefill}
        />
      )}
    </div>
  );
}
