import { describe, expect, it } from 'vitest';
import type { AssertFn } from '../../../src/evaluation/assertions.js';
import { InlineAssertEvaluator } from '../../../src/evaluation/evaluators/inline-assert.js';

describe('InlineAssertEvaluator', () => {
  it('runs an inline assert function and returns EvaluationScore', async () => {
    const fn: AssertFn = ({ output }) => ({
      name: 'test-assert',
      score: output.includes('hello') ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertEvaluator(fn, 'test-assert');

    const score = await evaluator.evaluate({
      evalCase: {
        id: 'test',
        question: 'greet me',
        criteria: '',
        input: [{ role: 'user', content: 'greet me' }],
        input_segments: [],
        expected_output: [],
        guideline_paths: [],
        file_paths: [],
        reference_answer: 'hello world',
      },
      candidate: 'hello world',
      // biome-ignore lint/suspicious/noExplicitAny: partial context for unit testing
    } as any);

    expect(score.score).toBe(1.0);
    expect(score.verdict).toBe('pass');
  });

  it('handles async assert functions', async () => {
    const fn: AssertFn = async ({ output }) => ({
      name: 'async-assert',
      score: output.length > 0 ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertEvaluator(fn, 'async-assert');

    const score = await evaluator.evaluate({
      evalCase: {
        id: 'test',
        question: 'test',
        criteria: '',
        input: [{ role: 'user', content: 'test' }],
        input_segments: [],
        expected_output: [],
        guideline_paths: [],
        file_paths: [],
      },
      candidate: 'some output',
      // biome-ignore lint/suspicious/noExplicitAny: partial context for unit testing
    } as any);

    expect(score.score).toBe(1.0);
  });

  it('returns fail verdict for score 0', async () => {
    const fn: AssertFn = () => ({
      name: 'always-fail',
      score: 0.0,
    });

    const evaluator = new InlineAssertEvaluator(fn, 'always-fail');

    const score = await evaluator.evaluate({
      evalCase: {
        id: 'test',
        question: 'test',
        criteria: '',
        input: [{ role: 'user', content: 'test' }],
        input_segments: [],
        expected_output: [],
        guideline_paths: [],
        file_paths: [],
      },
      candidate: 'output',
      // biome-ignore lint/suspicious/noExplicitAny: partial context for unit testing
    } as any);

    expect(score.score).toBe(0.0);
    expect(score.verdict).toBe('fail');
    expect(score.misses).toContain('always-fail');
  });
});
