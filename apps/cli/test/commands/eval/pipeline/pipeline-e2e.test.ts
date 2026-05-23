import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const CLI_ENTRY = join(import.meta.dirname, '../../../../src/cli.ts');
const EVAL_PATH = join(FIXTURE_DIR, 'input-test.eval.yaml');
const PIPELINE_E2E_TIMEOUT_MS = 60_000;

describe('eval pipeline e2e', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'agentv-pipeline-e2e-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it(
    'runs full input → grade → bench pipeline',
    async () => {
      const { execa } = await import('execa');

      // Step 1: pipeline input
      await execa('bun', [CLI_ENTRY, 'pipeline', 'input', EVAL_PATH, '--out', outDir]);
      const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
      expect(manifest.test_ids).toEqual(['test-01']);

      // Step 2: Write mock response.md (simulating target execution)
      await writeFile(join(outDir, 'input-test', 'test-01', 'response.md'), 'hello world response');

      // Step 3: pipeline grade
      await execa('bun', [CLI_ENTRY, 'pipeline', 'grade', outDir]);
      const gradeResult = JSON.parse(
        await readFile(
          join(outDir, 'input-test', 'test-01', 'code_grader_results', 'contains_hello.json'),
          'utf8',
        ),
      );
      expect(gradeResult.score).toBe(1);

      // Step 4: Write mock LLM grader result to disk, then run pipeline bench
      const llmResultsDir = join(outDir, 'input-test', 'test-01', 'llm_grader_results');
      await mkdir(llmResultsDir, { recursive: true });
      await writeFile(
        join(llmResultsDir, 'relevance.json'),
        JSON.stringify({
          score: 0.9,
          assertions: [{ text: 'Response is relevant', passed: true, evidence: 'echoes input' }],
        }),
      );
      await execa('bun', [CLI_ENTRY, 'pipeline', 'bench', outDir]);

      // Verify final artifacts
      const grading = JSON.parse(
        await readFile(join(outDir, 'input-test', 'test-01', 'grading.json'), 'utf8'),
      );
      expect(grading.graders).toHaveLength(2);
      expect(grading.summary.pass_rate).toBeGreaterThan(0);

      const indexContent = await readFile(join(outDir, 'index.jsonl'), 'utf8');
      const indexLines = indexContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(indexLines).toHaveLength(1);
      expect(indexLines[0].test_id).toBe('test-01');

      const benchmark = JSON.parse(await readFile(join(outDir, 'benchmark.json'), 'utf8'));
      expect(benchmark.run_summary).toBeDefined();
    },
    PIPELINE_E2E_TIMEOUT_MS,
  );
});
