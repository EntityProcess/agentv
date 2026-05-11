import { subcommands } from 'cmd-ts';

import { evalBenchCommand } from './bench.js';
import { evalGradeCommand } from './grade.js';
import { evalInputCommand } from './input.js';
import { evalRunCommand } from './run.js';

export const pipelineCommand = subcommands({
  name: 'pipeline',
  description:
    'Subagent-mode eval pipeline (input → executor subagents → grade → bench) — use this when the eval target is an AI agent (Claude, Codex, etc.)',
  cmds: {
    input: evalInputCommand,
    grade: evalGradeCommand,
    bench: evalBenchCommand,
    run: evalRunCommand,
  },
});
