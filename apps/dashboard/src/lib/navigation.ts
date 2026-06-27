/**
 * Pure Dashboard route helpers.
 *
 * These keep project-aware path generation in one place so redirects,
 * breadcrumbs, and regression tests all agree on the canonical URLs.
 */

export type StudioTabId = 'runs' | 'experiments' | 'analytics' | 'targets';

export interface IndexRouteDecision {
  kind: 'dashboard' | 'single-project-home' | 'redirect';
  redirectPath?: string;
}

export function initialProjectRedirectStorageKey(projectId: string): string {
  return `agentv.studio.initial-project-redirect:${projectId}`;
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

export interface EvalResultPathOptions {
  projectId?: string;
  resultDir?: string;
  evalPath?: string;
}

export interface EvalResultIdentity {
  testId: string;
  target?: string;
  result_dir?: string;
  eval_path?: string;
  suite?: string;
}

export function evalResultSearchParams(options: EvalResultPathOptions): Record<string, string> {
  if (options.resultDir) {
    return { result_dir: options.resultDir };
  }
  if (options.evalPath) {
    return { eval_path: options.evalPath };
  }
  return {};
}

export function evalResultPath(
  runId: string,
  evalId: string,
  options: EvalResultPathOptions = {},
): string {
  const base = evalPath(runId, evalId, options.projectId);
  const params = new URLSearchParams(evalResultSearchParams(options));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function evalResultIdentityKey(result: EvalResultIdentity): string {
  if (result.result_dir) return result.result_dir;
  return [result.eval_path ?? result.suite ?? '', result.testId, result.target ?? ''].join(':');
}

export function matchesEvalResultIdentity(
  result: Pick<EvalResultIdentity, 'testId' | 'result_dir' | 'eval_path'>,
  evalId: string,
  options: Pick<EvalResultPathOptions, 'resultDir' | 'evalPath'> = {},
): boolean {
  return (
    result.testId === evalId &&
    (!options.resultDir || result.result_dir === options.resultDir) &&
    (!options.evalPath || result.eval_path === options.evalPath)
  );
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

export function resolveInitialProjectRedirect(
  projectIds: string[],
  currentProjectId?: string,
  alreadyRedirected = false,
): string | undefined {
  if (alreadyRedirected) {
    return undefined;
  }

  return currentProjectId && projectIds.includes(currentProjectId) ? currentProjectId : undefined;
}

export function resolveIndexRoute(
  projectIds: string[],
  projectDashboard: boolean | undefined,
  preferredProjectId?: string,
  tab?: StudioTabId,
): IndexRouteDecision {
  if (projectDashboard === false) {
    return { kind: 'single-project-home' };
  }

  if (preferredProjectId && projectIds.includes(preferredProjectId)) {
    return {
      kind: 'redirect',
      redirectPath: projectHomePath(preferredProjectId, tab),
    };
  }

  return { kind: 'dashboard' };
}
