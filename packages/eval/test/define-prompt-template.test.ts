import { describe, expect, it } from 'bun:test';

import { type PromptTemplateInput, PromptTemplateInputSchema } from '../src/schemas.js';

describe('PromptTemplateInputSchema', () => {
  // Minimal valid input with all required fields
  const validInput = {
    question: 'What is 2+2?',
    criteria: 'The answer should be 4',
    expectedOutput: [],
    answer: 'The answer is 4',
    guidelineFiles: [],
    inputFiles: [],
    input: [],
  };

  it('parses valid input with all required fields', () => {
    const result = PromptTemplateInputSchema.parse(validInput);
    expect(result.question).toBe('What is 2+2?');
    expect(result.answer).toBe('The answer is 4');
    expect(result.criteria).toBe('The answer should be 4');
    expect(result.expectedOutput).toEqual([]);
    expect(result.guidelineFiles).toEqual([]);
    expect(result.inputFiles).toEqual([]);
    expect(result.input).toEqual([]);
  });

  it('rejects input missing required fields', () => {
    const minimalInput = {
      question: 'What is 2+2?',
      answer: 'The answer is 4',
    };
    expect(() => PromptTemplateInputSchema.parse(minimalInput)).toThrow();
  });

  it('accepts optional referenceAnswer', () => {
    const inputWithReference = {
      ...validInput,
      referenceAnswer: 'The sum of 2 and 2 is 4',
    };
    const result = PromptTemplateInputSchema.parse(inputWithReference);
    expect(result.referenceAnswer).toBe('The sum of 2 and 2 is 4');
  });

  it('accepts optional trace', () => {
    const inputWithTrace = {
      ...validInput,
      trace: {
        eventCount: 3,
        toolNames: ['read', 'write'],
        toolCallsByName: { read: 2, write: 1 },
        errorCount: 0,
      },
    };
    const result = PromptTemplateInputSchema.parse(inputWithTrace);
    expect(result.trace?.eventCount).toBe(3);
    expect(result.trace?.toolNames).toEqual(['read', 'write']);
  });

  it('accepts null trace', () => {
    const inputWithNullTrace = {
      ...validInput,
      trace: null,
    };
    const result = PromptTemplateInputSchema.parse(inputWithNullTrace);
    expect(result.trace).toBeNull();
  });

  it('accepts optional config', () => {
    const inputWithConfig = {
      ...validInput,
      config: { rubric: 'Check for correctness', strictMode: true },
    };
    const result = PromptTemplateInputSchema.parse(inputWithConfig);
    expect(result.config).toEqual({ rubric: 'Check for correctness', strictMode: true });
  });

  it('accepts expectedOutput with content', () => {
    const inputWithMessages = {
      ...validInput,
      expectedOutput: [{ role: 'assistant', content: '4' }],
    };
    const result = PromptTemplateInputSchema.parse(inputWithMessages);
    expect(result.expectedOutput[0].content).toBe('4');
  });

  it('accepts guidelineFiles with paths', () => {
    const inputWithGuidelines = {
      ...validInput,
      guidelineFiles: ['/path/to/guideline1.txt', '/path/to/guideline2.txt'],
    };
    const result = PromptTemplateInputSchema.parse(inputWithGuidelines);
    expect(result.guidelineFiles).toEqual(['/path/to/guideline1.txt', '/path/to/guideline2.txt']);
  });

  it('accepts inputFiles with paths', () => {
    const inputWithFiles = {
      ...validInput,
      inputFiles: ['/path/to/input1.txt'],
    };
    const result = PromptTemplateInputSchema.parse(inputWithFiles);
    expect(result.inputFiles).toEqual(['/path/to/input1.txt']);
  });

  it('accepts input with content', () => {
    const inputWithMessages = {
      ...validInput,
      input: [{ role: 'user', content: 'What is 2+2?' }],
    };
    const result = PromptTemplateInputSchema.parse(inputWithMessages);
    expect(result.input[0].content).toBe('What is 2+2?');
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
    const result = PromptTemplateInputSchema.parse(inputWithOutput);
    expect(result.output?.[0].toolCalls?.[0].tool).toBe('read');
  });

  it('accepts full input with all fields', () => {
    const fullInput = {
      question: 'What is 2+2?',
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      referenceAnswer: 'The sum is 4',
      answer: 'The answer is 4',
      output: [{ role: 'assistant', content: 'The answer is 4' }],
      guidelineFiles: ['/path/to/guideline.txt'],
      inputFiles: ['/path/to/input.txt'],
      input: [{ role: 'user', content: 'What is 2+2?' }],
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
      },
      config: { rubric: 'Check correctness' },
    };
    const result = PromptTemplateInputSchema.parse(fullInput);
    expect(result.question).toBe('What is 2+2?');
    expect(result.criteria).toBe('The answer should be 4');
    expect(result.referenceAnswer).toBe('The sum is 4');
    expect(result.answer).toBe('The answer is 4');
    expect(result.config).toEqual({ rubric: 'Check correctness' });
  });
});

describe('Schema type inference', () => {
  it('PromptTemplateInput has expected shape', () => {
    // Type-level test: ensure inferred types have expected properties
    const input: PromptTemplateInput = {
      question: 'test',
      criteria: 'expected',
      expectedOutput: [],
      answer: 'test',
      guidelineFiles: [],
      inputFiles: [],
      input: [],
    };

    // These should all type-check correctly
    const _q: string = input.question;
    const _c: string = input.answer;
    const _outcome: string = input.criteria;
    const _trace: PromptTemplateInput['trace'] = undefined;
    const _config: PromptTemplateInput['config'] = null;
    const _ref: PromptTemplateInput['referenceAnswer'] = undefined;

    expect(input.question).toBe('test');
  });

  it('PromptTemplateInput requires core fields', () => {
    const input: PromptTemplateInput = {
      question: 'test question',
      criteria: 'expected outcome',
      expectedOutput: [],
      answer: 'test answer',
      guidelineFiles: [],
      inputFiles: [],
      input: [],
    };

    // Required fields must be present
    expect(input.question).toBe('test question');
    expect(input.criteria).toBe('expected outcome');
    expect(input.answer).toBe('test answer');
    expect(input.expectedOutput).toEqual([]);
    expect(input.guidelineFiles).toEqual([]);
    expect(input.inputFiles).toEqual([]);
    expect(input.input).toEqual([]);

    // Optional fields can be omitted
    expect(input.referenceAnswer).toBeUndefined();
    expect(input.output).toBeUndefined();
    expect(input.trace).toBeUndefined();
    expect(input.config).toBeUndefined();
  });
});
