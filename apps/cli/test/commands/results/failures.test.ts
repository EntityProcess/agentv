import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { formatFailures } from '../../../src/commands/results/failures.js';

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

describe('formatFailures', () => {
  it('returns only failed tests', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 1 }),
      makeResult({ testId: 'fail-1', score: 0.5 }),
    ];
    const json = formatFailures(results);
    expect(json).toHaveLength(1);
    expect(json[0].testId).toBe('fail-1');
  });

  it('includes assertion details for failed tests', () => {
    const results = [
      makeResult({
        testId: 'fail-1',
        score: 0,
        assertions: [
          { text: 'contains greeting', passed: true },
          { text: "contains 'Dear'", passed: false, evidence: 'response was "Hi there"' },
        ],
      }),
    ];
    const json = formatFailures(results);
    expect(json).toHaveLength(1);
    expect(json[0].assertions).toHaveLength(2);
    expect(json[0].assertions[1].text).toBe("contains 'Dear'");
    expect(json[0].assertions[1].passed).toBe(false);
    expect(json[0].assertions[1].evidence).toBe('response was "Hi there"');
  });

  it('returns empty array when all pass', () => {
    const results = [makeResult({ score: 1 })];
    const json = formatFailures(results);
    expect(json).toHaveLength(0);
  });
});
