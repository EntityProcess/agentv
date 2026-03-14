#!/usr/bin/env bun
/**
 * compare-runs.ts
 *
 * Thin wrapper over `agentv compare` command.
 * Shells out to AgentV CLI for comparing eval runs.
 */

import { buildCompareCommand, runCommand } from '../src/command-runner.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      'Usage: bun scripts/compare-runs.ts <before.jsonl> <after.jsonl> [...other args]',
    );
    process.exit(1);
  }

  const cmd = buildCompareCommand(args);

  console.log(`Running: ${cmd.join(' ')}\n`);

  const result = await runCommand(cmd);

  if (result.stdout) {
    console.log(result.stdout);
  }

  if (result.stderr) {
    console.error(result.stderr);
  }

  process.exit(result.exitCode);
}

main();
