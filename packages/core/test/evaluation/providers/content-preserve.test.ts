import { describe, expect, it } from 'vitest';

import { getTextContent } from '../../../src/evaluation/content.js';
import {
  extractTextContent,
  toContentArray,
} from '../../../src/evaluation/providers/claude-content.js';
import {
  extractPiTextContent,
  toPiContentArray,
} from '../../../src/evaluation/providers/pi-utils.js';
import type { Content } from '../../../src/evaluation/content.js';
import type { Message } from '../../../src/evaluation/providers/types.js';

// ---------------------------------------------------------------------------
// toContentArray (Claude)
// ---------------------------------------------------------------------------
describe('toContentArray', () => {
  it('returns undefined for non-array input', () => {
    expect(toContentArray('plain string')).toBeUndefined();
    expect(toContentArray(42)).toBeUndefined();
    expect(toContentArray(null)).toBeUndefined();
    expect(toContentArray(undefined)).toBeUndefined();
  });

  it('returns undefined when content has only text blocks', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(toContentArray(content)).toBeUndefined();
  });

  it('preserves image + text with base64 data', () => {
    const content = [
      { type: 'text', text: 'Here is an image:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
      },
    ];
    const result = toContentArray(content);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: 'text', text: 'Here is an image:' });
    expect(result![1]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'data:image/png;base64,abc123',
    });
  });

  it('handles url images', () => {
    const content = [
      {
        type: 'image',
        url: 'https://example.com/img.png',
        source: { type: 'url' },
        media_type: 'image/png',
      },
    ];
    const result = toContentArray(content);
    expect(result).toBeDefined();
    expect(result![0]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'https://example.com/img.png',
    });
  });

  it('skips tool_use and tool_result blocks', () => {
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', name: 'bash', input: { cmd: 'ls' }, id: 't1' },
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
      {
        type: 'image',
        source: { data: 'AAAA', media_type: 'image/jpeg' },
      },
    ];
    const result = toContentArray(content);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: 'text', text: 'hi' });
    expect(result![1].type).toBe('image');
  });

  it('handles invalid parts gracefully', () => {
    const content = [null, undefined, 42, 'string', { type: 'text', text: 'ok' }];
    // only text → undefined (no non-text blocks)
    expect(toContentArray(content)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractTextContent (Claude)
// ---------------------------------------------------------------------------
describe('extractTextContent', () => {
  it('passes through a plain string', () => {
    expect(extractTextContent('hello')).toBe('hello');
  });

  it('returns undefined for non-array non-string', () => {
    expect(extractTextContent(42)).toBeUndefined();
    expect(extractTextContent(null)).toBeUndefined();
    expect(extractTextContent(undefined)).toBeUndefined();
    expect(extractTextContent({})).toBeUndefined();
  });

  it('extracts text from content array', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(extractTextContent(content)).toBe('hello\nworld');
  });

  it('skips non-text blocks', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'image', source: { data: 'abc' } },
      { type: 'tool_use', name: 'bash' },
    ];
    expect(extractTextContent(content)).toBe('hello');
  });

  it('returns undefined for empty array', () => {
    expect(extractTextContent([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toPiContentArray
// ---------------------------------------------------------------------------
describe('toPiContentArray', () => {
  it('returns undefined for non-array input', () => {
    expect(toPiContentArray('plain string')).toBeUndefined();
    expect(toPiContentArray(42)).toBeUndefined();
    expect(toPiContentArray(null)).toBeUndefined();
  });

  it('returns undefined when content has only text blocks', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(toPiContentArray(content)).toBeUndefined();
  });

  it('preserves image + text with base64 source', () => {
    const content = [
      { type: 'text', text: 'Here is an image:' },
      {
        type: 'image',
        media_type: 'image/png',
        source: { data: 'abc123', media_type: 'image/png' },
      },
    ];
    const result = toPiContentArray(content);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: 'text', text: 'Here is an image:' });
    expect(result![1]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'data:image/png;base64,abc123',
    });
  });

  it('handles url images', () => {
    const content = [
      {
        type: 'image',
        url: 'https://example.com/img.png',
        media_type: 'image/png',
      },
    ];
    const result = toPiContentArray(content);
    expect(result).toBeDefined();
    expect(result![0]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'https://example.com/img.png',
    });
  });

  it('skips tool_use and tool_result blocks', () => {
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', name: 'bash' },
      { type: 'tool_result', content: 'ok' },
      {
        type: 'image',
        media_type: 'image/jpeg',
        source: { data: 'AAAA', media_type: 'image/jpeg' },
      },
    ];
    const result = toPiContentArray(content);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: 'text', text: 'hi' });
    expect(result![1].type).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// extractPiTextContent (backward compat)
// ---------------------------------------------------------------------------
describe('extractPiTextContent', () => {
  it('passes through a plain string', () => {
    expect(extractPiTextContent('hello')).toBe('hello');
  });

  it('extracts text from content array', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(extractPiTextContent(content)).toBe('hello\nworld');
  });

  it('returns undefined for non-array non-string', () => {
    expect(extractPiTextContent(42)).toBeUndefined();
    expect(extractPiTextContent(null)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(extractPiTextContent([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: Content[] interop
// ---------------------------------------------------------------------------
describe('End-to-end content preservation', () => {
  it('Content[] is compatible with getTextContent', () => {
    const blocks: Content[] = [
      { type: 'text', text: 'hello' },
      { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,abc' },
      { type: 'text', text: 'world' },
    ];
    expect(getTextContent(blocks)).toBe('hello\nworld');
  });

  it('image block survives into Message.content', () => {
    const rawClaudeContent = [
      { type: 'text', text: 'Look at this:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'DEADBEEF' },
      },
    ];

    const structuredContent = toContentArray(rawClaudeContent);
    const textContent = extractTextContent(rawClaudeContent);

    const msg: Message = {
      role: 'assistant',
      content: structuredContent ?? textContent,
    };

    // content should be Content[] (not flattened to string)
    expect(Array.isArray(msg.content)).toBe(true);
    const blocks = msg.content as Content[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Look at this:' });
    expect(blocks[1].type).toBe('image');
    expect((blocks[1] as { source: string }).source).toContain('base64,DEADBEEF');
  });

  it('text-only content falls back to string', () => {
    const rawClaudeContent = [
      { type: 'text', text: 'Just text' },
    ];

    const structuredContent = toContentArray(rawClaudeContent);
    const textContent = extractTextContent(rawClaudeContent);

    const msg: Message = {
      role: 'assistant',
      content: structuredContent ?? textContent,
    };

    // text-only → toContentArray returns undefined → falls back to string
    expect(typeof msg.content).toBe('string');
    expect(msg.content).toBe('Just text');
  });
});
