/**
 * ResumeRunActions — run-detail Actions menu for resuming an interrupted run.
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
import { useEffect, useRef, useState } from 'react';

import { launchEvalRun } from '~/lib/api';
import type { EvalResult } from '~/lib/types';

import {
  type ResumeMode,
  buildResumeActionMenuItems,
  buildResumeRequestBody,
  shouldShowResumeActions,
} from './resume-run-helpers';
import type { RunStatus } from './stop-run-helpers';

export interface ResumeRunActionsProps {
  results: EvalResult[];
  runDir?: string;
  suiteFilter?: string;
  target?: string;
  projectId?: string;
  isReadOnly: boolean;
  plannedTestCount?: number;
  runStatus?: RunStatus;
}

export function ResumeRunActions({
  results,
  runDir,
  suiteFilter,
  target,
  projectId,
  isReadOnly,
  plannedTestCount,
  runStatus,
}: ResumeRunActionsProps) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<ResumeMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const showActions = shouldShowResumeActions(results, isReadOnly, plannedTestCount, runStatus);

  // Both actions need the run dir + the original eval file. Without those
  // we can't target the existing run workspace, so we render the buttons
  // disabled with an explanatory title rather than hiding them — that way
  // users can still see the affordance and understand why it's unavailable.
  const ready = !!runDir && !!suiteFilter;
  const disabledReason = !runDir
    ? 'Run directory unavailable (remote run cannot be resumed in place)'
    : !suiteFilter
      ? 'Original eval file path missing from summary.json — cannot determine what to resume'
      : '';
  const menuItems = buildResumeActionMenuItems({ ready, busy, disabledReason });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!showActions) return null;

  async function launch(mode: ResumeMode) {
    if (!ready || !runDir || !suiteFilter) return;
    setOpen(false);
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
    <div className="flex flex-col items-end gap-1" ref={menuRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={busy !== null}
          aria-haspopup="menu"
          aria-expanded={open}
          className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-200 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="run-actions-menu-button"
        >
          {busy === 'resume' ? 'Resuming...' : busy === 'rerun' ? 'Re-running...' : 'Actions'}
        </button>
        {open && (
          <div
            className="absolute left-0 z-20 mt-2 w-48 overflow-hidden rounded-md border border-gray-700 bg-gray-950 py-1 text-sm shadow-xl shadow-black/30 sm:left-auto sm:right-0"
            role="menu"
            aria-label="Run actions"
          >
            {menuItems.map((item) => (
              <button
                key={item.mode}
                type="button"
                role="menuitem"
                onClick={() => void launch(item.mode)}
                disabled={item.disabled}
                title={item.title}
                className="block w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500"
                data-testid={item.testId}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
