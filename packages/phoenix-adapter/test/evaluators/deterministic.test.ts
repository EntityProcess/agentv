import { describe, expect, test } from 'bun:test';
import { evaluateAssertion } from '../../src/evaluators/registry.js';

describe('deterministic evaluator adapters', () => {
  test('contains returns pass and score 1 when output includes the expected text', () => {
    const result = evaluateAssertion(
      { type: 'contains', name: 'has greeting', value: 'hello' },
      { output: 'well hello there' },
    );

    expect(result).toMatchObject({
      name: 'has greeting',
      type: 'contains',
      passed: true,
      score: 1,
      label: 'pass',
    });
  });

  test('contains returns fail and score 0 when output does not include the expected text', () => {
    const result = evaluateAssertion(
      { type: 'contains', value: 'goodbye' },
      { output: 'hello there' },
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.label).toBe('fail');
  });

  test('contains can compare case-insensitively', () => {
    const result = evaluateAssertion(
      { type: 'contains', value: 'HELLO', caseSensitive: false },
      { output: 'hello there' },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test('regex returns pass for matching output', () => {
    const result = evaluateAssertion(
      { type: 'regex', pattern: 'order-[0-9]+$' },
      { output: 'created order-123' },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test('regex returns fail for invalid patterns', () => {
    const result = evaluateAssertion({ type: 'regex', pattern: '[' }, { output: 'anything' });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('Invalid regex pattern');
  });

  test('equals performs stable deep equality for object outputs', () => {
    const result = evaluateAssertion(
      { type: 'equals', expected: { b: 2, a: ['x', { c: true }] } },
      { output: { a: ['x', { c: true }], b: 2 } },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test('equals can fall back to context expected output', () => {
    const result = evaluateAssertion(
      { type: 'equals' },
      { output: 'done', expectedOutput: 'done' },
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test('is-json passes JSON strings and object outputs', () => {
    const jsonString = evaluateAssertion({ type: 'is-json' }, { output: '{"ok":true}' });
    const objectOutput = evaluateAssertion({ type: 'is-json' }, { output: { ok: true } });

    expect(jsonString.passed).toBe(true);
    expect(jsonString.score).toBe(1);
    expect(objectOutput.passed).toBe(true);
    expect(objectOutput.score).toBe(1);
  });

  test('is-json fails non-JSON text', () => {
    const result = evaluateAssertion({ type: 'is-json' }, { output: 'not json' });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('Output is not valid JSON');
  });
});
