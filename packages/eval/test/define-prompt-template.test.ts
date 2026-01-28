import { describe, expect, it } from 'bun:test';

import { type PromptTemplateInput, PromptTemplateInputSchema } from '../src/schemas.js';

describe('PromptTemplateInputSchema', () => {
  // Minimal valid input with all required fields
  const validInput = {
    question: 'What is 2+2?',
    expectedOutcome: 'The answer should be 4',
    expectedMessages: [],
    candidateAnswer: 'The answer is 4',
    guidelineFiles: [],
    inputFiles: [],
    inputMessages: [],
  };

  it('parses valid input with all required fields', () => {
    const result = PromptTemplateInputSchema.parse(validInput);
    expect(result.question).toBe('What is 2+2?');
    expect(result.candidateAnswer).toBe('The answer is 4');
    expect(result.expectedOutcome).toBe('The answer should be 4');
    expect(result.expectedMessages).toEqual([]);
    expect(result.guidelineFiles).toEqual([]);
    expect(result.inputFiles).toEqual([]);
    expect(result.inputMessages).toEqual([]);
  });

  it('rejects input missing required fields', () => {
    const minimalInput = {
      question: 'What is 2+2?',
      candidateAnswer: 'The answer is 4',
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
    const result = PromptTemplateInputSchema.parse(inputWithTrace);
    expect(result.traceSummary?.eventCount).toBe(3);
    expect(result.traceSummary?.toolNames).toEqual(['read', 'write']);
  });

  it('accepts null traceSummary', () => {
    const inputWithNullTrace = {
      ...validInput,
      traceSummary: null,
    };
    const result = PromptTemplateInputSchema.parse(inputWithNullTrace);
    expect(result.traceSummary).toBeNull();
  });

  it('accepts optional config', () => {
    const inputWithConfig = {
      ...validInput,
      config: { rubric: 'Check for correctness', strictMode: true },
    };
    const result = PromptTemplateInputSchema.parse(inputWithConfig);
    expect(result.config).toEqual({ rubric: 'Check for correctness', strictMode: true });
  });

  it('accepts expectedMessages with content', () => {
    const inputWithMessages = {
      ...validInput,
      expectedMessages: [{ role: 'assistant', content: '4' }],
    };
    const result = PromptTemplateInputSchema.parse(inputWithMessages);
    expect(result.expectedMessages[0].content).toBe('4');
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

  it('accepts inputMessages with content', () => {
    const inputWithMessages = {
      ...validInput,
      inputMessages: [{ role: 'user', content: 'What is 2+2?' }],
    };
    const result = PromptTemplateInputSchema.parse(inputWithMessages);
    expect(result.inputMessages[0].content).toBe('What is 2+2?');
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
    const result = PromptTemplateInputSchema.parse(inputWithOutput);
    expect(result.outputMessages?.[0].toolCalls?.[0].tool).toBe('read');
  });

  it('accepts full input with all fields', () => {
    const fullInput = {
      question: 'What is 2+2?',
      expectedOutcome: 'The answer should be 4',
      expectedMessages: [{ role: 'assistant', content: '4' }],
      referenceAnswer: 'The sum is 4',
      candidateAnswer: 'The answer is 4',
      outputMessages: [{ role: 'assistant', content: 'The answer is 4' }],
      guidelineFiles: ['/path/to/guideline.txt'],
      inputFiles: ['/path/to/input.txt'],
      inputMessages: [{ role: 'user', content: 'What is 2+2?' }],
      traceSummary: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
      },
      config: { rubric: 'Check correctness' },
    };
    const result = PromptTemplateInputSchema.parse(fullInput);
    expect(result.question).toBe('What is 2+2?');
    expect(result.expectedOutcome).toBe('The answer should be 4');
    expect(result.referenceAnswer).toBe('The sum is 4');
    expect(result.candidateAnswer).toBe('The answer is 4');
    expect(result.config).toEqual({ rubric: 'Check correctness' });
  });
});

describe('Schema type inference', () => {
  it('PromptTemplateInput has expected shape', () => {
    // Type-level test: ensure inferred types have expected properties
    const input: PromptTemplateInput = {
      question: 'test',
      expectedOutcome: 'expected',
      expectedMessages: [],
      candidateAnswer: 'test',
      guidelineFiles: [],
      inputFiles: [],
      inputMessages: [],
    };

    // These should all type-check correctly
    const _q: string = input.question;
    const _c: string = input.candidateAnswer;
    const _outcome: string = input.expectedOutcome;
    const _trace: PromptTemplateInput['traceSummary'] = undefined;
    const _config: PromptTemplateInput['config'] = null;
    const _ref: PromptTemplateInput['referenceAnswer'] = undefined;

    expect(input.question).toBe('test');
  });

  it('PromptTemplateInput requires core fields', () => {
    const input: PromptTemplateInput = {
      question: 'test question',
      expectedOutcome: 'expected outcome',
      expectedMessages: [],
      candidateAnswer: 'test answer',
      guidelineFiles: [],
      inputFiles: [],
      inputMessages: [],
    };

    // Required fields must be present
    expect(input.question).toBe('test question');
    expect(input.expectedOutcome).toBe('expected outcome');
    expect(input.candidateAnswer).toBe('test answer');
    expect(input.expectedMessages).toEqual([]);
    expect(input.guidelineFiles).toEqual([]);
    expect(input.inputFiles).toEqual([]);
    expect(input.inputMessages).toEqual([]);

    // Optional fields can be omitted
    expect(input.referenceAnswer).toBeUndefined();
    expect(input.outputMessages).toBeUndefined();
    expect(input.traceSummary).toBeUndefined();
    expect(input.config).toBeUndefined();
  });
});
