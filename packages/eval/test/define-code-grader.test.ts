import { describe, expect, it } from 'bun:test';

import {
  CodeGraderInputSchema,
  type CodeGraderResult,
  CodeGraderResultSchema,
  // Backward-compat aliases
  CodeJudgeInputSchema,
  CodeJudgeResultSchema,
} from '../src/schemas.js';

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
