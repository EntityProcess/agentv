/**
 * Tests for script-grader plain-text fallback.
 *
 * When a script emits non-JSON stdout, the grader uses the exit code as
 * pass/fail (0 = score 1, non-zero = score 0) and stdout as the check
 * text. For numeric scores or multi-aspect results, use the JSON protocol.
 */

import { describe, expect, it } from 'vitest';
import { ScriptGrader } from '../../../src/evaluation/graders/script-grader.js';
import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';

const ctx = { candidate: '', evalCase: { id: 'test', input: [] } } as unknown as EvaluationContext;

const grader = (cmd: string) =>
  new ScriptGrader({ command: ['bash', '-c', cmd], agentTimeoutMs: 10_000 });

describe('script-grader plain-text fallback', () => {
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

  it('JSON protocol accepts aggregate pass/score/reason without checks', async () => {
    const result = await grader(
      `echo '{"pass":true,"score":0.6,"reason":"Aggregate script score passed"}'`,
    ).evaluate(ctx);
    expect(result.score).toBe(0.6);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('Aggregate script score passed');
    expect(result.checks).toEqual([]);
    expect(result.assertions).toEqual([]);
  });

  it('JSON protocol preserves checks with scores', async () => {
    const result = await grader(
      `echo '{"pass":false,"score":0.4,"reason":"One weighted check failed","checks":[{"id":"a","text":"A","pass":true,"score":1,"reason":"A passed"},{"id":"b","text":"B","pass":false,"score":0.2,"reason":"B failed","evidence":"Observed B"}]}'`,
    ).evaluate(ctx);
    expect(result.score).toBe(0.4);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toBe('One weighted check failed');
    expect(result.checks).toEqual([
      { id: 'a', text: 'A', pass: true, score: 1, reason: 'A passed' },
      {
        id: 'b',
        text: 'B',
        pass: false,
        score: 0.2,
        reason: 'B failed',
        evidence: 'Observed B',
      },
    ]);
    expect(result.assertions).toEqual([
      { text: 'A', passed: true },
      { text: 'B', passed: false, evidence: 'Observed B' },
    ]);
  });

  it('checks without score derive aggregate score from pass ratio', async () => {
    const result = await grader(
      `echo '{"reason":"Two checks, one pass","checks":[{"text":"a","pass":true,"reason":"A passed"},{"text":"b","pass":false,"reason":"B failed"}]}'`,
    ).evaluate(ctx);
    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('fail');
    expect(result.checks).toEqual([
      { text: 'a', pass: true, reason: 'A passed' },
      { text: 'b', pass: false, reason: 'B failed' },
    ]);
  });

  it('script with stderr on non-zero exit → surfaces as error assertion', async () => {
    const result = await grader('echo "bad" >&2; exit 1').evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.assertions[0].text).toContain('exited with code');
  });
});
