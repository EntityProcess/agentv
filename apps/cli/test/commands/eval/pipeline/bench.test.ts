import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_bench_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');

describe('pipeline bench', () => {
  beforeEach(async () => {
    const testDir = join(OUT_DIR, 'test-01');
    const codeResultsDir = join(testDir, 'code_grader_results');
    const llmGradersDir = join(testDir, 'llm_graders');
    const llmResultsDir = join(testDir, 'llm_grader_results');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeResultsDir, { recursive: true });
    await mkdir(llmGradersDir, { recursive: true });
    await mkdir(llmResultsDir, { recursive: true });
    await mkdir(codeGradersDir, { recursive: true });

    await writeFile(
      join(OUT_DIR, 'manifest.json'),
      JSON.stringify({
        eval_file: 'test.eval.yaml',
        timestamp: new Date().toISOString(),
        target: { name: 'test-target', kind: 'cli' },
        test_ids: ['test-01'],
      }),
    );
    await writeFile(
      join(codeResultsDir, 'contains.json'),
      JSON.stringify({
        name: 'contains',
        type: 'code-grader',
        score: 1.0,
        weight: 1.0,
        assertions: [{ text: 'Found keyword', passed: true }],
      }),
    );
    await writeFile(
      join(llmGradersDir, 'relevance.json'),
      JSON.stringify({
        name: 'relevance',
        weight: 2.0,
        threshold: 0.5,
        prompt_content: '...',
      }),
    );
    await writeFile(
      join(codeGradersDir, 'contains.json'),
      JSON.stringify({
        name: 'contains',
        command: ['echo'],
        weight: 1.0,
      }),
    );
  });

  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes grading.json with merged scores and pass_rate', async () => {
    // Write LLM grader result to disk (the default flow)
    await writeFile(
      join(OUT_DIR, 'test-01', 'llm_grader_results', 'relevance.json'),
      JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'Relevant response', passed: true, evidence: 'matches criteria' }],
      }),
    );

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', OUT_DIR]);

    const grading = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'grading.json'), 'utf8'));
    expect(grading.summary.pass_rate).toBeGreaterThan(0);
    expect(grading.assertions.length).toBeGreaterThan(0);
    expect(grading.graders).toHaveLength(2);
  }, 30_000);

  it('writes index.jsonl with one entry per test', async () => {
    await writeFile(
      join(OUT_DIR, 'test-01', 'llm_grader_results', 'relevance.json'),
      JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'Relevant', passed: true }],
      }),
    );

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', OUT_DIR]);

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const lines = indexContent
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0].test_id).toBe('test-01');
    expect(lines[0].score).toBeGreaterThan(0);
  }, 30_000);

  it('writes benchmark.json with run_summary', async () => {
    await writeFile(
      join(OUT_DIR, 'test-01', 'llm_grader_results', 'relevance.json'),
      JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'ok', passed: true }],
      }),
    );

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', OUT_DIR]);

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.metadata.targets).toContain('test-target');
    expect(benchmark.run_summary['test-target']).toBeDefined();
  }, 30_000);

  it('propagates experiment from manifest to index.jsonl and benchmark.json', async () => {
    // Overwrite manifest with experiment field
    await writeFile(
      join(OUT_DIR, 'manifest.json'),
      JSON.stringify({
        eval_file: 'test.eval.yaml',
        timestamp: new Date().toISOString(),
        experiment: 'without_skills',
        target: { name: 'test-target', kind: 'cli' },
        test_ids: ['test-01'],
      }),
    );

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', OUT_DIR]);

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const entry = JSON.parse(indexContent.trim().split('\n')[0]);
    expect(entry.experiment).toBe('without_skills');

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.metadata.experiment).toBe('without_skills');
  }, 30_000);

  it('omits experiment from output when manifest has no experiment', async () => {
    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', OUT_DIR]);

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const entry = JSON.parse(indexContent.trim().split('\n')[0]);
    expect(entry.experiment).toBeUndefined();

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.metadata.experiment).toBeUndefined();
  }, 30_000);
});
