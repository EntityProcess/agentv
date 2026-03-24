import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_grade_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');

describe('eval grade', () => {
  beforeEach(async () => {
    const testDir = join(OUT_DIR, 'test-01');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeGradersDir, { recursive: true });

    await writeFile(join(testDir, 'response.md'), 'hello world');
    await writeFile(
      join(testDir, 'input.json'),
      JSON.stringify({
        input_text: 'say hello',
        input_messages: [{ role: 'user', content: 'say hello' }],
        file_paths: [],
      }),
    );
    await writeFile(
      join(codeGradersDir, 'always_pass.json'),
      JSON.stringify({
        name: 'always_pass',
        command: [
          'bash',
          '-c',
          'echo \'{"score":1,"assertions":[{"text":"pass","passed":true}]}\'',
        ],
        weight: 1.0,
      }),
    );
    await writeFile(
      join(OUT_DIR, 'manifest.json'),
      JSON.stringify({
        eval_file: 'test.eval.yaml',
        timestamp: new Date().toISOString(),
        target: { name: 'test', kind: 'cli' },
        test_ids: ['test-01'],
      }),
    );
  });

  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes code_grader_results/<name>.json with score', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'grade', OUT_DIR]);

    const result = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_grader_results', 'always_pass.json'), 'utf8'),
    );
    expect(result.score).toBe(1);
    expect(result.name).toBe('always_pass');
  });

  it('includes assertions from code grader output', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'grade', OUT_DIR]);

    const result = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_grader_results', 'always_pass.json'), 'utf8'),
    );
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].passed).toBe(true);
  });
});
