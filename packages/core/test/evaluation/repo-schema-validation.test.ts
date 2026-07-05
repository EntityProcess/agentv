import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EvalFileSchema } from '../../src/evaluation/validation/eval-file.schema.js';
import { validateEvalFile } from '../../src/evaluation/validation/eval-validator.js';

async function validateEvalYaml(body: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-env-schema-'));
  try {
    const evalPath = path.join(tempDir, 'suite.eval.yaml');
    writeFileSync(
      evalPath,
      `${body}
description: test
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    vars:
      input: hello
`,
    );
    return await validateEvalFile(evalPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function expectError(result: Awaited<ReturnType<typeof validateEvalYaml>>, location: string) {
  expect(result.valid).toBe(false);
  expect(result.errors).toContainEqual(
    expect.objectContaining({
      severity: 'error',
      location,
      message: expect.stringContaining('environment'),
    }),
  );
}

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

  it('rejects legacy source field', async () => {
    const result = await validateEvalYaml(`workspace:
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo.git`);
    expectError(result, 'workspace.repos');
  });

  it('rejects legacy checkout field', async () => {
    const result = await validateEvalYaml(`workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo.git
      checkout:
        resolve: remote`);
    expectError(result, 'workspace.repos');
  });

  it('rejects legacy clone field', async () => {
    const result = await validateEvalYaml(`workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo.git
      clone:
        depth: 1`);
    expectError(result, 'workspace.repos');
  });

  it('rejects removed repo acquisition fields', async () => {
    const result = await validateEvalYaml(`workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo.git
      type: git
      resolve: custom
      resolver: custom`);
    expectError(result, 'workspace.repos');
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

  it('keeps removed workspace authoring out of the public schema', () => {
    expect(EvalFileSchema.safeParse(baseEval).success).toBe(true);
    expect(EvalFileSchema.safeParse({ ...baseEval, workspace: {} }).success).toBe(true);
  });

  it('rejects public workspace scope field', async () => {
    const result = await validateEvalYaml(`workspace:
  scope: attempt`);
    expectError(result, 'workspace.scope');
  });

  it('rejects removed workspace isolation per_test value', async () => {
    const result = await validateEvalYaml(`workspace:
  isolation: per_test`);
    expectError(result, 'workspace.isolation');
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

  it('rejects removed workspace.mode', async () => {
    const result = await validateEvalYaml(`workspace:
  mode: temp`);
    expectError(result, 'workspace.mode');
  });

  it('rejects removed workspace.path', async () => {
    const result = await validateEvalYaml(`workspace:
  path: /tmp/my-workspace`);
    expectError(result, 'workspace.path');
  });

  it('rejects removed workspace.static_path field', async () => {
    const result = await validateEvalYaml(`workspace:
  static_path: /tmp/my-workspace`);
    expectError(result, 'workspace.static_path');
  });

  it('rejects removed workspace.pool field', async () => {
    const result = await validateEvalYaml(`workspace:
  pool: true`);
    expectError(result, 'workspace.pool');
  });
});
