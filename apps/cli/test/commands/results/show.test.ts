import type { EvaluationResult } from '@agentv/core';
import { describe, expect, it } from 'vitest';
import {
  findResult,
  formatShowJson,
  formatShowMarkdown,
} from '../../../src/commands/results/show.js';

const makeResult = (overrides: Partial<EvaluationResult> = {}): EvaluationResult =>
  ({
    testId: 'test-1',
    score: 0.5,
    target: 'gpt-4',
    timestamp: '2026-01-01T00:00:00Z',
    assertions: [
      { text: "contains 'Dear'", passed: false, evidence: "'Dear' not found" },
      { text: 'contains greeting', passed: true },
    ],
    output: [{ role: 'assistant', content: 'Hi there!' }],
    input: [{ role: 'user', content: 'Give a formal greeting' }],
    executionStatus: 'success',
    durationMs: 1200,
    tokenUsage: { input: 200, output: 120 },
    ...overrides,
  }) as EvaluationResult;

describe('findResult', () => {
  it('finds result by testId', () => {
    const results = [makeResult({ testId: 'a' }), makeResult({ testId: 'b' })];
    expect(findResult(results, 'b')?.testId).toBe('b');
  });

  it('returns undefined for missing testId', () => {
    const results = [makeResult({ testId: 'a' })];
    expect(findResult(results, 'nonexistent')).toBeUndefined();
  });
});

describe('formatShowMarkdown', () => {
  it('includes test ID, input, score, assertions, and response', () => {
    const result = makeResult();
    const output = formatShowMarkdown(result);
    expect(output).toContain('test-1');
    expect(output).toContain('Give a formal greeting');
    expect(output).toContain('0.5');
    expect(output).toContain('FAIL');
    expect(output).toContain('PASS');
    expect(output).toContain('Hi there!');
  });
});

describe('formatShowJson', () => {
  it('returns structured test detail', () => {
    const result = makeResult();
    const json = formatShowJson(result);
    expect(json.testId).toBe('test-1');
    expect(json.score).toBe(0.5);
    expect(json.assertions).toHaveLength(2);
  });
});
