/**
 * Top-level Dashboard context bar.
 *
 * Keeps project identity out of the sidebar so the left rail can stay focused
 * on app navigation while the current project remains visible above the main
 * review surface.
 */

import { useMatches } from '@tanstack/react-router';

import { DEFAULT_APP_NAME, useProjectList, useStudioConfig } from '~/lib/api';
import { resolveProjectDisplayName } from '~/lib/project-display-name';
import { useSidebarContext } from '~/lib/sidebar-context';

import { BrandName } from './BrandName';

function useCurrentProjectId(): string | undefined {
  const matches = useMatches();

  for (let i = matches.length - 1; i >= 0; i--) {
    const params = matches[i].params as Record<string, string>;
    if (params.projectId) return params.projectId;
  }

  return undefined;
}

function formatProjectStat(project: {
  run_count: number;
  pass_rate: number;
  execution_error_count?: number;
}): string {
  if (project.run_count === 0) return 'No runs';
  const passRate = `${Math.round(project.pass_rate * 100)}% pass`;
  if ((project.execution_error_count ?? 0) > 0) {
    return `${passRate}, ${project.execution_error_count} errors`;
  }
  return `${passRate}, ${project.run_count} runs`;
}

export function ProjectContextBar() {
  const { toggle } = useSidebarContext();
  const { data: projectsData } = useProjectList();
  const currentProjectId = useCurrentProjectId();
  const { data: config } = useStudioConfig(currentProjectId);
  const projects = projectsData?.projects ?? [];
  const currentProject = currentProjectId
    ? projects.find((project) => project.id === currentProjectId)
    : undefined;
  const projectName = currentProjectId
    ? resolveProjectDisplayName(currentProjectId, projects)
    : 'All projects';
  const appName = config?.app_name ?? DEFAULT_APP_NAME;

  return (
    <header className="flex min-h-14 items-center gap-3 border-b border-gray-800 bg-gray-950 px-4 py-2 md:px-6">
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 text-gray-400 hover:text-gray-200 md:hidden"
        aria-label="Toggle navigation"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Toggle navigation"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-sm font-semibold text-white md:hidden">
            <BrandName appName={appName} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Project
            </div>
            <div className="mt-0.5 truncate text-sm font-medium text-gray-100">{projectName}</div>
          </div>
        </div>
      </div>

      {currentProject ? (
        <div className="hidden shrink-0 text-right text-xs text-gray-500 sm:block">
          <div className="tabular-nums">{formatProjectStat(currentProject)}</div>
          {currentProject.name !== currentProject.id ? (
            <div className="max-w-64 truncate">{currentProject.id}</div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
