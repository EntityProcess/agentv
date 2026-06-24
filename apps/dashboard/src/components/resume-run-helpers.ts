/**
 * Pure helpers backing ResumeRunActions, isolated for unit testing.
 *
 * These are intentionally side-effect-free: visibility logic and request-body
 * shaping live here so tests can pin the API contract without rendering React.
 *
 * To extend: add another `mode` to `ResumeMode` and handle it inside
 * `buildResumeRequestBody` — the server already accepts the union of resume,
 * rerun_failed, and retry_errors per the launch endpoint contract.
 */

import type { EvalResult, RunEvalRequest } from '~/lib/types';

import { type RunStatus, isTerminalRunStatus } from './stop-run-helpers';

export type ResumeMode = 'resume' | 'rerun';

export interface BuildResumeRequestParams {
  mode: ResumeMode;
  runDir: string;
  suiteFilter: string;
  target?: string;
}

/**
 * Whether the resume actions should be visible. The button is shown when:
 *   1. At least one recorded row has `execution_status: execution_error`, OR
 *   2. The run is *incomplete* — fewer recorded rows than the originally
 *      planned execution count, even if every recorded row is `ok`.
 *
 * Case 2 covers Stop-button / Ctrl+C interruptions where the run produced
 * only successful rows before being killed: there is no `execution_error`
 * to anchor on, but the run is still resumable. `plannedTestCount` is
 * persisted in `summary.json.metadata` at run start (see
 * `writeInitialRunSummaryArtifact`).
 *
 * Hidden in read-only mode — the server also returns 403, but UI-level
 * hiding avoids dead controls.
 */
export function shouldShowResumeActions(
  results: EvalResult[],
  isReadOnly: boolean,
  plannedTestCount?: number,
  runStatus?: RunStatus,
): boolean {
  if (isReadOnly) return false;
  if (runStatus && !isTerminalRunStatus(runStatus)) return false;
  if (results.some((r) => r.executionStatus === 'execution_error')) return true;
  if (plannedTestCount !== undefined && results.length < plannedTestCount) return true;
  return false;
}

/**
 * Build the POST /api/eval/run body for a resume / rerun-failed launch.
 * Matches the wire-format contract: snake_case, with `output` pointing at
 * the existing run dir so the CLI appends to that workspace.
 */
export function buildResumeRequestBody(params: BuildResumeRequestParams): RunEvalRequest {
  const body: RunEvalRequest = {
    suite_filter: params.suiteFilter,
    output: params.runDir,
  };
  if (params.target) body.target = params.target;
  if (params.mode === 'resume') {
    body.resume = true;
  } else {
    body.rerun_failed = true;
  }
  return body;
}
