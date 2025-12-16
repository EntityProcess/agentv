import { command, flag, option, optional, positional, string, subcommands } from 'cmd-ts';

import { generateRubricsCommand } from './rubrics.js';

const rubricsCommand = command({
  name: 'rubrics',
  description: 'Generate rubrics from expected_outcome in YAML eval file',
  args: {
    file: positional({
      type: string,
      displayName: 'file',
      description: 'Path to YAML eval file',
    }),
    target: option({
      type: optional(string),
      long: 'target',
      short: 't',
      description: 'Override target for rubric generation (default: file target or openai:gpt-4o)',
    }),
    verbose: flag({
      long: 'verbose',
      short: 'v',
      description: 'Show detailed progress',
    }),
  },
  handler: async ({ file, target, verbose }) => {
    try {
      await generateRubricsCommand({
        file,
        target,
        verbose,
      });
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});

export const generateCommand = subcommands({
  name: 'generate',
  description: 'Generate evaluation artifacts',
  cmds: {
    rubrics: rubricsCommand,
  },
});
