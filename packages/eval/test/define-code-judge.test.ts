import { describe, expect, it } from 'bun:test';

import {
  type CodeJudgeInput,
  CodeJudgeInputSchema,
  type CodeJudgeResult,
  CodeJudgeResultSchema,
} from '../src/schemas.js';

describe('CodeJudgeInputSchema', () => {
  const validInput = {
    question: 'What is 2+2?',
    criteria: 'The answer should be 4',
    expectedMessages: [{ role: 'assistant', content: '4' }],
    candidateAnswer: 'The answer is 4',
    guidelineFiles: [],
    inputFiles: [],
    inputMessages: [{ role: 'user', content: 'What is 2+2?' }],
  };

  it('parses valid input', () => {
    const result = CodeJudgeInputSchema.parse(validInput);
    expect(result.question).toBe('What is 2+2?');
    expect(result.candidateAnswer).toBe('The answer is 4');
  });

  it('accepts optional traceSummary', () => {
    const inputWithTrace = {
      ...validInput,
      traceSummary: {
        eventCount: 3,
        toolNames: ['read', 'write'],
        toolCallsByName: { read: 2, write: 1 },
        errorCount: 0,
      },
    };
    const result = CodeJudgeInputSchema.parse(inputWithTrace);
    expect(result.traceSummary?.eventCount).toBe(3);
    expect(result.traceSummary?.toolNames).toEqual(['read', 'write']);
  });

  it('accepts null traceSummary', () => {
    const inputWithNullTrace = {
      ...validInput,
      traceSummary: null,
    };
    const result = CodeJudgeInputSchema.parse(inputWithNullTrace);
    expect(result.traceSummary).toBeNull();
  });

  it('accepts optional config', () => {
    const inputWithConfig = {
      ...validInput,
      config: { maxToolCalls: 10, strictMode: true },
    };
    const result = CodeJudgeInputSchema.parse(inputWithConfig);
    expect(result.config).toEqual({ maxToolCalls: 10, strictMode: true });
  });

  it('accepts optional outputMessages with toolCalls', () => {
    const inputWithOutput = {
      ...validInput,
      outputMessages: [
        {
          role: 'assistant',
          content: 'Reading file...',
          toolCalls: [{ tool: 'read', input: { path: 'test.txt' } }],
        },
      ],
    };
    const result = CodeJudgeInputSchema.parse(inputWithOutput);
    expect(result.outputMessages?.[0].toolCalls?.[0].tool).toBe('read');
  });
});

describe('CodeJudgeResultSchema', () => {
  it('parses valid result with all fields', () => {
    const result: CodeJudgeResult = {
      score: 0.8,
      hits: ['Correct answer'],
      misses: ['Missing explanation'],
      reasoning: 'Good but could be better',
    };
    const parsed = CodeJudgeResultSchema.parse(result);
    expect(parsed.score).toBe(0.8);
    expect(parsed.hits).toEqual(['Correct answer']);
    expect(parsed.misses).toEqual(['Missing explanation']);
  });

  it('defaults hits and misses to empty arrays', () => {
    const result = { score: 0.5 };
    const parsed = CodeJudgeResultSchema.parse(result);
    expect(parsed.hits).toEqual([]);
    expect(parsed.misses).toEqual([]);
  });

  it('allows optional reasoning', () => {
    const result = { score: 1.0 };
    const parsed = CodeJudgeResultSchema.parse(result);
    expect(parsed.reasoning).toBeUndefined();
  });

  it('rejects score below 0', () => {
    const result = { score: -0.5 };
    expect(() => CodeJudgeResultSchema.parse(result)).toThrow();
  });

  it('rejects score above 1', () => {
    const result = { score: 1.5 };
    expect(() => CodeJudgeResultSchema.parse(result)).toThrow();
  });

  it('accepts boundary scores 0 and 1', () => {
    expect(CodeJudgeResultSchema.parse({ score: 0 }).score).toBe(0);
    expect(CodeJudgeResultSchema.parse({ score: 1 }).score).toBe(1);
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
    const parsed = CodeJudgeResultSchema.parse(result);
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
    const parsed = CodeJudgeResultSchema.parse(result);
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
    const parsed = CodeJudgeResultSchema.parse(result);
    expect(parsed.details?.alignment).toHaveLength(2);
    expect(parsed.details?.metrics).toBeDefined();
  });
});

describe('Schema type inference', () => {
  it('CodeJudgeInput has expected shape', () => {
    // Type-level test: ensure inferred types have expected properties
    const input: CodeJudgeInput = {
      question: 'test',
      criteria: 'test',
      expectedMessages: [],
      candidateAnswer: 'test',
      guidelineFiles: [],
      inputFiles: [],
      inputMessages: [],
    };

    // These should all type-check correctly
    const _q: string = input.question;
    const _c: string = input.candidateAnswer;
    const _trace: CodeJudgeInput['traceSummary'] = undefined;
    const _config: CodeJudgeInput['config'] = null;

    expect(input.question).toBe('test');
  });

  it('CodeJudgeResult has expected shape', () => {
    const result: CodeJudgeResult = {
      score: 0.5,
      hits: [],
      misses: [],
    };

    const _score: number = result.score;
    const _hits: string[] = result.hits;
    const _reasoning: string | undefined = result.reasoning;

    expect(result.score).toBe(0.5);
  });

  it('CodeJudgeResult supports optional details', () => {
    const resultWithDetails: CodeJudgeResult = {
      score: 0.8,
      hits: ['match'],
      misses: [],
      details: { tp: 1, fp: 0, fn: 0 },
    };

    const _details: Record<string, unknown> | undefined = resultWithDetails.details;
    expect(resultWithDetails.details?.tp).toBe(1);
  });
});
