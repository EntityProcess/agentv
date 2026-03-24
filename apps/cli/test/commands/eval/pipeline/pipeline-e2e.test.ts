import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const OUT_DIR = join(import.meta.dirname, '__tmp_pipeline_e2e__');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');
const EVAL_PATH = join(FIXTURE_DIR, 'input-test.eval.yaml');

describe('eval pipeline e2e', () => {
  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('runs full input → grade → bench pipeline', async () => {
    const { execa } = await import('execa');

    // Step 1: eval input
    await execa('bun', [CLI_ENTRY, 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);
    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.test_ids).toEqual(['test-01']);

    // Step 2: Write mock response.md (simulating target execution)
    await writeFile(join(OUT_DIR, 'test-01', 'response.md'), 'hello world response');

    // Step 3: eval grade
    await execa('bun', [CLI_ENTRY, 'eval', 'grade', OUT_DIR]);
    const gradeResult = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_grader_results', 'contains_hello.json'), 'utf8'),
    );
    expect(gradeResult.score).toBe(1);

    // Step 4: eval bench with mock LLM scores
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: {
          score: 0.9,
          assertions: [{ text: 'Response is relevant', passed: true, evidence: 'echoes input' }],
        },
      },
    });
    await execa('bun', [CLI_ENTRY, 'eval', 'bench', OUT_DIR], { input: llmScores });

    // Verify final artifacts
    const grading = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'grading.json'), 'utf8'),
    );
    expect(grading.evaluators).toHaveLength(2);
    expect(grading.summary.pass_rate).toBeGreaterThan(0);

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const indexLines = indexContent
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(indexLines).toHaveLength(1);
    expect(indexLines[0].test_id).toBe('test-01');

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.run_summary).toBeDefined();
  });
});
