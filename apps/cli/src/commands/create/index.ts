import { subcommands } from 'cmd-ts';

import { createAssertionCommand, createEvalCommand, createProviderCommand } from './commands.js';

export const createCommand = subcommands({
  name: 'create',
  description: 'Scaffold new AgentV components',
  cmds: {
    assertion: createAssertionCommand,
    eval: createEvalCommand,
    provider: createProviderCommand,
  },
});
