import type { RunMeta } from './types';

const REMOTE_RUN_PREFIX = 'remote::';

function canonicalRunId(filename: string): string {
  return filename.startsWith(REMOTE_RUN_PREFIX)
    ? filename.slice(REMOTE_RUN_PREFIX.length)
    : filename;
}

export function dedupeSyncedRuns(runs: readonly RunMeta[]): RunMeta[] {
  const byRunId = new Map<string, RunMeta>();

  for (const run of runs) {
    const key = canonicalRunId(run.filename);
    const existing = byRunId.get(key);
    if (!existing || (existing.source === 'remote' && run.source === 'local')) {
      byRunId.set(key, run);
    }
  }

  return [...byRunId.values()];
}
