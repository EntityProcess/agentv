#!/usr/bin/env bun
/**
 * prompt-eval.ts
 *
 * Thin wrapper over `agentv prompt eval` command.
 * Shells out to AgentV CLI for prompt inspection.
 */

import { buildPromptEvalCommand, runCommand } from '../src/command-runner.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: bun scripts/prompt-eval.ts --list <eval-path>');
    console.error('   or: bun scripts/prompt-eval.ts --input <eval-path> --test-id <id>');
    console.error('   or: bun scripts/prompt-eval.ts --expected-output <eval-path> --test-id <id>');
    process.exit(1);
  }

  const cmd = buildPromptEvalCommand(args);

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
