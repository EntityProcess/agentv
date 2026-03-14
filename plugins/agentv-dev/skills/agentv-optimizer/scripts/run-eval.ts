#!/usr/bin/env bun
/**
 * run-eval.ts
 * 
 * Thin wrapper over `agentv eval` command.
 * Shells out to AgentV CLI without embedding provider-specific logic.
 * Forwards all arguments verbatim to preserve exact CLI semantics.
 */

import { buildRunEvalCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: bun scripts/run-eval.ts <eval-path> [...agentv-eval-options]");
    console.error("All arguments are forwarded to 'agentv eval' verbatim.");
    process.exit(1);
  }

  const cmd = buildRunEvalCommand(args);

  // Check for --dry-run to show what would be executed
  const dryRun = args.includes("--dry-run");
  if (dryRun) {
    console.log("Dry-run mode: would execute:");
    console.log(cmd.join(" "));
    process.exit(0);
  }

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
