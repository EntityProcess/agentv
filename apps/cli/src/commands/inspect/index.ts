import { subcommands } from 'cmd-ts';

import { inspectFilterCommand } from './filter.js';
import { traceListCommand } from './list.js';
import { traceScoreCommand } from './score.js';
import { inspectSearchCommand } from './search.js';
import { traceShowCommand } from './show.js';
import { traceStatsCommand } from './stats.js';

export const inspectCommand = subcommands({
  name: 'inspect',
  description: 'Inspect and analyze evaluation results',
  cmds: {
    filter: inspectFilterCommand,
    list: traceListCommand,
    score: traceScoreCommand,
    search: inspectSearchCommand,
    show: traceShowCommand,
    stats: traceStatsCommand,
  },
});
