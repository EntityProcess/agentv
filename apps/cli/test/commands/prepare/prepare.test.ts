import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { assertCoreBuild } from '../../setup-core-build.js';

assertCoreBuild();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

async function writeFixtureProject(root: string): Promise<{
  readonly evalPath: string;
  readonly targetMarker: string;
  readonly graderMarker: string;
}> {
  const evalPath = path.join(root, 'evals', 'suite.eval.yaml');
  const targetMarker = path.join(root, 'target-ran.txt');
  const graderMarker = path.join(root, 'grader-ran.txt');

  await mkdir(path.join(root, 'evals'), { recursive: true });
  await mkdir(path.join(root, 'template'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, '.agentv'), { recursive: true });

  await writeFile(path.join(root, 'template', 'app.txt'), 'initial workspace file\n', 'utf8');
  await writeFile(
    path.join(root, 'scripts', 'hook.ts'),
    `
import { appendFile } from 'node:fs/promises';
const step = Bun.argv[2];
const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
await appendFile(\`\${payload.workspace_path}/hook-order.txt\`, \`\${step}\\n\`);
await Bun.write(\`\${payload.workspace_path}/\${step}.txt\`, \`\${payload.test_id}\\n\${payload.case_input ?? ''}\\n\`);
`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'scripts', 'target.ts'),
    `await Bun.write(${JSON.stringify(targetMarker)}, 'target launched\\n');\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'scripts', 'grader.ts'),
    `await Bun.write(${JSON.stringify(graderMarker)}, 'grader ran\\n');\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, '.agentv', 'targets.yaml'),
    `
targets:
  - name: codex
    provider: cli
    command: bun ./scripts/target.ts
`,
    'utf8',
  );
  await writeFile(
    evalPath,
    `
workspace:
  template: ../template
  hooks:
    before_all:
      command: ["bun", "../scripts/hook.ts", "workspace_before_all"]
    before_each:
      command: ["bun", "../scripts/hook.ts", "workspace_before_each"]
execution:
  targets:
    - name: codex
      hooks:
        before_all:
          command: ["bun", "../scripts/hook.ts", "target_before_all"]
        before_each:
          command: ["bun", "../scripts/hook.ts", "target_before_each"]
assertions:
  - name: secret-grader
    type: code-grader
    command: ["bun", "../scripts/grader.ts"]
tests:
  - id: case-1
    input: "Fix the workspace file."
    expected_output: "SECRET_EXPECTED_OUTPUT"
    criteria: "SECRET_RUBRIC_DETAIL"
`,
    'utf8',
  );

  return { evalPath, targetMarker, graderMarker };
}

describe('agentv prepare', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-prepare-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates prepared-attempt artifacts and stops before provider and graders', async () => {
    const { evalPath, targetMarker, graderMarker } = await writeFixtureProject(tempDir);
    const outDir = path.join(tempDir, 'prepared', 'case-1');

    const result = await execa(
      'bun',
      [
        '--no-env-file',
        CLI_ENTRY,
        'prepare',
        evalPath,
        '--test-id',
        'case-1',
        '--target',
        'codex',
        '--out',
        outDir,
      ],
      {
        cwd: tempDir,
        env: {
          AGENTV_HOME: path.join(tempDir, '.agentv-home'),
          AGENTV_NO_UPDATE_CHECK: '1',
        },
      },
    );

    const workspacePath = path.join(outDir, 'workspace');
    const promptPath = path.join(outDir, 'prompt.md');
    const manifestPath = path.join(outDir, 'agentv_prepare.json');

    expect(result.stdout).toContain(`Workspace: ${workspacePath}`);
    expect(result.stdout).toContain(`Prompt: ${promptPath}`);
    expect(await exists(path.join(workspacePath, 'app.txt'))).toBe(true);
    expect(await exists(promptPath)).toBe(true);
    expect(await exists(manifestPath)).toBe(true);

    for (const step of [
      'workspace_before_all',
      'target_before_all',
      'workspace_before_each',
      'target_before_each',
    ]) {
      expect(await exists(path.join(workspacePath, `${step}.txt`))).toBe(true);
    }
    expect(
      (await readFile(path.join(workspacePath, 'hook-order.txt'), 'utf8')).trim().split('\n'),
    ).toEqual([
      'workspace_before_all',
      'target_before_all',
      'workspace_before_each',
      'target_before_each',
    ]);

    expect(await exists(targetMarker)).toBe(false);
    expect(await exists(graderMarker)).toBe(false);

    const prompt = await readFile(promptPath, 'utf8');
    expect(prompt).toContain('Fix the workspace file.');
    expect(prompt).not.toContain('SECRET_EXPECTED_OUTPUT');
    expect(prompt).not.toContain('SECRET_RUBRIC_DETAIL');
    expect(prompt).not.toContain('secret-grader');
    expect(prompt).not.toContain('grader.ts');

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      schema_version: 1,
      eval_path: evalPath,
      test_id: 'case-1',
      target: 'codex',
      workspace_path: workspacePath,
      prompt_path: promptPath,
      setup_status: 'ok',
      repo_pins: [],
    });
    expect(typeof manifest.created_at).toBe('string');
    expect(Object.keys(manifest)).toContain('setup_steps');
    expect(Object.keys(manifest)).not.toContain('setupStatus');
  });

  it('prints snake_case JSON output for automation', async () => {
    const { evalPath } = await writeFixtureProject(tempDir);
    const outDir = path.join(tempDir, 'prepared-json');

    const result = await execa(
      'bun',
      [
        '--no-env-file',
        CLI_ENTRY,
        'prepare',
        evalPath,
        '--test-id',
        'case-1',
        '--target',
        'codex',
        '--out',
        outDir,
        '--format',
        'json',
      ],
      {
        cwd: tempDir,
        env: {
          AGENTV_HOME: path.join(tempDir, '.agentv-home'),
          AGENTV_NO_UPDATE_CHECK: '1',
        },
      },
    );

    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      test_id: 'case-1',
      target: 'codex',
      workspace_path: path.join(outDir, 'workspace'),
      prompt_path: path.join(outDir, 'prompt.md'),
      manifest_path: path.join(outDir, 'agentv_prepare.json'),
      setup_status: 'ok',
    });
    expect(Object.keys(output)).not.toContain('workspacePath');
  });
});
