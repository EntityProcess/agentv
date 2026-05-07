/**
 * StopRunButton — destructive button on /jobs/:runId that terminates a
 * Studio-launched eval.
 *
 * Calls DELETE /api/eval/run/:id (or the benchmark-scoped variant).
 * Optimistically flips the local label to "Stopping…" until the next
 * poll of /api/eval/status/:id observes a terminal state — at which
 * point the button hides via `shouldShowStopButton`.
 *
 * To extend with a "Force kill" affordance: thread a second handler
 * through that POSTs DELETE again (the CLI's signal handler interprets
 * a second SIGTERM within the same process as hard-exit) and surfaces a
 * confirmation prompt.
 */

import { useState } from 'react';

import { stopEvalRun } from '~/lib/api';

import { type RunStatus, shouldShowStopButton } from './stop-run-helpers';

export interface StopRunButtonProps {
  runId: string;
  status: RunStatus | undefined;
  isReadOnly: boolean;
  benchmarkId?: string;
}

export function StopRunButton({ runId, status, isReadOnly, benchmarkId }: StopRunButtonProps) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shouldShowStopButton(status, isReadOnly)) return null;

  async function onClick() {
    setStopping(true);
    setError(null);
    try {
      await stopEvalRun(runId, benchmarkId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop run');
      setStopping(false);
    }
    // On success, leave `stopping=true`. The status poller will flip to
    // a terminal state shortly, at which point the button unmounts.
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={stopping}
        className="rounded-md border border-red-700/70 bg-transparent px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="stop-run-button"
      >
        {stopping ? 'Stopping…' : '■ Stop run'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
