import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  RESULT_INDEX_FILENAME,
  resolveExistingRunPrimaryPath,
  resolveRunIndexPath,
} from './result-layout.js';

const CACHE_FILENAME = 'cache.json';

/**
 * Persisted pointer to the last eval run, stored in .agentv/cache.json.
 * Keys use camelCase (not snake_case) for backward compat with pre-existing cache files.
 */
export interface RunCache {
  /** Directory path for new per-run directory format (e.g. .agentv/results/runs/<ts>/) */
  readonly lastRunDir?: string;
  /** @deprecated Legacy flat-file pointer from old cache files. Ignored on read. */
  readonly lastResultFile?: string;
  readonly timestamp: string;
}

/**
 * Resolve the primary result manifest path from a RunCache entry.
 */
export function resolveRunCacheFile(cache: RunCache): string {
  if (cache.lastRunDir) {
    return resolveExistingRunPrimaryPath(cache.lastRunDir) ?? resolveRunIndexPath(cache.lastRunDir);
  }
  return '';
}

function cachePath(cwd: string): string {
  return path.join(cwd, '.agentv', CACHE_FILENAME);
}

export async function loadRunCache(cwd: string): Promise<RunCache | undefined> {
  try {
    const content = await readFile(cachePath(cwd), 'utf-8');
    return JSON.parse(content) as RunCache;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the cached last-run directory for a cwd, if it still exists on disk.
 * Returns undefined when there is no cache, the cache lacks a `lastRunDir`,
 * or the directory has since been deleted. Used by `--resume` / `--rerun-failed`
 * to default `--output` to the most recent run when no explicit dir is given,
 * matching the convention used by promptfoo (`--resume [evalId]`) and
 * OpenCompass (`-r [timestamp]`).
 */
export async function resolveCachedRunDir(cwd: string): Promise<string | undefined> {
  const cache = await loadRunCache(cwd);
  if (!cache?.lastRunDir) return undefined;
  if (!existsSync(cache.lastRunDir)) return undefined;
  return cache.lastRunDir;
}

export async function saveRunCache(cwd: string, resultPath: string): Promise<void> {
  if (path.basename(resultPath) !== RESULT_INDEX_FILENAME) {
    return;
  }

  const dir = path.join(cwd, '.agentv');
  await mkdir(dir, { recursive: true });
  const cache: RunCache = {
    lastRunDir: path.dirname(resultPath),
    timestamp: new Date().toISOString(),
  };
  await writeFile(cachePath(cwd), `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
}
