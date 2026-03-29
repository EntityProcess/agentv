import { describe, expect, it } from 'vitest';

import { toContentArray } from '../../../src/evaluation/providers/claude-content.js';

describe('toContentArray – empty image source guard', () => {
  it('skips image block when source.data is missing and url is absent', () => {
    const input = [
      { type: 'image', source: { media_type: 'image/png' } },
      { type: 'text', text: 'hello' },
    ];
    const result = toContentArray(input);
    // No valid image → no non-text content → returns undefined
    expect(result).toBeUndefined();
  });

  it('skips image block when source.data is empty string', () => {
    const input = [
      { type: 'image', source: { data: '', media_type: 'image/png' } },
      { type: 'text', text: 'hello' },
    ];
    const result = toContentArray(input);
    expect(result).toBeUndefined();
  });

  it('skips image block when source.data is missing and url is empty string', () => {
    const input = [
      { type: 'image', source: { media_type: 'image/jpeg' }, url: '' },
      { type: 'text', text: 'hello' },
    ];
    const result = toContentArray(input);
    expect(result).toBeUndefined();
  });

  it('includes image block when source.data has valid base64', () => {
    const input = [
      { type: 'image', source: { data: 'abc123', media_type: 'image/png' } },
      { type: 'text', text: 'hello' },
    ];
    const result = toContentArray(input);
    expect(result).toBeDefined();
    expect(result).toEqual([
      { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,abc123' },
      { type: 'text', text: 'hello' },
    ]);
  });

  it('includes image block when url is valid', () => {
    const input = [
      { type: 'image', source: { media_type: 'image/png' }, url: 'https://example.com/img.png' },
      { type: 'text', text: 'caption' },
    ];
    const result = toContentArray(input);
    expect(result).toBeDefined();
    expect(result).toEqual([
      { type: 'image', media_type: 'image/png', source: 'https://example.com/img.png' },
      { type: 'text', text: 'caption' },
    ]);
  });
});
