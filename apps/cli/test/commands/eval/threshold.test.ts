import { describe, expect, it } from 'bun:test';

import { formatThresholdSummary } from '../../../src/commands/eval/statistics.js';

describe('formatThresholdSummary', () => {
  it('returns PASS when mean score meets threshold', () => {
    const result = formatThresholdSummary(0.85, 0.6);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('0.85');
    expect(result.message).toContain('0.60');
    expect(result.message).toContain('PASS');
  });

  it('returns FAIL when mean score is below threshold', () => {
    const result = formatThresholdSummary(0.53, 0.6);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('0.53');
    expect(result.message).toContain('0.60');
    expect(result.message).toContain('FAIL');
  });

  it('returns PASS when mean score exactly equals threshold', () => {
    const result = formatThresholdSummary(0.6, 0.6);
    expect(result.passed).toBe(true);
  });

  it('returns PASS for threshold 0 with any score', () => {
    const result = formatThresholdSummary(0, 0);
    expect(result.passed).toBe(true);
  });
});
