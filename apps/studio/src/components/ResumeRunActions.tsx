/**
 * ResumeRunActions — header buttons for resuming an interrupted run.
 *
 * Surfaces the existing CLI resume mechanics (`--resume`, `--rerun-failed`)
 * via the launch endpoint when the loaded run contains at least one result
 * with `executionStatus === 'execution_error'`. Hidden in read-only mode
 * (the server also returns 403, but UI-level hiding avoids dead controls).
 *
 * On click, POSTs to /api/eval/run with `{ resume | rerun_failed: true,
 * output: <runDir>, suite_filter, target }` and navigates to /jobs/:runId
 * to surface progress.
 *
 * To extend with another resume verb (e.g. surfacing --retry-errors as a
 * cross-run picker), add a third button calling `launch({ retryErrors:
 * <path> })`. The launch helper already passes whichever fields are set
 * straight through to the server, which forwards them to the CLI.
 */

import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { launchEvalRun } from '~/lib/api';
import type { EvalResult } from '~/lib/types';

import {
  type ResumeMode,
  buildResumeRequestBody,
  shouldShowResumeActions,
} from './resume-run-helpers';

export interface ResumeRunActionsProps {
  results: EvalResult[];
  runDir?: string;
  suiteFilter?: string;
  target?: string;
  projectId?: string;
  isReadOnly: boolean;
  plannedTestCount?: number;
}

export function ResumeRunActions({
  results,
  runDir,
  suiteFilter,
  target,
  projectId,
  isReadOnly,
  plannedTestCount,
}: ResumeRunActionsProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<ResumeMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!shouldShowResumeActions(results, isReadOnly, plannedTestCount)) return null;

  // Both actions need the run dir + the original eval file. Without those
  // we can't target the existing run workspace, so we render the buttons
  // disabled with an explanatory title rather than hiding them — that way
  // users can still see the affordance and understand why it's unavailable.
  const ready = !!runDir && !!suiteFilter;
  const disabledReason = !runDir
    ? 'Run directory unavailable (remote run cannot be resumed in place)'
    : !suiteFilter
      ? 'Original eval file path missing from benchmark.json — cannot determine what to resume'
      : '';

  async function launch(mode: ResumeMode) {
    if (!ready || !runDir || !suiteFilter) return;
    setBusy(mode);
    setError(null);
    try {
      const body = buildResumeRequestBody({ mode, runDir, suiteFilter, target });
      const response = await launchEvalRun(body, projectId);
      if (projectId) {
        navigate({
          to: '/projects/$projectId/jobs/$runId',
          params: { projectId, runId: response.id },
        });
      } else {
        navigate({ to: '/jobs/$runId', params: { runId: response.id } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch resume');
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => launch('resume')}
          disabled={!ready || busy !== null}
          title={!ready ? disabledReason : 'Skip already-completed tests, run the rest'}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="resume-run-button"
        >
          {busy === 'resume' ? 'Resuming…' : '↻ Resume run'}
        </button>
        <button
          type="button"
          onClick={() => launch('rerun')}
          disabled={!ready || busy !== null}
          title={!ready ? disabledReason : 'Re-run failed/errored tests, keep passing results'}
          className="rounded-md border border-amber-600/60 bg-transparent px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="rerun-failed-button"
        >
          {busy === 'rerun' ? 'Re-running…' : 'Rerun failed cases'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
