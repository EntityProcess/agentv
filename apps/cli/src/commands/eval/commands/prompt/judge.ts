import { readFile } from 'node:fs/promises';
import {
  type EvalTest,
  type EvaluatorConfig,
  assembleLlmJudgePrompt,
  buildPromptInputs,
  executeScript,
  loadTestById,
  toSnakeCaseDeep,
} from '@agentv/core';
import { command, option, positional, string } from 'cmd-ts';

import { findRepoRoot } from '../../shared.js';

interface JudgeResult {
  test_id: string;
  evaluators: EvaluatorOutput[];
}

interface EvaluatorOutput {
  name: string;
  type: string;
  status: 'completed' | 'prompt_ready';
  result?: Record<string, unknown>;
  prompt?: { system_prompt: string; user_prompt: string };
}

export const evalPromptJudgeCommand = command({
  name: 'judge',
  description: 'Run code judges and output LLM judge prompts for a single test',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to evaluation .yaml file',
    }),
    testId: option({
      type: string,
      long: 'test-id',
      description: 'Test ID',
    }),
    answerFile: option({
      type: string,
      long: 'answer-file',
      description: 'Path to file containing the candidate answer',
    }),
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const evalCase = await loadTestById(args.evalPath, repoRoot, args.testId);
    const candidate = (await readFile(args.answerFile, 'utf8')).trim();
    const promptInputs = await buildPromptInputs(evalCase);

    const evaluators = evalCase.evaluators ?? [];
    const outputs: EvaluatorOutput[] = [];

    for (const config of evaluators) {
      const output = await processEvaluator(config, evalCase, candidate, promptInputs);
      outputs.push(output);
    }

    // If no explicit evaluators, default to llm_judge freeform
    if (outputs.length === 0) {
      const assembly = assembleLlmJudgePrompt({
        evalCase,
        candidate,
        promptInputs,
      });

      outputs.push({
        name: 'default_llm_judge',
        type: 'llm_judge',
        status: 'prompt_ready',
        prompt: {
          system_prompt: assembly.systemPrompt,
          user_prompt: assembly.userPrompt,
        },
      });
    }

    const result: JudgeResult = {
      test_id: evalCase.id,
      evaluators: outputs,
    };

    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
  },
});

async function processEvaluator(
  config: EvaluatorConfig,
  evalCase: EvalTest,
  candidate: string,
  promptInputs: Awaited<ReturnType<typeof buildPromptInputs>>,
): Promise<EvaluatorOutput> {
  switch (config.type) {
    case 'code': {
      const codeConfig = config as Extract<EvaluatorConfig, { type: 'code' }>;
      const script = codeConfig.script;
      const scriptCwd = codeConfig.resolvedCwd ?? codeConfig.cwd;

      const payload = {
        question: evalCase.question,
        criteria: evalCase.criteria,
        expectedOutput: evalCase.expected_output,
        referenceAnswer: evalCase.reference_answer,
        answer: candidate,
        output: null,
        guidelineFiles: evalCase.guideline_paths,
        inputFiles: evalCase.file_paths.filter((p) => !evalCase.guideline_paths.includes(p)),
        input: evalCase.input,
        trace: null,
        fileChanges: null,
        workspacePath: null,
        config: codeConfig.config ?? null,
      };

      try {
        const inputPayload = JSON.stringify(toSnakeCaseDeep(payload), null, 2);
        const stdout = await executeScript(script, inputPayload, 60_000, scriptCwd);

        const parsed = JSON.parse(stdout);
        return {
          name: codeConfig.name,
          type: 'code_judge',
          status: 'completed',
          result: parsed,
        };
      } catch (error) {
        return {
          name: codeConfig.name,
          type: 'code_judge',
          status: 'completed',
          result: {
            score: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case 'llm_judge': {
      const llmConfig = config as Extract<EvaluatorConfig, { type: 'llm_judge' }>;
      const assembly = assembleLlmJudgePrompt({
        evalCase,
        candidate,
        promptInputs,
        evaluatorConfig: llmConfig,
      });

      return {
        name: llmConfig.name,
        type: 'llm_judge',
        status: 'prompt_ready',
        prompt: {
          system_prompt: assembly.systemPrompt,
          user_prompt: assembly.userPrompt,
        },
      };
    }

    default: {
      // For other evaluator types, report as needing manual handling
      return {
        name: config.name,
        type: config.type,
        status: 'prompt_ready',
        result: {
          message: `Evaluator type "${config.type}" requires the full eval pipeline. Use \`agentv eval\` instead.`,
        },
      };
    }
  }
}
