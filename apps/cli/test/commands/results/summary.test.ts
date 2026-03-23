import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { formatSummaryJson, formatSummaryMarkdown } from '../../../src/commands/results/summary.js';

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

describe('formatSummaryMarkdown', () => {
  it('shows pass/fail counts and pass rate', () => {
    const results = [
      makeResult({ testId: 'test-1', score: 1 }),
      makeResult({ testId: 'test-2', score: 0 }),
    ];
    const output = formatSummaryMarkdown(results);
    expect(output).toContain('2 tests');
    expect(output).toContain('1 passed');
    expect(output).toContain('1 failed');
    expect(output).toContain('50%');
  });

  it('lists failed test IDs', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 1 }),
      makeResult({ testId: 'fail-1', score: 0 }),
      makeResult({ testId: 'fail-2', score: 0.5 }),
    ];
    const output = formatSummaryMarkdown(results);
    expect(output).toContain('fail-1');
    expect(output).toContain('fail-2');
    expect(output).not.toContain('pass-1');
  });

  it('shows score, duration, and tokens', () => {
    const results = [
      makeResult({
        score: 0.8,
        durationMs: 5000,
        tokenUsage: { input: 500, output: 300 },
      }),
    ];
    const output = formatSummaryMarkdown(results);
    expect(output).toContain('0.80');
    expect(output).toContain('5.0s');
    expect(output).toContain('800');
  });

  it('handles empty results', () => {
    const output = formatSummaryMarkdown([]);
    expect(output).toContain('0 tests');
    expect(output).toContain('0%');
  });

  it('formats duration in ms when under 1 second', () => {
    const results = [makeResult({ durationMs: 450 })];
    const output = formatSummaryMarkdown(results);
    expect(output).toContain('450ms');
  });

  it('omits failed section when all pass', () => {
    const results = [makeResult({ score: 1 }), makeResult({ score: 1 })];
    const output = formatSummaryMarkdown(results);
    expect(output).not.toContain('Failed:');
  });
});

describe('formatSummaryJson', () => {
  it('returns structured summary object', () => {
    const results = [
      makeResult({ testId: 'test-1', score: 1 }),
      makeResult({ testId: 'test-2', score: 0 }),
    ];
    const json = formatSummaryJson(results);
    expect(json.total).toBe(2);
    expect(json.passed).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.passRate).toBe(0.5);
    expect(json.failedTestIds).toEqual(['test-2']);
  });

  it('computes mean score correctly', () => {
    const results = [makeResult({ score: 0.8 }), makeResult({ score: 0.6 })];
    const json = formatSummaryJson(results);
    expect(json.meanScore).toBe(0.7);
  });

  it('aggregates duration and tokens', () => {
    const results = [
      makeResult({ durationMs: 1000, tokenUsage: { input: 100, output: 50 } }),
      makeResult({ durationMs: 2000, tokenUsage: { input: 200, output: 100 } }),
    ];
    const json = formatSummaryJson(results);
    expect(json.totalDurationMs).toBe(3000);
    expect(json.totalTokens).toBe(450);
  });

  it('handles missing tokenUsage gracefully', () => {
    const results = [makeResult({ tokenUsage: undefined })];
    const json = formatSummaryJson(results);
    expect(json.totalTokens).toBe(0);
  });

  it('handles missing durationMs gracefully', () => {
    const results = [makeResult({ durationMs: undefined })];
    const json = formatSummaryJson(results);
    expect(json.totalDurationMs).toBe(0);
  });

  it('returns empty failedTestIds when all pass', () => {
    const results = [makeResult({ score: 1 })];
    const json = formatSummaryJson(results);
    expect(json.failedTestIds).toEqual([]);
  });
});
