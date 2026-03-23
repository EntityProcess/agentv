import { subcommands } from 'cmd-ts';

import { resultsExportCommand } from './export.js';

export const resultsCommand = subcommands({
  name: 'results',
  description: 'Inspect, export, and manage evaluation results',
  cmds: {
    export: resultsExportCommand,
  },
});
