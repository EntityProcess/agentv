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
      'You are orchestrating AI agent evaluations. For each eval case below, follow this loop:',
      '',
      '## Workflow',
      '',
      '1. **Get input**: Run `agentv eval input <path> --eval-id <id>` to get the task as JSON',
      '   - Use `question` (flat string) or `input_messages` (structured chat) as the prompt',
      '   - Prepend `guidelines` to the system message if present',
      '   - `expected_outcome` describes what a good answer should accomplish',
      '',
      '2. **Execute task**: Send the prompt to your LLM and collect the response',
      '',
      '3. **Save output**: Write the LLM response to a text file',
      '',
      '4. **Judge**: Run `agentv eval judge <path> --eval-id <id> --output-file <file>`',
      '   The judge returns JSON with an `evaluators` array. Each evaluator has a `status`:',
      '   - `"completed"`: Deterministic result (code_judge). Read `result.score` directly.',
      '   - `"prompt_ready"`: LLM grading needed. Send `prompt.system_prompt` and `prompt.user_prompt`',
      '     to your LLM. The response will be a JSON object with `score` (0-1), `hits`, `misses`.',
      '',
    ];

    for (const evalPath of resolvedPaths) {
      const cases = await loadEvalCases(evalPath, repoRoot);
      lines.push(`## Eval Cases: ${evalPath}`);
      lines.push('');

      for (const evalCase of cases) {
        lines.push(`### ${evalCase.id}`);
        lines.push(`Expected outcome: ${evalCase.expected_outcome}`);
        lines.push('');
        lines.push('```bash');
        lines.push(`agentv eval input ${evalPath} --eval-id ${evalCase.id}`);
        lines.push(
          `agentv eval judge ${evalPath} --eval-id ${evalCase.id} --output-file <output-file>`,
        );
        lines.push('```');
        lines.push('');
      }
    }

    // Write to stdout, warnings to stderr
    process.stdout.write(lines.join('\n'));
  },
});
