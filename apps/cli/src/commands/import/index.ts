import { subcommands } from 'cmd-ts';

import { importClaudeCommand } from './claude.js';
import { importCodexCommand } from './codex.js';
import { importCopilotCommand } from './copilot.js';
import { importHuggingFaceCommand } from './huggingface.js';

export const importCommand = subcommands({
  name: 'import',
  description: 'Import agent session transcripts and datasets for offline grading',
  cmds: {
    claude: importClaudeCommand,
    codex: importCodexCommand,
    copilot: importCopilotCommand,
    huggingface: importHuggingFaceCommand,
  },
});
