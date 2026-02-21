import { describe, expect, it } from 'bun:test';

import { negateScore } from '../../../src/evaluation/evaluators/scoring.js';
import type { EvaluationScore } from '../../../src/evaluation/evaluators/types.js';

describe('negateScore', () => {
  it('inverts a passing score to failing', () => {
    const original: EvaluationScore = {
      score: 0.9,
      verdict: 'pass',
      hits: ['criterion met'],
      misses: [],
      expectedAspectCount: 1,
      reasoning: 'All good',
    };

    const negated = negateScore(original);

    expect(negated.score).toBeCloseTo(0.1, 10);
    expect(negated.verdict).toBe('fail');
    expect(negated.hits).toEqual([]);
    expect(negated.misses).toEqual(['criterion met']);
    expect(negated.reasoning).toBe('[Negated] All good (original score: 0.90)');
  });

  it('inverts a failing score to passing', () => {
    const original: EvaluationScore = {
      score: 0.1,
      verdict: 'fail',
      hits: [],
      misses: ['criterion not met'],
      expectedAspectCount: 1,
      reasoning: 'Failed check',
    };

    const negated = negateScore(original);

    expect(negated.score).toBeCloseTo(0.9, 10);
    expect(negated.verdict).toBe('pass');
    expect(negated.hits).toEqual(['criterion not met']);
    expect(negated.misses).toEqual([]);
    expect(negated.reasoning).toBe('[Negated] Failed check (original score: 0.10)');
  });

  it('keeps borderline verdict as borderline', () => {
    const original: EvaluationScore = {
      score: 0.7,
      verdict: 'borderline',
      hits: ['partial'],
      misses: ['incomplete'],
      expectedAspectCount: 2,
    };

    const negated = negateScore(original);

    expect(negated.score).toBeCloseTo(0.3, 10);
    expect(negated.verdict).toBe('borderline');
    expect(negated.hits).toEqual(['incomplete']);
    expect(negated.misses).toEqual(['partial']);
  });

  it('swaps hits and misses', () => {
    const original: EvaluationScore = {
      score: 1.0,
      verdict: 'pass',
      hits: ['a', 'b', 'c'],
      misses: ['d'],
      expectedAspectCount: 4,
    };

    const negated = negateScore(original);

    expect(negated.hits).toEqual(['d']);
    expect(negated.misses).toEqual(['a', 'b', 'c']);
  });

  it('annotates reasoning when no original reasoning', () => {
    const original: EvaluationScore = {
      score: 0.8,
      verdict: 'pass',
      hits: [],
      misses: [],
      expectedAspectCount: 0,
    };

    const negated = negateScore(original);

    expect(negated.reasoning).toBe('[Negated] Original score: 0.80');
  });

  it('clamps score to valid range (score 0 → 1)', () => {
    const original: EvaluationScore = {
      score: 0,
      verdict: 'fail',
      hits: [],
      misses: ['everything failed'],
      expectedAspectCount: 1,
    };

    const negated = negateScore(original);

    expect(negated.score).toBe(1);
    expect(negated.verdict).toBe('pass');
  });

  it('clamps score to valid range (score 1 → 0)', () => {
    const original: EvaluationScore = {
      score: 1,
      verdict: 'pass',
      hits: ['everything passed'],
      misses: [],
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
      hits: [],
      misses: [],
      expectedAspectCount: 3,
      details: { custom: 'data' },
    };

    const negated = negateScore(original);

    expect(negated.expectedAspectCount).toBe(3);
    expect(negated.details).toEqual({ custom: 'data' });
  });
});
