import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  LEGACY_RESULTS_FILENAME,
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
  /** Directory path for new per-run directory format (e.g. .agentv/results/raw/eval_<ts>/) */
  readonly lastRunDir?: string;
  /** JSONL file path for legacy flat-file format. Kept for backward compat. */
  readonly lastResultFile?: string;
  readonly timestamp: string;
}

/**
 * Resolve the primary result manifest path from a RunCache entry.
 * New format: lastRunDir/index.jsonl (fallback: results.jsonl)
 * Legacy format: lastResultFile (flat JSONL path)
 */
export function resolveRunCacheFile(cache: RunCache): string {
  if (cache.lastRunDir) {
    return resolveExistingRunPrimaryPath(cache.lastRunDir) ?? resolveRunIndexPath(cache.lastRunDir);
  }
  return cache.lastResultFile ?? '';
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

export async function saveRunCache(cwd: string, resultPath: string): Promise<void> {
  const dir = path.join(cwd, '.agentv');
  await mkdir(dir, { recursive: true });
  const basename = path.basename(resultPath);
  const cache: RunCache =
    basename === RESULT_INDEX_FILENAME || basename === LEGACY_RESULTS_FILENAME
      ? {
          lastRunDir: path.dirname(resultPath),
          timestamp: new Date().toISOString(),
        }
      : {
          lastResultFile: resultPath,
          timestamp: new Date().toISOString(),
        };
  await writeFile(cachePath(cwd), `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
}
