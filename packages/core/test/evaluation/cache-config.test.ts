import { describe, expect, it } from 'bun:test';

import { extractCacheConfig } from '../../src/evaluation/loaders/config-loader.js';
import type { JsonObject } from '../../src/evaluation/types.js';

describe('extractCacheConfig', () => {
  it('should return undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractCacheConfig(suite)).toBeUndefined();
  });

  it('rejects authored execution blocks', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(() => extractCacheConfig(suite)).toThrow(/Top-level 'execution'/);
  });
});
