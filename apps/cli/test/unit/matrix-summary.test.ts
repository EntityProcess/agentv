import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { formatMatrixSummary } from '../../src/commands/eval/statistics.js';

function makeResult(testId: string, target: string, score: number): EvaluationResult {
  return {
    timestamp: new Date().toISOString(),
    testId,
    score,
    hits: [],
    misses: [],
    answer: '',
    target,
  };
}

describe('formatMatrixSummary', () => {
  it('returns empty string for single target', () => {
    const results = [makeResult('test-1', 'copilot', 0.8)];
    expect(formatMatrixSummary(results)).toBe('');
  });

  it('formats matrix table for multiple targets', () => {
    const results = [
      makeResult('test-1', 'copilot', 0.9),
      makeResult('test-1', 'claude', 0.7),
      makeResult('test-2', 'copilot', 0.6),
      makeResult('test-2', 'claude', 0.8),
    ];
    const output = formatMatrixSummary(results);
    expect(output).toContain('MATRIX RESULTS');
    expect(output).toContain('copilot');
    expect(output).toContain('claude');
    expect(output).toContain('test-1');
    expect(output).toContain('test-2');
    expect(output).toContain('Average');
    expect(output).toContain('0.900');
    expect(output).toContain('0.700');
  });

  it('handles missing test-target pairs with dash', () => {
    const results = [makeResult('test-1', 'copilot', 0.9), makeResult('test-2', 'claude', 0.8)];
    const output = formatMatrixSummary(results);
    expect(output).toContain('-');
  });
});
