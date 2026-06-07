import type { RunMeta } from './types';

type SelectableRun = Pick<RunMeta, 'source' | 'status'>;

export function runSelectionDisabledReason(run: SelectableRun): string | undefined {
  if (run.source === 'remote') {
    return 'Remote runs cannot be combined or deleted from the local workspace.';
  }
  if (run.status === 'starting' || run.status === 'running') {
    return 'Running runs cannot be combined or deleted yet.';
  }
  return undefined;
}

export function formatSelectedRunCount(count: number): string {
  return `${count} local run${count === 1 ? '' : 's'} selected`;
}

export function buildCombineSuccessMessage(sourceCount: number, displayName: string): string {
  return `Combined ${sourceCount} local run${sourceCount === 1 ? '' : 's'} into ${displayName}.`;
}

export function buildDeleteSuccessMessage(count: number): string {
  return `Deleted ${count} local run${count === 1 ? '' : 's'}.`;
}
