import { subcommands } from 'cmd-ts';

import { evalInputCommand } from './commands/input.js';
import { evalJudgeCommand } from './commands/judge.js';
import { evalPromptCommand } from './commands/prompt.js';
import { evalRunCommand } from './commands/run.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
    input: evalInputCommand,
    judge: evalJudgeCommand,
  },
});
