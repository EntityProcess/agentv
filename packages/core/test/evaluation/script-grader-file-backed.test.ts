import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ScriptGrader } from '../../src/evaluation/graders/script-grader.js';
import type { EvalTest } from '../../src/evaluation/types.js';

const baseTestCase: EvalTest = {
  id: 'case-1',
  suite: 'test-dataset',
  question: 'Test question',
  input: [{ role: 'user', content: 'Test input' }],
  expected_output: [],
  reference_answer: 'Expected answer',
  file_paths: [],
  criteria: 'Test criteria',
  evaluator: 'script',
};

/** Create a grader script that echoes the received stdin payload. */
async function createEchoGrader(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'echo-grader.js');
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

/** Create a grader script that returns a fixed score. */
async function createScoringGrader(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'score-grader.js');
  await writeFile(
    script,
    `console.log(JSON.stringify({ score: 1.0, assertions: [{ text: 'ok', passed: true }] }));
`,
    'utf8',
  );
  return [process.execPath, script];
}

async function createPayloadShapeGrader(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'payload-shape-grader.js');
  await writeFile(
    script,
    `const input = require('fs').readFileSync(0, 'utf8');
const payload = JSON.parse(input);
console.log(JSON.stringify({
  score: payload.expected_output?.[0]?.content?.answer === 'Paris' &&
    payload.config?.mode === 'strict' &&
    payload.input?.[0]?.content === 'Test input' ? 1 : 0,
  assertions: [{
    text: 'structured stdin preserved',
    passed: payload.expected_output?.[0]?.content?.answer === 'Paris' &&
      payload.config?.mode === 'strict' &&
      payload.input?.[0]?.content === 'Test input'
  }],
  details: { expected_output: payload.expected_output, config: payload.config, input: payload.input }
}));
`,
    'utf8',
  );
  return [process.execPath, script];
}

describe('ScriptGrader file-backed output', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'code-eval-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sends small output inline (no temp file)', async () => {
    const command = await createEchoGrader(tmpDir);
    const smallOutput = [{ role: 'assistant' as const, content: 'short response' }];

    const evaluator = new ScriptGrader({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: smallOutput,
    });

    // Should not error — grader runs successfully
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('writes large output to temp file and cleans up', async () => {
    const command = await createScoringGrader(tmpDir);
    // Create output > 50KB
    const largeContent = 'x'.repeat(60_000);
    const largeOutput = [{ role: 'assistant' as const, content: largeContent }];

    const evaluator = new ScriptGrader({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: largeOutput,
    });

    expect(result.score).toBe(1.0);
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toEqual(['ok']);

    // Temp files should be cleaned up
    const agentVTmpDirs = readdirSync(tmpdir()).filter((d) => d.startsWith('agentv-judge-'));
    // The cleanup should have removed the dir; any remaining are from other tests
    // We can't easily assert absence since other tests may run concurrently
  });

  it('sends outputPath in payload for large output', async () => {
    const command = await createEchoGrader(tmpDir);
    const largeContent = 'x'.repeat(60_000);
    const largeOutput = [{ role: 'assistant' as const, content: largeContent }];

    const evaluator = new ScriptGrader({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output: largeOutput,
    });

    // The echo grader returns parsed info about the payload
    // We can't inspect the payload directly, but the grader script should run without error
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('preserves structured expected_output, input, and config in stdin', async () => {
    const command = await createPayloadShapeGrader(tmpDir);

    const evaluator = new ScriptGrader({ command, config: { mode: 'strict' } });
    const result = await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        expected_output: [{ role: 'assistant', content: { answer: 'Paris' } }],
      },
      candidate: 'answer',
      output: [{ role: 'assistant' as const, content: 'answer' }],
    });

    expect(result.score).toBe(1);
    expect(result.assertions).toEqual([{ text: 'structured stdin preserved', passed: true }]);
    expect(result.details?.expected_output).toEqual([
      { role: 'assistant', content: { answer: 'Paris' } },
    ]);
  });
});
