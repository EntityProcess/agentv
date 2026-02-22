/**
 * Prompt resolution utilities for LLM judge evaluators.
 *
 * Extracted from orchestrator.ts to enable reuse by the evaluator registry.
 */

import path from 'node:path';

import { toSnakeCaseDeep } from '../case-conversion.js';
import { readTextFile } from '../file-utils.js';
import type { Message } from '../providers/types.js';
import type { TraceSummary } from '../trace.js';
import type { EvalTest, PromptScriptConfig } from '../types.js';
import { executeScript } from './code-evaluator.js';

export interface ResolveCustomPromptContext {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly output?: readonly Message[];
  readonly trace?: TraceSummary;
  readonly config?: Record<string, unknown>;
  readonly fileChanges?: string;
  readonly workspacePath?: string;
}

export async function resolveCustomPrompt(
  promptConfig: {
    readonly prompt?: string | PromptScriptConfig;
    readonly promptPath?: string;
    readonly resolvedPromptPath?: string;
    readonly resolvedPromptScript?: readonly string[];
    readonly config?: Record<string, unknown>;
  },
  context?: ResolveCustomPromptContext,
  timeoutMs?: number,
): Promise<string | undefined> {
  if (promptConfig.resolvedPromptScript && promptConfig.resolvedPromptScript.length > 0) {
    if (!context) {
      throw new Error('Context required for executable prompt templates');
    }
    return executePromptTemplate(
      promptConfig.resolvedPromptScript,
      context,
      promptConfig.config,
      timeoutMs,
    );
  }

  const promptPath = promptConfig.resolvedPromptPath ?? promptConfig.promptPath;

  if (promptPath) {
    try {
      const content = await readTextFile(promptPath);
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not read custom prompt at ${promptPath}: ${message}`);
    }
  }

  const promptValue = promptConfig.prompt;
  if (typeof promptValue === 'string') {
    return promptValue;
  }

  return undefined;
}

async function executePromptTemplate(
  script: readonly string[],
  context: ResolveCustomPromptContext,
  config?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> {
  const payload = {
    question: context.evalCase.question,
    criteria: context.evalCase.criteria,
    expectedOutput: context.evalCase.expected_output,
    referenceAnswer: context.evalCase.reference_answer,
    answer: context.candidate,
    output: context.output ?? null,
    guidelineFiles: context.evalCase.guideline_paths,
    inputFiles: context.evalCase.file_paths.filter(
      (p) => !context.evalCase.guideline_paths.includes(p),
    ),
    input: context.evalCase.input,
    trace: context.trace ?? null,
    fileChanges: context.fileChanges ?? null,
    workspacePath: context.workspacePath ?? null,
    config: config ?? context.config ?? null,
  };

  const inputJson = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

  const scriptPath = script[script.length - 1];
  const cwd = path.dirname(scriptPath);

  try {
    const stdout = await executeScript(script, inputJson, timeoutMs, cwd);
    const prompt = stdout.trim();

    if (!prompt) {
      throw new Error('Prompt template produced empty output');
    }

    return prompt;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt template execution failed: ${message}`);
  }
}
