import { subcommands } from 'cmd-ts';

import { evalAggregateCommand } from './commands/aggregate.js';
import { evalAssertCommand } from './commands/assert.js';
import { evalRunCommand } from './commands/run.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    assert: evalAssertCommand,
    aggregate: evalAggregateCommand,
  },
});
