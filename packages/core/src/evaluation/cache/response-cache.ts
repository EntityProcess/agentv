import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationCache } from '../orchestrator.js';
import type { ProviderResponse } from '../providers/types.js';

const DEFAULT_CACHE_PATH = '.agentv/cache';

/**
 * File-based LLM response cache.
 * Stores provider responses as JSON files keyed by SHA-256 hash.
 * Directory structure: <cache_path>/<first-2-chars>/<full-hash>.json
 */
export class ResponseCache implements EvaluationCache {
  private readonly cachePath: string;

  constructor(cachePath?: string) {
    this.cachePath = cachePath ?? DEFAULT_CACHE_PATH;
  }

  async get(key: string): Promise<ProviderResponse | undefined> {
    const filePath = this.keyToPath(key);
    try {
      const data = await readFile(filePath, 'utf8');
      return JSON.parse(data) as ProviderResponse;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ProviderResponse): Promise<void> {
    const filePath = this.keyToPath(key);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private keyToPath(key: string): string {
    const prefix = key.slice(0, 2);
    return path.join(this.cachePath, prefix, `${key}.json`);
  }
}

/**
 * Determine whether caching should be active for a given run.
 *
 * Precedence:
 *   1. --no-cache CLI flag → always disabled
 *   2. --cache CLI flag OR execution.cache YAML → enabled
 *   3. Default → disabled (safe for variability testing)
 */
export function shouldEnableCache(params: {
  cliCache: boolean;
  cliNoCache: boolean;
  yamlCache?: boolean;
}): boolean {
  if (params.cliNoCache) return false;
  return params.cliCache || params.yamlCache === true;
}

/**
 * Check whether caching should be skipped for a target with temperature > 0.
 * Non-deterministic responses should not be cached unless explicitly forced.
 */
export function shouldSkipCacheForTemperature(targetConfig: Record<string, unknown>): boolean {
  const temp = targetConfig.temperature;
  if (typeof temp === 'number' && temp > 0) {
    return true;
  }
  return false;
}
