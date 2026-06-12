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
    inputFiles: [],
    input: [{ role: 'user', content: 'What is 2+2?' }],
    ...overrides,
  });
}

describe('enrichInput — pass-through', () => {
  it('returns the same object unchanged', () => {
    const input = buildInput();
    const result = enrichInput(input);
    expect(result).toBe(input);
  });

  it('structured fields (input, messages, expectedOutput) remain transcript arrays', () => {
    const input = buildInput({
      input: [{ role: 'user', content: 'Hello' }],
      output: 'Hi',
      messages: [{ role: 'assistant', content: 'Hi' }],
      expectedOutput: [{ role: 'assistant', content: 'Hi there' }],
    });
    enrichInput(input);
    expect(Array.isArray(input.input)).toBe(true);
    expect(input.output).toBe('Hi');
    expect(Array.isArray(input.messages)).toBe(true);
    expect(Array.isArray(input.expectedOutput)).toBe(true);
  });
});
