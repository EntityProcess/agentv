/** Default category for eval files without category taxonomy metadata. */
export const DEFAULT_CATEGORY = 'Uncategorized';

const GENERIC_EVAL_FILE_STEMS = new Set(['eval', 'dataset']);

/**
 * Canonicalize analytics category taxonomy paths.
 *
 * Categories are slash-delimited analytics paths, not filesystem paths. Existing
 * flat labels remain valid one-node paths, while repeated slash separators and
 * surrounding whitespace are normalized for derived and explicit categories.
 */
export function normalizeCategoryPath(category: string | undefined): string {
  const normalized = category
    ?.replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('/');
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CATEGORY;
}

function evalFileStem(fileName: string): string {
  return fileName.replace(/\.eval\.[^.]+$/i, '').replace(/\.[^.]+$/i, '');
}

/**
 * Derive a canonical slash-delimited analytics category path from an eval file.
 *
 * Generic eval filenames such as `eval.yaml` and `dataset.eval.yaml` do not add
 * a taxonomy leaf. Meaningful named eval files such as `network.eval.yaml` do
 * contribute a leaf. Any `evals` directory segment is treated as organization
 * only and is removed from the analytics taxonomy.
 */
export function deriveCategory(relativePath: string): string {
  const parts = relativePath
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const fileName = parts.at(-1);
  if (!fileName) {
    return DEFAULT_CATEGORY;
  }

  const taxonomyParts = parts.slice(0, -1).filter((part) => part !== 'evals');
  const stem = evalFileStem(fileName).trim();
  if (stem && !GENERIC_EVAL_FILE_STEMS.has(stem.toLowerCase())) {
    taxonomyParts.push(stem);
  }

  return normalizeCategoryPath(taxonomyParts.join('/'));
}
