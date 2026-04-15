import { describe, expect, it } from 'bun:test';

import { negateScore } from '../../../src/evaluation/graders/scoring.js';
import type { EvaluationScore } from '../../../src/evaluation/graders/types.js';

describe('negateScore', () => {
  it('inverts a passing score to failing', () => {
    const original: EvaluationScore = {
      score: 0.9,
      verdict: 'pass',
      assertions: [{ text: 'criterion met', passed: true }],
      expectedAspectCount: 1,
    };

    const negated = negateScore(original);

    expect(negated.score).toBeCloseTo(0.1, 10);
    expect(negated.verdict).toBe('fail');
    expect(negated.assertions).toEqual([{ text: 'criterion met', passed: false }]);
  });

  it('inverts a failing score to passing', () => {
    const original: EvaluationScore = {
      score: 0.1,
      verdict: 'fail',
      assertions: [{ text: 'criterion not met', passed: false }],
      expectedAspectCount: 1,
    };

    const negated = negateScore(original);

    expect(negated.score).toBeCloseTo(0.9, 10);
    expect(negated.verdict).toBe('pass');
    expect(negated.assertions).toEqual([{ text: 'criterion not met', passed: true }]);
  });

  it('flips passed on each assertion', () => {
    const original: EvaluationScore = {
      score: 1.0,
      verdict: 'pass',
      assertions: [
        { text: 'a', passed: true },
        { text: 'b', passed: true },
        { text: 'c', passed: true },
        { text: 'd', passed: false },
      ],
      expectedAspectCount: 4,
    };

    const negated = negateScore(original);

    expect(negated.assertions.filter((a) => a.passed).map((a) => a.text)).toEqual(['d']);
    expect(negated.assertions.filter((a) => !a.passed).map((a) => a.text)).toEqual(['a', 'b', 'c']);
  });

  it('clamps score to valid range (score 0 -> 1)', () => {
    const original: EvaluationScore = {
      score: 0,
      verdict: 'fail',
      assertions: [{ text: 'everything failed', passed: false }],
      expectedAspectCount: 1,
    };

    const negated = negateScore(original);

    expect(negated.score).toBe(1);
    expect(negated.verdict).toBe('pass');
  });

  it('clamps score to valid range (score 1 -> 0)', () => {
    const original: EvaluationScore = {
      score: 1,
      verdict: 'pass',
      assertions: [{ text: 'everything passed', passed: true }],
      expectedAspectCount: 1,
    };

    const negated = negateScore(original);

    expect(negated.score).toBe(0);
    expect(negated.verdict).toBe('fail');
  });

  it('preserves other properties like details and expectedAspectCount', () => {
    const original: EvaluationScore = {
      score: 0.5,
      verdict: 'fail',
      assertions: [],
      expectedAspectCount: 3,
      details: { custom: 'data' },
    };

    const negated = negateScore(original);

    expect(negated.expectedAspectCount).toBe(3);
    expect(negated.details).toEqual({ custom: 'data' });
  });
});
