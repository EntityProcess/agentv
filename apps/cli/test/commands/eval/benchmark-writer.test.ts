import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { buildBenchmarkJson } from '../../../src/commands/eval/benchmark-writer.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2026-03-13T00:00:00.000Z',
    testId: 'test-1',
    score: 0.9,
    hits: [],
    misses: [],
    answer: 'test answer',
    target: 'test-target',
    verdict: 'pass',
    executionStatus: 'ok',
    ...overrides,
  } as EvaluationResult;
}

describe('buildBenchmarkJson', () => {
  it('computes pass_rate from per-evaluator scores', () => {
    const results = [
      makeResult({
        scores: [
          { name: 'a1', type: 'llm-judge', score: 0.9, hits: [], misses: [] },
          { name: 'a2', type: 'llm-judge', score: 0.7, hits: [], misses: [] },
          { name: 'a3', type: 'llm-judge', score: 0.85, hits: [], misses: [] },
        ],
      }),
    ];
    const benchmark = buildBenchmarkJson(results);
    // 2 of 3 pass (>= 0.8), so pass_rate = 2/3 ≈ 0.667
    expect(benchmark.run_summary.with_skill.pass_rate.mean).toBeCloseTo(0.667, 2);
    expect(benchmark.run_summary.with_skill.pass_rate.stddev).toBe(0);
  });

  it('falls back to top-level score when no evaluator scores', () => {
    const results = [makeResult({ score: 0.9 }), makeResult({ score: 0.5 })];
    const benchmark = buildBenchmarkJson(results);
    // First passes (>= 0.8 → 1.0), second fails (< 0.8 → 0.0), mean = 0.5
    expect(benchmark.run_summary.with_skill.pass_rate.mean).toBe(0.5);
    expect(benchmark.run_summary.with_skill.pass_rate.stddev).toBe(0.5);
  });

  it('computes time_seconds from durationMs', () => {
    const results = [makeResult({ durationMs: 30000 }), makeResult({ durationMs: 60000 })];
    const benchmark = buildBenchmarkJson(results);
    expect(benchmark.run_summary.with_skill.time_seconds.mean).toBe(45);
    expect(benchmark.run_summary.with_skill.time_seconds.stddev).toBe(15);
  });

  it('computes tokens from tokenUsage', () => {
    const results = [
      makeResult({ tokenUsage: { input: 1000, output: 500 } } as Partial<EvaluationResult>),
      makeResult({ tokenUsage: { input: 2000, output: 1000 } } as Partial<EvaluationResult>),
    ];
    const benchmark = buildBenchmarkJson(results);
    expect(benchmark.run_summary.with_skill.tokens.mean).toBe(2250);
    expect(benchmark.run_summary.with_skill.tokens.stddev).toBe(750);
  });

  it('handles empty results', () => {
    const benchmark = buildBenchmarkJson([]);
    expect(benchmark.run_summary.with_skill.pass_rate.mean).toBe(0);
    expect(benchmark.run_summary.with_skill.pass_rate.stddev).toBe(0);
  });

  it('handles results without timing or token data', () => {
    const results = [makeResult({})];
    const benchmark = buildBenchmarkJson(results);
    expect(benchmark.run_summary.with_skill.time_seconds.mean).toBe(0);
    expect(benchmark.run_summary.with_skill.tokens.mean).toBe(0);
  });
});
