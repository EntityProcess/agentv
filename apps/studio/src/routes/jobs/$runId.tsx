/**
 * Job detail route: shows live stdout/stderr for a Studio-launched eval run.
 *
 * Accessible via /jobs/:runId. Polls /api/eval/status/:id until the run
 * reaches a terminal state (finished or failed), then stops polling.
 *
 * Entry point: "View Log →" button in the Active Runs section on the home page.
 */

import { Link, createFileRoute } from '@tanstack/react-router';

import { useEvalRunStatus } from '~/lib/api';

export const Route = createFileRoute('/jobs/$runId')({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { runId } = Route.useParams();
  const { data: status, isLoading, error } = useEvalRunStatus(runId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-64 animate-pulse rounded-lg bg-gray-900" />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
          {error ? `Failed to load run: ${error.message}` : 'Run not found.'}
        </div>
      </div>
    );
  }

  const isTerminal = status.status === 'finished' || status.status === 'failed';

  const statusColors: Record<string, string> = {
    starting: 'text-yellow-400',
    running: 'text-cyan-400',
    finished: 'text-emerald-400',
    failed: 'text-red-400',
  };

  const statusColor = statusColors[status.status] ?? 'text-gray-400';

  return (
    <div className="space-y-4">
      <BackLink />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{runId}</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Started {new Date(status.started_at).toLocaleString()}
            {status.finished_at && (
              <>
                {' · '}Finished {new Date(status.finished_at).toLocaleString()}
                {' · '}
                {Math.round(
                  (new Date(status.finished_at).getTime() - new Date(status.started_at).getTime()) /
                    1000,
                )}
                s
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${statusColor}`}>
            {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
          </span>
          {!isTerminal && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          )}
        </div>
      </div>

      {/* Command */}
      <div className="rounded-md border border-gray-700 bg-gray-950 px-4 py-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">Command</p>
        <code className="break-all text-xs text-cyan-300">{status.command}</code>
      </div>

      {/* Stdout */}
      {status.stdout ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">Output</p>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
            <pre className="whitespace-pre-wrap font-mono text-xs text-gray-200">
              {status.stdout}
            </pre>
          </div>
        </div>
      ) : (
        !isTerminal && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            Waiting for output…
          </div>
        )
      )}

      {/* Stderr */}
      {status.stderr && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-red-500">Stderr</p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-red-900/40 bg-red-950/20 p-4">
            <pre className="whitespace-pre-wrap font-mono text-xs text-red-300">
              {status.stderr}
            </pre>
          </div>
        </div>
      )}

      {/* Exit code */}
      {isTerminal && (
        <p className="text-xs text-gray-500">
          Exit code:{' '}
          <span className={status.exit_code === 0 ? 'text-emerald-400' : 'text-red-400'}>
            {status.exit_code}
          </span>
        </p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      search={{ tab: 'runs' } as Record<string, string>}
      className="text-xs text-gray-400 hover:text-cyan-400"
    >
      ← Back to Runs
    </Link>
  );
}
