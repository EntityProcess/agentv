import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_grade_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');

describe('pipeline grade', () => {
  beforeEach(async () => {
    const testDir = join(OUT_DIR, 'test-01');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeGradersDir, { recursive: true });

    await writeFile(join(testDir, 'response.md'), 'hello world');
    await writeFile(
      join(testDir, 'input.json'),
      JSON.stringify({
        input: [{ role: 'user', content: 'say hello' }],
        input_files: [],
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

  it('writes code_grader_results/<name>.json with score and assertions', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'grade', OUT_DIR]);

    const result = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_grader_results', 'always_pass.json'), 'utf8'),
    );
    expect(result.score).toBe(1);
    expect(result.name).toBe('always_pass');
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].passed).toBe(true);
  }, 30_000);
});

describe('pipeline grade — builtin assertions', () => {
  const BUILTIN_OUT = join(import.meta.dirname, '__tmp_grade_builtin_test__');

  beforeEach(async () => {
    const testDir = join(BUILTIN_OUT, 'test-01');
    const builtinGradersDir = join(testDir, 'code_graders');
    await mkdir(builtinGradersDir, { recursive: true });

    await writeFile(join(testDir, 'response.md'), 'hello world');
    await writeFile(
      join(testDir, 'input.json'),
      JSON.stringify({ input: [{ role: 'user', content: 'say hello' }] }),
    );

    await writeFile(
      join(builtinGradersDir, 'has_hello.json'),
      JSON.stringify({
        name: 'has_hello',
        type: 'contains',
        value: 'hello',
        weight: 1.0,
        negate: false,
      }),
    );

    await writeFile(
      join(builtinGradersDir, 'matches_pattern.json'),
      JSON.stringify({
        name: 'matches_pattern',
        type: 'regex',
        value: 'h[aeiou]llo',
        weight: 1.0,
        negate: false,
      }),
    );

    await writeFile(
      join(builtinGradersDir, 'has_goodbye.json'),
      JSON.stringify({
        name: 'has_goodbye',
        type: 'contains',
        value: 'goodbye',
        weight: 1.0,
        negate: false,
      }),
    );

    await writeFile(
      join(BUILTIN_OUT, 'manifest.json'),
      JSON.stringify({
        eval_file: 'test.eval.yaml',
        timestamp: new Date().toISOString(),
        target: { name: 'test', kind: 'cli' },
        test_ids: ['test-01'],
      }),
    );
  });

  afterEach(async () => {
    await rm(BUILTIN_OUT, { recursive: true, force: true });
  });

  it('evaluates builtin assertions and writes results', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'grade', BUILTIN_OUT]);

    const containsResult = JSON.parse(
      await readFile(join(BUILTIN_OUT, 'test-01', 'code_grader_results', 'has_hello.json'), 'utf8'),
    );
    expect(containsResult.score).toBe(1);
    expect(containsResult.type).toBe('contains');
    expect(containsResult.assertions[0].passed).toBe(true);

    const regexResult = JSON.parse(
      await readFile(
        join(BUILTIN_OUT, 'test-01', 'code_grader_results', 'matches_pattern.json'),
        'utf8',
      ),
    );
    expect(regexResult.score).toBe(1);
    expect(regexResult.type).toBe('regex');

    const failingContainsResult = JSON.parse(
      await readFile(
        join(BUILTIN_OUT, 'test-01', 'code_grader_results', 'has_goodbye.json'),
        'utf8',
      ),
    );
    expect(failingContainsResult.score).toBe(0);
    expect(failingContainsResult.assertions[0].passed).toBe(false);
  }, 30_000);

  it('applies negate to invert score', async () => {
    await writeFile(
      join(BUILTIN_OUT, 'test-01', 'code_graders', 'has_goodbye.json'),
      JSON.stringify({
        name: 'has_goodbye',
        type: 'contains',
        value: 'goodbye',
        weight: 1.0,
        negate: true,
      }),
    );

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'grade', BUILTIN_OUT]);

    const result = JSON.parse(
      await readFile(
        join(BUILTIN_OUT, 'test-01', 'code_grader_results', 'has_goodbye.json'),
        'utf8',
      ),
    );
    expect(result.score).toBe(1);
    expect(result.assertions[0].passed).toBe(true);
  }, 30_000);
});
