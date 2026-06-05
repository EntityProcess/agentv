import { subcommands } from 'cmd-ts';

import { resultsCombineCommand } from './combine.js';
import { resultsDeleteCommand } from './delete.js';
import { resultsExportCommand } from './export.js';
import { resultsFailuresCommand } from './failures.js';
import { resultsReportCommand } from './report.js';
import { resultsShowCommand } from './show.js';
import { resultsSummaryCommand } from './summary.js';
import { resultsValidateCommand } from './validate.js';

export const resultsCommand = subcommands({
  name: 'results',
  description: 'Inspect, export, and manage evaluation results',
  cmds: {
    combine: resultsCombineCommand,
    delete: resultsDeleteCommand,
    export: resultsExportCommand,
    report: resultsReportCommand,
    summary: resultsSummaryCommand,
    failures: resultsFailuresCommand,
    show: resultsShowCommand,
    validate: resultsValidateCommand,
  },
});
