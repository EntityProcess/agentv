import type { EvaluatorConfig, JsonObject, TestMessage } from '@agentv/core';
import { loadTestById, loadTests } from '@agentv/core';

import { findRepoRoot } from '../../shared.js';

interface PromptEvalInputResult {
  readonly test_id: string;
  readonly input: readonly JsonObject[];
  readonly guideline_paths: readonly string[];
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

export async function getPromptEvalInput(evalPath: string, testId: string): Promise<PromptEvalInputResult> {
  const repoRoot = await findRepoRoot(process.cwd());
  const evalCase = await loadTestById(evalPath, repoRoot, testId);
  const fileMap = buildFileMap(evalCase.input_segments, evalCase.file_paths);

  return {
    test_id: evalCase.id,
    input: resolveMessages(evalCase.input, fileMap),
    guideline_paths: evalCase.guideline_paths,
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

/**
 * Build a mapping from relative file names to resolved absolute paths.
 * Uses input_segments (which have resolvedPath) as the primary source,
 * then falls back to suffix-matching against all file_paths for
 * guideline files (which are excluded from input_segments).
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

  // For guideline files not in input_segments, match by suffix against file_paths
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
