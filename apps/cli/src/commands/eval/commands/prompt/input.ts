import type { JsonObject, TestMessage } from '@agentv/core';
import { loadTestById } from '@agentv/core';
import { command, option, positional, string } from 'cmd-ts';

import { findRepoRoot } from '../../shared.js';

export const evalPromptInputCommand = command({
  name: 'input',
  description: 'Output task input JSON for a single test',
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
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const evalCase = await loadTestById(args.evalPath, repoRoot, args.testId);

    // Build mapping from relative file names to resolved absolute paths.
    // input_segments has resolvedPath for non-guideline files;
    // file_paths (which includes guidelines) is used as a fallback.
    const fileMap = buildFileMap(evalCase.input_segments, evalCase.file_paths);

    // Resolve file references in input to absolute paths
    const resolvedMessages = resolveMessages(evalCase.input, fileMap);

    const output = {
      test_id: evalCase.id,
      input: resolvedMessages,
      guideline_paths: evalCase.guideline_paths,
      criteria: evalCase.criteria,
    };

    process.stdout.write(JSON.stringify(output, null, 2));
    process.stdout.write('\n');
  },
});

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
      // Suffix match: "file.md" matches "/abs/path/to/file.md"
      return allFilePaths.find((p) => p.endsWith(`/${key}`) || p === key);
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
