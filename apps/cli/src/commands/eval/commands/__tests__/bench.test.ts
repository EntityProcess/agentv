import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_bench_test__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../cli.ts');

describe('eval bench', () => {
  beforeEach(async () => {
    const testDir = join(OUT_DIR, 'test-01');
    const codeResultsDir = join(testDir, 'code_grader_results');
    const llmGradersDir = join(testDir, 'llm_graders');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeResultsDir, { recursive: true });
    await mkdir(llmGradersDir, { recursive: true });
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
    // Code grader result
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
    // LLM grader metadata (for weight)
    await writeFile(
      join(llmGradersDir, 'relevance.json'),
      JSON.stringify({
        name: 'relevance',
        weight: 2.0,
        threshold: 0.5,
        prompt_content: '...',
      }),
    );
    // Code grader metadata (for weight)
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
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: {
          score: 0.8,
          assertions: [{ text: 'Relevant response', passed: true, evidence: 'matches criteria' }],
        },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'bench', OUT_DIR], { input: llmScores });

    const grading = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'grading.json'), 'utf8'));
    expect(grading.summary.pass_rate).toBeGreaterThan(0);
    expect(grading.assertions.length).toBeGreaterThan(0);
    expect(grading.evaluators).toHaveLength(2);
  });

  it('writes index.jsonl with one entry per test', async () => {
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: {
          score: 0.8,
          assertions: [{ text: 'Relevant', passed: true }],
        },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'bench', OUT_DIR], { input: llmScores });

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const lines = indexContent.trim().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(1);
    expect(lines[0].test_id).toBe('test-01');
    expect(lines[0].score).toBeGreaterThan(0);
  });

  it('writes benchmark.json with run_summary', async () => {
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: { score: 0.8, assertions: [{ text: 'ok', passed: true }] },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', [CLI_ENTRY, 'eval', 'bench', OUT_DIR], { input: llmScores });

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.metadata.targets).toContain('test-target');
    expect(benchmark.run_summary['test-target']).toBeDefined();
  });
});
