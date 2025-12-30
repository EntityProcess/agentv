import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(cliRoot, '../..');
const CLI_ENTRY = path.join(cliRoot, 'src/cli.ts');
const MOCK_RUNNER = path.join(cliRoot, 'test/fixtures/mock-run-evaluation.ts');

interface EvalFixture {
  readonly baseDir: string;
  readonly suiteDir: string;
  readonly testFilePath: string;
}

let coreBuilt = false;

beforeAll(async () => {
  if (!coreBuilt) {
    await execa('bun', ['run', '--filter', '@agentv/core', 'build'], { cwd: repoRoot });
    coreBuilt = true;
  }
}, 30000);

async function createFixture(): Promise<EvalFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-ci-gate-test-'));
  const suiteDir = path.join(baseDir, 'suite');
  await mkdir(suiteDir, { recursive: true });

  const agentvDir = path.join(suiteDir, '.agentv');
  await mkdir(agentvDir, { recursive: true });

  const targetsPath = path.join(agentvDir, 'targets.yaml');
  const targetsContent = `$schema: agentv-targets-v2.2
targets:
  - name: default
    provider: mock
`;
  await writeFile(targetsPath, targetsContent, 'utf8');

  const testFilePath = path.join(suiteDir, 'sample.test.yaml');
  const testFileContent = `$schema: agentv-eval-v2
description: CI gate test

evalcases:
  - id: case-alpha
    outcome: System responds with alpha
    input_messages:
      - role: user
        content: Please respond with alpha
    expected_messages:
      - role: assistant
        content: "Alpha"
  - id: case-beta
    outcome: System responds with beta
    input_messages:
      - role: user
        content: Please respond with beta
    expected_messages:
      - role: assistant
        content: "Beta"
`;
  await writeFile(testFilePath, testFileContent, 'utf8');

  return { baseDir, suiteDir, testFilePath };
}

async function runCli(
  fixture: EvalFixture,
  args: readonly string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('bun', [CLI_ENTRY, ...args], {
    cwd: fixture.suiteDir,
    env: {
      ...process.env,
      CI: 'true',
      AGENTEVO_CLI_EVAL_RUNNER: MOCK_RUNNER,
      ...extraEnv,
    },
    reject: false,
  });

  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

const fixtures: string[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('CI gate: --min-score flag', () => {
  it('exits 1 with validation error when --min-score is out of range (1.5)', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stderr, exitCode } = await runCli(fixture, [
      'eval',
      fixture.testFilePath,
      '--min-score',
      '1.5',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--min-score must be between 0.0 and 1.0');
  });

  it('exits 1 with validation error when --min-score is negative', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stderr, exitCode } = await runCli(fixture, [
      'eval',
      fixture.testFilePath,
      '--min-score',
      '-0.5',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--min-score must be between 0.0 and 1.0');
  });

  it('exits 1 when eval has errors (regardless of threshold)', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stdout, exitCode } = await runCli(
      fixture,
      ['eval', fixture.testFilePath, '--min-score', '0.5'],
      { AGENTEVO_MOCK_SCENARIO: 'with-error' },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain('CI GATE FAILED');
    expect(stdout).toContain('errored');
    expect(stdout).toContain('score is invalid');
  });

  it('exits 1 when score (0.72) is below min-score (0.8)', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stdout, exitCode } = await runCli(
      fixture,
      ['eval', fixture.testFilePath, '--min-score', '0.8'],
      { AGENTEVO_MOCK_SCENARIO: 'low-score' },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain('CI GATE FAILED');
    expect(stdout).toContain('Score 0.72');
    expect(stdout).toContain('< min-score 0.80');
  });

  it('exits 0 when score (0.80) equals min-score (0.8) - boundary case', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stdout, exitCode } = await runCli(
      fixture,
      ['eval', fixture.testFilePath, '--min-score', '0.8'],
      { AGENTEVO_MOCK_SCENARIO: 'boundary-score' },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('CI GATE PASSED');
    expect(stdout).toContain('Score 0.80');
    expect(stdout).toContain('>= min-score 0.80');
  });

  it('exits 0 with no flags and no errors - backward compatibility', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    const { stdout, exitCode } = await runCli(fixture, ['eval', fixture.testFilePath]);

    expect(exitCode).toBe(0);
    // No CI gate message when no threshold is set
    expect(stdout).not.toContain('CI GATE');
  });

  it('exits 0 when score exceeds min-score', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture.baseDir);

    // Default scenario has 0.75 average, min-score 0.5 should pass
    const { stdout, exitCode } = await runCli(fixture, [
      'eval',
      fixture.testFilePath,
      '--min-score',
      '0.5',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('CI GATE PASSED');
    expect(stdout).toContain('>= min-score 0.50');
  });
});
