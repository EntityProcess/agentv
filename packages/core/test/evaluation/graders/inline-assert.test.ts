import { describe, expect, it } from 'vitest';
import type { AssertFn } from '../../../src/evaluation/assertions.js';
import { InlineAssertGrader } from '../../../src/evaluation/graders/inline-assert.js';

describe('InlineAssertGrader', () => {
  const makeContext = (candidate: string, referenceAnswer?: string) =>
    ({
      evalCase: {
        id: 'test',
        question: 'test question',
        criteria: '',
        input: [{ role: 'user', content: 'test question' }],
        expected_output: [],
        file_paths: [],
        reference_answer: referenceAnswer,
      },
      candidate,
      // biome-ignore lint/suspicious/noExplicitAny: test helper with partial context
    }) as any;

  it('runs an inline assert function and returns EvaluationScore', async () => {
    const fn: AssertFn = ({ output }) => ({
      name: 'test-assert',
      score: output.includes('hello') ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertGrader(fn, 'test-assert');
    const score = await evaluator.evaluate(makeContext('hello world'));

    expect(score.score).toBe(1.0);
    expect(score.verdict).toBe('pass');
    expect(score.assertions).toEqual([{ text: 'test-assert', passed: true }]);
  });

  it('handles failing assertion', async () => {
    const fn: AssertFn = ({ output }) => ({
      name: 'fail-assert',
      score: output.includes('goodbye') ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertGrader(fn, 'fail-assert');
    const score = await evaluator.evaluate(makeContext('hello world'));

    expect(score.score).toBe(0.0);
    expect(score.verdict).toBe('fail');
    expect(score.assertions).toEqual([{ text: 'fail-assert', passed: false }]);
  });

  it('handles async assert functions', async () => {
    const fn: AssertFn = async ({ output }) => ({
      name: 'async-assert',
      score: output.length > 0 ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertGrader(fn, 'async-assert');
    const score = await evaluator.evaluate(makeContext('some output'));

    expect(score.score).toBe(1.0);
  });

  it('clamps scores to 0-1 range', async () => {
    const fn: AssertFn = () => ({ name: 'clamped', score: 1.5 });
    const evaluator = new InlineAssertGrader(fn, 'clamped');
    const score = await evaluator.evaluate(makeContext('output'));

    expect(score.score).toBe(1.0);
  });

  it('clamps negative scores to 0', async () => {
    const fn: AssertFn = () => ({ name: 'negative', score: -0.5 });
    const evaluator = new InlineAssertGrader(fn, 'negative');
    const score = await evaluator.evaluate(makeContext('output'));

    expect(score.score).toBe(0.0);
    expect(score.verdict).toBe('fail');
  });

  it('passes expectedOutput from reference_answer', async () => {
    const fn: AssertFn = ({ expectedOutput }) => ({
      name: 'expected-check',
      score: expectedOutput === 'expected' ? 1.0 : 0.0,
    });

    const evaluator = new InlineAssertGrader(fn, 'expected-check');
    const score = await evaluator.evaluate(makeContext('candidate', 'expected'));

    expect(score.score).toBe(1.0);
  });
});
