import { describe, expect, it } from 'bun:test';
import type { ZodIssue } from 'zod';

import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

function collectIssueMessages(issues: readonly ZodIssue[]): string[] {
  const messages: string[] = [];
  for (const issue of issues) {
    messages.push(issue.message);
    if (issue.code === 'invalid_union') {
      for (const unionError of issue.unionErrors) {
        messages.push(...collectIssueMessages(unionError.issues));
      }
    }
  }
  return messages;
}

describe('EvalFileSchema input shorthand', () => {
  const baseTest = {
    id: 'test-1',
    criteria: 'Goal',
    input: 'Classify this request.',
  };

  it('accepts structured object input shorthand without a top-level role key', () => {
    const result = EvalFileSchema.safeParse({
      input: { task: 'classify', labels: ['bug', 'feature'] },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a single message-shaped input object with a top-level role key', () => {
    const result = EvalFileSchema.safeParse({
      input: { role: 'user', content: { task: 'classify' } },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('rejects object input with a reserved top-level role key unless it is a valid message', () => {
    const result = EvalFileSchema.safeParse({
      input: { role: 'admin', task: 'classify' },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects eval-level execution.trials because run counts belong under policy.repeat', () => {
    const result = EvalFileSchema.safeParse({
      execution: {
        trials: {
          count: 2,
          strategy: 'pass_at_k',
        },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('accepts workspace env preflight requirements', () => {
    const result = EvalFileSchema.safeParse({
      workspace: {
        env: {
          required_commands: ['git'],
          required_python_modules: ['json'],
        },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts top-level target and policy runtime controls with include selection entries', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      target: 'codex',
      policy: {
        threshold: 0.8,
        repeat: { count: 2, strategy: 'mean' },
        early_exit: true,
        timeout_seconds: 300,
        budget_usd: 2,
        sandbox: 'auto',
      },
      tests: [
        {
          include: './evals/**/*.eval.yaml',
          type: 'suite',
          select: {
            test_ids: ['pr50857-*'],
            tags: ['sql-migration'],
            metadata: {
              type: ['e2e', 'regression'],
              priority: 'high',
            },
          },
          run: {
            threshold: 1,
            repeat: { count: 2, strategy: 'pass_all' },
            timeout_seconds: 120,
            budget_usd: 2,
          },
        },
        {
          include: './cases/**/*.cases.yaml',
          type: 'tests',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts flatter imports with optional inline tests', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      imports: {
        suites: [
          {
            path: './evals/**/*.eval.yaml',
            select: {
              test_ids: ['pr50857-*'],
              tags: ['sql-migration'],
            },
            run: {
              threshold: 1,
              repeat: { count: 2, strategy: 'pass_all' },
              timeout_seconds: 120,
              budget_usd: 2,
            },
          },
        ],
        tests: [{ path: './cases/**/*.cases.yaml' }, './cases/regressions.jsonl'],
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts import-only wrapper evals', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      target: 'codex',
      policy: { threshold: 0.8 },
      imports: {
        suites: [{ path: './evals/**/*.eval.yaml' }],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects removed experiment authoring blocks', () => {
    const result = EvalFileSchema.safeParse({
      experiment: { target: 'codex' },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects lifecycle commands under policy', () => {
    const result = EvalFileSchema.safeParse({
      policy: {
        setup: [{ script: 'bun install' }],
        scripts: ['bun test'],
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects camelCase policy fields in YAML', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        timeoutSeconds: 300,
        repeat: { count: 2, costLimitUsd: 1 },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects scoped run overrides that change the target or setup', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          id: 'case-1',
          input: 'Question',
          criteria: 'Goal',
          run: {
            target: 'other-agent',
            setup: [{ script: 'bun install' }],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('does not accept test-level execution.targets', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          execution: {
            targets: ['codex'],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected test-level execution.targets to be rejected');
    expect(collectIssueMessages(result.error.issues)).toContain(
      "Unrecognized key(s) in object: 'targets'",
    );
  });

  it('does not accept test-level execution.target', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          execution: {
            target: 'codex',
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected test-level execution.target to be rejected');
    expect(collectIssueMessages(result.error.issues)).toContain(
      "Unrecognized key(s) in object: 'target'",
    );
  });
});
