import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveCachedRunDir } from '../../src/commands/eval/run-cache.js';

describe('resolveCachedRunDir', () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) {
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  function setupCwd(): string {
    tmpCwd = mkdtempSync(path.join(tmpdir(), 'agentv-run-cache-test-'));
    mkdirSync(path.join(tmpCwd, '.agentv'), { recursive: true });
    return tmpCwd;
  }

  function writeCache(cwd: string, lastRunDir: string | undefined): void {
    const cachePath = path.join(cwd, '.agentv', 'cache.json');
    const cache = lastRunDir
      ? { lastRunDir, timestamp: '2026-01-01T00:00:00.000Z' }
      : { timestamp: '2026-01-01T00:00:00.000Z' };
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  }

  it('returns the cached run dir when it exists on disk', async () => {
    const cwd = setupCwd();
    const runDir = path.join(cwd, '.agentv', 'results', 'default', '2026-01-01');
    mkdirSync(runDir, { recursive: true });
    writeCache(cwd, runDir);

    expect(await resolveCachedRunDir(cwd)).toBe(runDir);
  });

  it('returns undefined when no cache file exists', async () => {
    const cwd = setupCwd();
    rmSync(path.join(cwd, '.agentv'), { recursive: true });

    expect(await resolveCachedRunDir(cwd)).toBeUndefined();
  });

  it('returns undefined when the cache lacks lastRunDir', async () => {
    const cwd = setupCwd();
    writeCache(cwd, undefined);

    expect(await resolveCachedRunDir(cwd)).toBeUndefined();
  });

  it('returns undefined when the cached dir has been deleted', async () => {
    const cwd = setupCwd();
    const staleDir = path.join(cwd, '.agentv', 'results', 'default', '2026-01-01');
    writeCache(cwd, staleDir);

    expect(await resolveCachedRunDir(cwd)).toBeUndefined();
  });
});
