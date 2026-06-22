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

const report = {
  success: false,
  numTotalTests: 2,
  numPassedTests: 1,
  numFailedTests: 1,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: '/workspace/.agentv-vitest/example.test.ts',
      assertionResults: [
        {
          fullName: 'welcome banner includes ready status',
          status: 'passed',
          failureMessages: [],
        },
        {
          fullName: 'welcome banner links to dashboard',
          status: 'failed',
          failureMessages: ['AssertionError: expected link to point at /dashboard'],
        },
      ],
    },
  ],
};

async function runCli(args: readonly string[], cwd: string, input: string) {
  return execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
    cwd,
    input,
    env: {
      AGENTV_HOME: path.join(cwd, '.agentv-home'),
      AGENTV_NO_UPDATE_CHECK: '1',
    },
  });
}

describe('agentv eval vitest', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-eval-vitest-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs external verifier files through the code-grader protocol', async () => {
    const workspacePath = path.join(tempDir, 'workspace');
    const gradersPath = path.join(tempDir, 'graders');
    const fakeVitest = path.join(tempDir, 'fake-vitest.ts');
    await mkdir(workspacePath, { recursive: true });
    await mkdir(gradersPath, { recursive: true });
    await writeFile(
      path.join(gradersPath, 'welcome-banner.test.ts'),
      'import { expect, it } from "vitest";\n',
      'utf8',
    );
    await writeFile(
      fakeVitest,
      `import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
writeFileSync('vitest-args.json', JSON.stringify(args));
const outputArg = args.find((arg) => arg.startsWith('--outputFile='));
if (!outputArg) throw new Error('missing outputFile arg');
writeFileSync(outputArg.slice('--outputFile='.length), JSON.stringify(${JSON.stringify(report)}));
process.exit(1);
`,
      'utf8',
    );

    const payload = JSON.stringify({
      criteria: 'Verify the workspace',
      expected_output: [],
      input_files: [],
      input: [{ role: 'user', content: 'Update the welcome banner' }],
      workspace_path: workspacePath,
    });

    const result = await runCli(
      ['eval', 'vitest', '--vitest-command', `bun ${fakeVitest}`, 'graders/welcome-banner.test.ts'],
      tempDir,
      payload,
    );

    const output = JSON.parse(result.stdout);
    expect(output.score).toBe(0.5);
    expect(output.assertions).toEqual([
      { text: 'welcome banner includes ready status', passed: true },
      {
        text: 'welcome banner links to dashboard',
        passed: false,
        evidence: 'AssertionError: expected link to point at /dashboard',
      },
    ]);
    expect(output.details).toMatchObject({
      vitest_success: false,
      num_total_tests: 2,
      num_passed_tests: 1,
      num_failed_tests: 1,
    });

    const vitestArgs = JSON.parse(
      await readFile(path.join(workspacePath, 'vitest-args.json'), 'utf8'),
    ) as string[];
    expect(vitestArgs[0]).toMatch(/^\.agentv-vitest-.+\/0-welcome-banner\.test\.ts$/);
    expect(vitestArgs).toContain('--reporter=json');
    expect(vitestArgs.some((arg) => arg.startsWith('--outputFile='))).toBe(true);

    const workspaceEntries = await readdir(workspacePath);
    expect(workspaceEntries.some((entry) => entry.startsWith('.agentv-vitest-'))).toBe(false);
  });
});
