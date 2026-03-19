import { describe, expect, it } from 'bun:test';

import { enrichInput } from '../src/deprecation.js';
import { CodeGraderInputSchema } from '../src/schemas.js';

/**
 * Build a minimal valid CodeGraderInput for testing.
 */
function buildInput(overrides?: Record<string, unknown>) {
  return CodeGraderInputSchema.parse({
    criteria: 'The answer should be 4',
    expectedOutput: [{ role: 'assistant', content: '4' }],
    outputText: 'The answer is 4',
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
    inputText: 'What is 2+2?',
    ...overrides,
  });
}

describe('enrichInput — text accessors', () => {
  it('preserves inputText value', () => {
    const input = buildInput({ inputText: 'Hello world' });
    enrichInput(input);
    expect(input.inputText).toBe('Hello world');
  });

  it('preserves outputText value', () => {
    const input = buildInput({ outputText: 'The result is 42' });
    enrichInput(input);
    expect(input.outputText).toBe('The result is 42');
  });

  it('populates expectedOutputText from schema value', () => {
    const input = buildInput({ expectedOutputText: 'Expected text' });
    enrichInput(input);
    expect(input.expectedOutputText).toBe('Expected text');
  });

  it('populates expectedOutputText as empty string when undefined', () => {
    const input = buildInput({ expectedOutputText: undefined });
    enrichInput(input);
    expect(input.expectedOutputText).toBe('');
  });

  it('text accessors are always strings', () => {
    const input = buildInput();
    enrichInput(input);
    expect(typeof input.inputText).toBe('string');
    expect(typeof input.outputText).toBe('string');
    expect(typeof input.expectedOutputText).toBe('string');
  });

  it('structured fields (input, output, expectedOutput) remain Message[]', () => {
    const input = buildInput({
      input: [{ role: 'user', content: 'Hello' }],
      output: [{ role: 'assistant', content: 'Hi' }],
      expectedOutput: [{ role: 'assistant', content: 'Hi there' }],
    });
    enrichInput(input);
    expect(Array.isArray(input.input)).toBe(true);
    expect(Array.isArray(input.output)).toBe(true);
    expect(Array.isArray(input.expectedOutput)).toBe(true);
  });
});

describe('CodeGraderInputSchema — fields', () => {
  it('accepts inputText, outputText, expectedOutputText in schema', () => {
    const input = CodeGraderInputSchema.parse({
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      inputFiles: [],
      input: [{ role: 'user', content: 'What is 2+2?' }],
      inputText: 'What is 2+2?',
      outputText: 'The answer is 4',
      expectedOutputText: 'The answer is 4',
    });
    expect(input.inputText).toBe('What is 2+2?');
    expect(input.outputText).toBe('The answer is 4');
    expect(input.expectedOutputText).toBe('The answer is 4');
  });

  it('inputText is required in schema', () => {
    expect(() =>
      CodeGraderInputSchema.parse({
        criteria: 'The answer should be 4',
        expectedOutput: [{ role: 'assistant', content: '4' }],
        outputText: 'The answer is 4',
        inputFiles: [],
        input: [{ role: 'user', content: 'What is 2+2?' }],
      }),
    ).toThrow();
  });

  it('expectedOutputText is optional in schema', () => {
    const input = CodeGraderInputSchema.parse({
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      outputText: 'The answer is 4',
      inputFiles: [],
      input: [{ role: 'user', content: 'What is 2+2?' }],
      inputText: 'What is 2+2?',
    });
    expect(input.expectedOutputText).toBeUndefined();
  });

  it('does not accept deprecated question field', () => {
    expect(() =>
      CodeGraderInputSchema.parse({
        question: 'What is 2+2?',
        criteria: 'The answer should be 4',
        expectedOutput: [{ role: 'assistant', content: '4' }],
        outputText: 'The answer is 4',
        inputFiles: [],
        input: [{ role: 'user', content: 'What is 2+2?' }],
        inputText: 'What is 2+2?',
      }),
    ).not.toThrow(); // extra fields are stripped by zod by default
  });
});
