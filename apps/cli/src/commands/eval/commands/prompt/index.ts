import { command, flag, option, optional, positional, string, subcommands } from 'cmd-ts';

import {
  getPromptEvalExpectedOutput,
  getPromptEvalInput,
  listPromptEvalTestIds,
} from './accessors.js';

export const evalPromptEvalSubcommand = command({
  name: 'eval',
  description: 'Extract eval prompt data for agents',
  args: {
    list: flag({
      long: 'list',
      description: 'List available test IDs',
    }),
    input: flag({
      long: 'input',
      description: 'Extract the test input payload for a single test',
    }),
    expectedOutput: flag({
      long: 'expected-output',
      description: 'Extract expected output and grading context for a single test',
    }),
    testId: option({
      type: optional(string),
      long: 'test-id',
      description: 'Test ID (required for --input and --expected-output)',
    }),
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to evaluation .yaml, .json, or .jsonl file',
    }),
  },
  handler: async ({ evalPath, expectedOutput, input, list, testId }) => {
    const selectedModes = [list, input, expectedOutput].filter(Boolean).length;
    if (selectedModes !== 1) {
      throw new Error('Specify exactly one of --list, --input, or --expected-output.');
    }

    if ((input || expectedOutput) && !testId) {
      throw new Error('--test-id is required with --input and --expected-output.');
    }

    const output = list
      ? await listPromptEvalTestIds(evalPath)
      : input
        ? await getPromptEvalInput(evalPath, testId!)
        : await getPromptEvalExpectedOutput(evalPath, testId!);

    process.stdout.write(JSON.stringify(output, null, 2));
    process.stdout.write('\n');
  },
});

export const evalPromptCommand = subcommands({
  name: 'prompt',
  description: 'Prompt commands',
  cmds: {
    eval: evalPromptEvalSubcommand,
  },
});
