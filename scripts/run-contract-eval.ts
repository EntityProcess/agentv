#!/usr/bin/env bun
/**
 * Run the release contract eval from a clean checkout.
 *
 * The CLI source imports workspace packages through their built dist outputs,
 * so callers should run the root `contract-eval` package script rather than
 * invoking this file directly.
 *
 * Local usage:
 * Set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_DEPLOYMENT_NAME,
 * then run `bun run contract-eval`.
 */

const evalFiles = [
  'examples/contract/evals/release-gate.eval.yaml',
  'examples/contract/evals/repo-materialization.eval.yaml',
  'examples/contract/evals/script-grader-contract.eval.yaml',
];

for (const evalFile of evalFiles) {
  console.log(`\n=== Contract eval: ${evalFile} ===`);
  const proc = Bun.spawn(
    [
      'bun',
      'apps/cli/src/cli.ts',
      'eval',
      evalFile,
      '--provider',
      'azure',
      '--grader-provider',
      'azure',
      '--threshold',
      '1',
    ],
    {
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
