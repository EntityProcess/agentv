import { describe, expect, it } from 'bun:test';

import { aggregateTrials, getTCritical } from '../../src/evaluation/trials.js';
import type { TrialResult, TrialsConfig } from '../../src/evaluation/types.js';

describe('aggregateTrials', () => {
  describe('pass_at_k strategy', () => {
    it('returns best score when one trial passes', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.5, verdict: 'fail' },
        { attempt: 1, score: 0.9, verdict: 'pass' },
      ];
      const config: TrialsConfig = { count: 3, strategy: 'pass_at_k' };

      const result = aggregateTrials(trials, config);

      expect(result.score).toBe(0.9);
      expect(result.aggregation.strategy).toBe('pass_at_k');
      if (result.aggregation.strategy === 'pass_at_k') {
        expect(result.aggregation.passedAttempts).toBe(1);
        expect(result.aggregation.totalAttempts).toBe(2);
      }
    });

    it('returns best score when all trials fail', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.3, verdict: 'fail' },
        { attempt: 1, score: 0.4, verdict: 'fail' },
        { attempt: 2, score: 0.2, verdict: 'fail' },
      ];
      const config: TrialsConfig = { count: 3, strategy: 'pass_at_k' };

      const result = aggregateTrials(trials, config);

      expect(result.score).toBe(0.4);
      if (result.aggregation.strategy === 'pass_at_k') {
        expect(result.aggregation.passedAttempts).toBe(0);
        expect(result.aggregation.totalAttempts).toBe(3);
      }
    });

    it('handles single trial', () => {
      const trials: TrialResult[] = [{ attempt: 0, score: 0.85, verdict: 'pass' }];
      const config: TrialsConfig = { count: 1, strategy: 'pass_at_k' };

      const result = aggregateTrials(trials, config);

      expect(result.score).toBe(0.85);
    });
  });

  describe('mean strategy', () => {
    it('averages scores correctly', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.7, verdict: 'borderline' },
        { attempt: 1, score: 0.9, verdict: 'pass' },
        { attempt: 2, score: 1.0, verdict: 'pass' },
      ];
      const config: TrialsConfig = { count: 3, strategy: 'mean' };

      const result = aggregateTrials(trials, config);

      expect(result.score).toBeCloseTo(0.8667, 3);
      if (result.aggregation.strategy === 'mean') {
        expect(result.aggregation.mean).toBeCloseTo(0.8667, 3);
        expect(result.aggregation.min).toBe(0.7);
        expect(result.aggregation.max).toBe(1.0);
      }
    });

    it('handles all same scores', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.7, verdict: 'borderline' },
        { attempt: 1, score: 0.7, verdict: 'borderline' },
      ];
      const config: TrialsConfig = { count: 2, strategy: 'mean' };

      const result = aggregateTrials(trials, config);

      expect(result.score).toBeCloseTo(0.7);
    });
  });

  describe('confidence_interval strategy', () => {
    it('computes CI bounds', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.7, verdict: 'borderline' },
        { attempt: 1, score: 0.8, verdict: 'pass' },
        { attempt: 2, score: 0.9, verdict: 'pass' },
      ];
      const config: TrialsConfig = { count: 3, strategy: 'confidence_interval' };

      const result = aggregateTrials(trials, config);

      if (result.aggregation.strategy === 'confidence_interval') {
        expect(result.aggregation.mean).toBeCloseTo(0.8);
        expect(result.aggregation.ci95Lower).toBeLessThan(0.8);
        expect(result.aggregation.ci95Upper).toBeGreaterThan(0.8);
        expect(result.aggregation.stddev).toBeGreaterThan(0);
        // Score should be the lower bound (conservative)
        expect(result.score).toBe(result.aggregation.ci95Lower);
      }
    });

    it('clamps CI bounds to [0, 1]', () => {
      // Very high scores with some variance could push upper bound above 1
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.98, verdict: 'pass' },
        { attempt: 1, score: 0.99, verdict: 'pass' },
      ];
      const config: TrialsConfig = { count: 2, strategy: 'confidence_interval' };

      const result = aggregateTrials(trials, config);

      if (result.aggregation.strategy === 'confidence_interval') {
        expect(result.aggregation.ci95Upper).toBeLessThanOrEqual(1);
        expect(result.aggregation.ci95Lower).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles single trial (no CI)', () => {
      const trials: TrialResult[] = [{ attempt: 0, score: 0.85, verdict: 'pass' }];
      const config: TrialsConfig = { count: 1, strategy: 'confidence_interval' };

      const result = aggregateTrials(trials, config);

      if (result.aggregation.strategy === 'confidence_interval') {
        expect(result.aggregation.mean).toBe(0.85);
        expect(result.aggregation.ci95Lower).toBe(0.85);
        expect(result.aggregation.ci95Upper).toBe(0.85);
        expect(result.aggregation.stddev).toBe(0);
      }
    });

    it('handles very low scores', () => {
      const trials: TrialResult[] = [
        { attempt: 0, score: 0.05, verdict: 'fail' },
        { attempt: 1, score: 0.1, verdict: 'fail' },
        { attempt: 2, score: 0.02, verdict: 'fail' },
      ];
      const config: TrialsConfig = { count: 3, strategy: 'confidence_interval' };

      const result = aggregateTrials(trials, config);

      if (result.aggregation.strategy === 'confidence_interval') {
        expect(result.aggregation.ci95Lower).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

describe('getTCritical', () => {
  it('returns correct value for df=1', () => {
    expect(getTCritical(1)).toBe(12.706);
  });

  it('returns correct value for df=10', () => {
    expect(getTCritical(10)).toBe(2.228);
  });

  it('returns correct value for df=29', () => {
    expect(getTCritical(29)).toBe(2.045);
  });

  it('returns 1.96 for df >= 30', () => {
    expect(getTCritical(30)).toBe(1.96);
    expect(getTCritical(100)).toBe(1.96);
  });

  it('returns df=1 value for df < 1', () => {
    expect(getTCritical(0)).toBe(12.706);
  });
});
