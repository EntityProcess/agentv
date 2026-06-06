/**
 * Project title used by project-scoped Dashboard chrome.
 *
 * The primary label is the registry display name. The URL-safe ID remains
 * visible as secondary context when it differs, but routes still receive the ID.
 */

export function ProjectChromeTitle({
  projectId,
  displayName,
}: {
  projectId: string;
  displayName: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">{displayName}</h1>
      {displayName !== projectId ? (
        <p className="mt-0.5 text-sm text-gray-500">{projectId}</p>
      ) : null}
    </div>
  );
}
