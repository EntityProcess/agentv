import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareHostEnvironment } from '../../src/evaluation/environment/host.js';
import { type RunEvaluationOptions, runEvaluation } from '../../src/evaluation/orchestrator.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function baseEvalCase(overrides: Partial<EvalTest>): EvalTest {
  return {
    id: 'case-1',
    suite: 'environment-host-runtime',
    question: 'Return ok',
    input: [{ role: 'user', content: 'Return ok' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: '',
    assertions: [{ name: 'contains-ok', type: 'contains', value: 'ok' }],
    ...overrides,
  };
}

function providerFactory(captured: ProviderRequest[]): RunEvaluationOptions['providerFactory'] {
  return (target): Provider => ({
    id: `${target.kind}:${target.name}`,
    kind: target.kind,
    targetName: target.name,
    async invoke(request): Promise<ProviderResponse> {
      captured.push(request);
      return {
        output: [{ role: 'assistant', content: 'ok' }],
        durationMs: 1,
      };
    },
  });
}

describe('host environment runtime', () => {
  it('creates host workdir and passes deterministic setup args on stdin from recipe source cwd', async () => {
    const root = tempDir('agentv-host-env-');
    const sourceDir = path.join(root, '.agentv/environments');
    const workdir = path.join(sourceDir, 'checkout');
    await mkdir(sourceDir, { recursive: true });
    const setupScript = path.join(sourceDir, 'setup.mjs');
    await writeFile(
      setupScript,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "import path from 'node:path';",
        "const payload = JSON.parse(readFileSync(0, 'utf8'));",
        "writeFileSync(path.join(payload.environment.workdir, 'setup-payload.json'), JSON.stringify({ payload, cwd: process.cwd(), envWorkdir: process.env.AGENTV_ENVIRONMENT_WORKDIR }, null, 2));",
      ].join('\n'),
    );

    const result = await prepareHostEnvironment({
      type: 'host',
      workdir,
      sourceDir,
      setup: {
        command: ['node', 'setup.mjs'],
        args: {
          repo: 'example/repo',
          nested: { count: 2, enabled: true },
        },
      },
    });

    const payload = JSON.parse(await readFile(path.join(workdir, 'setup-payload.json'), 'utf8'));
    expect(result.status).toBe('success');
    expect(existsSync(workdir)).toBe(true);
    expect(payload.cwd).toBe(sourceDir);
    expect(payload.envWorkdir).toBe(workdir);
    expect(payload.payload).toEqual({
      args: {
        repo: 'example/repo',
        nested: { count: 2, enabled: true },
      },
      environment: {
        type: 'host',
        workdir,
      },
    });
  });

  it('returns structured setup failure details for non-zero setup commands', async () => {
    const root = tempDir('agentv-host-env-fail-');
    await expect(
      prepareHostEnvironment({
        type: 'host',
        workdir: path.join(root, 'checkout'),
        sourceDir: root,
        setup: {
          command: ['node', '-e', "console.error('setup failed'); process.exit(7)"],
          args: { reason: 'test' },
        },
      }),
    ).rejects.toMatchObject({
      result: {
        status: 'failed',
        exitCode: 7,
        stderr: 'setup failed\n',
        args: { reason: 'test' },
      },
    });
  });

  it('passes environment workdir to generic provider requests and script graders', async () => {
    const root = tempDir('agentv-host-env-eval-');
    const workdir = path.join(root, 'workdir');
    const sourceDir = path.join(root, '.agentv/environments');
    const legacyTemplate = path.join(root, 'legacy-template');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(legacyTemplate, { recursive: true });
    const setupScript = path.join(sourceDir, 'setup.mjs');
    const graderScript = path.join(root, 'grader.mjs');
    await writeFile(
      setupScript,
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.AGENTV_ENVIRONMENT_WORKDIR + '/ready.txt', 'ready');\n",
    );
    await writeFile(
      graderScript,
      [
        "import { readFileSync } from 'node:fs';",
        "const payload = JSON.parse(readFileSync(0, 'utf8'));",
        "const pass = process.cwd() === payload.workspace_path && payload.workspace_path.endsWith('/workdir');",
        "console.log(JSON.stringify({ pass, score: pass ? 1 : 0, reason: process.cwd(), checks: [{ text: 'cwd matches environment workdir', pass, reason: payload.workspace_path }] }));",
      ].join('\n'),
    );

    const capturedRequests: ProviderRequest[] = [];
    const results = await runEvaluation({
      testFilePath: path.join(root, 'suite.eval.yaml'),
      repoRoot: root,
      target: { kind: 'cli', name: 'generic-cli', config: {} },
      providerFactory: providerFactory(capturedRequests),
      evalCases: [
        baseEvalCase({
          environment: {
            type: 'host',
            workdir,
            sourceDir,
            setup: { command: ['node', 'setup.mjs'] },
          },
          workspace: {
            template: legacyTemplate,
          },
          assertions: [
            {
              name: 'script-cwd',
              type: 'script',
              command: ['node', graderScript],
            },
          ],
        }),
      ],
      maxConcurrency: 1,
      retainOnSuccess: 'cleanup',
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].cwd).toBe(workdir);
    expect(results[0].score).toBe(1);
    expect(results[0].scores?.[0]?.reason).toBe(workdir);
    expect(existsSync(path.join(workdir, 'ready.txt'))).toBe(true);
    expect(existsSync(workdir)).toBe(true);
  });
});
