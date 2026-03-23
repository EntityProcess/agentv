import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { formatSummary } from '../../../src/commands/results/summary.js';

const makeResult = (overrides: Partial<EvaluationResult> = {}): EvaluationResult =>
  ({
    testId: 'test-1',
    score: 1,
    target: 'gpt-4',
    timestamp: '2026-01-01T00:00:00Z',
    assertions: [],
    output: [],
    executionStatus: 'success',
    durationMs: 1200,
    tokenUsage: { input: 100, output: 50 },
    ...overrides,
  }) as EvaluationResult;

describe('formatSummary', () => {
  it('returns structured summary object', () => {
    const results = [
      makeResult({ testId: 'test-1', score: 1 }),
      makeResult({ testId: 'test-2', score: 0 }),
    ];
    const json = formatSummary(results);
    expect(json.total).toBe(2);
    expect(json.passed).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.passRate).toBe(0.5);
    expect(json.failedTestIds).toEqual(['test-2']);
  });

  it('computes mean score correctly', () => {
    const results = [makeResult({ score: 0.8 }), makeResult({ score: 0.6 })];
    const json = formatSummary(results);
    expect(json.meanScore).toBe(0.7);
  });

  it('aggregates duration and tokens', () => {
    const results = [
      makeResult({ durationMs: 1000, tokenUsage: { input: 100, output: 50 } }),
      makeResult({ durationMs: 2000, tokenUsage: { input: 200, output: 100 } }),
    ];
    const json = formatSummary(results);
    expect(json.totalDurationMs).toBe(3000);
    expect(json.totalTokens).toBe(450);
  });

  it('handles missing tokenUsage gracefully', () => {
    const results = [makeResult({ tokenUsage: undefined })];
    const json = formatSummary(results);
    expect(json.totalTokens).toBe(0);
  });

  it('handles missing durationMs gracefully', () => {
    const results = [makeResult({ durationMs: undefined })];
    const json = formatSummary(results);
    expect(json.totalDurationMs).toBe(0);
  });

  it('returns empty failedTestIds when all pass', () => {
    const results = [makeResult({ score: 1 })];
    const json = formatSummary(results);
    expect(json.failedTestIds).toEqual([]);
  });

  it('handles empty results', () => {
    const json = formatSummary([]);
    expect(json.total).toBe(0);
    expect(json.passRate).toBe(0);
  });
});
