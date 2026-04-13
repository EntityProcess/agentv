import { describe, expect, it } from 'bun:test';

import { formatSegment } from '../../../src/evaluation/formatting/segment-formatter.js';

describe('formatSegment agent mode file paths', () => {
  it('uses resolvedPath (absolute) when available', () => {
    const segment = {
      type: 'file',
      path: 'snippets/data.csv',
      text: 'content',
      resolvedPath: '/abs/path/to/snippets/data.csv',
    };
    expect(formatSegment(segment, 'agent')).toBe('<file: path="/abs/path/to/snippets/data.csv">');
  });

  it('falls back to display path when resolvedPath is absent', () => {
    const segment = { type: 'file', path: 'snippets/data.csv', text: 'content' };
    expect(formatSegment(segment, 'agent')).toBe('<file: path="snippets/data.csv">');
  });
});
