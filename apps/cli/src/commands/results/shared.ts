/**
 * Shared utilities for `agentv results` subcommands.
 *
 * Provides:
 * - resolveSourceFile() — find an index manifest from explicit path or auto-discover latest
 * - sourceArg — cmd-ts positional for optional result source path
 *
 * How to extend:
 * - To add a new subcommand, import loadResults() and sourceArg from this module.
 */

import { existsSync } from 'node:fs';
import { optional, positional, string } from 'cmd-ts';

import type { EvaluationResult } from '@agentv/core';
import { resolveRunManifestPath } from '../eval/result-layout.js';
import { loadRunCache, resolveRunCacheFile } from '../eval/run-cache.js';
import { listResultFiles } from '../trace/utils.js';
import { loadManifestResults, resolveResultSourcePath } from './manifest.js';

/** cmd-ts positional for optional result source file or workspace directory. */
export const sourceArg = positional({
  type: optional(string),
  displayName: 'source',
  description:
    'Run workspace directory or index.jsonl manifest (defaults to most recent in .agentv/results/runs/)',
});

/**
 * Resolve an index/results source path from explicit arg or auto-discovery.
 */
export async function resolveSourceFile(
  source: string | undefined,
  cwd: string,
): Promise<{ sourceFile: string }> {
  let sourceFile: string;

  if (source) {
    sourceFile = resolveResultSourcePath(source, cwd);
    if (!existsSync(sourceFile)) {
      console.error(`Error: File not found: ${sourceFile}`);
      process.exit(1);
    }
    sourceFile = resolveRunManifestPath(sourceFile);
  } else {
    const cache = await loadRunCache(cwd);
    const cachedFile = cache ? resolveRunCacheFile(cache) : '';
    if (cachedFile && existsSync(cachedFile)) {
      sourceFile = cachedFile;
    } else {
      const metas = listResultFiles(cwd, 1);
      if (metas.length === 0) {
        console.error('Error: No run workspaces found in .agentv/results/runs/');
        console.error('Run an evaluation first: agentv eval <eval-file>');
        process.exit(1);
      }
      sourceFile = metas[0].path;
    }
  }

  return { sourceFile };
}

/**
 * Load and parse eval results from a run workspace or index manifest.
 */
export async function loadResults(
  source: string | undefined,
  cwd: string,
): Promise<{ results: EvaluationResult[]; sourceFile: string }> {
  const { sourceFile } = await resolveSourceFile(source, cwd);
  const results = loadManifestResults(sourceFile);

  if (results.length === 0) {
    console.error(`No results found in ${sourceFile}`);
    process.exit(1);
  }

  return { results, sourceFile };
}
