/**
 * Shared utilities for `agentv results` subcommands.
 *
 * Provides:
 * - resolveSourceFile() — find JSONL from explicit path or auto-discover latest
 * - patchTestIds() — backward-compat eval_id -> test_id patching
 * - sourceArg — cmd-ts positional for optional JSONL source path
 *
 * How to extend:
 * - To add a new subcommand, import loadResults() and sourceArg from this module.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { optional, positional, string } from 'cmd-ts';

import type { EvaluationResult } from '@agentv/core';
import { parseJsonlResults } from '../eval/artifact-writer.js';
import { loadRunCache } from '../eval/run-cache.js';
import { listResultFiles } from '../trace/utils.js';

/** cmd-ts positional for optional JSONL source file. */
export const sourceArg = positional({
  type: optional(string),
  displayName: 'source',
  description: 'JSONL result file (defaults to most recent in .agentv/results/)',
});

/**
 * Resolve a JSONL source file path from explicit arg or auto-discovery.
 * Returns the absolute path and the file content.
 */
export async function resolveSourceFile(
  source: string | undefined,
  cwd: string,
): Promise<{ sourceFile: string; content: string }> {
  let sourceFile: string;

  if (source) {
    sourceFile = path.isAbsolute(source) ? source : path.resolve(cwd, source);
    if (!existsSync(sourceFile)) {
      console.error(`Error: File not found: ${sourceFile}`);
      process.exit(1);
    }
  } else {
    const cache = await loadRunCache(cwd);
    if (cache && existsSync(cache.lastResultFile)) {
      sourceFile = cache.lastResultFile;
    } else {
      const metas = listResultFiles(cwd, 1);
      if (metas.length === 0) {
        console.error('Error: No result files found in .agentv/results/');
        console.error('Run an evaluation first: agentv eval <eval-file>');
        process.exit(1);
      }
      sourceFile = metas[0].path;
    }
  }

  const content = readFileSync(sourceFile, 'utf8');
  return { sourceFile, content };
}

/**
 * Load and parse JSONL results from a source file, with backward-compat patching.
 */
export async function loadResults(
  source: string | undefined,
  cwd: string,
): Promise<{ results: EvaluationResult[]; sourceFile: string }> {
  const { sourceFile, content } = await resolveSourceFile(source, cwd);
  const results = parseJsonlResults(content);

  if (results.length === 0) {
    console.error(`No results found in ${sourceFile}`);
    process.exit(1);
  }

  return { results: patchTestIds(results), sourceFile };
}

/**
 * Patch older JSONL records that used eval_id instead of test_id.
 */
export function patchTestIds(results: EvaluationResult[]): EvaluationResult[] {
  return results.map((r) => {
    if (!r.testId && (r as unknown as Record<string, unknown>).evalId) {
      return { ...r, testId: String((r as unknown as Record<string, unknown>).evalId) };
    }
    return r;
  });
}
