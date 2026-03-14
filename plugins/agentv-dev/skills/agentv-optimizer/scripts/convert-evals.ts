#!/usr/bin/env bun
/**
 * convert-evals.ts
 * 
 * Thin wrapper over `agentv convert` command.
 * Shells out to AgentV CLI for eval format conversion.
 * Supports --eval-path as a wrapper-level flag, translating it to positional form.
 * All other arguments are forwarded verbatim.
 */

import { buildConvertCommand, runCommand } from "../src/command-runner.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error("Usage: bun scripts/convert-evals.ts --eval-path <eval-path> [--out <output-path>] [...other args]");
    console.error("   or: bun scripts/convert-evals.ts <eval-path> [--out <output-path>] [...other args]");
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

  const cmd = buildConvertCommand(finalArgs);

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
