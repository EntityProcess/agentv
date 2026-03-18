import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

async function createGraderFixture(): Promise<{ baseDir: string }> {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'agentv-assert-'));
  const gradersDir = path.join(baseDir, '.agentv', 'graders');
  await mkdir(gradersDir, { recursive: true });

  await writeFile(
    path.join(gradersDir, 'always-pass.ts'),
    `const input = await Bun.stdin.text();
const payload = JSON.parse(input);
console.log(JSON.stringify({ score: 1.0, assertions: [{ text: "always passes", passed: true }] }));`,
    'utf8',
  );

  await writeFile(
    path.join(gradersDir, 'check-contains.ts'),
    `const input = await Bun.stdin.text();
const payload = JSON.parse(input);
const output = payload.answer ?? payload.output ?? '';
const score = typeof output === 'string' && output.includes('hello') ? 1.0 : 0.0;
console.log(JSON.stringify({ score, assertions: [{ text: score ? "contains hello" : "missing hello", passed: !!score }] }));`,
    'utf8',
  );

  return { baseDir };
}

describe('agentv eval assert', () => {
  it('runs a grader with --output and --input flags', async () => {
    const { baseDir } = await createGraderFixture();
    try {
      const result = await execa(
        'bun',
        [
          '--no-env-file',
          CLI_ENTRY,
          'eval',
          'assert',
          'always-pass',
          '--agent-output',
          'some output',
          '--agent-input',
          'some input',
        ],
        { cwd: baseDir, reject: false },
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.score).toBe(1.0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('exits 1 when grader returns score 0', async () => {
    const { baseDir } = await createGraderFixture();
    try {
      const result = await execa(
        'bun',
        [
          '--no-env-file',
          CLI_ENTRY,
          'eval',
          'assert',
          'check-contains',
          '--agent-output',
          'no match here',
          '--agent-input',
          'test',
        ],
        { cwd: baseDir, reject: false },
      );
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.score).toBe(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('exits 0 when grader returns passing score', async () => {
    const { baseDir } = await createGraderFixture();
    try {
      const result = await execa(
        'bun',
        [
          '--no-env-file',
          CLI_ENTRY,
          'eval',
          'assert',
          'check-contains',
          '--agent-output',
          'hello world',
          '--agent-input',
          'test',
        ],
        { cwd: baseDir, reject: false },
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.score).toBe(1.0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('errors when grader name not found', async () => {
    const { baseDir } = await createGraderFixture();
    try {
      const result = await execa(
        'bun',
        [
          '--no-env-file',
          CLI_ENTRY,
          'eval',
          'assert',
          'nonexistent',
          '--agent-output',
          'test',
          '--agent-input',
          'test',
        ],
        { cwd: baseDir, reject: false },
      );
      expect(result.exitCode).not.toBe(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
