import { describe, expect, it } from 'vitest';
import type { AssertFn } from '../../src/evaluation/assertions.js';

describe('AssertFn type', () => {
  it('accepts a sync function returning AssertResult', () => {
    const fn: AssertFn = ({ output }) => ({
      name: 'custom',
      score: output.includes('hello') ? 1.0 : 0.0,
    });

    const result = fn({ input: 'test', output: 'hello world' });
    expect(result).toEqual({ name: 'custom', score: 1.0 });
  });

  it('accepts an async function returning AssertResult', async () => {
    const fn: AssertFn = async ({ output }) => ({
      name: 'async-custom',
      score: output.length > 0 ? 1.0 : 0.0,
    });

    const result = await fn({ input: 'test', output: 'something' });
    expect(result).toEqual({ name: 'async-custom', score: 1.0 });
  });

  it('receives expectedOutput and criteria in context', () => {
    const fn: AssertFn = ({ expectedOutput, criteria }) => ({
      name: 'context-check',
      score: expectedOutput === 'expected' && criteria === 'be good' ? 1.0 : 0.0,
    });

    const result = fn({
      input: 'test',
      output: 'anything',
      expectedOutput: 'expected',
      criteria: 'be good',
    });
    expect(result).toEqual({ name: 'context-check', score: 1.0 });
  });
});
