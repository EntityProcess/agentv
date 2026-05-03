/**
 * Tests for code-grader plain-text fallback.
 *
 * When a code-grader script emits non-JSON stdout, the grader interprets it
 * as a simple score instead of requiring the full JSON protocol. This lets
 * shell one-liners work without a JSON wrapper.
 */

import { describe, expect, it } from 'vitest';
import { CodeGrader } from '../../../src/evaluation/graders/code-grader.js';
import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';

const ctx = { candidate: '', evalCase: { id: 'test', input: [] } } as unknown as EvaluationContext;

const grader = (cmd: string) =>
  new CodeGrader({
    command: ['bash', '-c', cmd],
    agentTimeoutMs: 10_000,
  });

describe('code-grader plain-text fallback', () => {
  it('exit 0 with empty stdout → score 1', async () => {
    const result = await grader('true').evaluate(ctx);
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });

  it('exit 1 with empty stdout → score 0', async () => {
    const result = await grader('false').evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('stdout "PASS" → score 1', async () => {
    const result = await grader('echo PASS').evaluate(ctx);
    expect(result.score).toBe(1);
  });

  it('stdout "FAIL" → score 0', async () => {
    const result = await grader('echo FAIL').evaluate(ctx);
    expect(result.score).toBe(0);
  });

  it('stdout "true" → score 1', async () => {
    const result = await grader('echo true').evaluate(ctx);
    expect(result.score).toBe(1);
  });

  it('stdout "false" → score 0', async () => {
    const result = await grader('echo false').evaluate(ctx);
    expect(result.score).toBe(0);
  });

  it('stdout numeric string → score as float', async () => {
    const result = await grader('echo 0.75').evaluate(ctx);
    expect(result.score).toBe(0.75);
  });

  it('stdout numeric "1" → score 1', async () => {
    const result = await grader('echo 1').evaluate(ctx);
    expect(result.score).toBe(1);
  });

  it('stdout numeric "0" → score 0', async () => {
    const result = await grader('echo 0').evaluate(ctx);
    expect(result.score).toBe(0);
  });

  it('exit-code numeric comparison: [ 14 -ge 5 ] → score 1', async () => {
    const result = await grader('pages=14; [ "$pages" -ge 5 ]').evaluate(ctx);
    expect(result.score).toBe(1);
  });

  it('exit-code numeric comparison: [ 3 -ge 10 ] → score 0', async () => {
    const result = await grader('pages=3; [ "$pages" -ge 10 ]').evaluate(ctx);
    expect(result.score).toBe(0);
  });

  it('JSON protocol still works (score from JSON)', async () => {
    const result = await grader(
      `echo '{"score":0.6,"assertions":[{"text":"ok","passed":true}]}'`,
    ).evaluate(ctx);
    expect(result.score).toBe(0.6);
    expect(result.assertions).toHaveLength(1);
  });
});
