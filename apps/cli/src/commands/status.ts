import { createAgentKernel } from '@agentv/core';
import { command } from 'cmd-ts';

export const statusCommand = command({
  name: 'status',
  description: 'Show the latest AgentV kernel status',
  args: {},
  handler: () => {
    const kernel = createAgentKernel();
    // Provide a high-level status check without depending on real runtime state yet.
    console.log(`Kernel status: ${kernel.status}`);
  },
});
