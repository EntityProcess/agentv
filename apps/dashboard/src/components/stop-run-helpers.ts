/**
 * Pure helpers backing StopRunButton, isolated for unit testing.
 *
 * Intentionally side-effect-free so the visibility matrix is testable
 * without rendering React.
 *
 * To extend: extend the union of statuses recognized as non-terminal as
 * the server adds new lifecycle states. Today the server only emits
 * starting / running / finished / failed; anything not in the terminal
 * set is treated as live.
 */

export type RunStatus = 'starting' | 'running' | 'finished' | 'failed' | (string & {});

export function isTerminalRunStatus(status: RunStatus | undefined): boolean {
  return status === 'finished' || status === 'failed';
}

/**
 * Whether the Stop button should be visible. Hidden when the run is
 * terminal (no process to kill) and in read-only mode (the API also
 * 403s, but UI-level hiding avoids dead controls).
 */
export function shouldShowStopButton(status: RunStatus | undefined, isReadOnly: boolean): boolean {
  if (isReadOnly) return false;
  if (!status) return false;
  return !isTerminalRunStatus(status);
}
