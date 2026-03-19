import { describe, expect, it } from 'bun:test';

import { PromptTemplateInputSchema } from '../src/schemas.js';

describe('PromptTemplateInputSchema', () => {
  // Minimal valid input with all required fields
  const validInput = {
    inputText: 'What is 2+2?',
    criteria: 'The answer should be 4',
    expectedOutput: [],
    outputText: 'The answer is 4',
    inputFiles: [],
    input: [],
  };

  it('parses valid input with all required fields', () => {
    const result = PromptTemplateInputSchema.parse(validInput);
    expect(result.inputText).toBe('What is 2+2?');
    expect(result.outputText).toBe('The answer is 4');
    expect(result.criteria).toBe('The answer should be 4');
    expect(result.expectedOutput).toEqual([]);
    expect(result.inputFiles).toEqual([]);
    expect(result.input).toEqual([]);
  });

  it('rejects input missing required fields', () => {
    const minimalInput = {
      inputText: 'What is 2+2?',
    };
    expect(() => PromptTemplateInputSchema.parse(minimalInput)).toThrow();
  });

  it('accepts optional expectedOutputText', () => {
    const inputWithReference = {
      ...validInput,
      expectedOutputText: 'The sum of 2 and 2 is 4',
    };
    const result = PromptTemplateInputSchema.parse(inputWithReference);
    expect(result.expectedOutputText).toBe('The sum of 2 and 2 is 4');
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
    const result = PromptTemplateInputSchema.parse(inputWithTrace);
    expect(result.trace?.eventCount).toBe(3);
    expect(result.trace?.toolCalls).toEqual({ read: 2, write: 1 });
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
      inputText: 'What is 2+2?',
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      expectedOutputText: 'The sum is 4',
      outputText: 'The answer is 4',
      output: [{ role: 'assistant', content: 'The answer is 4' }],
      inputFiles: ['/path/to/input.txt'],
      input: [{ role: 'user', content: 'What is 2+2?' }],
      trace: {
        eventCount: 1,
        toolCalls: {},
        errorCount: 0,
      },
      config: { rubric: 'Check correctness' },
    };
    const result = PromptTemplateInputSchema.parse(fullInput);
    expect(result.inputText).toBe('What is 2+2?');
    expect(result.criteria).toBe('The answer should be 4');
    expect(result.expectedOutputText).toBe('The sum is 4');
    expect(result.outputText).toBe('The answer is 4');
    expect(result.config).toEqual({ rubric: 'Check correctness' });
  });
});
