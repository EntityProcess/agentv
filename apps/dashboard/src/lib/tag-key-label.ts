/**
 * Title-case a promptfoo tag key for display (e.g. `team` → `Team`).
 *
 * Shared by the Tags tab, the tag-value detail view, and the Sidebar so the
 * three surfaces render the same label for a given key. Falls back to `Tag`
 * for an empty key.
 */
export function tagKeyLabel(key: string): string {
  if (!key) return 'Tag';
  return key.charAt(0).toUpperCase() + key.slice(1);
}
