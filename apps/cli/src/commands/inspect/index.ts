import { subcommands } from 'cmd-ts';

import { traceListCommand } from './list.js';
import { traceScoreCommand } from './score.js';
import { traceShowCommand } from './show.js';
import { traceStatsCommand } from './stats.js';

export const inspectCommand = subcommands({
  name: 'inspect',
  description: 'Inspect and analyze evaluation results',
  cmds: {
    list: traceListCommand,
    score: traceScoreCommand,
    show: traceShowCommand,
    stats: traceStatsCommand,
  },
});
