import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateEvalFile } from '../../../src/evaluation/validation/eval-validator.js';
import { loadTestSuite, loadTests } from '../../../src/evaluation/yaml-parser.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return fn(tempDir).finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
}

function writeEval(dir: string, body: string): string {
  const evalPath = path.join(dir, 'suite.eval.yaml');
  writeFileSync(evalPath, body);
  return evalPath;
}

const baseCase = [
  'prompts:',
  '  - "{{ input }}"',
  'tests:',
  '  - id: case-1',
  '    vars:',
  '      input: Fix the bug',
  '    assert:',
  '      - type: contains',
  '        value: fixed',
  '',
].join('\n');

describe('environment recipe loading', () => {
  it('accepts inline host environment recipes', async () => {
    await withTempDir('agentv-env-host-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'environment:',
          '  type: host',
          '  workdir: ./workspaces/app',
          '  setup:',
          '    command: ["bash", "-lc", "bun install && bun run build"]',
          '    cwd: "."',
          '    timeout_ms: 120000',
          '  env:',
          '    NODE_ENV: test',
          baseCase,
        ].join('\n'),
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests[0].environment).toEqual({
        type: 'host',
        workdir: path.join(dir, 'workspaces/app'),
        sourceDir: dir,
        recipeSha256: expect.any(String),
        setup: {
          command: ['bash', '-lc', 'bun install && bun run build'],
          cwd: '.',
          timeoutMs: 120000,
        },
        env: { NODE_ENV: 'test' },
      });
    });
  });

  it('loads file:// environment recipes relative to the recipe file', async () => {
    await withTempDir('agentv-env-file-', async (dir) => {
      const recipeDir = path.join(dir, '.agentv/environments');
      mkdirSync(recipeDir, { recursive: true });
      writeFileSync(
        path.join(recipeDir, 'host.yaml'),
        [
          'type: host',
          'workdir: ./checkout',
          'setup:',
          '  command: ["bash", "./setup.sh"]',
          '',
        ].join('\n'),
      );
      const evalPath = writeEval(
        dir,
        ['environment: file://.agentv/environments/host.yaml', baseCase].join('\n'),
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests[0].environment).toMatchObject({
        type: 'host',
        workdir: path.join(recipeDir, 'checkout'),
        recipeFilePath: path.join(recipeDir, 'host.yaml'),
        recipeFileSha256: expect.any(String),
        recipeSha256: expect.any(String),
      });
    });
  });

  it('rejects setup command strings in authored environment recipes', async () => {
    await withTempDir('agentv-env-string-command-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'environment:',
          '  type: host',
          '  workdir: ./workspaces/app',
          '  setup:',
          '    command: ./scripts/setup.sh',
          baseCase,
        ].join('\n'),
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        'environment.setup.command must be a non-empty string array',
      );
    });
  });

  it('rejects setup args in authored environment recipes', async () => {
    await withTempDir('agentv-env-setup-args-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'environment:',
          '  type: host',
          '  workdir: ./workspaces/app',
          '  setup:',
          '    command: ["bash", "./scripts/setup.sh"]',
          '    args:',
          '      repo: example/app',
          baseCase,
        ].join('\n'),
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        'environment.setup.args is not supported',
      );
    });
  });

  it('accepts inline docker environment recipes at schema level', async () => {
    await withTempDir('agentv-env-docker-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'environment:',
          '  type: docker',
          '  context: ./environment',
          '  dockerfile: Dockerfile',
          '  workdir: /app',
          '  env:',
          '    NODE_ENV: test',
          '  resources:',
          '    cpus: 2',
          '    memory: 4g',
          '  mounts:',
          '    - source: ./fixtures',
          '      target: /fixtures',
          '      access: ro',
          '  secrets:',
          '    OPENAI_API_KEY: placeholder',
          baseCase,
        ].join('\n'),
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests[0].environment).toEqual({
        type: 'docker',
        context: path.join(dir, 'environment'),
        dockerfile: path.join(dir, 'Dockerfile'),
        workdir: '/app',
        sourceDir: dir,
        recipeSha256: expect.any(String),
        env: { NODE_ENV: 'test' },
        resources: { cpus: 2, memory: '4g' },
        mounts: [{ source: path.join(dir, 'fixtures'), target: '/fixtures', access: 'ro' }],
        secrets: { OPENAI_API_KEY: 'placeholder' },
      });
    });
  });

  it('inherits suite environment and lets case environment replace it', async () => {
    await withTempDir('agentv-env-override-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'environment:',
          '  type: host',
          '  workdir: ./suite-workdir',
          'prompts:',
          '  - "{{ input }}"',
          'tests:',
          '  - id: inherited',
          '    vars: { input: A }',
          '    assert:',
          '      - type: contains',
          '        value: fixed',
          '  - id: overridden',
          '    environment:',
          '      type: host',
          '      workdir: ./case-workdir',
          '    vars: { input: B }',
          '    assert:',
          '      - type: contains',
          '        value: fixed',
          '',
        ].join('\n'),
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests.find((test) => test.id === 'inherited')?.environment?.workdir).toBe(
        path.join(dir, 'suite-workdir'),
      );
      expect(tests.find((test) => test.id === 'overridden')?.environment?.workdir).toBe(
        path.join(dir, 'case-workdir'),
      );
    });
  });

  it('rejects target-level environment', async () => {
    await withTempDir('agentv-env-target-', async (dir) => {
      const evalPath = writeEval(
        dir,
        [
          'targets:',
          '  - id: codex',
          '    provider: codex-cli',
          '    environment:',
          '      type: host',
          '      workdir: ./workspace',
          baseCase,
        ].join('\n'),
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(/targets\[0\]\.environment/);
    });
  });

  it('rejects public workspace testbed fields with environment guidance', async () => {
    await withTempDir('agentv-env-workspace-', async (dir) => {
      const evalPath = writeEval(
        dir,
        ['workspace:', '  repos:', '    - repo: example/app', '      path: app', baseCase].join(
          '\n',
        ),
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        /workspace\.repos.*environment\.setup\.command/,
      );
    });
  });

  it('keeps top-level env and extensions distinct from environment', async () => {
    await withTempDir('agentv-env-distinct-', async (dir) => {
      writeFileSync(path.join(dir, 'hooks.mjs'), 'export function beforeAll() {}\n');
      const evalPath = writeEval(
        dir,
        [
          'env:',
          '  PROVIDER_FLAG: enabled',
          'environment:',
          '  type: host',
          '  workdir: ./workdir',
          '  env:',
          '    TESTBED_FLAG: enabled',
          'extensions:',
          '  - file://hooks.mjs:beforeAll',
          baseCase,
        ].join('\n'),
      );

      const suite = await loadTestSuite(evalPath, dir);
      const validation = await validateEvalFile(evalPath);

      expect(validation.valid).toBe(true);
      expect(suite.tests[0].environment?.env).toEqual({ TESTBED_FLAG: 'enabled' });
      expect(suite.tests[0].extensions?.[0]).toMatchObject({
        hook: 'beforeAll',
        path: path.join(dir, 'hooks.mjs'),
      });
    });
  });
});
