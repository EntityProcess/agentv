/**
 * Run detail route: shows per-eval breakdown with score bars.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { ResumeRunActions } from '~/components/ResumeRunActions';
import { RunDetail } from '~/components/RunDetail';
import { RunEvalModal } from '~/components/RunEvalModal';
import { RunStatusIndicator } from '~/components/RunStatusIndicator';
import { StopRunButton } from '~/components/StopRunButton';
import { useRemoteStatus, useRunDetail, useStudioConfig } from '~/lib/api';
import { buildRunDetailHeader } from '~/lib/run-detail-context';

export const Route = createFileRoute('/runs/$runId')({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { data, isLoading, error } = useRunDetail(runId);
  const { data: config } = useStudioConfig();
  const { data: remoteStatus } = useRemoteStatus();
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

  const prefill = target ? { target } : undefined;
  const runStatus = data?.status;
  const isActiveRun = runStatus === 'starting' || runStatus === 'running';

  const header = buildRunDetailHeader({
    runId,
    results: data?.results ?? [],
    source: data?.source,
    sourceLabel: data?.source_label,
    remoteRepo: data?.source === 'remote' ? remoteStatus?.repo : undefined,
    formatTimestamp: (value) => new Date(value).toLocaleString(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">{header.heading}</h1>
            {header.sourceBadge ? (
              <span className="rounded-md border border-cyan-900/60 bg-cyan-950/20 px-2 py-0.5 text-xs font-medium text-cyan-300">
                {header.sourceBadge}
              </span>
            ) : null}
          </div>
          {header.meta ? <p className="mt-1 text-sm text-gray-500">{header.meta}</p> : null}
          {header.sourceContext.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              {header.sourceContext.map((item) => (
                <span key={`${item.label}:${item.value}`}>
                  <span className="text-gray-600">{item.label}:</span> {item.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {!isReadOnly && isActiveRun ? (
            <StopRunButton runId={runId} status={runStatus} isReadOnly={isReadOnly} />
          ) : (
            <ResumeRunActions
              results={data?.results ?? []}
              runDir={data?.run_dir}
              suiteFilter={data?.suite_filter}
              target={target ?? undefined}
              isReadOnly={isReadOnly}
              plannedTestCount={data?.planned_test_count}
              runStatus={runStatus}
            />
          )}
          {runStatus && <RunStatusIndicator status={runStatus} />}
          {!isReadOnly && !isActiveRun && (
            <button
              type="button"
              onClick={() => setShowRunEval(true)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              ▶ Run evals
            </button>
          )}
        </div>
      </div>
      <RunDetail results={data?.results ?? []} runId={runId} />
      {!isReadOnly && (
        <RunEvalModal open={showRunEval} onClose={() => setShowRunEval(false)} prefill={prefill} />
      )}
    </div>
  );
}
