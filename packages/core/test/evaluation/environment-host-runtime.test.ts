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
  it('creates host workdir and runs setup argv from explicit cwd', async () => {
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
        command: ['node', '../setup.mjs'],
        cwd: '.',
      },
    });

    const payload = JSON.parse(await readFile(path.join(workdir, 'setup-payload.json'), 'utf8'));
    expect(result.status).toBe('success');
    expect(existsSync(workdir)).toBe(true);
    expect(payload.cwd).toBe(workdir);
    expect(payload.envWorkdir).toBe(workdir);
    expect(payload.payload).toEqual({
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
        },
      }),
    ).rejects.toMatchObject({
      result: {
        status: 'failed',
        exitCode: 7,
        stderr: 'setup failed\n',
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

  it('applies provider-local host environment setup as a candidate overlay with provenance', async () => {
    const root = tempDir('agentv-provider-env-candidate-');
    const workdir = path.join(root, 'workdir');
    const sourceDir = path.join(root, '.agentv/environments');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, 'provider-setup.mjs'),
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.AGENTV_ENVIRONMENT_WORKDIR + '/provider-ready.txt', 'ready');\n",
    );

    const capturedRequests: ProviderRequest[] = [];
    const results = await runEvaluation({
      testFilePath: path.join(root, 'suite.eval.yaml'),
      repoRoot: root,
      target: {
        kind: 'mock',
        name: 'candidate',
        config: {},
        environment: {
          type: 'host',
          workdir,
          sourceDir,
          setup: { command: ['node', 'provider-setup.mjs'] },
        },
      },
      providerFactory: providerFactory(capturedRequests),
      evalCases: [
        baseEvalCase({
          environment: {
            type: 'host',
            workdir,
            sourceDir,
            env: { BASE_FLAG: '1' },
          },
        }),
      ],
      maxConcurrency: 1,
    });

    expect(capturedRequests[0].cwd).toBe(workdir);
    expect(existsSync(path.join(workdir, 'provider-ready.txt'))).toBe(true);
    expect(results[0].environmentProvenance?.composition?.layers).toMatchObject([
      { scope: 'base' },
      { scope: 'provider', providerName: 'candidate' },
    ]);
    const [baseLayer, providerLayer] = results[0].environmentProvenance?.composition?.layers ?? [];
    expect(baseLayer?.environment.setupExecutions).toBeUndefined();
    expect(providerLayer?.environment.setupExecutions?.[0]?.command).toEqual([
      'node',
      'provider-setup.mjs',
    ]);
  });

  it('returns an explicit conflict when base and provider setup both define commands', async () => {
    const root = tempDir('agentv-provider-env-conflict-');
    const workdir = path.join(root, 'workdir');

    const results = await runEvaluation({
      testFilePath: path.join(root, 'suite.eval.yaml'),
      repoRoot: root,
      target: {
        kind: 'mock',
        name: 'candidate',
        config: {},
        environment: {
          type: 'host',
          workdir,
          sourceDir: root,
          setup: { command: ['node', '-e', ''] },
        },
      },
      providerFactory: providerFactory([]),
      evalCases: [
        baseEvalCase({
          environment: {
            type: 'host',
            workdir,
            sourceDir: root,
            setup: { command: ['node', '-e', ''] },
          },
        }),
      ],
      maxConcurrency: 1,
    });

    expect(results[0].executionStatus).toBe('execution_error');
    expect(results[0].error).toContain('both base and provider environments define setup');
  });

  it('prepares grader provider-local environment only for grader invocation', async () => {
    const root = tempDir('agentv-provider-env-grader-');
    const candidateWorkdir = path.join(root, 'candidate');
    const graderWorkdir = path.join(root, 'grader');
    const graderSetupScript = path.join(root, 'grader-setup.ts');
    await writeFile(
      graderSetupScript,
      'await Bun.write(`${process.argv[2]}/grader-marker.txt`, "ready");\n',
    );
    const captured: Record<string, ProviderRequest[]> = { answer: [], grader: [] };
    const answerProvider = providerFactory(captured.answer);
    const graderProvider: Provider = {
      id: 'mock:grader',
      kind: 'mock',
      targetName: 'grader',
      async invoke(request): Promise<ProviderResponse> {
        captured.grader.push(request);
        expect(await readFile(path.join(request.cwd ?? '', 'grader-marker.txt'), 'utf8')).toBe(
          'ready',
        );
        return {
          output: [
            {
              role: 'assistant',
              content: JSON.stringify({
                score: 1,
                assertions: [{ text: 'ok', passed: true }],
              }),
            },
          ],
        };
      },
    };

    const results = await runEvaluation({
      testFilePath: path.join(root, 'suite.eval.yaml'),
      repoRoot: root,
      target: { kind: 'mock', name: 'answer', config: {}, graderTarget: 'grader' },
      targets: [
        { name: 'answer', provider: 'mock' },
        {
          name: 'grader',
          provider: 'mock',
          environment: {
            type: 'host',
            workdir: graderWorkdir,
            sourceDir: root,
            setup: { command: ['bun', graderSetupScript, graderWorkdir] },
          },
        },
      ],
      providerFactory: (target) =>
        target.name === 'grader' ? graderProvider : answerProvider(target),
      evalCases: [
        baseEvalCase({
          environment: { type: 'host', workdir: candidateWorkdir, sourceDir: root },
          assertions: [{ name: 'rubric', type: 'llm-rubric', value: 'Judge it.' }],
        }),
      ],
      maxConcurrency: 1,
    });

    expect(results[0].score).toBe(1);
    expect(captured.answer[0].cwd).toBe(candidateWorkdir);
    expect(captured.grader[0].cwd).toBe(graderWorkdir);
  });
});
