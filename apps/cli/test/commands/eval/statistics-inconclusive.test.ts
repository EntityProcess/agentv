import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';

import {
  calculateEvaluationSummary,
  formatEvaluationSummary,
} from '../../../src/commands/eval/statistics.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    testId: 'test-1',
    score: 1.0,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: [{ role: 'assistant' as const, content: 'answer' }],
    target: 'default',
    executionStatus: 'ok',
    ...overrides,
  };
}

describe('formatEvaluationSummary — error verdict', () => {
  it('shows ERROR when all tests are execution errors', () => {
    const results = [
      makeResult({
        testId: 'err-1',
        score: 0,
        executionStatus: 'execution_error',
        error: 'Not Found',
      }),
      makeResult({
        testId: 'err-2',
        score: 0,
        executionStatus: 'execution_error',
        error: 'Not Found',
      }),
      makeResult({
        testId: 'err-3',
        score: 0,
        executionStatus: 'execution_error',
        error: 'Not Found',
      }),
    ];

    const summary = calculateEvaluationSummary(results);
    const output = formatEvaluationSummary(summary);

    expect(output).toContain('RESULT: ERROR');
    expect(output).toContain('all 3 test(s) had execution errors');
    expect(output).toContain('no evaluation was performed');
  });

  it('shows PASS/FAIL when only some tests are execution errors', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 0.9, executionStatus: 'ok' }),
      makeResult({
        testId: 'err-1',
        score: 0,
        executionStatus: 'execution_error',
        error: 'Not Found',
      }),
    ];

    const summary = calculateEvaluationSummary(results);
    const output = formatEvaluationSummary(summary);

    // Should show PASS (the one graded test passed) not ERROR
    expect(output).toContain('RESULT: PASS');
    expect(output).not.toContain('RESULT: ERROR');
  });

  it('shows FAIL when there are quality failures mixed with execution errors', () => {
    const results = [
      makeResult({ testId: 'fail-1', score: 0.3, executionStatus: 'quality_failure' }),
      makeResult({
        testId: 'err-1',
        score: 0,
        executionStatus: 'execution_error',
        error: 'Not Found',
      }),
    ];

    const summary = calculateEvaluationSummary(results, { threshold: 0.8 });
    const output = formatEvaluationSummary(summary, { threshold: 0.8 });

    expect(output).toContain('RESULT: FAIL');
    expect(output).not.toContain('RESULT: ERROR');
  });

  it('shows PASS when all tests pass and none are errors', () => {
    const results = [
      makeResult({ testId: 'pass-1', score: 0.9, executionStatus: 'ok' }),
      makeResult({ testId: 'pass-2', score: 0.85, executionStatus: 'ok' }),
    ];

    const summary = calculateEvaluationSummary(results);
    const output = formatEvaluationSummary(summary);

    expect(output).toContain('RESULT: PASS');
    expect(output).not.toContain('RESULT: ERROR');
  });
});
