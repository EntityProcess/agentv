import { subcommands } from 'cmd-ts';

import { resultsExportCommand } from './export.js';
import { resultsFailuresCommand } from './failures.js';
import { resultsShowCommand } from './show.js';
import { resultsSummaryCommand } from './summary.js';

export const resultsCommand = subcommands({
  name: 'results',
  description: 'Inspect, export, and manage evaluation results',
  cmds: {
    export: resultsExportCommand,
    summary: resultsSummaryCommand,
    failures: resultsFailuresCommand,
    show: resultsShowCommand,
  },
});
