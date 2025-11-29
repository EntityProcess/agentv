import type { Command } from "commander";

import { runOptimizeCommand } from "./run-optimize.js";

export function registerOptimizeCommand(program: Command): Command {
  program
    .command("optimize")
    .description("Run ACE optimization using an optimizer config file")
    .argument("<config>", "Path to optimizer configuration (.yaml)")
    .option("--target <name>", "Override target name from targets.yaml")
    .option("--targets <path>", "Path to targets.yaml (overrides discovery)")
    .option("--dry-run", "Use mock provider responses instead of real LLM calls", false)
    .option("--verbose", "Enable verbose logging", false)
    .action(async (config: string, rawOptions: Record<string, unknown>) => {
      try {
        await runOptimizeCommand(config, rawOptions);
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return program;
}
