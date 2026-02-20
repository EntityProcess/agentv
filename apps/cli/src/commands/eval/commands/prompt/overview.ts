import { type EvalTest, loadTests } from '@agentv/core';
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
    const fileEntries: Array<{ path: string; tests: readonly EvalTest[] }> = [];
    for (const evalPath of resolvedPaths) {
      const tests = await loadTests(evalPath, repoRoot);
      fileEntries.push({ path: evalPath, tests });
    }

    const totalCases = fileEntries.reduce((sum, e) => sum + e.tests.length, 0);

    const lines: string[] = [
      '# AgentV Eval Orchestration',
      '',
      `You are orchestrating ${totalCases} evaluation case${totalCases === 1 ? '' : 's'}. For each case: get the task input, execute it, then judge the result.`,
      '',
      '## Step 1: Get Task Input',
      '',
      'Run `agentv prompt input <path> --test-id <id>` to get the task as JSON.',
      '',
      'The output contains:',
      '- `input_messages` — `[{role, content}]` array. Content segments are either `{type: "text", value: "..."}` or `{type: "file", path: "/absolute/path"}`. Read file segments from the filesystem.',
      '- `guideline_paths` — files containing additional instructions to prepend to the system message (may be empty). Read these from the filesystem.',
      '- `criteria` — what a good answer should accomplish (for your reference, do not leak to the agent being tested)',
      '',
      '## Step 2: Execute the Task',
      '',
      'Send the prompt to the agent/LLM being evaluated. Save the complete response text to a file.',
      '',
      '## Step 3: Judge the Result',
      '',
      'Run `agentv prompt judge <path> --test-id <id> --answer-file <response-file>`.',
      '',
      'The output contains an `evaluators` array. Each evaluator has a `status`:',
      '',
      '- **`"completed"`** — Score is final (code_judge ran deterministically). Read `result.score` (0.0–1.0).',
      '- **`"prompt_ready"`** — LLM grading required. Send `prompt.system_prompt` as system and',
      '  `prompt.user_prompt` as user to your LLM. Parse the JSON response to get `score`, `hits`, `misses`.',
      '',
    ];

    for (const { path: evalPath, tests } of fileEntries) {
      lines.push(`## ${evalPath}`);
      lines.push('');

      for (const evalCase of tests) {
        const evaluatorSummary = describeEvaluators(evalCase);
        lines.push(`### ${evalCase.id}`);
        lines.push(`Criteria: ${evalCase.criteria}`);
        if (evaluatorSummary) {
          lines.push(`Evaluators: ${evaluatorSummary}`);
        }
        lines.push('');
        lines.push('```bash');
        lines.push(`agentv prompt input ${evalPath} --test-id ${evalCase.id}`);
        lines.push(
          `agentv prompt judge ${evalPath} --test-id ${evalCase.id} --answer-file <response-file>`,
        );
        lines.push('```');
        lines.push('');
      }
    }

    process.stdout.write(lines.join('\n'));
  },
});

function describeEvaluators(evalCase: EvalTest): string | undefined {
  const configs = evalCase.evaluators;
  if (!configs || configs.length === 0) return undefined;
  return configs.map((c) => `${c.name} (${c.type})`).join(', ');
}
