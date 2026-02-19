import path from 'node:path';
import { DEFAULT_EVAL_PATTERNS, loadConfig } from '@agentv/core';
import fg from 'fast-glob';

import { findRepoRoot } from './shared.js';

export interface DiscoveredEvalFile {
  /** Absolute path to the eval file */
  readonly path: string;
  /** Relative path from cwd for display */
  readonly relativePath: string;
  /** Category derived from parent folder structure */
  readonly category: string;
}

/**
 * Discover eval files by glob pattern matching.
 *
 * Uses `eval_patterns` from `.agentv/config.yaml` if configured,
 * otherwise falls back to default patterns that match `dataset*.yaml`
 * and `eval.yaml` files under `evals/` directories.
 */
export async function discoverEvalFiles(cwd: string): Promise<readonly DiscoveredEvalFile[]> {
  const repoRoot = await findRepoRoot(cwd);

  // Load config to check for custom eval_patterns
  // Pass a dummy file path in cwd so buildDirectoryChain starts from cwd
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  const patterns =
    config?.eval_patterns && config.eval_patterns.length > 0
      ? config.eval_patterns
      : DEFAULT_EVAL_PATTERNS;

  const ignore = ['**/node_modules/**', '**/dist/**'];

  const matches = await fg(patterns as string[], {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore,
    followSymbolicLinks: true,
    caseSensitiveMatch: false,
  });

  const evalFiles: DiscoveredEvalFile[] = matches.map((absPath) => {
    const relativePath = path.relative(cwd, absPath);
    const category = deriveCategory(relativePath);
    return { path: absPath, relativePath, category };
  });

  evalFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return evalFiles;
}

/** Derive a human-readable category from the relative path. */
function deriveCategory(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  // Use the first meaningful directory as category
  // e.g., "examples/showcase/export-screening/evals/dataset.yaml" → "showcase/export-screening"
  // e.g., "evals/dataset.yaml" → "evals"
  if (parts.length <= 1) {
    return 'root';
  }

  // Remove the filename and "evals" folder if present
  const dirs = parts.slice(0, -1).filter((d) => d !== 'evals');
  return dirs.length > 0 ? dirs.join('/') : 'root';
}

/** Get unique categories from discovered eval files. */
export function getCategories(files: readonly DiscoveredEvalFile[]): readonly string[] {
  const categories = new Set<string>();
  for (const file of files) {
    categories.add(file.category);
  }
  const sorted = Array.from(categories);
  sorted.sort();
  return sorted;
}

/** Filter eval files by category. */
export function filterByCategory(
  files: readonly DiscoveredEvalFile[],
  category: string,
): readonly DiscoveredEvalFile[] {
  return files.filter((f) => f.category === category);
}
