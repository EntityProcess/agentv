import { subcommands } from 'cmd-ts';

import { evalAssertCommand } from './commands/assert.js';
import { evalBenchCommand } from './commands/bench.js';
import { evalGradeCommand } from './commands/grade.js';
import { evalInputCommand } from './commands/input.js';
import { evalPromptCommand } from './commands/prompt/index.js';
import { evalRunCommand } from './commands/run.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
    assert: evalAssertCommand,
    input: evalInputCommand,
    grade: evalGradeCommand,
    bench: evalBenchCommand,
  },
});
