/**
 * Integration tests for the `agentv generate rubrics` command.
 *
 * These tests verify that the command correctly updates YAML files with generated rubrics.
 */

import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

interface GenerateFixture {
  readonly baseDir: string;
  readonly suiteDir: string;
  readonly testFilePath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');
const MOCK_GENERATOR = path.join(projectRoot, 'apps/cli/test/fixtures/mock-rubric-generator.ts');
let coreBuilt = false;

beforeAll(async () => {
  if (!coreBuilt) {
    await execa('bun', ['run', '--filter', '@agentv/core', 'build'], { cwd: projectRoot });
    coreBuilt = true;
  }
}, 30000); // 30 second timeout for building core package

async function createFixture(
  withExistingRubrics = false,
  withComments = false,
): Promise<GenerateFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-generate-test-'));
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

  const testFilePath = path.join(suiteDir, 'test.yaml');

  let testFileContent = `$schema: agentv-eval-v2
description: Generate rubrics integration test
target: default

evalcases:`;

  if (withComments) {
    testFileContent += '\n  # This is a test comment\n  # TODO: update this test case';
  }

  testFileContent += `
  - id: case-with-outcome
    expected_outcome: System should respond politely and helpfully`;

  if (withExistingRubrics) {
    testFileContent += `
    rubrics:
      - id: politeness
        description: Response must be polite
        weight: 0.5
        required: true
      - id: helpfulness
        description: Response must be helpful
        weight: 0.5
        required: true`;
  }

  testFileContent += `
    input_messages:
      - role: user
        content: "Hello, can you help me?"
    expected_messages:
      - role: assistant
        content: "Of course! How can I help you?"`;

  if (withComments) {
    testFileContent += '\n\n  # Another test case';
  }

  testFileContent += `
  - id: case-without-outcome
    input_messages:
      - role: user
        content: "This case has no expected outcome"
`;

  await writeFile(testFilePath, testFileContent, 'utf8');

  return { baseDir, suiteDir, testFilePath };
}

async function runGenerateRubrics(
  fixture: GenerateFixture,
  args: readonly string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execa(
      'bun',
      [CLI_ENTRY, 'generate', 'rubrics', fixture.testFilePath, ...args],
      {
        cwd: fixture.suiteDir,
        env: {
          ...process.env,
          CI: 'true',
          AGENTEVO_CLI_RUBRIC_GENERATOR: MOCK_GENERATOR,
        },
        reject: false,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      return {
        stdout: String(error.stdout),
        stderr: String(error.stderr),
      };
    }
    throw error;
  }
}

describe('generate rubrics integration', () => {
  let fixture: GenerateFixture;

  afterEach(async () => {
    if (fixture) {
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it('should generate rubrics for cases with expected_outcome', async () => {
    fixture = await createFixture(false, false);

    const { stdout } = await runGenerateRubrics(fixture);

    expect(stdout).toContain('Generating rubrics for:');
    expect(stdout).toContain('case-with-outcome');
    expect(stdout).toMatch(/Updated \d+ eval case\(s\) with generated rubrics/);

    // Read the updated file
    const content = await readFile(fixture.testFilePath, 'utf8');

    // Check that rubrics were added
    expect(content).toContain('rubrics:');
    expect(content).toContain('id:');
    expect(content).toContain('description:');
    expect(content).toContain('weight:');
    expect(content).toContain('required:');

    // Case without outcome should not have rubrics
    const caseWithoutOutcome = content.split('case-without-outcome')[1];
    expect(caseWithoutOutcome).not.toContain('rubrics:');
  }, 30000);

  it('should skip cases that already have rubrics', async () => {
    fixture = await createFixture(true, false);

    const { stdout } = await runGenerateRubrics(fixture);

    expect(stdout).toContain('Generating rubrics for:');
    expect(stdout).toContain('No eval cases updated');

    // Read the file
    const content = await readFile(fixture.testFilePath, 'utf8');

    // Check that existing rubrics are preserved
    expect(content).toContain('politeness');
    expect(content).toContain('Response must be polite');
    expect(content).toContain('helpfulness');
    expect(content).toContain('Response must be helpful');
  }, 30000);

  it('should preserve comments and structure', async () => {
    fixture = await createFixture(false, true);

    const originalContent = await readFile(fixture.testFilePath, 'utf8');

    // Verify comments exist in original
    expect(originalContent).toContain('# This is a test comment');
    expect(originalContent).toContain('# TODO: update this test case');
    expect(originalContent).toContain('# Another test case');

    await runGenerateRubrics(fixture);

    // Read the updated file
    const updatedContent = await readFile(fixture.testFilePath, 'utf8');

    // Check that comments are preserved
    expect(updatedContent).toContain('# This is a test comment');
    expect(updatedContent).toContain('# TODO: update this test case');
    expect(updatedContent).toContain('# Another test case');

    // Check that rubrics were added
    expect(updatedContent).toContain('rubrics:');

    // Check that structure is maintained (basic indentation check)
    const lines = updatedContent.split('\n');
    const evalcasesLine = lines.findIndex((line) => line.includes('evalcases:'));
    const rubricsLine = lines.findIndex((line) => line.includes('rubrics:'));

    // rubrics should be indented more than evalcases
    if (evalcasesLine >= 0 && rubricsLine >= 0) {
      const evalcasesIndent = lines[evalcasesLine].match(/^\s*/)?.[0].length ?? 0;
      const rubricsIndent = lines[rubricsLine].match(/^\s*/)?.[0].length ?? 0;
      expect(rubricsIndent).toBeGreaterThan(evalcasesIndent);
    }
  }, 30000);

  it('should support verbose output', async () => {
    fixture = await createFixture(false, false);

    const { stdout } = await runGenerateRubrics(fixture, ['--verbose']);

    expect(stdout).toContain('Using target:');
    expect(stdout).toContain('Generating rubrics for: case-with-outcome');
    expect(stdout).toMatch(/Generated \d+ rubric\(s\)/);
    expect(stdout).toContain('Skipping case-without-outcome: no expected_outcome');
  }, 30000);

  it('should handle files with no evalcases', async () => {
    fixture = await createFixture(false, false);

    // Create a file with no evalcases
    const emptyFilePath = path.join(fixture.suiteDir, 'empty.yaml');
    await writeFile(
      emptyFilePath,
      `$schema: agentv-eval-v2
description: Empty test
target: default
`,
      'utf8',
    );

    // Create new fixture with updated testFilePath
    const emptyFixture: GenerateFixture = {
      ...fixture,
      testFilePath: emptyFilePath,
    };

    const { stdout, stderr } = await runGenerateRubrics(emptyFixture);

    // Should report an error about no evalcases
    expect(stdout + stderr).toContain('No evalcases found');
  }, 30000);

  it('should support target override', async () => {
    fixture = await createFixture(false, false);

    // Add another target to targets.yaml
    const targetsPath = path.join(fixture.suiteDir, '.agentv', 'targets.yaml');
    const targetsContent = await readFile(targetsPath, 'utf8');
    const updatedTargets = `${targetsContent}  - name: custom-target
    provider: mock
`;
    await writeFile(targetsPath, updatedTargets, 'utf8');

    const { stdout } = await runGenerateRubrics(fixture, [
      '--target',
      'custom-target',
      '--verbose',
    ]);

    expect(stdout).toContain('Using target: custom-target');
  }, 30000);
});
