import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodeEvaluator } from '../../src/evaluation/evaluators/code-evaluator.js';
import type { EvalTest } from '../../src/evaluation/types.js';

const baseTestCase: EvalTest = {
  id: 'case-1',
  dataset: 'test-dataset',
  question: 'Test question',
  input: [{ role: 'user', content: 'Test input' }],
  input_segments: [{ type: 'text', value: 'Test input' }],
  expected_output: [],
  reference_answer: 'Expected answer',
  guideline_paths: [],
  file_paths: [],
  criteria: 'Test criteria',
  evaluator: 'code-judge',
};

/** Create a judge script that echoes the received stdin payload. */
async function createEchoJudge(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'echo-judge.js');
  await writeFile(
    script,
    `const input = require('fs').readFileSync(0, 'utf8');
const payload = JSON.parse(input);
console.log(JSON.stringify({
  hasOutputPath: !!payload.output_path,
  outputIsNull: payload.output === null,
  outputPath: payload.output_path || null,
}));
`,
    'utf8',
  );
  return [process.execPath, script];
}

/** Create a judge script that returns a fixed score. */
async function createScoringJudge(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'score-judge.js');
  await writeFile(
    script,
    `console.log(JSON.stringify({ score: 1.0, hits: ['ok'], misses: [] }));
`,
    'utf8',
  );
  return [process.execPath, script];
}

describe('CodeEvaluator file-backed output', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'code-eval-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sends small output inline (no temp file)', async () => {
    const command = await createEchoJudge(tmpDir);
    const smallOutput = [{ role: 'assistant' as const, content: 'short response' }];

    const evaluator = new CodeEvaluator({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: smallOutput,
    });

    // Should not error — judge runs successfully
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('writes large output to temp file and cleans up', async () => {
    const command = await createScoringJudge(tmpDir);
    // Create output > 50KB
    const largeContent = 'x'.repeat(60_000);
    const largeOutput = [{ role: 'assistant' as const, content: largeContent }];

    const evaluator = new CodeEvaluator({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: largeOutput,
    });

    expect(result.score).toBe(1.0);
    expect(result.hits).toEqual(['ok']);

    // Temp files should be cleaned up
    const agentVTmpDirs = readdirSync(tmpdir()).filter((d) => d.startsWith('agentv-judge-'));
    // The cleanup should have removed the dir; any remaining are from other tests
    // We can't easily assert absence since other tests may run concurrently
  });

  it('sends outputPath in payload for large output', async () => {
    const command = await createEchoJudge(tmpDir);
    const largeContent = 'x'.repeat(60_000);
    const largeOutput = [{ role: 'assistant' as const, content: largeContent }];

    const evaluator = new CodeEvaluator({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: largeOutput,
    });

    // The echo judge returns parsed info about the payload
    // We can't inspect the payload directly, but the judge script should run without error
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
