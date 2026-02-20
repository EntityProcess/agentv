/**
 * Integration tests for the `agentv generate rubrics` command.
 *
 * These tests verify that the command correctly updates YAML files with generated rubrics.
 */

import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
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

async function createFixture(withComments = false): Promise<GenerateFixture> {
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

  let testFileContent = `description: Generate rubrics integration test

execution:
  target: default

tests:`;

  if (withComments) {
    testFileContent += '\n  # This is a test comment\n  # TODO: update this test case';
  }

  testFileContent += `
  - id: case-with-outcome
    criteria: System should respond politely and helpfully`;

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

  it('should generate rubrics for cases with criteria', async () => {
    fixture = await createFixture();

    const { stdout } = await runGenerateRubrics(fixture);

    expect(stdout).toContain('Generating rubrics for:');
    expect(stdout).toContain('case-with-outcome');
    expect(stdout).toMatch(/Updated \d+ test\(s\) with generated rubrics/);

    // Read the updated file
    const content = await readFile(fixture.testFilePath, 'utf8');

    // Check that rubrics were added
    expect(content).toContain('rubrics:');
    expect(content).toContain('id:');
    expect(content).toContain('outcome:');
    expect(content).toContain('weight:');
    expect(content).toContain('required:');

    // Case without outcome should not have rubrics
    const caseWithoutOutcome = content.split('case-without-outcome')[1];
    expect(caseWithoutOutcome).not.toContain('rubrics:');
  }, 30000);

  it('should preserve comments and structure', async () => {
    fixture = await createFixture(true);

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
    const casesLine = lines.findIndex((line) => line.includes('tests:'));
    const rubricsLine = lines.findIndex((line) => line.includes('rubrics:'));

    // rubrics should be indented more than tests
    if (casesLine >= 0 && rubricsLine >= 0) {
      const casesIndent = lines[casesLine].match(/^\s*/)?.[0].length ?? 0;
      const rubricsIndent = lines[rubricsLine].match(/^\s*/)?.[0].length ?? 0;
      expect(rubricsIndent).toBeGreaterThan(casesIndent);
    }
  }, 30000);
});
