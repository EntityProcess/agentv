/**
 * Top-level Dashboard context bar.
 *
 * Keeps project identity out of the sidebar so the left rail can stay focused
 * on app navigation while the current project remains visible above the main
 * review surface.
 */

import { useMatches, useNavigate } from '@tanstack/react-router';
import type { ChangeEvent } from 'react';

import { DEFAULT_APP_NAME, useProjectList, useStudioConfig } from '~/lib/api';
import { resolveProjectDisplayName } from '~/lib/project-display-name';
import { useSidebarContext } from '~/lib/sidebar-context';

import { BrandName } from './BrandName';

const ALL_PROJECTS_VALUE = '__all_projects__';

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
  const navigate = useNavigate();
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
  const hasProjectSwitcher = projects.length > 0;

  function handleProjectChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextProjectId = event.target.value;
    if (nextProjectId === ALL_PROJECTS_VALUE) {
      navigate({ to: '/' });
      return;
    }

    navigate({
      to: '/projects/$projectId',
      params: { projectId: nextProjectId },
      search: { tab: 'runs' } as Record<string, string>,
    });
  }

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
            {hasProjectSwitcher ? (
              <select
                value={currentProjectId ?? ALL_PROJECTS_VALUE}
                onChange={handleProjectChange}
                aria-label="Switch project"
                className="mt-0.5 w-full max-w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm font-medium text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 md:w-auto md:min-w-64"
              >
                <option value={ALL_PROJECTS_VALUE}>All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {resolveProjectDisplayName(project.id, projects)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-0.5 truncate text-sm font-medium text-gray-100">{projectName}</div>
            )}
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
