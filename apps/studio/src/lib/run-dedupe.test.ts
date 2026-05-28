import { describe, expect, it } from 'bun:test';

import { dedupeSyncedRuns } from './run-dedupe';
import type { RunMeta } from './types';

function run(filename: string, source: RunMeta['source']): RunMeta {
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
});
