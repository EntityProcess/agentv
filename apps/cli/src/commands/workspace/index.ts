import { subcommands } from 'cmd-ts';

import { depsCommand } from './deps.js';

export const workspaceCommand = subcommands({
  name: 'workspace',
  description: 'Inspect workspace dependencies',
  cmds: {
    deps: depsCommand,
  },
});
