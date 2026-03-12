import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import path from 'node:path';

import { generateOverviewPrompt } from '../../../src/commands/eval/commands/prompt/overview.js';

const BASIC_EVAL_PATH = path.resolve(
  import.meta.dir,
  '../../../../examples/features/basic/evals/dataset.eval.yaml',
);

describe('generateOverviewPrompt', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.AGENTV_EVAL_MODE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENTV_EVAL_MODE;
    } else {
      process.env.AGENTV_EVAL_MODE = originalEnv;
    }
  });

  it('defaults to prompt mode when AGENTV_EVAL_MODE is not set', async () => {
    delete process.env.AGENTV_EVAL_MODE;
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: prompt');
    expect(output).toContain('eval-candidate');
    expect(output).toContain('eval-judge');
    expect(output).not.toContain('agentv eval ');
  });

  it('emits prompt mode instructions when AGENTV_EVAL_MODE=prompt', async () => {
    process.env.AGENTV_EVAL_MODE = 'prompt';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: prompt');
    expect(output).toContain('eval-candidate');
    expect(output).toContain('eval-judge');
    expect(output).toContain('.agentv/tmp/');
    expect(output).toContain('.agentv/results/');
  });

  it('emits code mode instructions when AGENTV_EVAL_MODE=code', async () => {
    process.env.AGENTV_EVAL_MODE = 'code';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: code');
    expect(output).toContain('agentv eval');
    expect(output).not.toContain('eval-candidate');
    expect(output).not.toContain('eval-judge');
  });

  it('errors on invalid AGENTV_EVAL_MODE value', async () => {
    process.env.AGENTV_EVAL_MODE = 'invalid';
    await expect(generateOverviewPrompt([BASIC_EVAL_PATH])).rejects.toThrow(
      /AGENTV_EVAL_MODE.*prompt.*code/,
    );
  });

  it('includes per-test dispatch blocks in prompt mode', async () => {
    delete process.env.AGENTV_EVAL_MODE;
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('code-review-javascript');
    expect(output).toContain('shorthand-string-example');
    expect(output).toContain('coding-multiturn-debug-session');
    expect(output).toContain('answer-file: `.agentv/tmp/eval_code-review-javascript.txt`');
    expect(output).toContain('results-file: `.agentv/results/eval_');
  });

  it('includes test IDs in code mode', async () => {
    process.env.AGENTV_EVAL_MODE = 'code';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('code-review-javascript');
  });
});
