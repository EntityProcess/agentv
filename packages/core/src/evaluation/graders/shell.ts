/**
 * Shell grader: runs a shell command and checks its stdout.
 *
 * Pass/fail logic:
 * - No `expected`: passes when exit code is 0.
 * - `expected`, no `operator`: trims stdout and compares as exact string.
 * - `expected` + `operator`: parses stdout and expected as floats, compares numerically.
 *
 * The command runs in the workspace directory when available.
 *
 * To add a new comparison operator: extend `ShellOperator` in types.ts and add a
 * case to `compareNumeric` below.
 */

import { execShellWithStdin } from '../../runtime/exec.js';
import type { ShellGraderConfig, ShellOperator } from '../types.js';
import { scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

function compareNumeric(actual: number, operator: ShellOperator, expected: number): boolean {
  switch (operator) {
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
  }
}

export class ShellGrader implements Grader {
  readonly kind = 'shell';

  constructor(private readonly config: ShellGraderConfig) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const { command, expected, operator } = this.config;
    const cwd = context.workspacePath;

    let result: { stdout: string; stderr: string; exitCode: number };
    try {
      result = await execShellWithStdin(command, '', { cwd });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Shell command error: ${msg}`, passed: false }],
        expectedAspectCount: 1,
      };
    }

    const stdout = result.stdout.trim();

    let passed: boolean;
    let assertionText: string;

    if (expected === undefined) {
      passed = result.exitCode === 0;
      assertionText = passed
        ? 'Command exited with code 0'
        : `Command exited with code ${result.exitCode}`;
    } else if (operator !== undefined) {
      const actualNum = Number.parseFloat(stdout);
      const expectedNum = Number.parseFloat(expected);
      if (Number.isNaN(actualNum) || Number.isNaN(expectedNum)) {
        return {
          score: 0,
          verdict: 'fail',
          assertions: [
            {
              text: `Cannot compare numerically: stdout="${stdout}", expected="${expected}"`,
              passed: false,
            },
          ],
          expectedAspectCount: 1,
        };
      }
      passed = compareNumeric(actualNum, operator, expectedNum);
      assertionText = passed
        ? `${actualNum} ${operator} ${expectedNum} (passed)`
        : `${actualNum} ${operator} ${expectedNum} (failed)`;
    } else {
      passed = stdout === expected;
      assertionText = passed
        ? `stdout "${stdout}" equals expected "${expected}"`
        : `stdout "${stdout}" does not equal expected "${expected}"`;
    }

    const score = passed ? 1 : 0;
    return {
      score,
      verdict: scoreToVerdict(score),
      assertions: [{ text: assertionText, passed }],
      expectedAspectCount: 1,
    };
  }
}
