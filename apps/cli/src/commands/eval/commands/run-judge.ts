import { readFileSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';
import fg from 'fast-glob';

import { executeScript } from '@agentv/core';

export const evalRunJudgeCommand = command({
  name: 'run-judge',
  description: 'Run a single code judge from .agentv/judges/ and print the score',
  args: {
    judgeName: positional({
      type: string,
      displayName: 'judge-name',
      description: 'Name of the judge (matches filename without extension in .agentv/judges/)',
    }),
    agentOutput: option({
      type: optional(string),
      long: 'agent-output',
      description: "The agent's full response text",
    }),
    agentInput: option({
      type: optional(string),
      long: 'agent-input',
      description: 'The original user prompt',
    }),
    file: option({
      type: optional(string),
      long: 'file',
      description: 'Path to JSON file with { output, input } fields',
    }),
  },
  handler: async ({ judgeName, agentOutput: output, agentInput: input, file }) => {
    let resolvedOutput: string;
    let resolvedInput: string;

    if (file) {
      const content = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
      resolvedOutput = content.output ?? '';
      resolvedInput = content.input ?? '';
    } else {
      if (output === undefined) {
        console.error('Error: --agent-output is required (or use --file)');
        process.exit(1);
      }
      resolvedOutput = output;
      resolvedInput = input ?? '';
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(judgeName)) {
      console.error(
        `Error: Invalid judge name '${judgeName}' — only letters, digits, hyphens, and underscores allowed`,
      );
      process.exit(1);
    }

    const scriptPath = await findJudgeScript(judgeName, process.cwd());
    if (!scriptPath) {
      console.error(`Error: Judge '${judgeName}' not found in .agentv/judges/`);
      process.exit(1);
    }

    // Build payload matching CodeEvaluator's expected format (snake_case).
    // Include all fields that defineCodeJudge validates as required.
    const payload = JSON.stringify(
      {
        answer: resolvedOutput,
        output: [{ role: 'assistant', content: resolvedOutput }],
        input: [{ role: 'user', content: resolvedInput }],
        question: resolvedInput,
        criteria: '',
        expected_output: [],
        reference_answer: '',
        guideline_files: [],
        input_files: [],
        trace: null,
        token_usage: null,
        cost_usd: null,
        duration_ms: null,
        start_time: null,
        end_time: null,
        file_changes: null,
        workspace_path: null,
        config: null,
        metadata: {},
      },
      null,
      2,
    );

    try {
      const stdout = await executeScript(['bun', 'run', scriptPath], payload);
      const parsed = JSON.parse(stdout);
      const score = typeof parsed.score === 'number' ? parsed.score : 0;

      process.stdout.write(JSON.stringify(parsed, null, 2));
      process.stdout.write('\n');
      process.exit(score >= 0.5 ? 0 : 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  },
});

async function findJudgeScript(judgeName: string, startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const judgesDir = path.join(dir, '.agentv', 'judges');
    const found = await fg([`${judgeName}.{ts,js,mts,mjs}`], {
      cwd: judgesDir,
      absolute: true,
      onlyFiles: true,
    });
    if (found.length > 0) return found[0];
    dir = path.dirname(dir);
  }

  return null;
}
