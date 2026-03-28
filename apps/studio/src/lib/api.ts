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
  ExperimentsResponse,
  FeedbackData,
  FileContentResponse,
  FileTreeResponse,
  IndexResponse,
  RunDetailResponse,
  RunListResponse,
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

export function runCategoriesOptions(runId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'categories'],
    queryFn: () =>
      fetchJson<CategoriesResponse>(`/api/runs/${encodeURIComponent(runId)}/categories`),
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

// ── Hooks ───────────────────────────────────────────────────────────────

export function useRunList() {
  return useQuery(runListOptions);
}

export function useRunDetail(filename: string) {
  return useQuery(runDetailOptions(filename));
}

export function useRunCategories(runId: string) {
  return useQuery(runCategoriesOptions(runId));
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
