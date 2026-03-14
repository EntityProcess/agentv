#!/usr/bin/env bun
/**
 * run-eval.ts
 * 
 * Thin wrapper over `agentv eval` command.
 * Shells out to AgentV CLI without embedding provider-specific logic.
 * Supports --eval-path as a wrapper-level flag, translating it to positional form.
 * All other arguments are forwarded verbatim to preserve exact CLI semantics.
 */

import { buildRunEvalCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: bun scripts/run-eval.ts --eval-path <eval-path> [...agentv-eval-options]");
    console.error("   or: bun scripts/run-eval.ts <eval-path> [...agentv-eval-options]");
    process.exit(1);
  }

  // Translate --eval-path to positional form for AgentV CLI
  const transformedArgs: string[] = [];
  let i = 0;
  let evalPath: string | null = null;
  
  while (i < args.length) {
    if (args[i] === "--eval-path" && i + 1 < args.length) {
      evalPath = args[i + 1];
      i += 2;
    } else {
      transformedArgs.push(args[i]);
      i++;
    }
  }
  
  // If --eval-path was provided, insert it as first positional arg
  const finalArgs = evalPath ? [evalPath, ...transformedArgs] : transformedArgs;

  const cmd = buildRunEvalCommand(finalArgs);

  // Check for --dry-run to show what would be executed
  const dryRun = finalArgs.includes("--dry-run");
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
