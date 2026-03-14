#!/usr/bin/env bun
/**
 * run-eval.ts
 * 
 * Thin wrapper over `agentv eval` command.
 * Shells out to AgentV CLI without embedding provider-specific logic.
 */

import { buildRunEvalCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let evalPath = "";
  let target: string | undefined;
  let targets: string[] | undefined;
  let artifactsDir: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--eval-path") {
      evalPath = args[++i];
    } else if (arg === "--target") {
      target = args[++i];
    } else if (arg === "--targets") {
      targets = args[++i].split(",");
    } else if (arg === "--artifacts") {
      artifactsDir = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (!arg.startsWith("--")) {
      evalPath = arg;
    }
  }

  if (!evalPath) {
    console.error("Usage: bun scripts/run-eval.ts <eval-path> [--target <name>] [--targets <t1,t2>] [--artifacts <dir>] [--dry-run]");
    process.exit(1);
  }

  const cmd = buildRunEvalCommand({
    evalPath,
    target,
    targets,
    artifactsDir,
    dryRun,
  });

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
