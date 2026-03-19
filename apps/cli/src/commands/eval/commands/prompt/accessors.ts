import type { EvaluatorConfig, JsonObject, TestMessage } from '@agentv/core';
import { loadTestById, loadTests } from '@agentv/core';

import { findRepoRoot } from '../../shared.js';

interface PromptEvalInputResult {
  readonly test_id: string;
  readonly input: readonly JsonObject[];
  readonly criteria: string;
}

interface PromptEvalExpectedOutputResult {
  readonly test_id: string;
  readonly criteria: string;
  readonly expected_output: readonly JsonObject[];
  readonly reference_answer?: string;
  readonly assertions: readonly EvaluatorConfig[];
}

interface PromptEvalListResult {
  readonly eval_path: string;
  readonly test_ids: readonly string[];
}

export async function listPromptEvalTestIds(evalPath: string): Promise<PromptEvalListResult> {
  const repoRoot = await findRepoRoot(process.cwd());
  const tests = await loadTests(evalPath, repoRoot);

  return {
    eval_path: evalPath,
    test_ids: tests.map((test) => test.id).sort(),
  };
}

export async function getPromptEvalInput(
  evalPath: string,
  testId: string,
): Promise<PromptEvalInputResult> {
  const repoRoot = await findRepoRoot(process.cwd());
  const evalCase = await loadTestById(evalPath, repoRoot, testId);
  const fileMap = buildFileMap(evalCase.input_segments, evalCase.file_paths);

  return {
    test_id: evalCase.id,
    input: resolveMessages(evalCase.input, fileMap),
    criteria: evalCase.criteria,
  };
}

export async function getPromptEvalExpectedOutput(
  evalPath: string,
  testId: string,
): Promise<PromptEvalExpectedOutputResult> {
  const repoRoot = await findRepoRoot(process.cwd());
  const evalCase = await loadTestById(evalPath, repoRoot, testId);

  return {
    test_id: evalCase.id,
    criteria: evalCase.criteria,
    expected_output: evalCase.expected_output,
    reference_answer: evalCase.reference_answer,
    assertions: evalCase.assertions ?? [],
  };
}

export async function getPromptEvalGradingBrief(evalPath: string, testId: string): Promise<string> {
  const repoRoot = await findRepoRoot(process.cwd());
  const evalCase = await loadTestById(evalPath, repoRoot, testId);
  const fileMap = buildFileMap(evalCase.input_segments, evalCase.file_paths);
  const resolvedInput = resolveMessages(evalCase.input, fileMap);

  const lines: string[] = [];

  // Input
  const inputText = extractTextFromMessages(resolvedInput);
  if (inputText) {
    lines.push(`Input: "${inputText}"`);
  }

  // Files
  if (evalCase.file_paths.length > 0) {
    lines.push(`Files: ${evalCase.file_paths.join(', ')}`);
  }

  // Expected output
  if (evalCase.reference_answer) {
    lines.push(`Expected: "${evalCase.reference_answer}"`);
  }

  // Criteria
  const criteria: string[] = [];
  if (evalCase.criteria) {
    criteria.push(evalCase.criteria);
  }
  for (const assertion of evalCase.assertions ?? []) {
    const entry = assertion as Record<string, unknown>;
    const type = entry.type as string | undefined;
    const bag = (entry.config as Record<string, unknown>) ?? {};
    if (type === 'contains') {
      criteria.push(`Output contains '${entry.value}'`);
    } else if (type === 'rubrics') {
      const items = (entry.criteria ?? bag.criteria) as Array<{ outcome?: string }> | undefined;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.outcome) criteria.push(item.outcome);
        }
      }
    } else if (
      type === 'llm-grader' ||
      type === 'llm_grader' ||
      type === 'llm-judge' ||
      type === 'llm_judge'
    ) {
      const prompt = entry.prompt ?? bag.prompt ?? bag.criteria;
      criteria.push(`[llm-grader] ${typeof prompt === 'string' ? prompt : ''}`);
    } else if (
      type === 'code-grader' ||
      type === 'code_grader' ||
      type === 'code-judge' ||
      type === 'code_judge'
    ) {
      const name = entry.name ?? type;
      const desc = bag.description ?? entry.description;
      criteria.push(`[code-grader] ${name}${desc ? `: ${desc}` : ''}`);
    } else if (type === 'skill-trigger') {
      const trigger = entry.should_trigger !== false;
      criteria.push(`[skill-trigger] should_trigger: ${trigger} for ${entry.skill}`);
    } else if (type) {
      criteria.push(`[${type}] ${entry.value ?? bag.criteria ?? bag.prompt ?? ''}`);
    }
  }

  if (criteria.length > 0) {
    lines.push('Criteria:');
    for (const c of criteria) {
      lines.push(`  - ${c}`);
    }
  }

  return lines.join('\n');
}

function extractTextFromMessages(messages: JsonObject[]): string {
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const textBlocks = (msg.content as JsonObject[])
        .filter((b) => b.type === 'text')
        .map((b) => b.value as string);
      if (textBlocks.length > 0) return textBlocks.join(' ');
    }
  }
  return '';
}

/**
 * Build a mapping from relative file names to resolved absolute paths.
 * Uses input_segments (which have resolvedPath) as the primary source,
 * then falls back to suffix-matching against all file_paths.
 */
function buildFileMap(
  inputSegments: readonly JsonObject[],
  allFilePaths: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();

  for (const segment of inputSegments) {
    if (
      segment.type === 'file' &&
      typeof segment.path === 'string' &&
      typeof segment.resolvedPath === 'string'
    ) {
      map.set(segment.path, segment.resolvedPath);
    }
  }

  // Fall back to suffix-matching against file_paths
  return {
    get(key: string): string | undefined {
      const direct = map.get(key);
      if (direct) return direct;
      return allFilePaths.find((filePath) => filePath.endsWith(`/${key}`) || filePath === key);
    },
    has(key: string): boolean {
      return this.get(key) !== undefined;
    },
  } as Map<string, string>;
}

/**
 * Resolve file references in messages, replacing relative values with absolute paths.
 * The agent can then read these files directly from the filesystem.
 */
function resolveMessages(
  messages: readonly TestMessage[],
  fileMap: Map<string, string>,
): JsonObject[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content } as JsonObject;
    }

    if (!Array.isArray(message.content)) {
      return { role: message.role, content: message.content } as JsonObject;
    }

    const resolvedContent: JsonObject[] = [];
    for (const segment of message.content) {
      if (typeof segment === 'string') {
        resolvedContent.push({ type: 'text', value: segment } as JsonObject);
        continue;
      }

      const obj = segment as JsonObject;
      if (obj.type === 'file' && typeof obj.value === 'string') {
        const resolved = fileMap.get(obj.value);
        resolvedContent.push({
          type: 'file',
          path: resolved ?? obj.value,
        } as JsonObject);
      } else {
        resolvedContent.push(obj);
      }
    }

    return { role: message.role, content: resolvedContent } as JsonObject;
  });
}
