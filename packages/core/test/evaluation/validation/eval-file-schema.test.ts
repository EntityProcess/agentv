import { describe, expect, it } from 'bun:test';

import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

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

  it('rejects eval-level execution.trials because run counts belong on experiments', () => {
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

  it('accepts inline experiment runtime and include selection entries', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      experiment: {
        targets: ['codex', 'claude'],
        workers: 2,
        threshold: 0.8,
        repeat: { count: 2, strategy: 'mean' },
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

  it('rejects eval files that set both experiment and legacy execution', () => {
    const result = EvalFileSchema.safeParse({
      experiment: { target: 'codex' },
      execution: { target: 'claude' },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects experiment lifecycle commands', () => {
    const result = EvalFileSchema.safeParse({
      experiment: {
        setup: [{ script: 'bun install' }],
        scripts: ['bun test'],
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
});
