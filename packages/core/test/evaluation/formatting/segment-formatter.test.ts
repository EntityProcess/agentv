import { describe, expect, it } from 'bun:test';

import {
  formatFileContents,
  formatSegment,
  hasVisibleContent,
} from '../../../src/evaluation/formatting/segment-formatter.js';

describe('formatSegment', () => {
  describe('text segments', () => {
    it('returns value for text segments', () => {
      expect(formatSegment({ type: 'text', value: 'hello' })).toBe('hello');
    });

    it('returns undefined for missing value', () => {
      expect(formatSegment({ type: 'text' })).toBeUndefined();
    });
  });

  describe('file segments in lm mode', () => {
    it('returns embedded content with XML tags', () => {
      const segment = { type: 'file', path: 'data.csv', text: 'a,b\n1,2' };
      const result = formatSegment(segment, 'lm');
      expect(result).toContain('<file path="data.csv">');
      expect(result).toContain('a,b\n1,2');
      expect(result).toContain('</file>');
    });

    it('returns undefined when text is missing', () => {
      const segment = { type: 'file', path: 'data.csv' };
      expect(formatSegment(segment, 'lm')).toBeUndefined();
    });
  });

  describe('file segments in agent mode', () => {
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

    it('returns undefined when path is missing', () => {
      const segment = { type: 'file', text: 'content' };
      expect(formatSegment(segment, 'agent')).toBeUndefined();
    });
  });

  describe('unknown segment types', () => {
    it('returns undefined for unknown types', () => {
      expect(formatSegment({ type: 'video', value: 'test' })).toBeUndefined();
    });

    it('returns undefined for missing type', () => {
      expect(formatSegment({ value: 'test' })).toBeUndefined();
    });
  });
});

describe('formatFileContents', () => {
  it('wraps file parts in XML tags', () => {
    const result = formatFileContents([
      { content: 'a,b\n1,2', isFile: true, displayPath: 'data.csv' },
    ]);
    expect(result).toBe('<file path="data.csv">\na,b\n1,2\n</file>');
  });

  it('joins non-file parts with spaces when no files present', () => {
    const result = formatFileContents([
      { content: 'hello', isFile: false },
      { content: 'world', isFile: false },
    ]);
    expect(result).toBe('hello world');
  });
});

describe('hasVisibleContent', () => {
  it('returns true for non-empty text segments', () => {
    expect(hasVisibleContent([{ type: 'text', value: 'hello' }])).toBe(true);
  });

  it('returns false for whitespace-only text', () => {
    expect(hasVisibleContent([{ type: 'text', value: '   ' }])).toBe(false);
  });

  it('returns true for file segments with text', () => {
    expect(hasVisibleContent([{ type: 'file', text: 'content' }])).toBe(true);
  });

  it('returns false for empty segments', () => {
    expect(hasVisibleContent([])).toBe(false);
  });
});
