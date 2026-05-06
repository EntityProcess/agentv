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

export type ResumeMode = 'resume' | 'rerun';

export interface BuildResumeRequestParams {
  mode: ResumeMode;
  runDir: string;
  suiteFilter: string;
  target?: string;
}

/**
 * Whether the resume actions should be visible. The button only makes sense
 * when at least one row failed with an execution error and the user has
 * write access (read-only mode hides the entire control rather than
 * showing a disabled button — see issue acceptance criteria).
 */
export function shouldShowResumeActions(results: EvalResult[], isReadOnly: boolean): boolean {
  if (isReadOnly) return false;
  return results.some((r) => r.executionStatus === 'execution_error');
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
