import { describe, expect, it } from 'vitest';
import { ShellGrader } from '../../../src/evaluation/graders/shell.js';
import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';
import type { ShellGraderConfig } from '../../../src/evaluation/types.js';

const mockContext = (workspacePath?: string): EvaluationContext =>
  ({
    candidate: '',
    workspacePath,
    evalCase: { id: 'test', input: [] },
  }) as unknown as EvaluationContext;

const grader = (extra: Partial<ShellGraderConfig> = {}) =>
  new ShellGrader({ name: 'test-shell', type: 'shell', command: 'echo 5', ...extra });

describe('ShellGrader', () => {
  it('passes when command exits 0 and no expected', async () => {
    const result = await grader({ command: 'true' }).evaluate(mockContext());
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });

  it('fails when command exits non-zero and no expected', async () => {
    const result = await grader({ command: 'false' }).evaluate(mockContext());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('passes on exact string match', async () => {
    const result = await grader({ command: 'echo hello', expected: 'hello' }).evaluate(
      mockContext(),
    );
    expect(result.score).toBe(1);
  });

  it('fails on string mismatch', async () => {
    const result = await grader({ command: 'echo hello', expected: 'world' }).evaluate(
      mockContext(),
    );
    expect(result.score).toBe(0);
    expect(result.assertions[0].text).toContain('does not equal');
  });

  it.each([
    ['>', 10, 5, 1],
    ['>', 5, 10, 0],
    ['<', 3, 10, 1],
    ['>=', 5, 5, 1],
    ['<=', 5, 5, 1],
    ['==', 7, 7, 1],
    ['!=', 7, 5, 1],
    ['!=', 5, 5, 0],
  ] as const)(
    'numeric operator %s: actual=%d, expected=%d → score=%d',
    async (op, actual, expected, score) => {
      const result = await grader({
        command: `echo ${actual}`,
        operator: op,
        expected: String(expected),
      }).evaluate(mockContext());
      expect(result.score).toBe(score);
    },
  );

  it('fails with clear message when stdout is not a number for numeric comparison', async () => {
    const result = await grader({
      command: 'echo notanumber',
      operator: '>=',
      expected: '5',
    }).evaluate(mockContext());
    expect(result.score).toBe(0);
    expect(result.assertions[0].text).toContain('Cannot compare numerically');
  });

  it('returns score 0 when command errors', async () => {
    const result = await grader({ command: 'nonexistent_command_xyz_abc_987' }).evaluate(
      mockContext(),
    );
    expect(result.score).toBe(0);
  });
});
