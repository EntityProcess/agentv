import { subcommands } from 'cmd-ts';

import { runsRerunCommand } from './rerun.js';

export const runsCommand = subcommands({
  name: 'runs',
  description: 'Operate on captured run workspaces',
  cmds: {
    rerun: runsRerunCommand,
  },
});
