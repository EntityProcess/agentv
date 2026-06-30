import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const MOCK_RUNNER = path.join(projectRoot, 'apps/cli/test/fixtures/mock-run-evaluation.ts');

interface BundleFixture {
  readonly baseDir: string;
  readonly cwd: string;
  readonly sourceRunDir: string;
  readonly outputDir: string;
  readonly envFile: string;
  readonly overrideTargetsPath: string;
}

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const DEFAULT_TARGETS = `targets:
  - name: captured
    provider: mock
`;

async function writeTaskBundle(options: {
  readonly sourceRunDir: string;
  readonly testId: string;
  readonly targetsYaml: string;
}): Promise<Record<string, unknown>> {
  const artifactDir = path.join(options.sourceRunDir, options.testId);
  const taskDir = path.join(artifactDir, 'task');
  const outputsDir = path.join(artifactDir, 'outputs');
  await mkdir(taskDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });

  await writeFile(
    path.join(taskDir, 'EVAL.yaml'),
    `experiment:
  target: captured
tests:
  - id: ${options.testId}
    input:
      - role: user
        content: Prompt for ${options.testId}
    expected_output: []
`,
    'utf8',
  );
  await writeFile(path.join(taskDir, 'targets.yaml'), options.targetsYaml, 'utf8');
  await writeFile(path.join(artifactDir, 'grading.json'), '{"assertions":[]}\n', 'utf8');
  await writeFile(path.join(artifactDir, 'timing.json'), '{"duration_ms":1}\n', 'utf8');
  await writeFile(path.join(outputsDir, 'answer.md'), '@[assistant]:\nCaptured answer\n', 'utf8');

  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    test_id: options.testId,
    target: 'captured',
    score: 0.1,
    result_dir: options.testId,
    grading_path: `${options.testId}/grading.json`,
    timing_path: `${options.testId}/timing.json`,
    output_path: `${options.testId}/outputs/answer.md`,
    answer_path: `${options.testId}/outputs/answer.md`,
    task_dir: `${options.testId}/task`,
    eval_path: `${options.testId}/task/EVAL.yaml`,
    targets_path: `${options.testId}/task/targets.yaml`,
  };
}

async function createBundleFixture(targetsYaml = DEFAULT_TARGETS): Promise<BundleFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-rerun-'));
  const cwd = path.join(baseDir, 'workspace');
  const sourceRunDir = path.join(baseDir, 'source-run');
  const outputDir = path.join(baseDir, 'rerun-output');
  await mkdir(cwd, { recursive: true });
  await mkdir(sourceRunDir, { recursive: true });

  const records = [
    await writeTaskBundle({ sourceRunDir, testId: 'case-alpha', targetsYaml }),
    await writeTaskBundle({ sourceRunDir, testId: 'case-beta', targetsYaml }),
  ];
  await writeFile(
    path.join(sourceRunDir, 'index.jsonl'),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );

  const envFile = path.join(baseDir, 'local.env');
  await writeFile(envFile, 'LOCAL_AGENT_COMMAND=echo local-agent\n', 'utf8');
  const overrideTargetsPath = path.join(baseDir, 'override-targets.yaml');
  await writeFile(
    overrideTargetsPath,
    `targets:
  - name: local
    provider: mock
`,
    'utf8',
  );

  return { baseDir, cwd, sourceRunDir, outputDir, envFile, overrideTargetsPath };
}

async function runCli(
  fixture: BundleFixture,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly env?: Record<string, string | undefined> },
): Promise<CliResult> {
  const result = await execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
    cwd: options?.cwd ?? fixture.cwd,
    env: {
      ...process.env,
      AGENTV_NO_UPDATE_CHECK: '1',
      CI: 'true',
      LOCAL_AGENT_COMMAND: undefined,
      AGENTEVO_CLI_EVAL_RUNNER: MOCK_RUNNER,
      ...options?.env,
    },
    reject: false,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

async function readJsonLines(filePath: string): Promise<readonly Record<string, unknown>[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function discoverIndexPaths(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'index.jsonl')) {
    return [path.join(dir, 'index.jsonl')];
  }
  if (entries.some((entry) => entry.isFile() && entry.name === 'index.jsonl')) {
    return [path.join(dir, 'index.jsonl')];
  }
  const discovered: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      discovered.push(...(await discoverIndexPaths(path.join(dir, entry.name))));
    }
  }
  return discovered.sort();
}

async function readOutputBundle(
  outputDir: string,
): Promise<{ readonly indexPath: string; readonly rows: readonly Record<string, unknown>[] }> {
  const [indexPath] = await discoverIndexPaths(outputDir);
  expect(indexPath).toBeTruthy();
  return { indexPath, rows: await readJsonLines(indexPath ?? '') };
}

function extractRerunOutputDir(stdout: string): string {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('Rerun output directory:'));
  if (!line) {
    throw new Error(`Missing rerun output line:\n${stdout}`);
  }
  return line.replace('Rerun output directory:', '').trim();
}

describe('agentv runs rerun', () => {
  let fixtures: BundleFixture[] = [];

  beforeEach(() => {
    fixtures = [];
  });

  afterEach(async () => {
    await Promise.all(
      fixtures.map((fixture) => rm(fixture.baseDir, { recursive: true, force: true })),
    );
  });

  async function fixture(targetsYaml?: string): Promise<BundleFixture> {
    const created = await createBundleFixture(targetsYaml);
    fixtures.push(created);
    return created;
  }

  it('reruns captured task bundles into an explicit output directory with source metadata', async () => {
    const created = await fixture();

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--output',
      created.outputDir,
      '--verbose',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Rerunning 2 captured task bundle(s)');
    const { indexPath, rows } = await readOutputBundle(created.outputDir);
    expect(rows.map((row) => row.test_id)).toEqual(['case-alpha', 'case-beta']);
    expect(rows.every((row) => row.target === 'captured')).toBe(true);
    expect(rows[0].metadata).toMatchObject({
      rerun_source: {
        mode: 'rerun',
        source_test_id: 'case-alpha',
        source_target: 'captured',
      },
    });

    const answerPath = path.join(path.dirname(indexPath), String(rows[0].answer_path));
    const answer = await readFile(answerPath, 'utf8');
    expect(answer).toContain('Alpha answer');
    expect(answer).not.toContain('Captured answer');
  }, 30_000);

  it('fails clearly for missing env and accepts an explicit env file', async () => {
    const created = await fixture(`targets:
  - name: captured
    provider: cli
    command: \${{ LOCAL_AGENT_COMMAND }}
`);

    const missing = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--output',
      created.outputDir,
      '--dry-run',
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('Missing environment variable(s)');
    expect(missing.stderr).toContain('LOCAL_AGENT_COMMAND');

    const withAmbientEnv = await runCli(
      created,
      ['runs', 'rerun', created.sourceRunDir, '--output', created.outputDir, '--dry-run'],
      { env: { LOCAL_AGENT_COMMAND: 'echo ambient-agent' } },
    );
    expect(withAmbientEnv.exitCode).toBe(0);

    const withEnvFile = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--output',
      created.outputDir,
      '--env-file',
      created.envFile,
      '--dry-run',
    ]);
    expect(withEnvFile.exitCode).toBe(0);
  }, 30_000);

  it('fails loudly when selected bundle artifacts are missing', async () => {
    const created = await fixture();
    await rm(path.join(created.sourceRunDir, 'case-beta', 'task', 'targets.yaml'));

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--test-id',
      'case-beta',
      '--output',
      created.outputDir,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Task targets for case-beta@captured not found');
  }, 30_000);

  it('reruns a selected test subset from index.jsonl', async () => {
    const created = await fixture();

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--test-id',
      'case-alpha',
      '--output',
      created.outputDir,
    ]);

    expect(result.exitCode).toBe(0);
    const { rows } = await readOutputBundle(created.outputDir);
    expect(rows.map((row) => row.test_id)).toEqual(['case-alpha']);
  }, 30_000);

  it('chooses a default output directory outside the source task folder', async () => {
    const created = await fixture();
    const taskDir = path.join(created.sourceRunDir, 'case-alpha', 'task');

    const result = await runCli(
      created,
      ['runs', 'rerun', created.sourceRunDir, '--test-id', 'case-alpha'],
      { cwd: taskDir },
    );

    expect(result.exitCode).toBe(0);
    const outputDir = extractRerunOutputDir(result.stdout);
    expect(path.relative(taskDir, outputDir).startsWith('..')).toBe(true);
    const { rows } = await readOutputBundle(outputDir);
    expect(rows.map((row) => row.test_id)).toEqual(['case-alpha']);
  }, 30_000);

  it('rejects explicit output nested under a source task folder', async () => {
    const created = await fixture();
    const nestedOutput = path.join(
      created.sourceRunDir,
      'case-alpha',
      'task',
      '.agentv',
      'results',
    );

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--test-id',
      'case-alpha',
      '--output',
      nestedOutput,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Refusing to write rerun output inside the source bundle');
  }, 30_000);

  it('fails loudly for incompatible target overrides', async () => {
    const created = await fixture();

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--targets',
      created.overrideTargetsPath,
      '--target',
      'missing',
      '--output',
      created.outputDir,
      '--dry-run',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Target override is incompatible');
    expect(result.stderr).toContain('missing');
  }, 30_000);

  it('accepts a compatible target override file and target selection', async () => {
    const created = await fixture();

    const result = await runCli(created, [
      'runs',
      'rerun',
      created.sourceRunDir,
      '--targets',
      created.overrideTargetsPath,
      '--target',
      'local',
      '--output',
      created.outputDir,
    ]);

    expect(result.exitCode).toBe(0);
    const { rows } = await readOutputBundle(created.outputDir);
    expect(rows.every((row) => row.target === 'local')).toBe(true);
  }, 30_000);
});
