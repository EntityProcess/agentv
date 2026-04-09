import type { RemoteStatusResponse } from '~/lib/types';

export type RunSourceFilter = 'all' | 'local' | 'remote';

interface RunSourceToolbarProps {
  filter: RunSourceFilter;
  onFilterChange: (filter: RunSourceFilter) => void;
  remoteStatus?: RemoteStatusResponse;
  syncInFlight?: boolean;
  onSync?: () => void;
}

function formatLastSynced(timestamp?: string): string {
  if (!timestamp) {
    return 'Never synced';
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Never synced';
  }

  return `Last synced ${parsed.toLocaleString()}`;
}

export function RunSourceToolbar({
  filter,
  onFilterChange,
  remoteStatus,
  syncInFlight,
  onSync,
}: RunSourceToolbarProps) {
  const remoteConfigured = remoteStatus?.configured === true;
  const remoteUnavailable = remoteConfigured && remoteStatus?.available !== true;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'local', 'remote'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                filter === value
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {value === 'all' ? 'All Sources' : value === 'local' ? 'Local Only' : 'Remote Only'}
            </button>
          ))}
        </div>

        {remoteConfigured && onSync ? (
          <button
            type="button"
            onClick={onSync}
            disabled={syncInFlight}
            className="rounded-md border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncInFlight ? 'Syncing…' : 'Sync Remote Results'}
          </button>
        ) : null}
      </div>

      {remoteConfigured ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <span>{formatLastSynced(remoteStatus?.last_synced_at)}</span>
          {remoteStatus?.repo ? <span>Repo: {remoteStatus.repo}</span> : null}
          {remoteUnavailable ? (
            <span className="text-yellow-400">Remote cache unavailable</span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Remote results are not configured. Showing local runs only.
        </p>
      )}

      {remoteStatus?.last_error ? (
        <div className="rounded-md border border-yellow-900/50 bg-yellow-950/20 px-3 py-2 text-sm text-yellow-300">
          {remoteStatus.last_error}
        </div>
      ) : null}
    </div>
  );
}
