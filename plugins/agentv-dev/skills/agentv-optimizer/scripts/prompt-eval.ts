#!/usr/bin/env bun
/**
 * prompt-eval.ts
 * 
 * Thin wrapper over `agentv prompt eval` command.
 * Shells out to AgentV CLI for prompt inspection.
 */

import { buildPromptEvalCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: bun scripts/prompt-eval.ts <overview|input|judge> <eval-path> [--test-id <id>] [...other args]");
    process.exit(1);
  }

  const cmd = buildPromptEvalCommand(args);

  console.log(`Running: ${cmd.join(" ")}\n`);
  
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
