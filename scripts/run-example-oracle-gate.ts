#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';

function run(command: readonly string[]): void {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EVAL_CRITERIA: process.env.EVAL_CRITERIA ?? 'oracle fixture criteria',
      CUSTOM_SYSTEM_PROMPT: process.env.CUSTOM_SYSTEM_PROMPT ?? 'oracle fixture system prompt',
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(['bun', 'run', 'validate:examples']);
run(['bun', 'scripts/run-example-oracle-fixtures.ts', ...process.argv.slice(2)]);
