#!/usr/bin/env bun
/**
 * convert-evals.ts
 * 
 * Thin wrapper over `agentv convert` command.
 * Shells out to AgentV CLI for eval format conversion.
 */

import { buildConvertCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error("Usage: bun scripts/convert-evals.ts <eval-path> [--out <output-path>] [...other args]");
    process.exit(1);
  }

  const cmd = buildConvertCommand(args);

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
