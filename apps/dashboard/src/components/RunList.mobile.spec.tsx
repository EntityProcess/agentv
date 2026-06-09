import { describe, expect, it } from 'bun:test';

import type { RunMeta } from '../lib/types';
import { buildRunListItemView } from './RunList';

function runMeta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    filename: 'run-2026-06-08.jsonl',
    path: '/tmp/run-2026-06-08.jsonl',
    timestamp: '2026-06-08T10:00:00.000Z',
    test_count: 10,
    pass_rate: 0.7,
    avg_score: 0.7,
    size_bytes: 1024,
    source: 'local',
    ...overrides,
  };
}

describe('buildRunListItemView', () => {
  it('deducts execution errors from quality totals for both table and mobile views', () => {
    const view = buildRunListItemView(
      runMeta({
        execution_error_count: 2,
      }),
      0.8,
    );

    expect(view.errors).toBe(2);
    expect(view.qualityCount).toBe(8);
    expect(view.passedCount).toBe(6);
    expect(view.failedCount).toBe(2);
    expect(view.passing).toBe(false);
  });

  it('preserves active run status separately from pass rate', () => {
    const view = buildRunListItemView(
      runMeta({
        status: 'running',
        pass_rate: 0,
      }),
      0.8,
    );

    expect(view.isActive).toBe(true);
    expect(view.passing).toBe(false);
  });

  it('uses compact run display without duplicating the pass-rate column', () => {
    const view = buildRunListItemView(
      runMeta({
        display_name: '2026-03-27T05-00-00-000Z',
        filename: 'remote::2026-03-27T05-00-00-000Z',
        target: 'remote-target',
        timestamp: '2026-03-27T05:00:00.000Z',
        pass_rate: 1,
        source: 'remote',
      }),
      0.8,
    );

    expect(view.display.primary).toBe('27/03 05:00');
    expect(view.display.secondary).toBe('remote-target');
    expect(view.label).toBe('27/03 05:00 · remote-target');
  });
});
