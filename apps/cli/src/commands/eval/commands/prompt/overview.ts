import { type EvalCase, loadEvalCases } from '@agentv/core';
import { command, restPositionals, string } from 'cmd-ts';

import { findRepoRoot, resolveEvalPaths } from '../../shared.js';

export const evalPromptOverviewCommand = command({
  name: 'overview',
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

    // Collect all cases upfront for the summary
    const fileEntries: Array<{ path: string; cases: readonly EvalCase[] }> = [];
    for (const evalPath of resolvedPaths) {
      const cases = await loadEvalCases(evalPath, repoRoot);
      fileEntries.push({ path: evalPath, cases });
    }

    const totalCases = fileEntries.reduce((sum, e) => sum + e.cases.length, 0);

    const lines: string[] = [
      '# AgentV Eval Orchestration',
      '',
      `You are orchestrating ${totalCases} evaluation case${totalCases === 1 ? '' : 's'}. For each case: get the task input, execute it, then judge the result.`,
      '',
      '## Step 1: Get Task Input',
      '',
      'Run `agentv eval prompt input <path> --eval-id <id>` to get the task as JSON.',
      '',
      'The output contains:',
      '- `question` — flat string prompt (use for simple single-turn tasks)',
      '- `input_messages` — structured `[{role, content}]` array (use for multi-turn or chat APIs)',
      '- `guidelines` — additional context to prepend to the system message (may be null)',
      '- `expected_outcome` — what a good answer should accomplish (for your reference, do not leak to the agent being tested)',
      '- `file_paths` — referenced files (content is already embedded in `question`)',
      '',
      '## Step 2: Execute the Task',
      '',
      'Send the prompt to the agent/LLM being evaluated. Save the complete response text to a file.',
      '',
      '## Step 3: Judge the Result',
      '',
      'Run `agentv eval prompt judge <path> --eval-id <id> --answer-file <response-file>`.',
      '',
      'The output contains an `evaluators` array. Each evaluator has a `status`:',
      '',
      '- **`"completed"`** — Score is final (code_judge ran deterministically). Read `result.score` (0.0–1.0).',
      '- **`"prompt_ready"`** — LLM grading required. Send `prompt.system_prompt` as system and',
      '  `prompt.user_prompt` as user to your LLM. Parse the JSON response to get `score`, `hits`, `misses`.',
      '',
    ];

    for (const { path: evalPath, cases } of fileEntries) {
      lines.push(`## ${evalPath}`);
      lines.push('');

      for (const evalCase of cases) {
        const evaluatorSummary = describeEvaluators(evalCase);
        lines.push(`### ${evalCase.id}`);
        lines.push(`Expected outcome: ${evalCase.expected_outcome}`);
        if (evaluatorSummary) {
          lines.push(`Evaluators: ${evaluatorSummary}`);
        }
        lines.push('');
        lines.push('```bash');
        lines.push(`agentv eval prompt input ${evalPath} --eval-id ${evalCase.id}`);
        lines.push(
          `agentv eval prompt judge ${evalPath} --eval-id ${evalCase.id} --answer-file <response-file>`,
        );
        lines.push('```');
        lines.push('');
      }
    }

    process.stdout.write(lines.join('\n'));
  },
});

function describeEvaluators(evalCase: EvalCase): string | undefined {
  const configs = evalCase.evaluators;
  if (!configs || configs.length === 0) return undefined;
  return configs.map((c) => `${c.name} (${c.type})`).join(', ');
}
