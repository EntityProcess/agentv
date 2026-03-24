import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { type RunCache, resolveRunCacheFile } from '../../../src/commands/eval/run-cache.js';

describe('resolveRunCacheFile', () => {
  it('should resolve new directory-based cache to index.jsonl inside dir', () => {
    const cache: RunCache = { lastRunDir: '/results/raw/eval_2026-03-24', timestamp: '' };
    expect(resolveRunCacheFile(cache)).toBe(
      path.join('/results/raw/eval_2026-03-24', 'index.jsonl'),
    );
  });

  it('should resolve legacy file-based cache to lastResultFile', () => {
    const cache: RunCache = { lastResultFile: '/results/raw/eval_2026-03-24.jsonl', timestamp: '' };
    expect(resolveRunCacheFile(cache)).toBe('/results/raw/eval_2026-03-24.jsonl');
  });

  it('should prefer lastRunDir over lastResultFile when both present', () => {
    const cache: RunCache = {
      lastRunDir: '/results/raw/eval_dir',
      lastResultFile: '/results/raw/eval_old.jsonl',
      timestamp: '',
    };
    expect(resolveRunCacheFile(cache)).toBe(path.join('/results/raw/eval_dir', 'index.jsonl'));
  });

  it('should return empty string when neither field is set', () => {
    const cache: RunCache = { timestamp: '' };
    expect(resolveRunCacheFile(cache)).toBe('');
  });
});
