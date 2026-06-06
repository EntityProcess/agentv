/**
 * PublishRunAction — secondary local-run workflow for copying one completed
 * run into the configured remote results repo.
 *
 * Project-level Sync Project remains the primary remote workflow. This
 * component only appears for completed local runs, previews the destination
 * repo/path before publishing, and requires a separate two-step replace action
 * when a remote run with the same ID already exists.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { publishRunApi, useRunPublishPreview } from '~/lib/api';

type RunSource = 'local' | 'remote' | undefined;
type RunStatus = 'starting' | 'running' | 'finished' | 'failed' | undefined;

export interface PublishRunActionProps {
  runId: string;
  projectId?: string;
  source: RunSource;
  status: RunStatus;
  isReadOnly: boolean;
}

export function PublishRunAction({
  runId,
  projectId,
  source,
  status,
  isReadOnly,
}: PublishRunActionProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'publish' | 'replace' | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isActiveRun = status === 'starting' || status === 'running';
  const enabled = !isReadOnly && source === 'local' && !isActiveRun;
  const preview = useRunPublishPreview(runId, projectId, enabled);

  if (!enabled) return null;

  async function refreshQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['runs'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['remote-status'] }),
      queryClient.invalidateQueries({ queryKey: ['runs', runId, 'publish-preview'] }),
    ]);
  }

  async function publish(replace: boolean) {
    setBusy(replace ? 'replace' : 'publish');
    setError(null);
    setFeedback(null);
    try {
      const result = await publishRunApi(runId, { projectId, replace });
      setConfirmReplace(false);
      setFeedback(
        result.published
          ? replace
            ? 'Remote run replaced'
            : 'Run published'
          : 'Remote already matches this run',
      );
      await refreshQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish run');
    } finally {
      setBusy(null);
    }
  }

  const data = preview.data;
  const disabled = preview.isLoading || busy !== null || !!data?.block_reason;
  const title =
    data?.block_reason ??
    (data
      ? `${data.target_repo}: ${data.target_path}`
      : preview.error
        ? (preview.error as Error).message
        : 'Loading publish target');

  return (
    <div className="flex max-w-[28rem] flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {data?.remote_exists ? (
          confirmReplace ? (
            <>
              <button
                type="button"
                onClick={() => publish(true)}
                disabled={disabled}
                title={title}
                className="rounded-md border border-red-600/70 bg-red-950/40 px-3 py-1.5 text-sm font-medium text-red-200 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'replace' ? 'Replacing...' : 'Confirm replace'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReplace(false)}
                disabled={busy !== null}
                className="rounded-md border border-gray-700 bg-transparent px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
                setError(null);
                setConfirmReplace(true);
              }}
              disabled={disabled}
              title={title}
              className="rounded-md border border-amber-600/60 bg-transparent px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Replace published run
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => publish(false)}
            disabled={disabled || !data?.can_publish}
            title={title}
            className="rounded-md border border-cyan-600/60 bg-transparent px-3 py-1.5 text-sm font-medium text-cyan-300 hover:bg-cyan-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'publish' ? 'Publishing...' : 'Publish run'}
          </button>
        )}
      </div>
      {data ? (
        <p className="max-w-full truncate text-right text-xs text-gray-500" title={title}>
          {data.target_repo} / {data.target_path}
          {data.remote_exists ? ' - remote run exists' : ''}
        </p>
      ) : preview.isLoading ? (
        <p className="text-xs text-gray-500">Checking publish target...</p>
      ) : null}
      {data?.block_reason && (
        <p className="max-w-full text-right text-xs text-amber-300">{data.block_reason}</p>
      )}
      {feedback && <p className="text-xs text-emerald-400">{feedback}</p>}
      {(error || preview.error) && (
        <p className="max-w-full text-right text-xs text-red-400">
          {error ?? (preview.error as Error).message}
        </p>
      )}
    </div>
  );
}
