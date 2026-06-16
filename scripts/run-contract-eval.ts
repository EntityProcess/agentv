#!/usr/bin/env bun
/**
 * Run the release contract eval from a clean checkout.
 *
 * The CLI source imports workspace packages through their built dist outputs,
 * so callers should run the root `contract-eval` package script rather than
 * invoking this file directly.
 */

process.env.CONTRACT_EVAL_MODEL ||= 'openai/gpt-4.1-mini';

const proc = Bun.spawn(
  [
    'bun',
    'apps/cli/src/cli.ts',
    'eval',
    'examples/contract/evals/release-gate.eval.yaml',
    '--target',
    'github-models-contract',
    '--threshold',
    '1',
  ],
  {
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

process.exit(await proc.exited);
