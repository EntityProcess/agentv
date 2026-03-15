import { subcommands } from 'cmd-ts';

import { evalPromptCommand } from './commands/prompt/index.js';
import { evalRunJudgeCommand } from './commands/run-judge.js';
import { evalRunCommand } from './commands/run.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
    'run-judge': evalRunJudgeCommand,
  },
});
