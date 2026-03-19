import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_FILENAME = 'cache.json';

export interface RunCache {
  readonly lastResultFile: string;
  readonly timestamp: string;
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

export async function saveRunCache(cwd: string, resultFile: string): Promise<void> {
  const dir = path.join(cwd, '.agentv');
  await mkdir(dir, { recursive: true });
  const cache: RunCache = {
    lastResultFile: resultFile,
    timestamp: new Date().toISOString(),
  };
  await writeFile(cachePath(cwd), `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
}
