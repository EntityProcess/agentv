import type { Command } from "commander";

import { createAgentKernel } from "@agentevo/core";

export function registerStatusCommand(program: Command): Command {
  program
    .command("status")
    .description("Show the latest AgentEvo kernel status")
    .action(() => {
      const kernel = createAgentKernel();
      // Provide a high-level status check without depending on real runtime state yet.
      console.log(`Kernel status: ${kernel.status}`);
    });

  return program;
}
