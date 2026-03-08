import { subcommands } from 'cmd-ts';

import { cleanCommand } from './clean.js';
import { listCommand } from './list.js';

export const workspaceCommand = subcommands({
  name: 'workspace',
  description: 'Manage workspace pool',
  cmds: {
    list: listCommand,
    clean: cleanCommand,
  },
});
