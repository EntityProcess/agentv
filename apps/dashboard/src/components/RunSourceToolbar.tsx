import {
  buildRemoteErrorAction,
  buildRemoteStatusItems,
  getProjectSyncView,
} from '~/lib/project-sync-status';
import type { RemoteStatusResponse } from '~/lib/types';

interface RunSourceToolbarProps {
  remoteStatus?: RemoteStatusResponse;
  syncInFlight?: boolean;
  onSync?: () => void;
  projectName?: string;
  syncFeedback?: { kind: 'success' | 'warning' | 'error'; message: string } | null;
  /** Pre-formatted "N of M runs on remote (branch)" summary derived from the listed runs. */
  onRemoteSummary?: string;
}

export function RunSourceToolbar({
  remoteStatus,
  syncInFlight,
  onSync,
  projectName,
  syncFeedback,
  onRemoteSummary,
}: RunSourceToolbarProps) {
  const remoteConfigured = remoteStatus?.configured === true;
  const syncView = getProjectSyncView(remoteStatus, syncInFlight);
  const syncDisabled = syncInFlight === true || !syncView.canSync;
  const statusToneClass = {
    neutral: 'border-gray-700 bg-gray-800/70 text-gray-300',
    good: 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300',
    info: 'border-cyan-800/70 bg-cyan-950/30 text-cyan-300',
    warn: 'border-yellow-800/70 bg-yellow-950/30 text-yellow-300',
    danger: 'border-red-800/70 bg-red-950/30 text-red-300',
  }[syncView.tone];
  const feedbackClass =
    syncFeedback?.kind === 'success'
      ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
      : syncFeedback?.kind === 'warning'
        ? 'border-yellow-900/60 bg-yellow-950/20 text-yellow-300'
        : 'border-red-900/60 bg-red-950/20 text-red-300';
  const dirtyPathCount = remoteStatus?.dirty_paths?.length ?? 0;
  const conflictedPathCount = remoteStatus?.conflicted_paths?.length ?? 0;
  const remoteStatusItems = buildRemoteStatusItems(remoteStatus, projectName, onRemoteSummary);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200">Recent Runs</p>
          {remoteConfigured && onRemoteSummary ? (
            <p className="mt-0.5 text-xs text-gray-500">{onRemoteSummary}</p>
          ) : null}
        </div>

        {remoteConfigured ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusToneClass}`}
            >
              {syncView.label}
            </span>
            {onSync ? (
              <button
                type="button"
                onClick={onSync}
                disabled={syncDisabled}
                title={!syncView.canSync ? syncView.nextAction : undefined}
                className="rounded-md border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncInFlight ? 'Syncing...' : syncView.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {remoteConfigured ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-400">
            {remoteStatusItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <p className={syncView.tone === 'danger' ? 'text-red-300' : 'text-gray-400'}>
            {syncView.summary}
          </p>
          {syncView.nextAction ? (
            <p className="text-xs text-gray-500">{syncView.nextAction}</p>
          ) : null}
          {dirtyPathCount > 0 || conflictedPathCount > 0 ? (
            <div className="flex flex-wrap gap-2 text-xs">
              {dirtyPathCount > 0 ? (
                <span className="rounded-md border border-yellow-900/60 bg-yellow-950/20 px-2 py-0.5 text-yellow-300">
                  {dirtyPathCount} dirty path{dirtyPathCount === 1 ? '' : 's'}
                </span>
              ) : null}
              {conflictedPathCount > 0 ? (
                <span className="rounded-md border border-red-900/60 bg-red-950/20 px-2 py-0.5 text-red-300">
                  {conflictedPathCount} conflicted path{conflictedPathCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Remote results are not configured. Add{' '}
          <code className="rounded bg-gray-800 px-1 text-gray-400">results</code> to{' '}
          <code className="rounded bg-gray-800 px-1 text-gray-400">.agentv/config.yaml</code> to
          enable.
        </p>
      )}

      {syncFeedback ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${feedbackClass}`}
          role={syncFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {syncFeedback.message}
        </div>
      ) : null}

      {remoteStatus?.last_error ? (
        <div
          className="rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          <p className="font-medium">Remote sync error</p>
          <p>{remoteStatus.last_error}</p>
          <p className="mt-1 text-xs text-red-200/80">{buildRemoteErrorAction(remoteStatus)}</p>
        </div>
      ) : null}

      {remoteStatus?.git_diff_summary && syncView.state !== 'clean' ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-500">
          {remoteStatus.git_diff_summary}
        </pre>
      ) : null}
    </div>
  );
}
