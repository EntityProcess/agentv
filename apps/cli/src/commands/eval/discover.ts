import path from 'node:path';
import { detectFileType } from '@agentv/core/evaluation/validation';
import fg from 'fast-glob';

export interface DiscoveredEvalFile {
  /** Absolute path to the eval file */
  readonly path: string;
  /** Relative path from cwd for display */
  readonly relativePath: string;
  /** Category derived from parent folder structure */
  readonly category: string;
}

/**
 * Discover eval files (.yaml, .yml, .jsonl) in the current directory tree.
 *
 * Uses the core `detectFileType` function to classify each file:
 * 1. Checks for `$schema: agentv-eval-v2` field (explicit marker)
 * 2. Falls back to path-based inference (files under `.agentv/` as config/targets)
 * 3. Defaults to 'eval' for unrecognized YAML files
 *
 * Groups results by category based on their parent folder structure.
 */
export async function discoverEvalFiles(cwd: string): Promise<readonly DiscoveredEvalFile[]> {
  const patterns = ['**/*.yaml', '**/*.yml', '**/*.jsonl'];
  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.agentv/**',
    '**/targets.yaml',
    '**/targets.yml',
  ];

  const matches = await fg(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore,
    followSymbolicLinks: true,
  });

  const evalFiles: DiscoveredEvalFile[] = [];

  for (const absPath of matches) {
    // Use core's detectFileType to check $schema field and path-based inference
    const fileType = await detectFileType(absPath);
    if (fileType !== 'eval') {
      continue;
    }

    const relativePath = path.relative(cwd, absPath);
    const category = deriveCategory(relativePath);
    evalFiles.push({ path: absPath, relativePath, category });
  }

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
