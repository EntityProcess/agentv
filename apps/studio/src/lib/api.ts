/**
 * TanStack Query hooks for the AgentV Studio Hono API.
 *
 * All fetches go to /api/* which Vite proxies to the Hono server in dev,
 * and the same-origin Hono server serves in production.
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import type {
  CategoriesResponse,
  DatasetsResponse,
  EvalDetailResponse,
  ExperimentsResponse,
  FeedbackData,
  FileContentResponse,
  FileTreeResponse,
  IndexResponse,
  RunDetailResponse,
  RunListResponse,
  StudioConfigResponse,
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

export function runDatasetsOptions(runId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'datasets'],
    queryFn: () => fetchJson<DatasetsResponse>(`/api/runs/${encodeURIComponent(runId)}/datasets`),
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

export function categoryDatasetsOptions(runId: string, category: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'categories', category, 'datasets'],
    queryFn: () =>
      fetchJson<DatasetsResponse>(
        `/api/runs/${encodeURIComponent(runId)}/categories/${encodeURIComponent(category)}/datasets`,
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

export function useRunDatasets(runId: string) {
  return useQuery(runDatasetsOptions(runId));
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

export function useCategoryDatasets(runId: string, category: string) {
  return useQuery(categoryDatasetsOptions(runId, category));
}

export function useStudioConfig() {
  return useQuery(studioConfigOptions);
}

/** Default pass threshold matching @agentv/core PASS_THRESHOLD */
export const DEFAULT_PASS_THRESHOLD = 0.8;

export function isPassing(score: number, passThreshold: number = DEFAULT_PASS_THRESHOLD): boolean {
  return score >= passThreshold;
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
