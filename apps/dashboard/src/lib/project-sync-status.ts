import type { RemoteStatusResponse } from './types';

export type ProjectSyncState =
  | 'unconfigured'
  | 'clean'
  | 'unavailable'
  | 'behind'
  | 'ahead'
  | 'dirty'
  | 'conflicted'
  | 'syncing';

export type ProjectSyncTone = 'neutral' | 'good' | 'info' | 'warn' | 'danger';

export interface ProjectSyncView {
  state: ProjectSyncState;
  label: string;
  tone: ProjectSyncTone;
  summary: string;
  nextAction?: string;
  canSync: boolean;
}

function formatTimestamp(timestamp?: string): string | undefined {
  if (!timestamp) {
    return undefined;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleString();
}

export function formatLastSynced(timestamp?: string): string {
  const formatted = formatTimestamp(timestamp);
  return formatted ? `Last synced ${formatted}` : 'Never synced';
}

export function formatRemoteRunCount(count?: number): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return 'Remote runs unknown';
  }
  return `${count} remote run${count === 1 ? '' : 's'}`;
}

export function buildRemoteStatusItems(
  status: RemoteStatusResponse | undefined,
  projectName?: string,
): string[] {
  if (status?.configured !== true) {
    return [];
  }

  return [
    projectName ? `Project: ${projectName}` : undefined,
    formatRemoteRunCount(status.run_count),
    formatLastSynced(status.last_synced_at),
    status.repo ? `Repo: ${status.repo}` : undefined,
  ].filter((item): item is string => item !== undefined);
}

export function getProjectSyncView(
  status: RemoteStatusResponse | undefined,
  syncInFlight = false,
): ProjectSyncView {
  if (syncInFlight || status?.sync_status === 'syncing') {
    return {
      state: 'syncing',
      label: 'Syncing',
      tone: 'info',
      summary: 'Sync is in progress.',
      canSync: false,
    };
  }

  if (status?.configured !== true) {
    return {
      state: 'unconfigured',
      label: 'Not configured',
      tone: 'neutral',
      summary: 'Remote results are not configured for this project.',
      canSync: false,
    };
  }

  if (status.available !== true || status.sync_status === 'unavailable') {
    return {
      state: 'unavailable',
      label: 'Unavailable',
      tone: 'warn',
      summary: 'The remote results cache is not available locally.',
      nextAction: 'Sync Project can clone or refresh the configured results repo.',
      canSync: true,
    };
  }

  const state = status.sync_status ?? 'clean';
  if (state === 'conflicted' || state === 'diverged') {
    return {
      state: 'conflicted',
      label: state === 'diverged' ? 'Conflicted' : 'Conflicted',
      tone: 'danger',
      summary:
        status.block_reason ??
        (state === 'diverged'
          ? 'Local and remote results histories have diverged.'
          : 'The results repo has unresolved conflicts.'),
      nextAction: 'Resolve the results repo conflicts manually, then sync the project again.',
      canSync: false,
    };
  }

  if (state === 'dirty') {
    return {
      state: 'dirty',
      label: 'Dirty',
      tone: 'warn',
      summary: status.block_reason ?? 'Local result metadata has pending edits.',
      nextAction:
        status.auto_push === true
          ? 'Sync Project will commit safe result metadata changes before syncing.'
          : 'Review or commit the pending result metadata; no reset will be performed.',
      canSync: true,
    };
  }

  if (state === 'behind') {
    return {
      state: 'behind',
      label: 'Behind',
      tone: 'info',
      summary: `Remote has ${status.behind ?? 0} commit${status.behind === 1 ? '' : 's'} to pull.`,
      nextAction: 'Sync Project will fast-forward when possible.',
      canSync: true,
    };
  }

  if (state === 'ahead') {
    return {
      state: 'ahead',
      label: 'Ahead',
      tone: 'info',
      summary: `Local results are ${status.ahead ?? 0} commit${status.ahead === 1 ? '' : 's'} ahead.`,
      nextAction:
        status.auto_push === true
          ? 'Sync Project will push safe result changes.'
          : 'Enable auto_push or push the results repo manually.',
      canSync: true,
    };
  }

  return {
    state: 'clean',
    label: 'Clean',
    tone: 'good',
    summary: 'Local and remote result metadata are in sync.',
    canSync: true,
  };
}

function formatSyncOutcomeRuns(count?: number): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return 'remote results';
  }
  return formatRemoteRunCount(count);
}

function buildSyncOutcomeSentence(status: RemoteStatusResponse): string {
  const parts = [`Synced ${formatSyncOutcomeRuns(status.run_count)}`];
  if (status.repo) {
    parts.push(`from ${status.repo}`);
  }

  const syncedAt = formatTimestamp(status.last_synced_at);
  if (syncedAt) {
    parts.push(`at ${syncedAt}`);
  }

  return `${parts.join(' ')}.`;
}

function buildCachedRemoteAvailability(
  status: RemoteStatusResponse | undefined,
): string | undefined {
  if (status?.available !== true) {
    return undefined;
  }

  const runCount = status.run_count;
  if (typeof runCount === 'number' && Number.isFinite(runCount) && runCount > 0) {
    return `Cached ${formatRemoteRunCount(runCount)} ${
      runCount === 1 ? 'remains' : 'remain'
    } available.`;
  }

  return 'The remote results cache remains available.';
}

export function buildRemoteErrorAction(status: RemoteStatusResponse | undefined): string {
  return [
    buildCachedRemoteAvailability(status),
    'Resolve the results repo issue, then sync remote results again.',
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

export function buildProjectSyncFeedback(status: RemoteStatusResponse): {
  kind: 'success' | 'warning';
  message: string;
} {
  if (status.blocked || status.sync_status === 'conflicted' || status.sync_status === 'diverged') {
    const repo = status.repo ? ` for ${status.repo}` : '';
    const reason = status.block_reason ?? 'Sync stopped before changing the results repo.';
    return {
      kind: 'warning',
      message: `Sync stopped${repo}: ${reason}. ${buildRemoteErrorAction(status)}`,
    };
  }

  const actions = [
    status.commit_created ? 'committed pending metadata' : undefined,
    status.pull_performed ? 'pulled remote results' : undefined,
    status.push_performed ? 'pushed local results' : undefined,
  ].filter((action): action is string => action !== undefined);

  return {
    kind: 'success',
    message:
      actions.length > 0
        ? `${buildSyncOutcomeSentence(status)} Sync completed: ${actions.join(', ')}.`
        : `${buildSyncOutcomeSentence(status)} Project results were already up to date.`,
  };
}

export function buildProjectSyncErrorFeedback(
  error: unknown,
  status: RemoteStatusResponse | undefined,
): {
  kind: 'error';
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: 'error',
    message: `Sync failed: ${message}. ${buildRemoteErrorAction(status)}`,
  };
}
