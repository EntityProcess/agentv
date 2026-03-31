import { subcommands } from 'cmd-ts';

import { importClaudeCommand } from './claude.js';

export const importCommand = subcommands({
  name: 'import',
  description: 'Import agent session transcripts for offline grading',
  cmds: {
    claude: importClaudeCommand,
  },
});
