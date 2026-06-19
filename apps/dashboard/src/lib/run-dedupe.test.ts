import { describe, expect, it } from 'bun:test';

import { dedupeSyncedRuns } from './run-dedupe';
import type { RunMeta } from './types';

function run(filename: string, source: RunMeta['source'], onRemote = source === 'remote'): RunMeta {
  return {
    filename,
    display_name: filename,
    path: `/tmp/${filename}`,
    timestamp: '2026-05-28T08:21:09.063Z',
    test_count: 8,
    pass_rate: 1,
    avg_score: 1,
    size_bytes: 1024,
    source,
    on_remote: onRemote,
  };
}

describe('dedupeSyncedRuns', () => {
  it('collapses local and remote copies of the same run in all-runs views', () => {
    const runs = [
      run('remote::2026-05-28T08-21-09-063Z', 'remote'),
      run('2026-05-28T08-21-09-063Z', 'local'),
      run('remote::2026-05-27T08-21-09-063Z', 'remote'),
    ];

    expect(dedupeSyncedRuns(runs).map((r) => r.filename)).toEqual([
      '2026-05-28T08-21-09-063Z',
      'remote::2026-05-27T08-21-09-063Z',
    ]);
  });

  it('keeps the local copy but preserves remote presence for synced runs', () => {
    const runs = [
      run('remote::2026-05-28T08-21-09-063Z', 'remote', true),
      run('2026-05-28T08-21-09-063Z', 'local', false),
    ];

    const deduped = dedupeSyncedRuns(runs);
    expect(deduped).toHaveLength(1);
    // Local copy wins (readable on disk) but on_remote stays true so the
    // indicator and the "on remote" count agree for synced runs.
    expect(deduped[0]).toMatchObject({
      filename: '2026-05-28T08-21-09-063Z',
      source: 'local',
      on_remote: true,
    });
  });

  it('leaves a local-only run flagged as not on remote', () => {
    const deduped = dedupeSyncedRuns([run('2026-05-28T08-21-09-063Z', 'local', false)]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].on_remote).toBe(false);
  });
});
