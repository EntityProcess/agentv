import { buildPromptInputs, loadEvalCaseById } from '@agentv/core';
import { command, option, positional, string } from 'cmd-ts';

import { findRepoRoot } from '../../shared.js';

export const evalPromptInputCommand = command({
  name: 'input',
  description: 'Output task input JSON for a single eval case',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to evaluation .yaml file',
    }),
    evalId: option({
      type: string,
      long: 'eval-id',
      description: 'Eval case ID',
    }),
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const evalCase = await loadEvalCaseById(args.evalPath, repoRoot, args.evalId);
    const promptInputs = await buildPromptInputs(evalCase);

    const output = {
      eval_id: evalCase.id,
      question: promptInputs.question,
      system_message: promptInputs.systemMessage ?? null,
      guidelines: promptInputs.guidelines || null,
      input_messages: evalCase.input_messages,
      file_paths: evalCase.file_paths,
      expected_outcome: evalCase.expected_outcome,
    };

    process.stdout.write(JSON.stringify(output, null, 2));
    process.stdout.write('\n');
  },
});
