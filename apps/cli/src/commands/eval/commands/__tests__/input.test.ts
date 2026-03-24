import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE_DIR = join(import.meta.dirname, '../__fixtures__');
const OUT_DIR = join(import.meta.dirname, '__tmp_input_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../cli.ts');
const EVAL_PATH = join(FIXTURE_DIR, 'input-test.eval.yaml');

describe('eval input', () => {
  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes manifest.json with test_ids and eval_file', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.test_ids).toEqual(['test-01']);
    expect(manifest.eval_file).toContain('input-test.eval.yaml');
  });

  it('writes per-test input.json with input_text', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const input = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'input.json'), 'utf8'));
    expect(input.input_text).toBe('hello world');
    expect(input.input_messages).toHaveLength(1);
  });

  it('writes code_graders/<name>.json with resolved command', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const grader = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_graders', 'contains_hello.json'), 'utf8'),
    );
    expect(grader.command).toBeDefined();
    expect(grader.name).toBe('contains_hello');
  });

  it('writes llm_graders/<name>.json with prompt content', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const grader = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'llm_graders', 'relevance.json'), 'utf8'),
    );
    expect(grader.prompt_content).toBeDefined();
    expect(grader.name).toBe('relevance');
  });

  it('writes criteria.md', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const criteria = await readFile(join(OUT_DIR, 'test-01', 'criteria.md'), 'utf8');
    expect(criteria).toContain('Response echoes the input');
  });

  it('writes invoke.json', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const invoke = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'invoke.json'), 'utf8'));
    expect(invoke.kind).toBeDefined();
  });
});
