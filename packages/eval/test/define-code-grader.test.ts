import { describe, expect, it } from 'bun:test';

import {
  CodeGraderInputSchema,
  type CodeGraderResult,
  CodeGraderResultSchema,
  // Backward-compat aliases
  CodeJudgeInputSchema,
  CodeJudgeResultSchema,
  ContentFileSchema,
  ContentImageSchema,
  ContentSchema,
  ContentTextSchema,
  MessageSchema,
} from '../src/schemas.js';

// ---------------------------------------------------------------------------
// Content schemas
// ---------------------------------------------------------------------------

describe('ContentSchema', () => {
  it('parses ContentText', () => {
    const result = ContentTextSchema.parse({ type: 'text', text: 'hello' });
    expect(result).toEqual({ type: 'text', text: 'hello' });
  });

  it('parses ContentImage with path', () => {
    const result = ContentImageSchema.parse({
      type: 'image',
      media_type: 'image/png',
      path: '/workspace/chart.png',
    });
    expect(result).toEqual({
      type: 'image',
      media_type: 'image/png',
      path: '/workspace/chart.png',
    });
  });

  it('parses ContentFile', () => {
    const result = ContentFileSchema.parse({
      type: 'file',
      media_type: 'text/csv',
      path: '/workspace/data.csv',
    });
    expect(result).toEqual({ type: 'file', media_type: 'text/csv', path: '/workspace/data.csv' });
  });

  it('discriminated union resolves correct variant', () => {
    const text = ContentSchema.parse({ type: 'text', text: 'hi' });
    expect(text.type).toBe('text');

    const image = ContentSchema.parse({
      type: 'image',
      media_type: 'image/jpeg',
      path: '/img.jpg',
    });
    expect(image.type).toBe('image');

    const file = ContentSchema.parse({
      type: 'file',
      media_type: 'application/pdf',
      path: '/doc.pdf',
    });
    expect(file.type).toBe('file');
  });

  it('rejects unknown content type', () => {
    expect(() => ContentSchema.parse({ type: 'audio', data: '...' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MessageSchema with Content[]
// ---------------------------------------------------------------------------

describe('MessageSchema content variants', () => {
  it('accepts string content (backward compat)', () => {
    const msg = MessageSchema.parse({ role: 'assistant', content: 'Hello' });
    expect(msg.content).toBe('Hello');
  });

  it('accepts Content[] with text blocks', () => {
    const msg = MessageSchema.parse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'paragraph 1' },
        { type: 'text', text: 'paragraph 2' },
      ],
    });
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.content as unknown[]).toHaveLength(2);
  });

  it('accepts Content[] with image blocks', () => {
    const msg = MessageSchema.parse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Chart:' },
        { type: 'image', media_type: 'image/png', path: '/chart.png' },
      ],
    });
    const content = msg.content as { type: string }[];
    expect(content[1].type).toBe('image');
  });

  it('accepts Content[] with file blocks', () => {
    const msg = MessageSchema.parse({
      role: 'assistant',
      content: [{ type: 'file', media_type: 'text/csv', path: '/data.csv' }],
    });
    const content = msg.content as { type: string }[];
    expect(content[0].type).toBe('file');
  });

  it('accepts mixed Content[] (text + image + file)', () => {
    const msg = MessageSchema.parse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Analysis results:' },
        { type: 'image', media_type: 'image/png', path: '/chart.png' },
        { type: 'file', media_type: 'text/csv', path: '/data.csv' },
      ],
    });
    const content = msg.content as { type: string }[];
    expect(content).toHaveLength(3);
    expect(content.map((c) => c.type)).toEqual(['text', 'image', 'file']);
  });

  it('accepts undefined content', () => {
    const msg = MessageSchema.parse({ role: 'tool' });
    expect(msg.content).toBeUndefined();
  });
});

describe('CodeGraderInputSchema', () => {
  const validInput = {
    criteria: 'The answer should be 4',
    expectedOutput: [{ role: 'assistant', content: '4' }],
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
  };

  it('parses valid input', () => {
    const result = CodeGraderInputSchema.parse(validInput);
    expect(result.criteria).toBe('The answer should be 4');
  });

  it('accepts optional trace', () => {
    const inputWithTrace = {
      ...validInput,
      trace: {
        eventCount: 3,
        toolCalls: { read: 2, write: 1 },
        errorCount: 0,
      },
    };
    const result = CodeGraderInputSchema.parse(inputWithTrace);
    expect(result.trace?.eventCount).toBe(3);
    expect(result.trace?.toolCalls).toEqual({ read: 2, write: 1 });
  });

  it('accepts null trace', () => {
    const inputWithNullTrace = {
      ...validInput,
      trace: null,
    };
    const result = CodeGraderInputSchema.parse(inputWithNullTrace);
    expect(result.trace).toBeNull();
  });

  it('accepts optional config', () => {
    const inputWithConfig = {
      ...validInput,
      config: { maxToolCalls: 10, strictMode: true },
    };
    const result = CodeGraderInputSchema.parse(inputWithConfig);
    expect(result.config).toEqual({ maxToolCalls: 10, strictMode: true });
  });

  it('accepts optional output with toolCalls', () => {
    const inputWithOutput = {
      ...validInput,
      output: [
        {
          role: 'assistant',
          content: 'Reading file...',
          toolCalls: [{ tool: 'read', input: { path: 'test.txt' } }],
        },
      ],
    };
    const result = CodeGraderInputSchema.parse(inputWithOutput);
    expect(result.output?.[0].toolCalls?.[0].tool).toBe('read');
  });

  it('accepts output with Content[] containing image blocks', () => {
    const inputWithImages = {
      ...validInput,
      output: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Generated chart:' },
            { type: 'image', media_type: 'image/png', path: '/workspace/chart.png' },
          ],
        },
      ],
    };
    const result = CodeGraderInputSchema.parse(inputWithImages);
    const content = result.output?.[0].content as { type: string; path?: string }[];
    expect(content).toHaveLength(2);
    expect(content[1].type).toBe('image');
    expect(content[1].path).toBe('/workspace/chart.png');
  });

  it('accepts input with Content[] messages', () => {
    const inputWithContentArray = {
      ...validInput,
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image:' },
            { type: 'image', media_type: 'image/jpeg', path: '/workspace/photo.jpg' },
          ],
        },
      ],
    };
    const result = CodeGraderInputSchema.parse(inputWithContentArray);
    const content = result.input[0].content as { type: string }[];
    expect(content).toHaveLength(2);
  });
});

describe('CodeGraderResultSchema', () => {
  it('parses valid result with all fields', () => {
    const result: CodeGraderResult = {
      score: 0.8,
      assertions: [
        { text: 'Correct answer', passed: true },
        { text: 'Missing explanation', passed: false },
      ],
    };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.score).toBe(0.8);
    expect(parsed.assertions).toEqual([
      { text: 'Correct answer', passed: true },
      { text: 'Missing explanation', passed: false },
    ]);
  });

  it('defaults assertions to empty array', () => {
    const result = { score: 0.5 };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.assertions).toEqual([]);
  });

  it('defaults assertions to empty array when omitted', () => {
    const result = { score: 1.0 };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.assertions).toEqual([]);
  });

  it('rejects score below 0', () => {
    const result = { score: -0.5 };
    expect(() => CodeGraderResultSchema.parse(result)).toThrow();
  });

  it('rejects score above 1', () => {
    const result = { score: 1.5 };
    expect(() => CodeGraderResultSchema.parse(result)).toThrow();
  });

  it('accepts boundary scores 0 and 1', () => {
    expect(CodeGraderResultSchema.parse({ score: 0 }).score).toBe(0);
    expect(CodeGraderResultSchema.parse({ score: 1 }).score).toBe(1);
  });

  it('accepts optional details object', () => {
    const result = {
      score: 0.75,
      details: {
        tp: 5,
        tn: 2,
        fp: 1,
        fn: 2,
        precision: 0.833,
        recall: 0.714,
      },
    };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.details).toEqual({
      tp: 5,
      tn: 2,
      fp: 1,
      fn: 2,
      precision: 0.833,
      recall: 0.714,
    });
  });

  it('allows details to be omitted', () => {
    const result = { score: 0.5 };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.details).toBeUndefined();
  });

  it('accepts nested details object', () => {
    const result = {
      score: 0.8,
      details: {
        alignment: [
          { expectedIdx: 0, parsedIdx: 1, similarity: 0.95 },
          { expectedIdx: 1, parsedIdx: 0, similarity: 0.88 },
        ],
        metrics: {
          description: { tp: 2, fp: 0, fn: 0 },
          quantity: { tp: 1, fp: 1, fn: 0 },
        },
      },
    };
    const parsed = CodeGraderResultSchema.parse(result);
    expect(parsed.details?.alignment).toHaveLength(2);
    expect(parsed.details?.metrics).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Backward-compatibility: deprecated CodeJudge* aliases still work
// ---------------------------------------------------------------------------

describe('CodeJudgeInputSchema (backward-compat alias)', () => {
  it('parses valid input via deprecated alias', () => {
    const validInput = {
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      inputFiles: [],
      input: [{ role: 'user', content: 'What is 2+2?' }],
    };
    const result = CodeJudgeInputSchema.parse(validInput);
    expect(result.criteria).toBe('The answer should be 4');
  });
});

describe('CodeJudgeResultSchema (backward-compat alias)', () => {
  it('parses valid result via deprecated alias', () => {
    const result = { score: 0.8, assertions: [{ text: 'ok', passed: true }] };
    const parsed = CodeJudgeResultSchema.parse(result);
    expect(parsed.score).toBe(0.8);
  });
});
