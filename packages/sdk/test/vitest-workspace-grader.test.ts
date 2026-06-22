import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodeGraderInputSchema } from '../src/schemas.js';
import { runVitestWorkspaceGrader, vitestReportToCodeGraderResult } from '../src/vitest.js';

const mixedVitestReport = {
  success: false,
  numTotalTests: 2,
  numPassedTests: 1,
  numFailedTests: 1,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: '/workspace/verifiers/welcome-banner.test.ts',
      assertionResults: [
        {
          ancestorTitles: ['welcome banner'],
          fullName: 'welcome banner contains status',
          status: 'passed',
          title: 'contains status',
          duration: 3,
          failureMessages: [],
        },
        {
          ancestorTitles: ['welcome banner'],
          fullName: 'welcome banner links to dashboard',
          status: 'failed',
          title: 'links to dashboard',
          duration: 4,
          failureMessages: ['AssertionError: expected href to equal /dashboard'],
        },
      ],
    },
  ],
};

function buildInput(overrides?: Record<string, unknown>) {
  return CodeGraderInputSchema.parse({
    criteria: 'Verify the workspace with Vitest',
    expectedOutput: [],
    inputFiles: [],
    input: [{ role: 'user', content: 'Update the workspace' }],
    ...overrides,
  });
}

describe('Vitest workspace grader adapter', () => {
  let tmpDir: string;
  let previousWorkspaceEnv: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `agentv-vitest-grader-${crypto.randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    previousWorkspaceEnv = process.env.AGENTV_WORKSPACE_PATH;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousWorkspaceEnv === undefined) {
      process.env.AGENTV_WORKSPACE_PATH = undefined;
    } else {
      process.env.AGENTV_WORKSPACE_PATH = previousWorkspaceEnv;
    }
  });

  it('maps individual Vitest test outcomes to AgentV assertions', () => {
    const result = vitestReportToCodeGraderResult(mixedVitestReport);

    expect(result.score).toBe(0.5);
    expect(result.assertions).toEqual([
      { text: 'welcome banner contains status', passed: true },
      {
        text: 'welcome banner links to dashboard',
        passed: false,
        evidence: 'AssertionError: expected href to equal /dashboard',
      },
    ]);
    expect(result.details).toEqual({
      vitest_success: false,
      num_total_tests: 2,
      num_passed_tests: 1,
      num_failed_tests: 1,
      num_pending_tests: 0,
      num_todo_tests: 0,
    });
  });

  it('runs a verifier-file command with JSON reporter args and reads the output file', async () => {
    const fakeVitest = join(tmpDir, 'fake-vitest.ts');
    writeFileSync(
      fakeVitest,
      `import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
writeFileSync('vitest-argv.json', JSON.stringify(args));
const outputArg = args.find((arg) => arg.startsWith('--outputFile='));
if (!outputArg) throw new Error('missing outputFile arg');
writeFileSync(outputArg.slice('--outputFile='.length), JSON.stringify(${JSON.stringify(mixedVitestReport)}));
process.exit(1);
`,
    );

    const result = await runVitestWorkspaceGrader(
      {
        vitestCommand: ['bun', fakeVitest],
        testFile: 'verifiers/welcome-banner.test.ts',
      },
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result.score).toBe(0.5);
    expect(result.assertions.map((item) => item.text)).toEqual([
      'welcome banner contains status',
      'welcome banner links to dashboard',
    ]);

    const argv = JSON.parse(readFileSync(join(tmpDir, 'vitest-argv.json'), 'utf8')) as string[];
    expect(argv).toContain('verifiers/welcome-banner.test.ts');
    expect(argv).toContain('--reporter=json');
    expect(argv.some((arg) => arg.startsWith('--outputFile='))).toBe(true);
  });

  it('copies hidden verifier files into the workspace before running Vitest', async () => {
    const testFileRoot = join(tmpDir, 'graders');
    mkdirSync(testFileRoot, { recursive: true });
    writeFileSync(
      join(testFileRoot, 'welcome-banner.test.ts'),
      'import { expect, it } from "vitest";\n',
    );

    const fakeVitest = join(tmpDir, 'fake-vitest-copy.ts');
    writeFileSync(
      fakeVitest,
      `import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const args = process.argv.slice(2);
const testFile = args[0];
writeFileSync('vitest-test-file.json', JSON.stringify({
  testFile,
  exists: existsSync(join(process.cwd(), testFile)),
  isAbsolute: isAbsolute(testFile),
}));
const outputArg = args.find((arg) => arg.startsWith('--outputFile='));
if (!outputArg) throw new Error('missing outputFile arg');
writeFileSync(outputArg.slice('--outputFile='.length), JSON.stringify(${JSON.stringify(mixedVitestReport)}));
process.exit(1);
`,
    );

    const result = await runVitestWorkspaceGrader(
      {
        vitestCommand: ['bun', fakeVitest],
        testFile: 'welcome-banner.test.ts',
        testFileRoot,
        copyTestFilesToWorkspace: true,
      },
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result.score).toBe(0.5);
    const copied = JSON.parse(readFileSync(join(tmpDir, 'vitest-test-file.json'), 'utf8')) as {
      testFile: string;
      exists: boolean;
      isAbsolute: boolean;
    };
    expect(copied.testFile).toMatch(/^\.agentv-vitest-.+\/0-welcome-banner\.test\.ts$/);
    expect(copied.exists).toBe(true);
    expect(copied.isAbsolute).toBe(false);
  });

  it('runs a full Vitest command and parses JSON from stdout', async () => {
    const fakeVitest = join(tmpDir, 'fake-vitest-stdout.ts');
    writeFileSync(
      fakeVitest,
      `console.log(JSON.stringify(${JSON.stringify(mixedVitestReport)}));
process.exit(1);
`,
    );

    const result = await runVitestWorkspaceGrader(
      {
        command: ['bun', fakeVitest],
        appendReporterArgs: false,
      },
      buildInput({ workspacePath: tmpDir }),
    );

    expect(result.score).toBe(0.5);
    expect(result.assertions[1].passed).toBe(false);
  });

  it('returns a failed AgentV result when workspace_path is unavailable', async () => {
    process.env.AGENTV_WORKSPACE_PATH = undefined;

    const result = await runVitestWorkspaceGrader(
      { testFile: 'verifiers/welcome-banner.test.ts' },
      buildInput(),
    );

    expect(result.score).toBe(0);
    expect(result.assertions[0]).toMatchObject({
      text: 'Vitest workspace verifier requires workspace_path',
      passed: false,
    });
  });
});
