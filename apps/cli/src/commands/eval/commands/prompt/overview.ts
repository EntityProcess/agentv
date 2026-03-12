import { type EvalTest, loadTests } from '@agentv/core';
import { command, restPositionals, string } from 'cmd-ts';

import { findRepoRoot, resolveEvalPaths } from '../../shared.js';

type EvalMode = 'prompt' | 'command';

function getEvalMode(): EvalMode {
  const mode = process.env.AGENTV_EVAL_MODE ?? 'prompt';
  if (mode !== 'prompt' && mode !== 'command') {
    throw new Error(`Invalid AGENTV_EVAL_MODE="${mode}". Valid values: prompt, command`);
  }
  return mode;
}

export async function generateOverviewPrompt(evalPaths: string[]): Promise<string> {
  const cwd = process.cwd();
  const resolvedPaths = await resolveEvalPaths(evalPaths, cwd);
  const repoRoot = await findRepoRoot(cwd);
  const mode = getEvalMode();

  const fileEntries: Array<{ path: string; tests: readonly EvalTest[] }> = [];
  for (const evalPath of resolvedPaths) {
    const tests = await loadTests(evalPath, repoRoot);
    fileEntries.push({ path: evalPath, tests });
  }

  const totalCases = fileEntries.reduce((sum, e) => sum + e.tests.length, 0);

  if (mode === 'command') {
    return generateCommandModePrompt(fileEntries, totalCases);
  }
  return generatePromptModePrompt(fileEntries, totalCases);
}

function generatePromptModePrompt(
  fileEntries: Array<{ path: string; tests: readonly EvalTest[] }>,
  totalCases: number,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
  const lines: string[] = [
    '# AgentV Eval Orchestration',
    '',
    '**Mode: prompt** — You orchestrate the evaluation using agents. No API keys needed.',
    '',
    `You are orchestrating ${totalCases} evaluation case${totalCases === 1 ? '' : 's'}.`,
    '',
    '## Setup',
    '',
    `- **Results file:** \`.agentv/results/eval_${timestamp}.jsonl\``,
    '- **Temp answers:** `.agentv/tmp/`',
    '',
    'Ensure both directories exist before starting.',
    '',
    '## For each test case',
    '',
    'Run these two agents **sequentially**:',
    '',
    '### 1. Dispatch `eval-candidate` agent',
    '',
    'Parameters:',
    '- `eval-path`: Path to the eval YAML file',
    '- `test-id`: The test case ID',
    '- `answer-file`: `.agentv/tmp/eval_<test-id>.txt`',
    '',
    'The agent retrieves the task input, acts as the candidate LLM, and saves its response.',
    '',
    '### 2. Dispatch `eval-judge` agent (after candidate completes)',
    '',
    'Parameters:',
    '- `eval-path`: Path to the eval YAML file',
    '- `test-id`: The test case ID',
    '- `answer-file`: `.agentv/tmp/eval_<test-id>.txt`',
    `- \`results-file\`: \`.agentv/results/eval_${timestamp}.jsonl\``,
    '',
    'The agent runs evaluators, scores the response, and appends results to the JSONL file.',
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
      lines.push('**1. Dispatch `eval-candidate` agent:**');
      lines.push(`- eval-path: \`${evalPath}\``);
      lines.push(`- test-id: \`${evalCase.id}\``);
      lines.push(`- answer-file: \`.agentv/tmp/eval_${evalCase.id}.txt\``);
      lines.push('');
      lines.push('**2. Dispatch `eval-judge` agent** (after candidate completes):');
      lines.push(`- eval-path: \`${evalPath}\``);
      lines.push(`- test-id: \`${evalCase.id}\``);
      lines.push(`- answer-file: \`.agentv/tmp/eval_${evalCase.id}.txt\``);
      lines.push(`- results-file: \`.agentv/results/eval_${timestamp}.jsonl\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateCommandModePrompt(
  fileEntries: Array<{ path: string; tests: readonly EvalTest[] }>,
  totalCases: number,
): string {
  const evalPathArgs = fileEntries.map((e) => e.path).join(' ');
  const lines: string[] = [
    '# AgentV Eval Orchestration',
    '',
    '**Mode: command** — Run the evaluation end-to-end using the CLI.',
    '',
    `You are orchestrating ${totalCases} evaluation case${totalCases === 1 ? '' : 's'}.`,
    '',
    '## Run the evaluation',
    '',
    '```bash',
    `agentv eval ${evalPathArgs}`,
    '```',
    '',
    'Results are written to `.agentv/results/`. The output path is printed in the CLI output.',
    'Parse the JSONL file for per-test scores, hits, and misses.',
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
    }
  }

  return lines.join('\n');
}

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
    const output = await generateOverviewPrompt(args.evalPaths);
    process.stdout.write(output);
  },
});

function describeEvaluators(evalCase: EvalTest): string | undefined {
  const configs = evalCase.evaluators;
  if (!configs || configs.length === 0) return undefined;
  return configs.map((c) => `${c.name} (${c.type})`).join(', ');
}
