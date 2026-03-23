import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import type { AggregateGradingArtifact } from '../../../src/commands/eval/artifact-writer.js';
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
    expect(json.pass_rate).toEqual({ mean: 0.5 });
    expect(json.failed_test_ids).toEqual(['test-2']);
  });

  it('computes pass_rate.mean as mean of per-test scores', () => {
    const results = [makeResult({ score: 0.8 }), makeResult({ score: 0.6 })];
    const json = formatSummary(results);
    expect(json.pass_rate).toEqual({ mean: 0.7 });
  });

  it('aggregates duration and tokens', () => {
    const results = [
      makeResult({ durationMs: 1000, tokenUsage: { input: 100, output: 50 } }),
      makeResult({ durationMs: 2000, tokenUsage: { input: 200, output: 100 } }),
    ];
    const json = formatSummary(results);
    expect(json.total_duration_ms).toBe(3000);
    expect(json.total_tokens).toBe(450);
  });

  it('handles missing tokenUsage gracefully', () => {
    const results = [makeResult({ tokenUsage: undefined })];
    const json = formatSummary(results);
    expect(json.total_tokens).toBe(0);
  });

  it('handles missing durationMs gracefully', () => {
    const results = [makeResult({ durationMs: undefined })];
    const json = formatSummary(results);
    expect(json.total_duration_ms).toBe(0);
  });

  it('returns empty failedTestIds when all pass', () => {
    const results = [makeResult({ score: 1 })];
    const json = formatSummary(results);
    expect(json.failed_test_ids).toEqual([]);
  });

  it('handles empty results', () => {
    const json = formatSummary([]);
    expect(json.total).toBe(0);
    expect(json.pass_rate).toEqual({ mean: 0 });
  });
});

describe('formatSummary with grading artifact', () => {
  it('uses assertion counts from grading artifact when provided', () => {
    const grading: AggregateGradingArtifact = {
      assertions: [
        { test_id: 'test-1', text: 'a', passed: true, evidence: '' },
        { test_id: 'test-1', text: 'b', passed: false, evidence: 'missing' },
        { test_id: 'test-2', text: 'c', passed: true, evidence: '' },
      ],
      summary: { passed: 2, failed: 1, total: 3, pass_rate: 0.667 },
    };

    const results = [
      makeResult({
        testId: 'test-1',
        score: 0.5,
        durationMs: 1000,
        tokenUsage: { input: 100, output: 50 },
      }),
      makeResult({
        testId: 'test-2',
        score: 1.0,
        durationMs: 2000,
        tokenUsage: { input: 200, output: 100 },
      }),
    ];

    const json = formatSummary(results, grading);

    // pass_rate comes from grading artifact summary
    expect(json.pass_rate).toEqual({ mean: 0.667 });
    // passed/failed counts from grading artifact (assertion-level)
    expect(json.passed).toBe(2);
    expect(json.failed).toBe(1);
    // total is still number of tests
    expect(json.total).toBe(2);
    // duration and tokens still computed from results
    expect(json.total_duration_ms).toBe(3000);
    expect(json.total_tokens).toBe(450);
  });

  it('falls back to JSONL computation when no grading artifact', () => {
    const results = [
      makeResult({ testId: 'test-1', score: 1.0 }),
      makeResult({ testId: 'test-2', score: 0.0 }),
    ];

    const json = formatSummary(results);

    // Without grading artifact, uses per-test score-based computation
    expect(json.passed).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.pass_rate).toEqual({ mean: 0.5 });
  });
});
