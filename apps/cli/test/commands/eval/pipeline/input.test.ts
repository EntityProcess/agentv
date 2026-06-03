import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const OUT_DIR = join(import.meta.dirname, '__tmp_input_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');
const EVAL_PATH = join(FIXTURE_DIR, 'input-test.eval.yaml');

describe('pipeline input', () => {
  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('materializes the default input workspace', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.test_ids).toEqual(['test-01']);
    expect(manifest.eval_file).toContain('input-test.eval.yaml');
    expect(manifest.experiment).toBeUndefined();

    const input = JSON.parse(
      await readFile(join(OUT_DIR, 'input-test', 'test-01', 'input.json'), 'utf8'),
    );
    expect(input.input).toHaveLength(1);
    expect(input.input[0].content).toBe('hello world');

    const codeGrader = JSON.parse(
      await readFile(
        join(OUT_DIR, 'input-test', 'test-01', 'code_graders', 'contains_hello.json'),
        'utf8',
      ),
    );
    expect(codeGrader.command).toBeDefined();
    expect(codeGrader.name).toBe('contains_hello');

    const llmGrader = JSON.parse(
      await readFile(
        join(OUT_DIR, 'input-test', 'test-01', 'llm_graders', 'relevance.json'),
        'utf8',
      ),
    );
    expect(llmGrader.prompt_content).toBeDefined();
    expect(llmGrader.name).toBe('relevance');

    const criteria = await readFile(join(OUT_DIR, 'input-test', 'test-01', 'criteria.md'), 'utf8');
    expect(criteria).toContain('Response echoes the input');

    const invoke = JSON.parse(
      await readFile(join(OUT_DIR, 'input-test', 'test-01', 'invoke.json'), 'utf8'),
    );
    expect(invoke.kind).toBeDefined();
  }, 30_000);

  it('writes experiment to manifest when --experiment is provided', async () => {
    const { execa } = await import('execa');
    await execa('bun', [
      CLI_ENTRY,
      'pipeline',
      'input',
      EVAL_PATH,
      '--out',
      OUT_DIR,
      '--experiment',
      'without_skills',
    ]);

    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.experiment).toBe('without_skills');
  }, 30_000);

  it('writes code_graders/<name>.json for deterministic assertions', async () => {
    const { execa } = await import('execa');
    const builtinEvalPath = join(FIXTURE_DIR, 'builtin-test.eval.yaml');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'input', builtinEvalPath, '--out', OUT_DIR]);

    const containsGrader = JSON.parse(
      await readFile(
        join(OUT_DIR, 'builtin-test', 'test-01', 'code_graders', 'has_hello.json'),
        'utf8',
      ),
    );
    expect(containsGrader.name).toBe('has_hello');
    expect(containsGrader.type).toBe('contains');
    expect(containsGrader.value).toBe('hello');

    const regexGrader = JSON.parse(
      await readFile(
        join(OUT_DIR, 'builtin-test', 'test-01', 'code_graders', 'matches_pattern.json'),
        'utf8',
      ),
    );
    expect(regexGrader.name).toBe('matches_pattern');
    expect(regexGrader.type).toBe('regex');
    expect(regexGrader.value).toBe('h[aeiou]llo');
  }, 30_000);

  it('falls back to eval file basename for suite directory when name is absent', async () => {
    const { execa } = await import('execa');
    const noNameEvalPath = join(FIXTURE_DIR, 'no-name.eval.yaml');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'input', noNameEvalPath, '--out', OUT_DIR]);

    const input = JSON.parse(
      await readFile(join(OUT_DIR, 'no-name', 'test-01', 'input.json'), 'utf8'),
    );
    expect(input.input[0].content).toBe('hello world');

    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.suite).toBe('no-name');
  }, 30_000);
});
