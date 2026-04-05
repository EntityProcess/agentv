import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { type RunCache, resolveRunCacheFile } from '../../../src/commands/eval/run-cache.js';

describe('resolveRunCacheFile', () => {
  it('should resolve new directory-based cache to index.jsonl inside dir', () => {
    const cache: RunCache = { lastRunDir: '/results/runs/2026-03-24T00-00-00-000Z', timestamp: '' };
    expect(resolveRunCacheFile(cache)).toBe(
      path.join('/results/runs/2026-03-24T00-00-00-000Z', 'index.jsonl'),
    );
  });

  it('ignores legacy file-based cache entries', () => {
    const cache: RunCache = {
      lastResultFile: '/results/runs/eval_2026-03-24.jsonl',
      timestamp: '',
    };
    expect(resolveRunCacheFile(cache)).toBe('');
  });

  it('should prefer lastRunDir over lastResultFile when both present', () => {
    const cache: RunCache = {
      lastRunDir: '/results/runs/2026-03-24T00-00-00-000Z',
      lastResultFile: '/results/runs/eval_old.jsonl',
      timestamp: '',
    };
    expect(resolveRunCacheFile(cache)).toBe(
      path.join('/results/runs/2026-03-24T00-00-00-000Z', 'index.jsonl'),
    );
  });

  it('should return empty string when neither field is set', () => {
    const cache: RunCache = { timestamp: '' };
    expect(resolveRunCacheFile(cache)).toBe('');
  });
});
