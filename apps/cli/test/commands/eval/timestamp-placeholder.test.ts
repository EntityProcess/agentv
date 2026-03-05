import { describe, expect, it } from 'bun:test';

import { resolveTimestampPlaceholder } from '../../../src/commands/eval/run-eval.js';

describe('resolveTimestampPlaceholder', () => {
  it('replaces {timestamp} with formatted date', () => {
    const result = resolveTimestampPlaceholder('trace-{timestamp}.jsonl');
    expect(result).toMatch(/^trace-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonl$/);
  });

  it('returns string unchanged when no placeholder', () => {
    const result = resolveTimestampPlaceholder('trace.jsonl');
    expect(result).toBe('trace.jsonl');
  });

  it('replaces multiple {timestamp} occurrences', () => {
    const result = resolveTimestampPlaceholder('{timestamp}-{timestamp}.jsonl');
    expect(result).toMatch(/^\d{4}.*-\d{4}.*\.jsonl$/);
  });
});
