/**
 * Prompt resolution utilities for LLM judge evaluators.
 *
 * Extracted from orchestrator.ts to enable reuse by the evaluator registry.
 *
 * Key behavior: When a user writes `prompt: "some text"` in an assertion,
 * `resolveCustomPrompt()` returns that text. The caller must then decide
 * whether the text is a **full template** (contains `{{output}}` etc.) or
 * **bare criteria** (no template variables). Use `containsTemplateVariables()`
 * to distinguish: full templates become `evaluatorTemplateOverride`, while
 * bare criteria are injected into the default template's `{{criteria}}` slot.
 */

import path from 'node:path';

import { toSnakeCaseDeep } from '../case-conversion.js';
import { readTextFile } from '../file-utils.js';
import type { Message } from '../providers/types.js';
import { VALID_TEMPLATE_VARIABLES } from '../template-variables.js';
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

/**
 * Checks whether a prompt string contains any known `{{ variable }}` template
 * placeholders (e.g. `{{output}}`, `{{input}}`). If it does, the string is a
 * full evaluator template and should replace the default template. If not,
 * it's bare criteria text and should be injected into the `{{criteria}}` slot
 * of the default template.
 */
export function containsTemplateVariables(text: string): boolean {
  const variablePattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = variablePattern.exec(text)) !== null) {
    if (VALID_TEMPLATE_VARIABLES.has(match[1])) {
      return true;
    }
  }
  return false;
}

async function executePromptTemplate(
  script: readonly string[],
  context: ResolveCustomPromptContext,
  config?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> {
  const payload = {
    criteria: context.evalCase.criteria,
    expectedOutput: context.evalCase.expected_output,
    output: context.output ?? null,
    inputFiles: context.evalCase.file_paths,
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
