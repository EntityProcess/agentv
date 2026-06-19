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
    if (!existing) {
      byRunId.set(key, run);
      continue;
    }
    // Keep the local copy (it is readable from disk) but preserve remote
    // presence so the per-run indicator and "on remote" count stay accurate
    // for runs that exist both locally and on the results branch.
    const preferred = existing.source === 'remote' && run.source === 'local' ? run : existing;
    byRunId.set(key, {
      ...preferred,
      on_remote: existing.on_remote === true || run.on_remote === true,
    });
  }

  return [...byRunId.values()];
}
