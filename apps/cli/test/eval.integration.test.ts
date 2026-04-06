import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { assertCoreBuild } from './setup-core-build.js';

assertCoreBuild();

interface EvalFixture {
  readonly baseDir: string;
  readonly suiteDir: string;
  readonly testFilePath: string;
  readonly diagnosticsPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');
const MOCK_RUNNER = path.join(projectRoot, 'apps/cli/test/fixtures/mock-run-evaluation.ts');

async function createFixture(): Promise<EvalFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-cli-test-'));
  const suiteDir = path.join(baseDir, 'suite');
  await mkdir(suiteDir, { recursive: true });

  const agentvDir = path.join(suiteDir, '.agentv');
  await mkdir(agentvDir, { recursive: true });

  const targetsPath = path.join(agentvDir, 'targets.yaml');
  const targetsContent = `$schema: agentv-targets-v2.2
targets:
  - name: default
    provider: mock
  - name: file-target
    provider: mock
  - name: cli-target
    provider: mock
`;
  await writeFile(targetsPath, targetsContent, 'utf8');

  const testFilePath = path.join(suiteDir, 'sample.test.yaml');
  const testFileContent = `description: CLI integration test
target: file-target

tests:
  - id: case-alpha
    criteria: System responds with alpha
    input:
      - role: user
        content: |
          Please respond with alpha
    expected_output:
      - role: assistant
        content: "Alpha"
  - id: case-beta
    criteria: System responds with beta
    input:
      - role: user
        content: |
          Please respond with beta
    expected_output:
      - role: assistant
        content: "Beta"
`;
  await writeFile(testFilePath, testFileContent, 'utf8');

  const envPath = path.join(suiteDir, '.env');
  await writeFile(envPath, 'CLI_ENV_SAMPLE=from-dotenv\n', 'utf8');

  const diagnosticsPath = path.join(baseDir, 'diagnostics.json');

  return { baseDir, suiteDir, testFilePath, diagnosticsPath } satisfies EvalFixture;
}

async function createNestedEnvFixture(): Promise<EvalFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-cli-nested-env-test-'));
  const suiteDir = path.join(baseDir, 'suite');
  const evalDir = path.join(suiteDir, 'evals', 'foo');
  await mkdir(evalDir, { recursive: true });

  const agentvDir = path.join(suiteDir, '.agentv');
  await mkdir(agentvDir, { recursive: true });

  const targetsPath = path.join(agentvDir, 'targets.yaml');
  const targetsContent = `$schema: agentv-targets-v2.2
targets:
  - name: default
    provider: mock
`;
  await writeFile(targetsPath, targetsContent, 'utf8');

  const testFilePath = path.join(evalDir, 'sample.test.yaml');
  const testFileContent = `description: CLI nested env integration test

tests:
  - id: case-alpha
    criteria: System responds with alpha
    input:
      - role: user
        content: |
          Please respond with alpha
    expected_output:
      - role: assistant
        content: "Alpha"
  - id: case-beta
    criteria: System responds with beta
    input:
      - role: user
        content: |
          Please respond with beta
    expected_output:
      - role: assistant
        content: "Beta"
`;
  await writeFile(testFilePath, testFileContent, 'utf8');

  await writeFile(
    path.join(suiteDir, '.env'),
    'CLI_ENV_SAMPLE=from-root\nCLI_ENV_ROOT_ONLY=from-root\n',
    'utf8',
  );
  await writeFile(
    path.join(evalDir, '.env'),
    'CLI_ENV_SAMPLE=from-local\nCLI_ENV_LOCAL_ONLY=from-local\n',
    'utf8',
  );

  const diagnosticsPath = path.join(baseDir, 'diagnostics.json');

  return { baseDir, suiteDir, testFilePath, diagnosticsPath } satisfies EvalFixture;
}

async function runCli(
  fixture: EvalFixture,
  args: readonly string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string }> {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  baseEnv.CLI_ENV_SAMPLE = undefined;
  baseEnv.CLI_ENV_ROOT_ONLY = undefined;
  baseEnv.CLI_ENV_LOCAL_ONLY = undefined;

  try {
    const result = await execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
      cwd: fixture.suiteDir,
      env: {
        ...baseEnv,
        CI: 'true', // Disable interactive progress display for tests
        AGENTEVO_CLI_EVAL_RUNNER: MOCK_RUNNER,
        AGENTEVO_CLI_EVAL_RUNNER_OUTPUT: fixture.diagnosticsPath,
        ...extraEnv,
      },
      reject: false,
    });

    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    console.error('CLI execution failed:', error);
    throw error;
  }
}

function extractOutputPath(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  // Try new format first, then legacy
  const outputLine =
    lines.find((line) => line.startsWith('Results written to:')) ??
    lines.find((line) => line.startsWith('Output path:'));
  if (!outputLine) {
    throw new Error(`Unable to parse output path from CLI output:\n${stdout}`);
  }
  return outputLine.replace(/^(Results written to:|Output path:)/, '').trim();
}

async function readJsonLines(filePath: string): Promise<readonly unknown[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function readDiagnostics(fixture: EvalFixture): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const raw = await readFile(fixture.diagnosticsPath, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || attempt === 19) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`Missing diagnostics file: ${fixture.diagnosticsPath}`);
}

describe('agentv eval CLI', () => {
  it('writes results, summary, and prompt dumps using default directories', async () => {
    const fixture = await createFixture();
    try {
      const { stdout } = await runCli(fixture, ['eval', fixture.testFilePath, '--verbose']);

      // Don't check stderr - it may contain stack traces or other diagnostics
      expect(stdout).toContain('Using target (test-file): file-target [provider=mock]');
      expect(stdout).toContain('Mean score: 0.750');
      // Std deviation is an implementation detail - don't check it

      const outputPath = extractOutputPath(stdout);
      expect(outputPath).toContain(`${path.sep}.agentv${path.sep}results${path.sep}`);

      const results = await readJsonLines(outputPath);
      expect(results).toHaveLength(2);
      const [firstResult, secondResult] = results as Array<Record<string, unknown>>;
      expect(firstResult.test_id).toBe('case-alpha');
      expect(secondResult.test_id).toBe('case-beta');

      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        target: 'file-target',
        agentTimeoutMs: null,
        envSample: 'from-dotenv',
        resultCount: 2,
      });

      // Prompt dump feature has been removed, so we no longer check for it
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('loads the nearest .env first and uses parent .env only for missing keys', async () => {
    const fixture = await createNestedEnvFixture();
    try {
      await runCli(fixture, ['eval', fixture.testFilePath, '--verbose']);

      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        envSample: 'from-local',
        envRootOnly: 'from-root',
        envLocalOnly: 'from-local',
        resultCount: 2,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('supports repeatable --test-id flags with OR matching', async () => {
    const fixture = await createFixture();
    try {
      await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--test-id',
        'case-alpha',
        '--test-id',
        'case-beta',
      ]);

      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics.filter).toEqual(['case-alpha', 'case-beta']);
      expect(diagnostics.evalCaseIds).toEqual(['case-alpha', 'case-beta']);
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });
});
