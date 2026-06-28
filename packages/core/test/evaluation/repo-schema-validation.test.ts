import { describe, expect, it } from 'vitest';

import { EvalFileSchema } from '../../src/evaluation/validation/eval-file.schema.js';

describe('repo lifecycle schema validation', () => {
  const baseEval = {
    description: 'test',
    tests: [
      { id: 'test-1', input: [{ role: 'user', content: [{ type: 'text', value: 'hello' }] }] },
    ],
  };

  it('accepts workspace repos with provenance fields', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            commit: 'main',
            ancestor: 1,
            sparse: ['src', 'package.json'],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts GitHub org/name shorthand', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'org/repo',
            base_commit: '4a1b2c3d',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts Docker repo hints without repo identity', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        docker: { image: 'swebench/sweb.eval.django__django:latest' },
        repos: [{ path: '/testbed', base_commit: 'abc123' }],
      },
    });
    expect(result.success).toBe(true);
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

  it('rejects negative ancestor', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            ancestor: -1,
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects conflicting commit aliases', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
            commit: 'abc',
            base_commit: 'def',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts workspace with hooks after_each reset config', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
          },
        ],
        hooks: { after_each: { reset: 'fast' } },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with isolation field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        isolation: 'per_case',
        repos: [
          {
            path: './repo-a',
            repo: 'https://github.com/org/repo.git',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
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
