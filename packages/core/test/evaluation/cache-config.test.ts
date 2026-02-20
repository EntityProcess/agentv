import { describe, expect, it } from 'bun:test';

import { extractCacheConfig } from '../../src/evaluation/loaders/config-loader.js';
import type { JsonObject } from '../../src/evaluation/types.js';

describe('extractCacheConfig', () => {
  it('should return undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractCacheConfig(suite)).toBeUndefined();
  });

  it('should return undefined when no cache field', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractCacheConfig(suite)).toBeUndefined();
  });

  it('should parse cache: true', () => {
    const suite: JsonObject = { execution: { cache: true } };
    const result = extractCacheConfig(suite);
    expect(result).toEqual({ enabled: true, cachePath: undefined });
  });

  it('should parse cache: false', () => {
    const suite: JsonObject = { execution: { cache: false } };
    const result = extractCacheConfig(suite);
    expect(result).toEqual({ enabled: false, cachePath: undefined });
  });

  it('should parse cache_path', () => {
    const suite: JsonObject = { execution: { cache: true, cache_path: '.agentv/my-cache' } };
    const result = extractCacheConfig(suite);
    expect(result).toEqual({ enabled: true, cachePath: '.agentv/my-cache' });
  });

  it('should accept camelCase cachePath', () => {
    const suite: JsonObject = { execution: { cache: true, cachePath: 'custom/cache' } };
    const result = extractCacheConfig(suite);
    expect(result).toEqual({ enabled: true, cachePath: 'custom/cache' });
  });

  it('should return undefined for invalid cache value', () => {
    const suite: JsonObject = { execution: { cache: 'yes' } };
    expect(extractCacheConfig(suite)).toBeUndefined();
  });
});
