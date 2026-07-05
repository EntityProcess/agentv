import { describe, expect, it } from 'vitest';

import { EvalFileSchema } from '../../src/evaluation/validation/eval-file.schema.js';

describe('environment recipe schema validation', () => {
  const baseEval = {
    description: 'test',
    prompts: ['{{ input }}'],
    tests: [
      {
        id: 'test-1',
        vars: { input: [{ role: 'user', content: [{ type: 'text', value: 'hello' }] }] },
      },
    ],
  };

  it('accepts host environment setup argv with cwd and timeout', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      environment: {
        type: 'host',
        workdir: './repo-a',
        setup: {
          command: ['bash', '-lc', 'bun install && bun run build'],
          cwd: '.',
          timeout_ms: 120000,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects environment setup args with actionable guidance', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      environment: {
        type: 'host',
        workdir: './repo-a',
        setup: {
          command: ['bash', './setup.sh'],
          args: {
            repo: 'https://github.com/org/repo.git',
          },
        },
      },
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes('environment.setup.args')),
    ).toBe(true);
  });

  it('rejects string environment setup commands', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      environment: {
        type: 'host',
        workdir: './repo-a',
        setup: {
          command: './setup.sh',
        },
      },
    });
    expect(result.success).toBe(false);
    expect(
      JSON.stringify(result.error?.issues).includes(
        'environment.setup.command must be a non-empty argv array',
      ),
    ).toBe(true);
  });

  it('rejects legacy source field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects legacy checkout field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            checkout: { resolve: 'remote' },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects legacy clone field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            clone: { depth: 1 },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed repo acquisition fields', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            type: 'git',
            resolve: 'custom',
            resolver: 'custom',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown environment fields', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      environment: {
        type: 'host',
        workdir: './repo-a',
        repos: [{ repo: 'https://github.com/org/repo.git' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts internal workspace hooks after_each reset config', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        hooks: { after_each: { reset: 'fast' } },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects public workspace scope field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        scope: 'attempt',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed workspace isolation per_test value', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        isolation: 'per_test',
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects experiment workspace blocks', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      experiment: {
        workspace: {
          isolation: 'per_test',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects experiment workspace runtime override fields', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      experiment: {
        workspace: {
          mode: 'static',
          path: '/tmp/my-workspace',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects test execution workspace blocks', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      tests: [
        {
          ...baseEval.tests[0],
          execution: {
            workspace: {
              mode: 'static',
              path: '/tmp/my-workspace',
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects task workspace fields in experiment workspace', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      experiment: {
        workspace: {
          repos: [
            {
              path: './repo-a',
              repo: 'https://github.com/org/repo.git',
            },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed workspace.mode', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        mode: 'temp',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed workspace.path', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        path: '/tmp/my-workspace',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed workspace.static_path field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        mode: 'static',
        static_path: '/tmp/my-workspace',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed workspace.pool field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        pool: true,
      },
    });
    expect(result.success).toBe(false);
  });
});
