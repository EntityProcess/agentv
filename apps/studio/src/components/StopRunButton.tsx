/**
 * StopRunButton — stop affordance on /jobs/:runId and active run detail
 * views that interrupts a Studio-launched eval. Stop is part of the
 * stop → resume → complete workflow, not a destructive cancel: the
 * partial index.jsonl is preserved and can be resumed in one click from
 * the run-detail page.
 *
 * Calls POST /api/eval/run/:id/stop (or the project-scoped variant).
 * Optimistically flips the local label to "Stopping…" until the next
 * poll of /api/eval/status/:id observes a terminal state — at which
 * point the button hides via `shouldShowStopButton`.
 *
 * Styling is intentionally neutral (gray, not red) to signal that this
 * stops execution without deleting the partial run workspace.
 */

import { useState } from 'react';

import { stopEvalRun } from '~/lib/api';

import { type RunStatus, shouldShowStopButton } from './stop-run-helpers';

export interface StopRunButtonProps {
  runId: string;
  status: RunStatus | undefined;
  isReadOnly: boolean;
  projectId?: string;
}

export function StopRunButton({ runId, status, isReadOnly, projectId }: StopRunButtonProps) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shouldShowStopButton(status, isReadOnly)) return null;

  async function onClick() {
    setStopping(true);
    setError(null);
    try {
      await stopEvalRun(runId, projectId);
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
        className="inline-flex items-center gap-2 rounded-md border border-gray-700 bg-transparent px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="stop-run-button"
      >
        {stopping ? (
          'Stopping…'
        ) : (
          <>
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[1px] bg-current"
            />
            Stop
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
