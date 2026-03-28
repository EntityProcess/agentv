import path from 'node:path';

/** Default category for eval files without subdirectory structure. */
export const DEFAULT_CATEGORY = 'Uncategorized';

/**
 * Derive a human-readable category from an eval file's relative path.
 *
 * Strips the filename and any `evals` directory segments, then joins
 * remaining directories with `/`. Returns {@link DEFAULT_CATEGORY} for files
 * at the root level.
 */
export function deriveCategory(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  if (parts.length <= 1) {
    return DEFAULT_CATEGORY;
  }
  const dirs = parts.slice(0, -1).filter((d) => d !== 'evals');
  return dirs.length > 0 ? dirs.join('/') : DEFAULT_CATEGORY;
}
