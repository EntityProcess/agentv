import { subcommands } from 'cmd-ts';

import { compareCommand } from '../compare/index.js';
import { trendCommand } from '../trend/index.js';
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
  description: 'Inspect, export, and manage local evaluation results',
  cmds: {
    combine: resultsCombineCommand,
    compare: compareCommand,
    delete: resultsDeleteCommand,
    export: resultsExportCommand,
    report: resultsReportCommand,
    summary: resultsSummaryCommand,
    failures: resultsFailuresCommand,
    show: resultsShowCommand,
    trend: trendCommand,
    validate: resultsValidateCommand,
  },
});
