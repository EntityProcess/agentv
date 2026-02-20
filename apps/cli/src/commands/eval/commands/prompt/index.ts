import { subcommands } from 'cmd-ts';

import { evalPromptInputCommand } from './input.js';
import { evalPromptJudgeCommand } from './judge.js';
import { evalPromptOverviewCommand } from './overview.js';

export const evalPromptEvalSubcommand = subcommands({
  name: 'eval',
  description: 'Eval prompt commands (overview, input, judge)',
  cmds: {
    overview: evalPromptOverviewCommand,
    input: evalPromptInputCommand,
    judge: evalPromptJudgeCommand,
  },
});

export const evalPromptCommand = subcommands({
  name: 'prompt',
  description: 'Prompt commands',
  cmds: {
    eval: evalPromptEvalSubcommand,
  },
});
