import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ResponseCache,
  shouldEnableCache,
  shouldSkipCacheForTemperature,
} from '../../src/evaluation/cache/response-cache.js';
import type { ProviderResponse } from '../../src/evaluation/providers/types.js';

describe('ResponseCache', () => {
  function makeTempDir(): string {
    return mkdtempSync(path.join(tmpdir(), 'agentv-cache-test-'));
  }

  const sampleResponse: ProviderResponse = {
    raw: { text: 'Hello world' },
    output: [{ role: 'assistant', content: 'Hello world' }],
  };

  it('should store and retrieve cached responses', async () => {
    const cacheDir = makeTempDir();
    const cache = new ResponseCache(cacheDir);
    const key = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    await cache.set(key, sampleResponse);
    const result = await cache.get(key);

    expect(result).toEqual(sampleResponse);
  });

  it('should return undefined for cache miss', async () => {
    const cacheDir = makeTempDir();
    const cache = new ResponseCache(cacheDir);

    const result = await cache.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should use directory structure with first 2 chars as prefix', async () => {
    const cacheDir = makeTempDir();
    const cache = new ResponseCache(cacheDir);
    const key = 'ab12345678';

    await cache.set(key, sampleResponse);

    // Verify directory structure: <cache_path>/ab/ab12345678.json
    const prefixDir = path.join(cacheDir, 'ab');
    expect(existsSync(prefixDir)).toBe(true);
    expect(existsSync(path.join(prefixDir, `${key}.json`))).toBe(true);
  });

  it('should return different results for different keys', async () => {
    const cacheDir = makeTempDir();
    const cache = new ResponseCache(cacheDir);

    const response1: ProviderResponse = { raw: { text: 'Response 1' } };
    const response2: ProviderResponse = { raw: { text: 'Response 2' } };

    await cache.set('key1', response1);
    await cache.set('key2', response2);

    expect(await cache.get('key1')).toEqual(response1);
    expect(await cache.get('key2')).toEqual(response2);
  });

  it('should overwrite existing cache entry', async () => {
    const cacheDir = makeTempDir();
    const cache = new ResponseCache(cacheDir);

    const original: ProviderResponse = { raw: { text: 'Original' } };
    const updated: ProviderResponse = { raw: { text: 'Updated' } };

    await cache.set('key1', original);
    await cache.set('key1', updated);

    expect(await cache.get('key1')).toEqual(updated);
  });
});

describe('shouldEnableCache', () => {
  it('should default to disabled (no cache)', () => {
    expect(shouldEnableCache({ cliCache: false, cliNoCache: false })).toBe(false);
  });

  it('should enable when --cache CLI flag is set', () => {
    expect(shouldEnableCache({ cliCache: true, cliNoCache: false })).toBe(true);
  });

  it('should enable when YAML execution.cache is true', () => {
    expect(shouldEnableCache({ cliCache: false, cliNoCache: false, yamlCache: true })).toBe(true);
  });

  it('should disable when --no-cache overrides --cache', () => {
    expect(shouldEnableCache({ cliCache: true, cliNoCache: true })).toBe(false);
  });

  it('should disable when --no-cache overrides YAML cache: true', () => {
    expect(shouldEnableCache({ cliCache: false, cliNoCache: true, yamlCache: true })).toBe(false);
  });

  it('should disable when YAML cache is false', () => {
    expect(shouldEnableCache({ cliCache: false, cliNoCache: false, yamlCache: false })).toBe(false);
  });
});

describe('shouldSkipCacheForTemperature', () => {
  it('should skip cache when temperature > 0', () => {
    expect(shouldSkipCacheForTemperature({ temperature: 0.5 })).toBe(true);
    expect(shouldSkipCacheForTemperature({ temperature: 1.0 })).toBe(true);
  });

  it('should not skip when temperature is 0', () => {
    expect(shouldSkipCacheForTemperature({ temperature: 0 })).toBe(false);
  });

  it('should not skip when temperature is not set', () => {
    expect(shouldSkipCacheForTemperature({})).toBe(false);
  });

  it('should not skip when temperature is not a number', () => {
    expect(shouldSkipCacheForTemperature({ temperature: 'high' })).toBe(false);
  });
});
