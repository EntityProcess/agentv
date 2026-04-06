/**
 * TanStack Query hooks for the AgentV Studio Hono API.
 *
 * All fetches go to /api/* which Vite proxies to the Hono server in dev,
 * and the same-origin Hono server serves in production.
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import type {
  CategoriesResponse,
  EvalDetailResponse,
  EvalDiscoverResponse,
  EvalPreviewResponse,
  EvalRunResponse,
  EvalRunStatus,
  EvalTargetsResponse,
  ExperimentsResponse,
  FeedbackData,
  FileContentResponse,
  FileTreeResponse,
  IndexResponse,
  ProjectEntry,
  ProjectListResponse,
  RunDetailResponse,
  RunEvalRequest,
  RunListResponse,
  StudioConfigResponse,
  SuitesResponse,
  TargetsResponse,
} from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Query option factories ──────────────────────────────────────────────

export const runListOptions = queryOptions({
  queryKey: ['runs'],
  queryFn: () => fetchJson<RunListResponse>('/api/runs'),
  refetchInterval: 5_000,
});

export function runDetailOptions(filename: string) {
  return queryOptions({
    queryKey: ['runs', filename],
    queryFn: () => fetchJson<RunDetailResponse>(`/api/runs/${encodeURIComponent(filename)}`),
    enabled: !!filename,
  });
}

export function runSuitesOptions(runId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'suites'],
    queryFn: () => fetchJson<SuitesResponse>(`/api/runs/${encodeURIComponent(runId)}/suites`),
    enabled: !!runId,
  });
}

export function evalDetailOptions(runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'evals', evalId],
    queryFn: () =>
      fetchJson<EvalDetailResponse>(
        `/api/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}`,
      ),
    enabled: !!runId && !!evalId,
  });
}

export const indexOptions = queryOptions({
  queryKey: ['index'],
  queryFn: () => fetchJson<IndexResponse>('/api/index'),
});

export const feedbackOptions = queryOptions({
  queryKey: ['feedback'],
  queryFn: () => fetchJson<FeedbackData>('/api/feedback'),
});

export const experimentsOptions = queryOptions({
  queryKey: ['experiments'],
  queryFn: () => fetchJson<ExperimentsResponse>('/api/experiments'),
});

export const targetsOptions = queryOptions({
  queryKey: ['targets'],
  queryFn: () => fetchJson<TargetsResponse>('/api/targets'),
});

export function evalFilesOptions(runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'evals', evalId, 'files'],
    queryFn: () =>
      fetchJson<FileTreeResponse>(
        `/api/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files`,
      ),
    enabled: !!runId && !!evalId,
  });
}

export function evalFileContentOptions(runId: string, evalId: string, filePath: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'evals', evalId, 'files', filePath],
    queryFn: () =>
      fetchJson<FileContentResponse>(
        `/api/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files/${filePath}`,
      ),
    enabled: !!runId && !!evalId && !!filePath,
  });
}

export function runCategoriesOptions(runId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'categories'],
    queryFn: () =>
      fetchJson<CategoriesResponse>(`/api/runs/${encodeURIComponent(runId)}/categories`),
    enabled: !!runId,
  });
}

export function categorySuitesOptions(runId: string, category: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'categories', category, 'suites'],
    queryFn: () =>
      fetchJson<SuitesResponse>(
        `/api/runs/${encodeURIComponent(runId)}/categories/${encodeURIComponent(category)}/suites`,
      ),
    enabled: !!runId && !!category,
  });
}

export const studioConfigOptions = queryOptions({
  queryKey: ['config'],
  queryFn: () => fetchJson<StudioConfigResponse>('/api/config'),
  staleTime: 5_000,
});

// ── Hooks ───────────────────────────────────────────────────────────────

export function useRunList() {
  return useQuery(runListOptions);
}

export function useRunDetail(filename: string) {
  return useQuery(runDetailOptions(filename));
}

export function useRunSuites(runId: string) {
  return useQuery(runSuitesOptions(runId));
}

export function useEvalDetail(runId: string, evalId: string) {
  return useQuery(evalDetailOptions(runId, evalId));
}

export function useIndex() {
  return useQuery(indexOptions);
}

export function useFeedback() {
  return useQuery(feedbackOptions);
}

export function useExperiments() {
  return useQuery(experimentsOptions);
}

export function useTargets() {
  return useQuery(targetsOptions);
}

export function useEvalFiles(runId: string, evalId: string) {
  return useQuery(evalFilesOptions(runId, evalId));
}

export function useEvalFileContent(runId: string, evalId: string, filePath: string) {
  return useQuery(evalFileContentOptions(runId, evalId, filePath));
}

export function useRunCategories(runId: string) {
  return useQuery(runCategoriesOptions(runId));
}

export function useCategorySuites(runId: string, category: string) {
  return useQuery(categorySuitesOptions(runId, category));
}

export function useStudioConfig() {
  return useQuery(studioConfigOptions);
}

/** Default pass threshold matching @agentv/core DEFAULT_THRESHOLD */
export const DEFAULT_PASS_THRESHOLD = 0.8;

export function isPassing(score: number, passThreshold: number = DEFAULT_PASS_THRESHOLD): boolean {
  return score >= passThreshold;
}

// ── Project API ─────────────────────────────────────────────────────────

export const projectListOptions = queryOptions({
  queryKey: ['projects'],
  queryFn: () => fetchJson<ProjectListResponse>('/api/projects'),
  refetchInterval: 10_000,
});

export function useProjectList() {
  return useQuery(projectListOptions);
}

export const allProjectRunsOptions = queryOptions({
  queryKey: ['projects', 'all-runs'],
  queryFn: () => fetchJson<RunListResponse>('/api/projects/all-runs'),
  refetchInterval: 5_000,
});

export function useAllProjectRuns() {
  return useQuery(allProjectRunsOptions);
}

export async function addProjectApi(projectPath: string): Promise<ProjectEntry> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectPath }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || `Failed to add project: ${res.status}`);
  }
  return res.json() as Promise<ProjectEntry>;
}

export async function removeProjectApi(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to remove project: ${res.status}`);
  }
}

export async function discoverProjectsApi(dirPath: string): Promise<ProjectEntry[]> {
  const res = await fetch('/api/projects/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || `Failed to discover: ${res.status}`);
  }
  const data = (await res.json()) as { discovered: ProjectEntry[] };
  return data.discovered;
}

/** Build the API base URL for a project-scoped request. */
function projectApiBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function projectRunListOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs'],
    queryFn: () => fetchJson<RunListResponse>(`${projectApiBase(projectId)}/runs`),
    enabled: !!projectId,
    refetchInterval: 5_000,
  });
}

export function useProjectRunList(projectId: string) {
  return useQuery(projectRunListOptions(projectId));
}

export function projectRunDetailOptions(projectId: string, filename: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', filename],
    queryFn: () =>
      fetchJson<RunDetailResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(filename)}`,
      ),
    enabled: !!projectId && !!filename,
  });
}

export function useProjectRunDetail(projectId: string, filename: string) {
  return useQuery(projectRunDetailOptions(projectId, filename));
}

export function projectRunSuitesOptions(projectId: string, runId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'suites'],
    queryFn: () =>
      fetchJson<SuitesResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/suites`,
      ),
    enabled: !!projectId && !!runId,
  });
}

export function projectRunCategoriesOptions(projectId: string, runId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'categories'],
    queryFn: () =>
      fetchJson<CategoriesResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/categories`,
      ),
    enabled: !!projectId && !!runId,
  });
}

export function projectCategorySuitesOptions(projectId: string, runId: string, category: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'categories', category, 'suites'],
    queryFn: () =>
      fetchJson<SuitesResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/categories/${encodeURIComponent(category)}/suites`,
      ),
    enabled: !!projectId && !!runId && !!category,
  });
}

export function projectEvalDetailOptions(projectId: string, runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'evals', evalId],
    queryFn: () =>
      fetchJson<EvalDetailResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}`,
      ),
    enabled: !!projectId && !!runId && !!evalId,
  });
}

export function projectEvalFilesOptions(projectId: string, runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'evals', evalId, 'files'],
    queryFn: () =>
      fetchJson<FileTreeResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files`,
      ),
    enabled: !!projectId && !!runId && !!evalId,
  });
}

export function projectEvalFileContentOptions(
  projectId: string,
  runId: string,
  evalId: string,
  filePath: string,
) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'evals', evalId, 'files', filePath],
    queryFn: () =>
      fetchJson<FileContentResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files/${filePath}`,
      ),
    enabled: !!projectId && !!runId && !!evalId && !!filePath,
  });
}

export function projectExperimentsOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'experiments'],
    queryFn: () => fetchJson<ExperimentsResponse>(`${projectApiBase(projectId)}/experiments`),
    enabled: !!projectId,
  });
}

export function projectTargetsOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'targets'],
    queryFn: () => fetchJson<TargetsResponse>(`${projectApiBase(projectId)}/targets`),
    enabled: !!projectId,
  });
}

export function projectConfigOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'config'],
    queryFn: () => fetchJson<StudioConfigResponse>(`${projectApiBase(projectId)}/config`),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export async function saveStudioConfig(
  config: Partial<StudioConfigResponse>,
): Promise<StudioConfigResponse> {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Failed to save config: ${res.status}`);
  }
  return res.json() as Promise<StudioConfigResponse>;
}

// ── Eval runner queries & mutations ──────────────────────────────────────

export function evalDiscoverOptions(projectId?: string) {
  const url = projectId ? `${projectApiBase(projectId)}/eval/discover` : '/api/eval/discover';
  return queryOptions({
    queryKey: ['eval-discover', projectId ?? ''],
    queryFn: () => fetchJson<EvalDiscoverResponse>(url),
    staleTime: 30_000,
  });
}

export function useEvalDiscover(projectId?: string) {
  return useQuery(evalDiscoverOptions(projectId));
}

export function evalTargetsOptions(projectId?: string) {
  const url = projectId ? `${projectApiBase(projectId)}/eval/targets` : '/api/eval/targets';
  return queryOptions({
    queryKey: ['eval-targets', projectId ?? ''],
    queryFn: () => fetchJson<EvalTargetsResponse>(url),
    staleTime: 30_000,
  });
}

export function useEvalTargets(projectId?: string) {
  return useQuery(evalTargetsOptions(projectId));
}

export async function launchEvalRun(
  body: RunEvalRequest,
  projectId?: string,
): Promise<EvalRunResponse> {
  const url = projectId ? `${projectApiBase(projectId)}/eval/run` : '/api/eval/run';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed: ${res.status}`);
  }
  return res.json() as Promise<EvalRunResponse>;
}

export function evalRunStatusOptions(runId: string | null) {
  return queryOptions({
    queryKey: ['eval-status', runId],
    queryFn: () => fetchJson<EvalRunStatus>(`/api/eval/status/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'finished' || status === 'failed') return false;
      return 2_000;
    },
  });
}

export function useEvalRunStatus(runId: string | null) {
  return useQuery(evalRunStatusOptions(runId));
}

export async function previewEvalCommand(
  body: RunEvalRequest,
  projectId?: string,
): Promise<EvalPreviewResponse> {
  const url = projectId ? `${projectApiBase(projectId)}/eval/preview` : '/api/eval/preview';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  return res.json() as Promise<EvalPreviewResponse>;
}
