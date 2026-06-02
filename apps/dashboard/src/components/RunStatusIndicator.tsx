/**
 * RunStatusIndicator — shared live/terminal status badge for Dashboard-launched
 * eval runs. Used anywhere the UI needs the same colored status label and
 * active spinner so run/job views stay visually consistent.
 */

import type { RunStatus } from './stop-run-helpers';

export interface RunStatusIndicatorProps {
  status: RunStatus;
}

export function RunStatusIndicator({ status }: RunStatusIndicatorProps) {
  const isTerminal = status === 'finished' || status === 'failed';
  const statusColors: Record<string, string> = {
    starting: 'text-yellow-400',
    running: 'text-cyan-400',
    finished: 'text-emerald-400',
    failed: 'text-red-400',
  };
  const statusColor = statusColors[status] ?? 'text-gray-400';

  return (
    <>
      <span className={`text-sm font-medium ${statusColor}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
      {!isTerminal && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      )}
    </>
  );
}
