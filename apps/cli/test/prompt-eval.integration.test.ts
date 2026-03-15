import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import { assertCoreBuild } from './setup-core-build.js';

assertCoreBuild();

interface PromptEvalFixture {
  readonly baseDir: string;
  readonly suiteDir: string;
  readonly evalPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

async function createFixture(): Promise<PromptEvalFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-prompt-eval-'));
  const suiteDir = path.join(baseDir, 'suite');
  await mkdir(suiteDir, { recursive: true });

  const evalPath = path.join(suiteDir, 'sample.eval.yaml');
  await writeFile(
    evalPath,
    `description: Prompt eval CLI fixture

tests:
  - id: greeting-test
    criteria: Assistant greets the user by name
    assertions:
      - name: mentions-name
        type: contains
        value: Taylor
    input:
      - role: user
        content: Say hello to Taylor.
    expected_output:
      - role: assistant
        content: Hello, Taylor!
  - id: farewell-test
    criteria: Assistant says goodbye politely
    input:
      - role: user
        content: Say goodbye to Taylor.
    expected_output:
      - role: assistant
        content: Goodbye, Taylor.
`,
    'utf8',
  );

  return { baseDir, suiteDir, evalPath } satisfies PromptEvalFixture;
}

async function runPromptCli(
  fixture: PromptEvalFixture,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('bun', ['--no-env-file', CLI_ENTRY, ...args], {
    cwd: fixture.suiteDir,
    env: {
      ...process.env,
      CI: 'true',
    },
    reject: false,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

describe('agentv prompt eval CLI', () => {
  it('lists available test IDs', async () => {
    const fixture = await createFixture();
    try {
      const result = await runPromptCli(fixture, ['prompt', 'eval', '--list', fixture.evalPath]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        eval_path: fixture.evalPath,
        test_ids: ['farewell-test', 'greeting-test'],
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('returns prompt input for a specific test via --input', async () => {
    const fixture = await createFixture();
    try {
      const result = await runPromptCli(fixture, [
        'prompt',
        'eval',
        '--input',
        fixture.evalPath,
        '--test-id',
        'greeting-test',
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        test_id: 'greeting-test',
        input: [{ role: 'user', content: 'Say hello to Taylor.' }],
        guideline_paths: [],
        criteria: 'Assistant greets the user by name',
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('returns human-readable grading brief via --grading-brief', async () => {
    const fixture = await createFixture();
    try {
      const result = await runPromptCli(fixture, [
        'prompt',
        'eval',
        '--grading-brief',
        fixture.evalPath,
        '--test-id',
        'greeting-test',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Input:');
      expect(result.stdout).toContain('Say hello to Taylor.');
      expect(result.stdout).toContain('Expected:');
      expect(result.stdout).toContain('Hello, Taylor!');
      expect(result.stdout).toContain('Criteria:');
      expect(result.stdout).toContain('Taylor');
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('returns expected output and evaluator context for a specific test', async () => {
    const fixture = await createFixture();
    try {
      const result = await runPromptCli(fixture, [
        'prompt',
        'eval',
        '--expected-output',
        fixture.evalPath,
        '--test-id',
        'greeting-test',
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        test_id: 'greeting-test',
        criteria: 'Assistant greets the user by name',
        expected_output: [{ role: 'assistant', content: 'Hello, Taylor!' }],
        reference_answer: 'Hello, Taylor!',
        assertions: [{ name: 'mentions-name', type: 'contains', value: 'Taylor' }],
      });
    } finally {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });
});
