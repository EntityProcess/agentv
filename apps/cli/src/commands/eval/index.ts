import { subcommands } from 'cmd-ts';

import { evalPromptCommand } from './commands/prompt/index.js';
import { evalRunCommand } from './commands/run.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
  },
});
