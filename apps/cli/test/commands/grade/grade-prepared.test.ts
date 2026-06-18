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

async function runCli(args: readonly string[], cwd: string) {
  return execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
    cwd,
    env: {
      AGENTV_HOME: path.join(cwd, '.agentv-home'),
      AGENTV_NO_UPDATE_CHECK: '1',
    },
  });
}

async function writeFixtureProject(
  root: string,
  assertionYaml: string,
): Promise<{
  readonly evalPath: string;
  readonly targetMarker: string;
  readonly graderPayloadPath: string;
}> {
  const evalPath = path.join(root, 'evals', 'suite.eval.yaml');
  const targetMarker = path.join(root, 'target-ran.txt');
  const graderPayloadPath = path.join(root, 'grader-payload.json');

  await mkdir(path.join(root, 'evals'), { recursive: true });
  await mkdir(path.join(root, 'template'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, '.agentv'), { recursive: true });

  await writeFile(path.join(root, 'template', 'app.txt'), 'initial workspace file\n', 'utf8');
  await writeFile(
    path.join(root, 'scripts', 'target.ts'),
    `await Bun.write(${JSON.stringify(targetMarker)}, 'target launched\\n');\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'scripts', 'workspace-grader.ts'),
    `
const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
const workspacePath = payload.workspace_path;
const fileChanges = payload.file_changes ?? '';
const app = await Bun.file(\`\${workspacePath}/app.txt\`).text();
const passed = app.includes('manual edit') && fileChanges.includes('+manual edit');
await Bun.write(${JSON.stringify(graderPayloadPath)}, JSON.stringify({
  workspace_path: workspacePath,
  file_changes: fileChanges,
  output: payload.output,
}, null, 2));
console.log(JSON.stringify({
  score: passed ? 1 : 0,
  assertions: [{
    text: 'workspace diff captured',
    passed,
    evidence: fileChanges,
  }],
}));
`,
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
assertions:
${assertionYaml
  .trim()
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
tests:
  - id: case-1
    input: "Fix the workspace file."
    expected_output: "done"
`,
    'utf8',
  );

  return { evalPath, targetMarker, graderPayloadPath };
}

describe('agentv grade prepared attempts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-grade-prepared-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('grades manual workspace edits without invoking the target provider', async () => {
    const { evalPath, targetMarker, graderPayloadPath } = await writeFixtureProject(
      tempDir,
      `
- name: workspace-check
  type: code-grader
  command: ["bun", "../scripts/workspace-grader.ts"]
`,
    );
    const preparedDir = path.join(tempDir, 'prepared', 'case-1');
    const runDir = path.join(tempDir, 'runs', 'prepared-grade');

    await runCli(
      ['prepare', evalPath, '--test-id', 'case-1', '--target', 'codex', '--out', preparedDir],
      tempDir,
    );
    await writeFile(
      path.join(preparedDir, 'workspace', 'app.txt'),
      'initial workspace file\nmanual edit\n',
      'utf8',
    );

    const result = await runCli(
      [
        'grade',
        evalPath,
        '--test-id',
        'case-1',
        '--prepared',
        preparedDir,
        '--output',
        runDir,
        '--format',
        'json',
      ],
      tempDir,
    );

    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      test_id: 'case-1',
      target: 'codex',
      score: 1,
      execution_status: 'ok',
      workspace_path: path.join(preparedDir, 'workspace'),
      manifest_path: path.join(preparedDir, 'agentv_prepare.json'),
      output_dir: runDir,
      index_path: path.join(runDir, 'index.jsonl'),
    });
    expect(await exists(targetMarker)).toBe(false);

    const graderPayload = JSON.parse(await readFile(graderPayloadPath, 'utf8'));
    expect(graderPayload.workspace_path).toBe(path.join(preparedDir, 'workspace'));
    expect(graderPayload.file_changes).toContain('+manual edit');

    const row = JSON.parse((await readFile(path.join(runDir, 'index.jsonl'), 'utf8')).trim());
    expect(row).toMatchObject({
      test_id: 'case-1',
      target: 'codex',
      score: 1,
      execution_status: 'ok',
      workspace_path: path.join(preparedDir, 'workspace'),
      metadata: {
        prepared_attempt: {
          source: 'manual',
          manifest_path: path.join(preparedDir, 'agentv_prepare.json'),
          workspace_path: path.join(preparedDir, 'workspace'),
          prompt_path: path.join(preparedDir, 'prompt.md'),
          target: 'codex',
          baseline_status: 'initialized',
        },
      },
    });
    expect(typeof row.metadata.prepared_attempt.baseline_commit).toBe('string');

    const grading = JSON.parse(await readFile(path.join(runDir, row.grading_path), 'utf8'));
    expect(grading.workspace_changes.diff_summary).toContain('+manual edit');
  });

  it('fails clearly when the prepared manifest is missing', async () => {
    await expect(
      runCli(
        [
          'grade',
          path.join(tempDir, 'evals', 'suite.eval.yaml'),
          '--test-id',
          'case-1',
          '--prepared',
          path.join(tempDir, 'missing-prepared'),
        ],
        tempDir,
      ),
    ).rejects.toThrow(/Prepared manifest not found/);
  });

  it('fails clearly when the prepared manifest is invalid', async () => {
    const preparedDir = path.join(tempDir, 'bad-prepared');
    await mkdir(preparedDir, { recursive: true });
    await writeFile(path.join(preparedDir, 'agentv_prepare.json'), '{"schema_version": 1}\n');

    await expect(
      runCli(
        [
          'grade',
          path.join(tempDir, 'evals', 'suite.eval.yaml'),
          '--test-id',
          'case-1',
          '--prepared',
          preparedDir,
        ],
        tempDir,
      ),
    ).rejects.toThrow(/Invalid prepared manifest/);
  });

  it('marks trajectory grading unavailable when no trace is supplied', async () => {
    const { evalPath, targetMarker } = await writeFixtureProject(
      tempDir,
      `
- name: expected-tool-sequence
  type: tool-trajectory
  mode: in_order
  expected:
    - tool: Read
      args:
        path: app.txt
`,
    );
    const preparedDir = path.join(tempDir, 'prepared', 'trajectory');
    const runDir = path.join(tempDir, 'runs', 'trajectory');

    await runCli(
      ['prepare', evalPath, '--test-id', 'case-1', '--target', 'codex', '--out', preparedDir],
      tempDir,
    );
    await writeFile(
      path.join(preparedDir, 'workspace', 'app.txt'),
      'initial workspace file\nmanual edit\n',
      'utf8',
    );

    await runCli(
      ['grade', evalPath, '--test-id', 'case-1', '--prepared', preparedDir, '--output', runDir],
      tempDir,
    );

    expect(await exists(targetMarker)).toBe(false);
    const row = JSON.parse((await readFile(path.join(runDir, 'index.jsonl'), 'utf8')).trim());
    expect(row.score).toBe(0);
    expect(row.scores[0]).toMatchObject({
      name: 'expected-tool-sequence',
      type: 'tool-trajectory',
      score: 0,
    });
    expect(row.scores[0].assertions[0]).toMatchObject({
      text: 'No trace available for evaluation',
      passed: false,
    });
  });
});
