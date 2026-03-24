import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_FILENAME = 'cache.json';

export interface RunCache {
  /** Directory path for new per-run directory format (e.g. .agentv/results/raw/eval_<ts>/) */
  readonly lastRunDir?: string;
  /** JSONL file path for legacy flat-file format. Kept for backward compat. */
  readonly lastResultFile?: string;
  readonly timestamp: string;
}

/**
 * Resolve the JSONL results file path from a RunCache entry.
 * New format: lastRunDir/results.jsonl
 * Legacy format: lastResultFile (flat JSONL path)
 */
export function resolveRunCacheFile(cache: RunCache): string {
  if (cache.lastRunDir) {
    return path.join(cache.lastRunDir, 'results.jsonl');
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

export async function saveRunCache(cwd: string, runDir: string): Promise<void> {
  const dir = path.join(cwd, '.agentv');
  await mkdir(dir, { recursive: true });
  const cache: RunCache = {
    lastRunDir: runDir,
    timestamp: new Date().toISOString(),
  };
  await writeFile(cachePath(cwd), `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
}
