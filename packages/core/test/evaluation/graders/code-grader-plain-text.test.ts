/**
 * Tests for code-grader plain-text fallback.
 *
 * When a script emits non-JSON stdout, the grader uses the exit code as
 * pass/fail (0 = score 1, non-zero = score 0) and stdout as the assertion
 * text. For numeric scores or multi-aspect results, use the JSON protocol.
 */

import { describe, expect, it } from 'vitest';
import { CodeGrader } from '../../../src/evaluation/graders/code-grader.js';
import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';

const ctx = { candidate: '', evalCase: { id: 'test', input: [] } } as unknown as EvaluationContext;

const grader = (cmd: string) =>
  new CodeGrader({ command: ['bash', '-c', cmd], agentTimeoutMs: 10_000 });

describe('code-grader plain-text fallback', () => {
  it('exit 0 with empty stdout → score 1, assertion text "exit 0"', async () => {
    const result = await grader('true').evaluate(ctx);
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions[0]).toMatchObject({ text: 'exit 0', passed: true });
  });

  it('exit 1 with empty stdout → score 0, assertion text "exit 1"', async () => {
    const result = await grader('false').evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions[0]).toMatchObject({ text: 'exit 1', passed: false });
  });

  it('exit 0 with stdout → score 1, stdout is assertion text', async () => {
    const result = await grader('echo "PDF has 14 pages (≥5 required)"').evaluate(ctx);
    expect(result.score).toBe(1);
    expect(result.assertions[0]).toMatchObject({
      text: 'PDF has 14 pages (≥5 required)',
      passed: true,
    });
  });

  it('exit 1 with stdout → score 0, stdout is assertion text', async () => {
    const result = await grader('echo "PDF has 3 pages (<5 required)"; exit 1').evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.assertions[0]).toMatchObject({
      text: 'PDF has 3 pages (<5 required)',
      passed: false,
    });
  });

  it('exit-code numeric comparison: [ 14 -ge 5 ] → score 1', async () => {
    const result = await grader('pages=14; [ "$pages" -ge 5 ]').evaluate(ctx);
    expect(result.score).toBe(1);
  });

  it('exit-code numeric comparison: [ 3 -ge 10 ] → score 0', async () => {
    const result = await grader('pages=3; [ "$pages" -ge 10 ]').evaluate(ctx);
    expect(result.score).toBe(0);
  });

  it('JSON protocol still works (score + assertions)', async () => {
    const result = await grader(
      `echo '{"score":0.6,"assertions":[{"text":"ok","passed":true}]}'`,
    ).evaluate(ctx);
    expect(result.score).toBe(0.6);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].text).toBe('ok');
  });

  it('script with stderr on non-zero exit → surfaces as error assertion', async () => {
    const result = await grader('echo "bad" >&2; exit 1').evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.assertions[0].text).toContain('exited with code');
  });
});
