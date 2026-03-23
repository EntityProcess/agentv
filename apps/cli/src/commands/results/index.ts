import { subcommands } from 'cmd-ts';

import { resultsExportCommand } from './export.js';
import { resultsServeCommand } from './serve.js';

export const resultsCommand = subcommands({
  name: 'results',
  description: 'Inspect, export, and manage evaluation results',
  cmds: {
    export: resultsExportCommand,
    serve: resultsServeCommand,
  },
});
