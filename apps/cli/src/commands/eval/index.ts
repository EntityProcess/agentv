import { subcommands } from 'cmd-ts';

import { evalAggregateCommand } from './commands/aggregate.js';
import { evalAssertCommand } from './commands/assert.js';
import { evalBundleCommand } from './commands/bundle.js';
import { evalRunCommand } from './commands/run.js';
import { evalVitestCommand } from './commands/vitest.js';

export const evalCommand = subcommands({
  name: 'eval',
  description:
    'Evaluation commands. Shorthand: eval files run with `eval run`; verifier-looking test files run with `eval vitest`.',
  cmds: {
    run: evalRunCommand,
    assert: evalAssertCommand,
    aggregate: evalAggregateCommand,
    bundle: evalBundleCommand,
    vitest: evalVitestCommand,
  },
});
