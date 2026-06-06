/**
 * Resolve the human project name shown in Dashboard chrome.
 *
 * Project-scoped URLs use stable registry IDs, while visible chrome should
 * show the registry name from `/api/projects`. Callers pass the project list
 * they already fetched and this helper falls back to the ID only when the
 * registry name is unavailable.
 */

export interface ProjectDisplayEntry {
  id: string;
  name?: string | null;
}

export function resolveProjectDisplayName(
  projectId: string,
  projects: readonly ProjectDisplayEntry[] | undefined,
): string {
  const name = projects?.find((project) => project.id === projectId)?.name?.trim();
  return name || projectId;
}
