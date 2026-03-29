import { describe, expect, it } from 'vitest';

import {
  type Content,
  type ContentFile,
  type ContentImage,
  type ContentText,
  getTextContent,
  isContent,
  isContentArray,
} from '../../src/evaluation/content.js';
import { type Message, extractLastAssistantContent } from '../../src/evaluation/providers/types.js';

// ---------------------------------------------------------------------------
// Content type guards
// ---------------------------------------------------------------------------

describe('isContent', () => {
  it('returns true for ContentText', () => {
    expect(isContent({ type: 'text', text: 'hello' })).toBe(true);
  });

  it('returns true for ContentImage', () => {
    expect(isContent({ type: 'image', media_type: 'image/png', source: 'data:...' })).toBe(true);
  });

  it('returns true for ContentFile', () => {
    expect(isContent({ type: 'file', media_type: 'text/plain', path: '/tmp/f.txt' })).toBe(true);
  });

  it('returns false for non-object values', () => {
    expect(isContent(null)).toBe(false);
    expect(isContent(undefined)).toBe(false);
    expect(isContent('text')).toBe(false);
    expect(isContent(42)).toBe(false);
  });

  it('returns false for objects with unknown type', () => {
    expect(isContent({ type: 'audio', data: '...' })).toBe(false);
    expect(isContent({ type: 123 })).toBe(false);
    expect(isContent({})).toBe(false);
  });
});

describe('isContentArray', () => {
  it('returns true for array of valid Content blocks', () => {
    const blocks: Content[] = [
      { type: 'text', text: 'hello' },
      { type: 'image', media_type: 'image/png', source: 'data:...' },
    ];
    expect(isContentArray(blocks)).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(isContentArray([])).toBe(false);
  });

  it('returns false for array with non-Content items', () => {
    expect(isContentArray([{ type: 'unknown' }])).toBe(false);
    expect(isContentArray(['hello'])).toBe(false);
  });

  it('returns false for non-array values', () => {
    expect(isContentArray('text')).toBe(false);
    expect(isContentArray(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTextContent
// ---------------------------------------------------------------------------

describe('getTextContent', () => {
  it('returns string content directly', () => {
    expect(getTextContent('hello world')).toBe('hello world');
  });

  it('returns empty string for undefined', () => {
    expect(getTextContent(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(getTextContent(null)).toBe('');
  });

  it('extracts text from ContentText blocks', () => {
    const content: Content[] = [
      { type: 'text', text: 'line 1' },
      { type: 'text', text: 'line 2' },
    ];
    expect(getTextContent(content)).toBe('line 1\nline 2');
  });

  it('skips non-text blocks when extracting text', () => {
    const content: Content[] = [
      { type: 'text', text: 'hello' },
      { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,...' },
      { type: 'text', text: 'world' },
    ];
    expect(getTextContent(content)).toBe('hello\nworld');
  });

  it('returns empty string for Content[] with no text blocks', () => {
    const content: Content[] = [
      { type: 'image', media_type: 'image/png', source: 'data:...' },
      { type: 'file', media_type: 'text/plain', path: '/f.txt' },
    ];
    expect(getTextContent(content)).toBe('');
  });

  it('handles single text block', () => {
    const content: Content[] = [{ type: 'text', text: 'only text' }];
    expect(getTextContent(content)).toBe('only text');
  });
});

// ---------------------------------------------------------------------------
// extractLastAssistantContent with Content[]
// ---------------------------------------------------------------------------

describe('extractLastAssistantContent with Content[]', () => {
  it('extracts text from Content[] in assistant message', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the chart:' },
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,abc' },
        ],
      },
    ];
    expect(extractLastAssistantContent(messages)).toBe('Here is the chart:');
  });

  it('still works with plain string content (backward compat)', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'plain text response' }];
    expect(extractLastAssistantContent(messages)).toBe('plain text response');
  });

  it('returns empty string for no assistant messages', () => {
    const messages: Message[] = [{ role: 'user', content: 'question' }];
    expect(extractLastAssistantContent(messages)).toBe('');
  });

  it('returns empty string for undefined messages', () => {
    expect(extractLastAssistantContent(undefined)).toBe('');
    expect(extractLastAssistantContent([])).toBe('');
  });

  it('finds the last assistant message in a conversation', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'first response' },
      { role: 'user', content: 'follow-up' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'second response' },
          { type: 'file', media_type: 'text/csv', path: '/data.csv' },
        ],
      },
    ];
    expect(extractLastAssistantContent(messages)).toBe('second response');
  });
});

// ---------------------------------------------------------------------------
// Type compatibility — compile-time checks
// ---------------------------------------------------------------------------

describe('Message type compatibility', () => {
  it('accepts string content', () => {
    const msg: Message = { role: 'assistant', content: 'hello' };
    expect(msg.content).toBe('hello');
  });

  it('accepts Content[] content', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', media_type: 'image/png', source: 'base64data' },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it('accepts undefined content', () => {
    const msg: Message = { role: 'assistant' };
    expect(msg.content).toBeUndefined();
  });

  it('preserves Content subtypes in Content[]', () => {
    const text: ContentText = { type: 'text', text: 'hi' };
    const image: ContentImage = { type: 'image', media_type: 'image/jpeg', source: '/img.jpg' };
    const file: ContentFile = { type: 'file', media_type: 'application/pdf', path: '/doc.pdf' };

    const msg: Message = { role: 'assistant', content: [text, image, file] };
    const blocks = msg.content as Content[];

    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('image');
    expect(blocks[2].type).toBe('file');
  });
});
