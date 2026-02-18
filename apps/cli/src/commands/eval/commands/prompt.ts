import { loadEvalCases } from '@agentv/core';
import { command, restPositionals, string } from 'cmd-ts';

import { findRepoRoot, resolveEvalPaths } from '../shared.js';

export const evalPromptCommand = command({
  name: 'prompt',
  description: 'Output orchestration prompt for host agent to run evals',
  args: {
    evalPaths: restPositionals({
      type: string,
      displayName: 'eval-paths',
      description: 'Path(s) or glob(s) to evaluation .yaml file(s)',
    }),
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const resolvedPaths = await resolveEvalPaths(args.evalPaths, cwd);
    const repoRoot = await findRepoRoot(cwd);

    const lines: string[] = [
      '# AgentV Eval Orchestration',
      '',
      'Run the following commands to evaluate each case. For each case:',
      '1. Use `agentv eval input` to get the task input',
      '2. Execute the task with your agent/LLM',
      '3. Save the output to a file',
      '4. Use `agentv eval judge` to grade the result',
      '',
    ];

    for (const evalPath of resolvedPaths) {
      const cases = await loadEvalCases(evalPath, repoRoot);
      lines.push(`## ${evalPath}`);
      lines.push('');

      for (const evalCase of cases) {
        lines.push(`### ${evalCase.id}`);
        lines.push('');
        lines.push('```bash');
        lines.push('# Get task input');
        lines.push(`agentv eval input ${evalPath} --eval-id ${evalCase.id}`);
        lines.push('');
        lines.push('# After running the task and saving output to /tmp/output.txt:');
        lines.push(
          `agentv eval judge ${evalPath} --eval-id ${evalCase.id} --output-file /tmp/output.txt`,
        );
        lines.push('```');
        lines.push('');
      }
    }

    // Write to stdout, warnings to stderr
    process.stdout.write(lines.join('\n'));
  },
});
