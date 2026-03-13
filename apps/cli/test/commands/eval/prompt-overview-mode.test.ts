import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import path from 'node:path';

import { generateOverviewPrompt } from '../../../src/commands/eval/commands/prompt/overview.js';

const BASIC_EVAL_PATH = path.resolve(
  import.meta.dir,
  '../../../../examples/features/basic/evals/dataset.eval.yaml',
);

const AGENT_SKILLS_EVAL_PATH = path.resolve(
  import.meta.dir,
  '../../../../examples/features/agent-skills-evals/evals.json',
);

describe('generateOverviewPrompt', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.AGENTV_PROMPT_EVAL_MODE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      process.env.AGENTV_PROMPT_EVAL_MODE = undefined;
    } else {
      process.env.AGENTV_PROMPT_EVAL_MODE = originalEnv;
    }
  });

  it('defaults to agent mode when AGENTV_PROMPT_EVAL_MODE is not set', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = undefined;
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: agent');
    expect(output).toContain('eval-candidate');
    expect(output).toContain('eval-judge');
    expect(output).not.toContain('agentv eval ');
  });

  it('emits agent mode instructions when AGENTV_PROMPT_EVAL_MODE=agent', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = 'agent';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: agent');
    expect(output).toContain('eval-candidate');
    expect(output).toContain('eval-judge');
    expect(output).toContain('.agentv/tmp/');
    expect(output).toContain('.agentv/results/');
  });

  it('emits cli mode instructions when AGENTV_PROMPT_EVAL_MODE=cli', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = 'cli';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('Mode: cli');
    expect(output).toContain('agentv eval');
    expect(output).not.toContain('eval-candidate');
    expect(output).not.toContain('eval-judge');
  });

  it('errors on invalid AGENTV_PROMPT_EVAL_MODE value', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = 'invalid';
    await expect(generateOverviewPrompt([BASIC_EVAL_PATH])).rejects.toThrow(
      /AGENTV_PROMPT_EVAL_MODE.*agent.*cli/,
    );
  });

  it('includes per-test dispatch blocks in agent mode', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = undefined;
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('code-review-javascript');
    expect(output).toContain('shorthand-string-example');
    expect(output).toContain('coding-multiturn-debug-session');
    expect(output).toContain('answer-file: `.agentv/tmp/eval_code-review-javascript.txt`');
    expect(output).toContain('results-file: `.agentv/results/eval_');
  });

  it('includes test IDs in cli mode', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = 'cli';
    const output = await generateOverviewPrompt([BASIC_EVAL_PATH]);
    expect(output).toContain('code-review-javascript');
  });

  it('accepts Agent Skills evals.json files', async () => {
    process.env.AGENTV_PROMPT_EVAL_MODE = undefined;
    const output = await generateOverviewPrompt([AGENT_SKILLS_EVAL_PATH]);
    expect(output).toContain('Mode: agent');
    expect(output).toContain('eval-candidate');
    // Test IDs from evals.json (promoted from numeric id)
    expect(output).toContain('### 1');
    expect(output).toContain('### 2');
    // Promoted assertions should appear as evaluators
    expect(output).toContain('assertion-1 (llm-judge)');
  });
});
