import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveFileReference } from '../../../src/evaluation/loaders/file-resolver.js';

describe('git URL resolution e2e', () => {
  it('fetches file from public GitHub repo', async () => {
    // Use a stable public file that won't change
    const url = 'https://github.com/anthropics/anthropic-cookbook/blob/main/README.md';

    const result = await resolveFileReference(url, []);

    expect(result.displayPath).toBe(url);
    expect(result.resolvedPath).toBeDefined();

    // Verify file content is readable
    if (!result.resolvedPath) {
      throw new Error('resolvedPath should be defined');
    }
    const content = await readFile(result.resolvedPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content.toLowerCase()).toContain('anthropic'); // Basic sanity check
  }, 30000); // 30s timeout for network
});
