import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlValue } from '@agentv/core';
import { execa } from 'execa';
import { assertCoreBuild } from '../../setup-core-build.js';

assertCoreBuild();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

async function runCli(cwd: string, args: readonly string[]) {
  return execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
    cwd,
    env: { ...process.env, CI: 'true' },
    reject: false,
  });
}

async function expectFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

describe('agentv eval bundle', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-eval-bundle-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createPortableSourceFixture(): Promise<{
    sourceDir: string;
    bundleDir: string;
    evalPath: string;
    sourceEvalBefore: string;
  }> {
    const sourceDir = path.join(tempDir, 'source');
    const bundleDir = path.join(tempDir, 'bundle');
    await mkdir(path.join(sourceDir, '.agentv'), { recursive: true });
    await mkdir(path.join(sourceDir, 'evals'), { recursive: true });
    await mkdir(path.join(sourceDir, 'data'), { recursive: true });
    await mkdir(path.join(sourceDir, 'scripts'), { recursive: true });
    await mkdir(path.join(sourceDir, 'workspace-template'), { recursive: true });

    await writeFile(
      path.join(sourceDir, '.agentv', 'targets.yaml'),
      `targets:
  - name: inherited
    provider: mock
    response: '{"answer":"Mock provider response from inherited target"}'
    fallback_targets: [backup]
  - name: backup
    provider: mock
    response: '{"answer":"Backup mock response"}'
`,
      'utf8',
    );
    await writeFile(path.join(sourceDir, 'data', 'input.txt'), 'portable fixture input\n', 'utf8');
    await writeFile(
      path.join(sourceDir, 'data', 'cases.yaml'),
      `- id: case-alpha
  input:
    - role: user
      content:
        - type: file
          value: ../data/input.txt
        - type: text
          value: Answer using the fixture.
  assertions:
    - type: contains
      value: Mock
`,
      'utf8',
    );
    await writeFile(path.join(sourceDir, 'workspace-template', 'marker.txt'), 'template\n', 'utf8');
    await writeFile(
      path.join(sourceDir, 'scripts', 'setup.ts'),
      `const payload = JSON.parse(await Bun.stdin.text());
await Bun.write(\`\${payload.workspace_path}/hook-ran.txt\`, 'ok\\n');
`,
      'utf8',
    );

    const evalPath = path.join(sourceDir, 'evals', 'demo.eval.yaml');
    const sourceEvalBefore = `name: portable-demo
experiment:
  target: inherited
workspace:
  template: ../workspace-template
  hooks:
    before_each:
      command: ["bun", "../scripts/setup.ts"]
tests: ../data/cases.yaml
`;
    await writeFile(evalPath, sourceEvalBefore, 'utf8');

    return { sourceDir, bundleDir, evalPath, sourceEvalBefore };
  }

  it('bundles inherited targets, relative data, workspace templates, and scripts into a runnable directory', async () => {
    const { sourceDir, bundleDir, evalPath, sourceEvalBefore } =
      await createPortableSourceFixture();

    const bundle = await runCli(sourceDir, [
      'eval',
      'bundle',
      'evals/demo.eval.yaml',
      '--out',
      bundleDir,
    ]);

    expect(bundle.exitCode).toBe(0);
    expect(bundle.stdout).toContain(`Bundle written to: ${bundleDir}`);
    expect(await readFile(evalPath, 'utf8')).toBe(sourceEvalBefore);

    const manifest = JSON.parse(
      await readFile(path.join(bundleDir, 'agentv_bundle.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest.schema_version).toBe(1);
    expect(manifest.eval_path).toBe('evals/demo.eval.yaml');
    expect(manifest.targets_path).toBe('targets.yaml');
    expect(manifest.test_count).toBe(1);
    expect(manifest).not.toHaveProperty('schemaVersion');

    await expectFileExists(path.join(bundleDir, 'targets.yaml'));
    await expectFileExists(path.join(bundleDir, 'evals', 'demo.eval.yaml'));
    await expectFileExists(path.join(bundleDir, 'evals', 'files', 'data', 'input.txt'));
    await expectFileExists(
      path.join(bundleDir, 'evals', 'workspaces', 'workspace-template', 'marker.txt'),
    );
    await expectFileExists(path.join(bundleDir, 'evals', 'scripts', 'scripts', 'setup.ts'));

    const bundledEvalText = await readFile(path.join(bundleDir, 'evals', 'demo.eval.yaml'), 'utf8');
    expect(bundledEvalText).not.toContain(sourceDir);
    const bundledEval = parseYamlValue(bundledEvalText) as Record<string, unknown>;
    expect(bundledEval.experiment).toEqual({ target: 'inherited' });
    const [testCase] = bundledEval.tests as Record<string, unknown>[];
    expect(testCase.id).toBe('case-alpha');
    expect(testCase.workspace).toMatchObject({
      template: 'workspaces/workspace-template',
      hooks: { before_each: { command: ['bun', 'scripts/scripts/setup.ts'] } },
    });
    const input = testCase.input as Array<{ content: Array<Record<string, unknown>> }>;
    expect(input[0]?.content[0]).toEqual({ type: 'file', value: 'files/data/input.txt' });

    const bundledTargets = await readFile(path.join(bundleDir, 'targets.yaml'), 'utf8');
    expect(bundledTargets).toContain('name: inherited');
    expect(bundledTargets).toContain('name: backup');

    await rm(sourceDir, { recursive: true, force: true });
    const run = await runCli(bundleDir, [
      'eval',
      'evals/demo.eval.yaml',
      '--output',
      path.join(bundleDir, 'run'),
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('RESULT: PASS');
    await expectFileExists(path.join(bundleDir, 'run', 'inherited', 'index.jsonl'));
  }, 60_000);

  it('reports unbundleable workspace references with their eval location', async () => {
    const sourceDir = path.join(tempDir, 'missing-source');
    const bundleDir = path.join(tempDir, 'missing-bundle');
    await mkdir(path.join(sourceDir, '.agentv'), { recursive: true });
    await mkdir(path.join(sourceDir, 'evals'), { recursive: true });
    await writeFile(
      path.join(sourceDir, '.agentv', 'targets.yaml'),
      `targets:
  - name: default
    provider: mock
`,
      'utf8',
    );
    await writeFile(
      path.join(sourceDir, 'evals', 'missing-template.eval.yaml'),
      `workspace:
  template: ../does-not-exist
tests:
  - id: missing-template
    input: hello
    assertions:
      - type: contains
        value: Mock
`,
      'utf8',
    );

    const result = await runCli(sourceDir, [
      'eval',
      'bundle',
      'evals/missing-template.eval.yaml',
      '--out',
      bundleDir,
    ]);

    expect(result.exitCode).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Cannot bundle eval');
    expect(output).toContain('workspace.template for test "missing-template"');
    expect(output).toContain('not found');
  }, 30_000);
});
