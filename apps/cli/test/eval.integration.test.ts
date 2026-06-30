import { describe, expect, it } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import packageJson from '../package.json' with { type: 'json' };
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
  - name: codex-target
    provider: codex
    model: gpt-5-default
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
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
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

    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error) {
    console.error('CLI execution failed:', error);
    throw error;
  }
}

function extractOutputPath(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  // Try new format first, then legacy
  const outputLine =
    lines.find((line) => line.includes('Results written to:')) ??
    lines.find((line) => line.includes('Output path:'));
  if (!outputLine) {
    throw new Error(`Unable to parse output path from CLI output:\n${stdout}`);
  }
  return outputLine.replace(/^.*?(Results written to:|Output path:)/, '').trim();
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

async function writeTsCacheConfig(fixture: EvalFixture, cachePath: string): Promise<void> {
  await writeFile(
    path.join(fixture.suiteDir, 'agentv.config.ts'),
    `export default { cache: { enabled: true, path: ${JSON.stringify(cachePath)} } };\n`,
    'utf8',
  );
}

async function writeTsOutputConfig(fixture: EvalFixture, outputDir: string): Promise<void> {
  await writeFile(
    path.join(fixture.suiteDir, 'agentv.config.ts'),
    `export default { output: { dir: ${JSON.stringify(outputDir)} } };\n`,
    'utf8',
  );
}

async function writeRequiredVersionConfig(
  fixture: EvalFixture,
  requiredVersion: string,
): Promise<void> {
  await writeFile(
    path.join(fixture.suiteDir, '.agentv', 'config.yaml'),
    `required_version: "${requiredVersion}"\n`,
    'utf8',
  );
}

async function expectFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

describe('agentv eval CLI', () => {
  it('writes results, summary, and prompt dumps using default directories', async () => {
    const fixture = await createFixture();
    try {
      const { stdout } = await runCli(fixture, ['eval', fixture.testFilePath, '--verbose']);

      // Don't check stderr - it may contain stack traces or other diagnostics
      expect(stdout).toContain('Using target (test-file): file-target [provider=mock]');
      expect(stdout).toContain('Mean score: 75%');
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
  }, 30_000);

  it('surfaces required_version mismatch note when the eval fails', async () => {
    const fixture = await createFixture();
    try {
      await writeRequiredVersionConfig(fixture, '>=999.0.0');

      const { stdout, stderr, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--threshold',
        '0.8',
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain('RESULT: FAIL');
      expect(stdout).toContain(
        `note: agentv ${packageJson.version} does not satisfy this project's required_version >=999.0.0 - this may be the cause. Run \`agentv self update\`.`,
      );
      expect(stderr).toContain(
        `Warning: agentv ${packageJson.version} does not satisfy this project's required_version >=999.0.0. Run \`agentv self update\`.`,
      );
      expect(`${stdout}\n${stderr}`).not.toContain('Update now?');
      expect(`${stdout}\n${stderr}`).not.toContain('Update complete');
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps required_version mismatch low-noise when the eval passes', async () => {
    const fixture = await createFixture();
    try {
      await writeRequiredVersionConfig(fixture, '>=999.0.0');

      const { stdout, stderr, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--threshold',
        '0.5',
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('RESULT: PASS');
      expect(stdout).not.toContain('note: agentv');
      expect(stderr).toContain(
        `Warning: agentv ${packageJson.version} does not satisfy this project's required_version >=999.0.0. Run \`agentv self update\`.`,
      );
      expect(`${stdout}\n${stderr}`).not.toContain('Update now?');
      expect(`${stdout}\n${stderr}`).not.toContain('Update complete');
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('writes canonical artifacts under an explicit --output directory', async () => {
    const fixture = await createFixture();
    try {
      const outputDir = path.join(fixture.baseDir, 'explicit-run');
      const { stdout, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--output',
        outputDir,
      ]);

      expect(exitCode).toBe(0);
      const indexPath = path.join(outputDir, 'file-target', 'index.jsonl');
      expect(extractOutputPath(stdout)).toBe(indexPath);
      expect(stdout).toContain(`Artifact directory: ${outputDir}`);

      const results = await readJsonLines(indexPath);
      expect(results).toHaveLength(2);
      await expectFileExists(path.join(outputDir, 'file-target', 'summary.json'));
      for (const row of results as Array<Record<string, unknown>>) {
        const resultDir = row.result_dir as string;
        await expectFileExists(path.join(outputDir, 'file-target', resultDir, 'summary.json'));
        await expectFileExists(
          path.join(outputDir, 'file-target', resultDir, 'run-1', 'grading.json'),
        );
      }
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses agentv.config.ts output.dir as the canonical artifact directory fallback', async () => {
    const fixture = await createFixture();
    try {
      await writeTsOutputConfig(fixture, './configured-results');

      const { stdout, exitCode } = await runCli(fixture, ['eval', fixture.testFilePath]);

      const outputDir = path.join(fixture.suiteDir, 'configured-results');
      expect(exitCode).toBe(0);
      const indexPath = path.join(outputDir, 'file-target', 'index.jsonl');
      expect(extractOutputPath(stdout)).toBe(indexPath);
      await expectFileExists(indexPath);
      await expectFileExists(path.join(outputDir, 'file-target', 'summary.json'));
      const [firstRow] = (await readJsonLines(indexPath)) as Array<Record<string, unknown>>;
      await expectFileExists(
        path.join(outputDir, 'file-target', firstRow.result_dir as string, 'summary.json'),
      );
      await expectFileExists(
        path.join(outputDir, 'file-target', firstRow.result_dir as string, 'run-1', 'grading.json'),
      );
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects removed --export and keeps --output as the canonical manifest location', async () => {
    const fixture = await createFixture();
    try {
      const outputDir = path.join(fixture.baseDir, 'run');
      const flatJsonlPath = path.join(fixture.baseDir, 'flat.jsonl');

      const removed = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--output',
        outputDir,
        '--export',
        flatJsonlPath,
      ]);

      expect(removed.exitCode).not.toBe(0);
      expect(`${removed.stdout}\n${removed.stderr}`).toContain('Unknown arguments');

      const { stdout, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--output',
        outputDir,
        '--threshold',
        '0.8',
      ]);

      expect(exitCode).toBe(1);
      const indexPath = path.join(outputDir, 'file-target', 'index.jsonl');
      expect(extractOutputPath(stdout)).toBe(indexPath);
      expect(stdout).not.toContain('Export files:');

      const canonicalResults = await readJsonLines(indexPath);
      expect(canonicalResults).toHaveLength(2);
      await expectFileExists(path.join(outputDir, 'file-target', 'summary.json'));
      for (const row of canonicalResults) {
        expect(row.transcript_path).toMatch(/run-1\/transcript\.jsonl$/);
        await expectFileExists(path.join(outputDir, 'file-target', row.transcript_path as string));
        expect(row.transcript_raw_path).toMatch(/run-1\/transcript-raw\.jsonl$/);
        await expectFileExists(
          path.join(outputDir, 'file-target', row.transcript_raw_path as string),
        );
      }
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails with migration guidance for removed eval output flags', async () => {
    const cases = [
      {
        args: ['--out', 'legacy.jsonl'],
        expected: [
          '--out was removed',
          '--output <dir>',
          'Flat result file export from agentv eval has been removed',
        ],
      },
      {
        args: ['--artifacts', 'legacy-artifacts'],
        expected: ['--artifacts was removed', '--output legacy-artifacts'],
      },
      {
        args: ['-o', 'junit.xml', '--artifacts', 'legacy-artifacts'],
        expected: [
          '--artifacts was removed',
          '--output legacy-artifacts',
          'JUnit XML export from agentv eval has been removed',
        ],
      },
      {
        args: ['--output-format', 'html'],
        expected: ['--output-format was removed', 'index.jsonl'],
      },
      {
        args: ['--output', 'results.xml'],
        expected: [
          '--output expects a run directory',
          'JUnit XML export from agentv eval has been removed',
          '<dir>/index.jsonl',
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const fixture = await createFixture();
      try {
        const result = await runCli(fixture, ['eval', fixture.testFilePath, ...testCase.args]);
        expect(result.exitCode).toBe(1);
        const output = `${result.stdout}\n${result.stderr}`;
        for (const expected of testCase.expected) {
          expect(output).toContain(expected);
        }
      } finally {
        await rm(fixture.baseDir, { recursive: true, force: true });
      }
    }
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

  it('keeps --workspace-path as a static workspace override for existing workspaces', async () => {
    const fixture = await createFixture();
    try {
      const workspacePath = path.join(fixture.baseDir, 'prepared-workspace');
      await mkdir(workspacePath, { recursive: true });

      const result = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--workspace-path',
        workspacePath,
      ]);

      expect(result.exitCode).toBe(0);
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        workspaceMode: 'static',
        workspacePath,
        resultCount: 2,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses config.local.yaml workspace_path as a static workspace override', async () => {
    const fixture = await createFixture();
    try {
      const workspacePath = path.join(fixture.baseDir, 'local-config-workspace');
      await mkdir(workspacePath, { recursive: true });
      await writeFile(
        path.join(fixture.suiteDir, '.agentv', 'config.local.yaml'),
        `execution:\n  workspace_path: ${JSON.stringify(workspacePath)}\n`,
        'utf8',
      );

      const result = await runCli(fixture, ['eval', fixture.testFilePath]);

      expect(result.exitCode).toBe(0);
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        workspaceMode: 'static',
        workspacePath,
        resultCount: 2,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('passes run-level budget tracking through to the evaluator', async () => {
    const fixture = await createFixture();
    try {
      await runCli(fixture, ['eval', fixture.testFilePath, '--budget-usd', '0.5']);

      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        budgetUsd: null,
        hasRunBudgetTracker: true,
        runBudgetCapUsd: 0.5,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs eval-local target config with suite test selection and run knobs', async () => {
    const fixture = await createFixture();
    try {
      await writeFile(
        path.join(fixture.suiteDir, '.agentv', 'config.yaml'),
        'eval_patterns:\n  - sample.test.yaml\n  - unused.test.yaml\n',
        'utf8',
      );
      await writeFile(
        path.join(fixture.suiteDir, 'unused.test.yaml'),
        [
          'description: unmatched eval file should not resolve targets',
          'target: missing-target',
          'tests:',
          '  - id: case-unused',
          '    criteria: System responds with unused',
          '    input: unused',
          '    expected_output: unused',
          '',
        ].join('\n'),
        'utf8',
      );
      const wrapperPath = path.join(fixture.suiteDir, 'native-exp.eval.yaml');
      await writeFile(
        wrapperPath,
        [
          'name: native-exp',
          'target:',
          '  extends: codex-target',
          '  model: gpt-5-codex',
          'timeout_seconds: 12',
          'threshold: 0.8',
          'budget_usd: 3',
          'runs: 2',
          'tests:',
          '  - include: sample.test.yaml',
          '    type: suite',
          '    select: case-alpha',
          '    run:',
          '      threshold: 1.0',
          '      timeout_seconds: 5',
          '      budget_usd: 0.75',
          '      repeat:',
          '        count: 3',
          '        strategy: pass_all',
          '',
        ].join('\n'),
        'utf8',
      );

      const { stdout, exitCode } = await runCli(fixture, ['eval', wrapperPath, '--workers', '4']);

      expect(exitCode).toBe(0);
      const outputPath = extractOutputPath(stdout);
      expect(outputPath).toContain(`${path.sep}native-exp${path.sep}`);

      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        target: 'codex-target',
        targetModel: 'gpt-5-codex',
        agentTimeoutMs: 5000,
        maxConcurrency: 4,
        evalCaseIds: ['case-alpha'],
        budgetUsd: 0.75,
        threshold: 1,
        trials: {
          count: 3,
          strategy: 'pass_all',
        },
      });

      const benchmark = JSON.parse(
        await readFile(path.join(path.dirname(outputPath), 'summary.json'), 'utf8'),
      ) as { metadata?: Record<string, unknown> };
      expect(benchmark.metadata?.experiment).toBe('native-exp');
      expect(benchmark.metadata?.experiment_config).toMatchObject({
        target: 'codex-target',
        runs: 2,
        threshold: 0.8,
        budget_usd: 3,
        timeout_seconds: 12,
      });
      expect(
        (benchmark.metadata?.experiment_config as Record<string, unknown>).fingerprint,
      ).toMatch(/^[a-f0-9]{64}$/);
      expect(benchmark.metadata?.runtime_source).toMatchObject({
        schema_version: 'agentv.runtime_source.v1',
        kind: 'wrapper_eval',
        config_source: 'mixed',
        experiment_namespace: 'native-exp',
        experiment_namespace_source: 'eval_metadata',
        eval_files: ['native-exp.eval.yaml'],
        wrapper_eval_file: 'native-exp.eval.yaml',
        source_eval_files: ['sample.test.yaml'],
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps non-concurrency run controls isolated across multiple eval files', async () => {
    const fixture = await createFixture();
    try {
      const firstPath = path.join(fixture.suiteDir, 'first.eval.yaml');
      const secondPath = path.join(fixture.suiteDir, 'second.eval.yaml');
      await writeFile(
        firstPath,
        [
          'name: first',
          'target: cli-target',
          'timeout_seconds: 11',
          'budget_usd: 0.11',
          'tests:',
          '  - id: first-case',
          '    input: first',
          '    criteria: ok',
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        secondPath,
        [
          'name: second',
          'target: file-target',
          'timeout_seconds: 22',
          'budget_usd: 0.22',
          'tests:',
          '  - id: second-case',
          '    input: second',
          '    criteria: ok',
          '',
        ].join('\n'),
        'utf8',
      );

      const { stdout, exitCode } = await runCli(fixture, [
        'eval',
        firstPath,
        secondPath,
        '--workers',
        '2',
      ]);

      expect(exitCode).toBe(0);
      const outputPath = extractOutputPath(stdout);
      expect(outputPath).toContain(`${path.sep}multi-eval${path.sep}`);

      const diagnostics = await readDiagnostics(fixture);
      const calls = diagnostics.calls as Array<Record<string, unknown>>;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        target: 'cli-target',
        agentTimeoutMs: 11_000,
        maxConcurrency: 2,
        budgetUsd: 0.11,
        runBudgetCapUsd: 0.11,
        evalCaseIds: ['first-case'],
      });
      expect(calls[1]).toMatchObject({
        target: 'file-target',
        agentTimeoutMs: 22_000,
        maxConcurrency: 2,
        budgetUsd: 0.22,
        runBudgetCapUsd: 0.22,
        evalCaseIds: ['second-case'],
      });

      const benchmark = JSON.parse(
        await readFile(path.join(path.dirname(outputPath), 'summary.json'), 'utf8'),
      ) as { metadata?: Record<string, unknown> };
      expect(benchmark.metadata?.runtime_source).toMatchObject({
        schema_version: 'agentv.runtime_source.v1',
        kind: 'multi_eval',
        config_source: 'mixed',
        experiment_namespace: 'multi-eval',
        experiment_namespace_source: 'multi_eval',
        eval_files: ['first.eval.yaml', 'second.eval.yaml'],
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('records CLI-named experiment namespace separately from default runtime config', async () => {
    const fixture = await createFixture();
    try {
      const { stdout, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--experiment',
        'cli-smoke',
      ]);

      expect(exitCode).toBe(0);
      const outputPath = extractOutputPath(stdout);
      const benchmark = JSON.parse(
        await readFile(path.join(path.dirname(outputPath), 'summary.json'), 'utf8'),
      ) as { metadata?: Record<string, unknown> };
      expect(benchmark.metadata?.runtime_source).toMatchObject({
        schema_version: 'agentv.runtime_source.v1',
        kind: 'direct_suite',
        config_source: 'inline_experiment',
        experiment_namespace: 'cli-smoke',
        experiment_namespace_source: 'cli',
        eval_files: ['sample.test.yaml'],
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('honors agentv.config.ts cache.path when response cache is enabled there', async () => {
    const fixture = await createFixture();
    try {
      const cachePath = '.agentv/ts-response-cache';
      await writeTsCacheConfig(fixture, cachePath);

      const { stdout } = await runCli(fixture, ['eval', fixture.testFilePath]);

      const resolvedCachePath = path.resolve(fixture.suiteDir, cachePath);
      expect(stdout).toContain(`Response cache: enabled (${resolvedCachePath})`);
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        hasCache: true,
        cachePath: resolvedCachePath,
        useCache: true,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('honors CLI --cache-path as an explicit response cache opt-in', async () => {
    const fixture = await createFixture();
    try {
      const cachePath = '.agentv/cli-response-cache';

      const { stdout } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--cache-path',
        cachePath,
      ]);

      const resolvedCachePath = path.resolve(fixture.suiteDir, cachePath);
      expect(stdout).toContain(`Response cache: enabled (${resolvedCachePath})`);
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        hasCache: true,
        cachePath: resolvedCachePath,
        useCache: true,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('lets --no-cache override config-driven response cache settings', async () => {
    const fixture = await createFixture();
    try {
      await writeTsCacheConfig(fixture, '.agentv/disabled-response-cache');

      const { stdout } = await runCli(fixture, ['eval', fixture.testFilePath, '--no-cache']);

      expect(stdout).not.toContain('Response cache: enabled');
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        hasCache: false,
        cachePath: null,
        useCache: false,
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('passes --record-replay separately from the response cache', async () => {
    const fixture = await createFixture();
    try {
      const replayPath = path.join(fixture.baseDir, 'fixtures', 'target-output.jsonl');
      const { stdout, exitCode } = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--target',
        'cli-target',
        '--record-replay',
        replayPath,
        '--record-replay-variant',
        'legal-v1',
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Replay recording: ${replayPath}`);
      expect(stdout).not.toContain('Response cache: enabled');
      const diagnostics = await readDiagnostics(fixture);
      expect(diagnostics).toMatchObject({
        target: 'cli-target',
        hasCache: false,
        cachePath: null,
        useCache: false,
        replayRecording: {
          fixturesPath: replayPath,
          sourceTarget: 'cli-target',
          variant: 'legal-v1',
        },
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps response cache help separate from transcript replay terminology', async () => {
    const result = await execa('bun', ['--no-env-file', CLI_ENTRY, 'eval', 'run', '--help'], {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true' },
      reject: false,
    });
    const helpText = `${result.stdout}\n${result.stderr}`;
    expect(helpText).toContain('--cache');
    expect(helpText).toContain('--cache-path');
    expect(helpText).toContain('--transcript');
    expect(helpText).toContain('--record-replay');

    const cacheHelp = helpText
      .split(/\r?\n/)
      .filter((line) => line.includes('--cache'))
      .join('\n')
      .toLowerCase();
    expect(cacheHelp).toContain('response cache');
    expect(cacheHelp).not.toContain('replay');

    const transcriptHelp = helpText
      .split(/\r?\n/)
      .filter((line) => line.includes('--transcript'))
      .join('\n')
      .toLowerCase();
    expect(transcriptHelp).not.toContain('cache');

    const replayHelp = helpText
      .split(/\r?\n/)
      .filter((line) => line.includes('--record-replay'))
      .join('\n')
      .toLowerCase();
    expect(replayHelp).not.toContain('response cache');
  }, 30_000);

  it('omits removed benchmark JSON export flag from help', async () => {
    const result = await execa('bun', ['--no-env-file', CLI_ENTRY, 'eval', 'run', '--help'], {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true' },
      reject: false,
    });
    const helpText = `${result.stdout}\n${result.stderr}`;
    expect(helpText).not.toContain('--benchmark-json');
    expect(helpText).toContain('--output');
    expect(helpText).toContain('summary.json');
  }, 30_000);

  it('omits removed eval dry-run flags from help', async () => {
    const result = await execa('bun', ['--no-env-file', CLI_ENTRY, 'eval', 'run', '--help'], {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true' },
      reject: false,
    });
    const helpText = `${result.stdout}\n${result.stderr}`;
    expect(helpText).not.toContain('--dry-run');
    expect(helpText).not.toContain('--dry-run-delay');
    expect(helpText).not.toContain('--dry-run-delay-min');
    expect(helpText).not.toContain('--dry-run-delay-max');
    expect(helpText).toContain('--transcript');
    expect(helpText).toContain('--record-replay');
  }, 30_000);

  it('keeps non-eval dry-run flags available', async () => {
    const commands = [
      ['results', 'export', '--help'],
      ['runs', 'rerun', '--help'],
    ] as const;

    for (const args of commands) {
      const result = await execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
        cwd: projectRoot,
        env: { ...process.env, CI: 'true' },
        reject: false,
      });
      const helpText = `${result.stdout}\n${result.stderr}`;
      expect(helpText).toContain('--dry-run');
    }
  }, 30_000);

  it('omits removed promptfoo import command from help', async () => {
    const helpResult = await execa('bun', ['--no-env-file', CLI_ENTRY, 'import', '--help'], {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true' },
      reject: false,
    });
    const helpText = `${helpResult.stdout}\n${helpResult.stderr}`.toLowerCase();
    expect(helpText).not.toContain('promptfoo');
    expect(helpText).toContain('claude');
    expect(helpText).toContain('codex');
    expect(helpText).toContain('copilot');
    expect(helpText).toContain('huggingface');

    const removedResult = await execa('bun', ['--no-env-file', CLI_ENTRY, 'import', 'promptfoo'], {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true' },
      reject: false,
    });
    expect(removedResult.exitCode).not.toBe(0);
    expect(`${removedResult.stdout}\n${removedResult.stderr}`.toLowerCase()).toContain('promptfoo');
  }, 30_000);

  it('rejects the removed benchmark JSON export flag as an unknown argument', async () => {
    const fixture = await createFixture();
    try {
      const result = await runCli(fixture, [
        'eval',
        fixture.testFilePath,
        '--benchmark-json',
        path.join(fixture.baseDir, 'summary.json'),
      ]);

      expect(result.exitCode).not.toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain('Unknown arguments');
      expect(output).toContain('--benchmark-json');
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects removed eval dry-run flags as unknown arguments', async () => {
    const cases = [
      ['--dry-run'],
      ['--dry-run-delay', '10'],
      ['--dry-run-delay-min', '5'],
      ['--dry-run-delay-max', '20'],
    ] as const;

    for (const args of cases) {
      const fixture = await createFixture();
      try {
        const result = await runCli(fixture, ['eval', fixture.testFilePath, ...args]);
        expect(result.exitCode).not.toBe(0);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(output).toContain('Unknown arguments');
        expect(output).toContain(args[0]);
      } finally {
        await rm(fixture.baseDir, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
