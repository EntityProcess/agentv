/**
 * Pure Studio route helpers.
 *
 * These keep project-aware path generation in one place so redirects,
 * breadcrumbs, and regression tests all agree on the canonical URLs.
 */

export type StudioTabId = 'runs' | 'experiments' | 'analytics' | 'targets';

export interface IndexRouteDecision {
  kind: 'dashboard' | 'single-project-home' | 'redirect';
  redirectPath?: string;
}

export function projectHomePath(projectId: string, tab?: StudioTabId): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

export function runPath(runId: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
    : `/runs/${encodeURIComponent(runId)}`;
}

export function evalPath(runId: string, evalId: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/evals/${encodeURIComponent(runId)}/${encodeURIComponent(evalId)}`
    : `/evals/${encodeURIComponent(runId)}/${encodeURIComponent(evalId)}`;
}

export function experimentPath(experimentName: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/experiments/${encodeURIComponent(experimentName)}`
    : `/experiments/${encodeURIComponent(experimentName)}`;
}

export function jobPath(runId: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(runId)}`
    : `/jobs/${encodeURIComponent(runId)}`;
}

export function categoryPath(runId: string, category: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/category/${encodeURIComponent(category)}`
    : `/runs/${encodeURIComponent(runId)}/category/${encodeURIComponent(category)}`;
}

export function suitePath(runId: string, suite: string, projectId?: string): string {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/suite/${encodeURIComponent(suite)}`
    : `/runs/${encodeURIComponent(runId)}/suite/${encodeURIComponent(suite)}`;
}

export function runsHomePath(projectId?: string): string {
  return projectId ? projectHomePath(projectId, 'runs') : '/?tab=runs';
}

export function experimentsHomePath(projectId?: string): string {
  return projectId ? projectHomePath(projectId, 'experiments') : '/?tab=experiments';
}

export function resolveIndexRoute(
  projectIds: string[],
  projectDashboard: boolean | undefined,
  tab?: StudioTabId,
): IndexRouteDecision {
  if (projectDashboard === false) {
    return { kind: 'single-project-home' };
  }

  if (projectIds.length === 1) {
    return {
      kind: 'redirect',
      redirectPath: projectHomePath(projectIds[0], tab),
    };
  }

  return { kind: 'dashboard' };
}
