import { describe, expect, it } from 'vitest';

import { EvalFileSchema } from '../../src/evaluation/validation/eval-file.schema.js';

describe('repo lifecycle schema validation', () => {
  const baseEval = {
    description: 'test',
    tests: [
      { id: 'test-1', input: [{ role: 'user', content: [{ type: 'text', value: 'hello' }] }] },
    ],
  };

  it('accepts workspace with repos (git source)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ref: 'main' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with repos (local source)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-b',
            source: { type: 'local', path: '/opt/mirrors/repo-b' },
            checkout: { ref: '4a1b2c3d' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with full clone options', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ref: 'main', resolve: 'remote', ancestor: 1 },
            clone: { depth: 2, filter: 'blob:none', sparse: ['src/**', 'package.json'] },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with hooks after_each reset config', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
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
        isolation: 'per_test',
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid source type', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'svn', url: 'https://example.com' },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid hooks after_each reset mode', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        hooks: { after_each: { reset: 'invalid' } },
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
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ancestor: -1 },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clone depth of 0', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            clone: { depth: 0 },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('preserves existing workspace fields (template, hooks)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        template: './fixtures',
        hooks: {
          before_all: { command: ['bash', 'setup.sh'] },
          after_each: { reset: 'fast' },
        },
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});
