import { describe, expect, it } from 'vitest';
import { formatFailuresMarkdown, formatFailuresJson } from '../../../src/commands/results/failures.js';
import type { EvaluationResult } from '@agentv/core';

const makeResult = (overrides: Partial<EvaluationResult> = {}): EvaluationResult =>
  ({
    testId: 'test-1',
    score: 1,
    target: 'gpt-4',
    timestamp: '2026-01-01T00:00:00Z',
    assertions: [],
    output: [],
    executionStatus: 'success',
    ...overrides,
  }) as EvaluationResult;

describe('formatFailuresMarkdown', () => {
  it('shows only failed tests', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 1, assertions: [{ text: 'ok', passed: true }] }),
      makeResult({
        testId: 'fail-1',
        score: 0,
        assertions: [
          { text: 'contains greeting', passed: true },
          { text: "contains 'Dear'", passed: false, evidence: 'response was "Hi there"' },
        ],
      }),
    ];
    const output = formatFailuresMarkdown(results);
    expect(output).toContain('fail-1');
    expect(output).not.toContain('pass-1');
    expect(output).toContain('FAIL');
    expect(output).toContain("contains 'Dear'");
    expect(output).toContain('response was "Hi there"');
  });

  it('returns empty message when all pass', () => {
    const results = [makeResult({ score: 1 })];
    const output = formatFailuresMarkdown(results);
    expect(output).toContain('All tests passed');
  });
});

describe('formatFailuresJson', () => {
  it('returns only failed tests', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 1 }),
      makeResult({ testId: 'fail-1', score: 0.5 }),
    ];
    const json = formatFailuresJson(results);
    expect(json).toHaveLength(1);
    expect(json[0].testId).toBe('fail-1');
  });
});
