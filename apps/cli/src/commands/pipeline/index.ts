import { subcommands } from 'cmd-ts';

import { evalBenchCommand } from './bench.js';
import { evalGradeCommand } from './grade.js';
import { evalInputCommand } from './input.js';

export const pipelineCommand = subcommands({
  name: 'pipeline',
  description: 'Agent-mode eval pipeline commands (input → grade → bench)',
  cmds: {
    input: evalInputCommand,
    grade: evalGradeCommand,
    bench: evalBenchCommand,
  },
});
