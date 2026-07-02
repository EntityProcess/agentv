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

  it('rejects eval-level execution blocks', () => {
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

  it('rejects removed top-level runs and early_exit controls', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      runs: 2,
      early_exit: true,
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

  it('accepts top-level target object and repeat runtime controls with include selection entries', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      description: 'Wrapper eval',
      experiment: 'release-gate',
      target: {
        extends: 'codex',
        model: 'gpt-5.1',
        reasoning_effort: 'high',
      },
      threshold: 0.8,
      repeat: {
        count: 2,
        strategy: 'pass_any',
        early_exit: true,
      },
      timeout_seconds: 300,
      evaluate_options: {
        budget_usd: 2,
        max_concurrency: 3,
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
            repeat: { count: 2, strategy: 'pass_all', early_exit: true },
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

  it('rejects invalid evaluate_options.max_concurrency', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      evaluate_options: {
        max_concurrency: 0,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('accepts default_test.threshold as the preferred inherited test threshold', () => {
    const result = EvalFileSchema.safeParse({
      default_test: {
        threshold: 0.6,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a snake_cased promptfoo-shaped eval config', () => {
    const result = EvalFileSchema.safeParse({
      description: 'Promptfoo-compatible authoring shape',
      tags: {
        suite: 'smoke',
      },
      prompts: [
        {
          label: 'reviewer',
          raw: 'Review {{ vars.diff }}',
        },
      ],
      targets: [
        {
          id: 'local-agent',
          provider: 'codex',
          config: {
            model: 'gpt-5.4-mini',
          },
        },
      ],
      default_test: {
        vars: {
          tone: 'concise',
        },
        assert: ['Mentions the highest-risk issue'],
        options: {
          disable_default_asserts: true,
        },
        threshold: 0.7,
        metadata: {
          priority: 'p0',
        },
      },
      tests: [
        {
          description: 'grades a fixed provider output',
          vars: {
            diff: 'change',
          },
          provider_output: 'Looks safe.',
          assert: [
            {
              type: 'contains',
              value: 'safe',
              metric: 'safety_text',
              threshold: 0.5,
            },
            {
              type: 'g-eval',
              value: ['Identifies user impact', 'Avoids unsupported claims'],
              score_ranges: [{ score_range: [0, 10], outcome: 'overall quality' }],
            },
          ],
        },
      ],
      scenarios: [
        {
          description: 'severity variants',
          config: [{ vars: { severity: 'high' } }],
          tests: [
            {
              vars: { diff: 'critical fix' },
              assert: [{ type: 'llm-rubric', value: 'Flags the risk clearly' }],
            },
          ],
        },
      ],
      derived_metrics: [{ name: 'weighted_quality', value: 'safety_text * 0.5' }],
      output_path: 'results.json',
      env: {
        EVAL_MODE: 'local',
      },
      nunjucks_filters: {
        slug: './filters/slug.ts',
      },
      extensions: ['agentv:agent-rules'],
      evaluate_options: {
        cache: true,
        delay: 100,
        generate_suggestions: false,
        repeat: 2,
        timeout_ms: 30_000,
        max_eval_time_ms: 120_000,
        filter_range: [0, 10],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid default_test values', () => {
    const invalidThreshold = EvalFileSchema.safeParse({
      default_test: {
        threshold: 1.2,
      },
      tests: [baseTest],
    });
    const unknownDefault = EvalFileSchema.safeParse({
      default_test: {
        threshold: 0.6,
        unsupported: true,
      },
      tests: [baseTest],
    });

    expect(invalidThreshold.success).toBe(false);
    expect(unknownDefault.success).toBe(false);
  });

  it('rejects authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        runs: 2,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects top-level model because model belongs in target object', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      model: 'gpt-5.1',
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('accepts explicit rubrics criteria string shorthand', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assertions: [
            {
              type: 'rubrics',
              criteria: ['Must be polite', 'Must be accurate'],
            },
          ],
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
      threshold: 0.8,
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

  it('rejects lifecycle commands under authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      policy: {
        setup: [{ command: 'bun install' }],
        scripts: ['bun test'],
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects sandbox under authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        sandbox: 'auto',
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects camelCase fields under authored policy blocks', () => {
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
            setup: [{ command: 'bun install' }],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects removed workspace hook script alias', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          workspace: {
            hooks: {
              before_all: {
                script: ['bun', 'run', 'setup.ts'],
              },
            },
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
