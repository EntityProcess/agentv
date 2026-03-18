import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { enrichInput, resetDeprecationWarnings } from '../src/deprecation.js';
import { CodeGraderInputSchema } from '../src/schemas.js';

/**
 * Build a minimal valid CodeGraderInput for testing.
 */
function buildInput(overrides?: Record<string, unknown>) {
  return CodeGraderInputSchema.parse({
    question: 'What is 2+2?',
    criteria: 'The answer should be 4',
    expectedOutput: [{ role: 'assistant', content: '4' }],
    referenceAnswer: 'The answer is 4',
    outputText: 'The answer is 4',
    guidelineFiles: [],
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
    ...overrides,
  });
}

describe('enrichInput — text accessors', () => {
  afterEach(() => {
    resetDeprecationWarnings();
  });

  it('populates inputText from question', () => {
    const input = buildInput({ question: 'Hello world' });
    enrichInput(input);
    expect(input.inputText).toBe('Hello world');
  });

  it('populates outputText from outputText', () => {
    const input = buildInput({ outputText: 'The result is 42' });
    enrichInput(input);
    expect(input.outputText).toBe('The result is 42');
  });

  it('populates expectedOutputText from referenceAnswer', () => {
    const input = buildInput({ referenceAnswer: 'Expected text' });
    enrichInput(input);
    expect(input.expectedOutputText).toBe('Expected text');
  });

  it('populates expectedOutputText as empty string when referenceAnswer is undefined', () => {
    const input = buildInput({ referenceAnswer: undefined });
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

describe('enrichInput — deprecation warnings', () => {
  afterEach(() => {
    resetDeprecationWarnings();
  });

  it('emits deprecation warning on first access of question', () => {
    const input = buildInput();
    enrichInput(input);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    // Access the deprecated field
    const _val = input.question;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("'question' is deprecated");
    expect(warnSpy.mock.calls[0][0]).toContain('inputText');
    warnSpy.mockRestore();
  });

  it('emits deprecation warning on first access of answer', () => {
    const input = buildInput();
    enrichInput(input);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const _val = input.answer;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("'answer' is deprecated");
    expect(warnSpy.mock.calls[0][0]).toContain('outputText');
    warnSpy.mockRestore();
  });

  it('emits deprecation warning on first access of referenceAnswer', () => {
    const input = buildInput();
    enrichInput(input);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const _val = input.referenceAnswer;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("'referenceAnswer' is deprecated");
    expect(warnSpy.mock.calls[0][0]).toContain('expectedOutputText');
    warnSpy.mockRestore();
  });

  it('emits deprecation warning only once per field', () => {
    const input = buildInput();
    enrichInput(input);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    // Access twice
    const _val1 = input.question;
    const _val2 = input.question;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('does not emit warnings when accessing new text accessors', () => {
    const input = buildInput();
    enrichInput(input);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const _val1 = input.inputText;
    const _val2 = input.outputText;
    const _val3 = input.expectedOutputText;
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deprecated fields still return correct values', () => {
    const input = buildInput({
      question: 'Test question',
      outputText: 'Test answer',
      referenceAnswer: 'Test reference',
    });
    enrichInput(input);

    // Suppress warnings for this test
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    expect(input.question).toBe('Test question');
    expect(input.answer).toBe('Test answer');
    expect(input.referenceAnswer).toBe('Test reference');
    warnSpy.mockRestore();
  });
});

describe('enrichInput — new accessors match deprecated values', () => {
  afterEach(() => {
    resetDeprecationWarnings();
  });

  it('inputText matches question value', () => {
    const input = buildInput({ question: 'My question' });
    enrichInput(input);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    expect(input.inputText).toBe(input.question);
    warnSpy.mockRestore();
  });

  it('outputText matches answer value', () => {
    const input = buildInput({ outputText: 'My answer' });
    enrichInput(input);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    expect(input.outputText).toBe(input.answer);
    warnSpy.mockRestore();
  });

  it('expectedOutputText matches referenceAnswer value', () => {
    const input = buildInput({ referenceAnswer: 'My reference' });
    enrichInput(input);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    expect(input.expectedOutputText).toBe(input.referenceAnswer);
    warnSpy.mockRestore();
  });
});

describe('CodeGraderInputSchema — new fields', () => {
  it('accepts inputText, outputText, expectedOutputText in schema', () => {
    const input = CodeGraderInputSchema.parse({
      question: 'What is 2+2?',
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      answer: 'The answer is 4',
      guidelineFiles: [],
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

  it('inputText and expectedOutputText are optional in schema', () => {
    const input = CodeGraderInputSchema.parse({
      question: 'What is 2+2?',
      criteria: 'The answer should be 4',
      expectedOutput: [{ role: 'assistant', content: '4' }],
      outputText: 'The answer is 4',
      guidelineFiles: [],
      inputFiles: [],
      input: [{ role: 'user', content: 'What is 2+2?' }],
    });
    expect(input.inputText).toBeUndefined();
    expect(input.outputText).toBe('The answer is 4');
    expect(input.expectedOutputText).toBeUndefined();
  });
});
