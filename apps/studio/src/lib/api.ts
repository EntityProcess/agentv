/**
 * TanStack Query hooks for the AgentV Studio Hono API.
 *
 * All fetches go to /api/* which Vite proxies to the Hono server in dev,
 * and the same-origin Hono server serves in production.
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import type {
  BenchmarkEntry,
  BenchmarkListResponse,
  CategoriesResponse,
  CompareResponse,
  EvalDetailResponse,
  EvalDiscoverResponse,
  EvalPreviewResponse,
  EvalRunListResponse,
  EvalRunResponse,
  EvalRunStatus,
  EvalTargetsResponse,
  ExperimentsResponse,
  FeedbackData,
  FileContentResponse,
  FileTreeResponse,
  IndexResponse,
  RemoteStatusResponse,
  RunDetailResponse,
  RunEvalRequest,
  RunLabelResponse,
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

export const compareOptions = queryOptions({
  queryKey: ['compare'],
  queryFn: () => fetchJson<CompareResponse>('/api/compare'),
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

export function remoteStatusOptions(benchmarkId?: string) {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/remote/status` : '/api/remote/status';
  return queryOptions({
    queryKey: ['remote-status', benchmarkId ?? ''],
    queryFn: () => fetchJson<RemoteStatusResponse>(url),
    staleTime: 5_000,
  });
}

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

export function useCompare() {
  return useQuery(compareOptions);
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

export function useRemoteStatus(benchmarkId?: string) {
  return useQuery(remoteStatusOptions(benchmarkId));
}

/** Default pass threshold matching @agentv/core DEFAULT_THRESHOLD */
export const DEFAULT_PASS_THRESHOLD = 0.8;

export function isPassing(score: number, passThreshold: number = DEFAULT_PASS_THRESHOLD): boolean {
  return score >= passThreshold;
}

// ── Benchmark API ────────────────────────────────────────────────────────

export const benchmarkListOptions = queryOptions({
  queryKey: ['benchmarks'],
  queryFn: () => fetchJson<BenchmarkListResponse>('/api/benchmarks'),
  refetchInterval: 10_000,
});

export function useBenchmarkList() {
  return useQuery(benchmarkListOptions);
}

export const allBenchmarkRunsOptions = queryOptions({
  queryKey: ['benchmarks', 'all-runs'],
  queryFn: () => fetchJson<RunListResponse>('/api/benchmarks/all-runs'),
  refetchInterval: 5_000,
});

export function useAllBenchmarkRuns() {
  return useQuery(allBenchmarkRunsOptions);
}

export async function addBenchmarkApi(benchmarkPath: string): Promise<BenchmarkEntry> {
  const res = await fetch('/api/benchmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: benchmarkPath }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || `Failed to add project: ${res.status}`);
  }
  return res.json() as Promise<BenchmarkEntry>;
}

export async function removeBenchmarkApi(benchmarkId: string): Promise<void> {
  const res = await fetch(`/api/benchmarks/${encodeURIComponent(benchmarkId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to remove project: ${res.status}`);
  }
}

export async function discoverBenchmarksApi(dirPath: string): Promise<BenchmarkEntry[]> {
  const res = await fetch('/api/benchmarks/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || `Failed to discover: ${res.status}`);
  }
  const data = (await res.json()) as { discovered: BenchmarkEntry[] };
  return data.discovered;
}

/** Build the API base URL for a benchmark-scoped request. */
function benchmarkApiBase(benchmarkId: string): string {
  return `/api/benchmarks/${encodeURIComponent(benchmarkId)}`;
}

export function benchmarkRunListOptions(benchmarkId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs'],
    queryFn: () => fetchJson<RunListResponse>(`${benchmarkApiBase(benchmarkId)}/runs`),
    enabled: !!benchmarkId,
    refetchInterval: 5_000,
  });
}

export function useBenchmarkRunList(benchmarkId: string) {
  return useQuery(benchmarkRunListOptions(benchmarkId));
}

export function benchmarkRunDetailOptions(benchmarkId: string, filename: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', filename],
    queryFn: () =>
      fetchJson<RunDetailResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(filename)}`,
      ),
    enabled: !!benchmarkId && !!filename,
  });
}

export function useBenchmarkRunDetail(benchmarkId: string, filename: string) {
  return useQuery(benchmarkRunDetailOptions(benchmarkId, filename));
}

export function benchmarkRunSuitesOptions(benchmarkId: string, runId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'suites'],
    queryFn: () =>
      fetchJson<SuitesResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/suites`,
      ),
    enabled: !!benchmarkId && !!runId,
  });
}

export function benchmarkRunCategoriesOptions(benchmarkId: string, runId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'categories'],
    queryFn: () =>
      fetchJson<CategoriesResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/categories`,
      ),
    enabled: !!benchmarkId && !!runId,
  });
}

export function benchmarkCategorySuitesOptions(
  benchmarkId: string,
  runId: string,
  category: string,
) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'categories', category, 'suites'],
    queryFn: () =>
      fetchJson<SuitesResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/categories/${encodeURIComponent(category)}/suites`,
      ),
    enabled: !!benchmarkId && !!runId && !!category,
  });
}

export function benchmarkEvalDetailOptions(benchmarkId: string, runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'evals', evalId],
    queryFn: () =>
      fetchJson<EvalDetailResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}`,
      ),
    enabled: !!benchmarkId && !!runId && !!evalId,
  });
}

export function benchmarkEvalFilesOptions(benchmarkId: string, runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'evals', evalId, 'files'],
    queryFn: () =>
      fetchJson<FileTreeResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files`,
      ),
    enabled: !!benchmarkId && !!runId && !!evalId,
  });
}

export function benchmarkEvalFileContentOptions(
  benchmarkId: string,
  runId: string,
  evalId: string,
  filePath: string,
) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'runs', runId, 'evals', evalId, 'files', filePath],
    queryFn: () =>
      fetchJson<FileContentResponse>(
        `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/files/${filePath}`,
      ),
    enabled: !!benchmarkId && !!runId && !!evalId && !!filePath,
  });
}

export function benchmarkExperimentsOptions(benchmarkId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'experiments'],
    queryFn: () => fetchJson<ExperimentsResponse>(`${benchmarkApiBase(benchmarkId)}/experiments`),
    enabled: !!benchmarkId,
  });
}

export function benchmarkCompareOptions(benchmarkId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'compare'],
    queryFn: () => fetchJson<CompareResponse>(`${benchmarkApiBase(benchmarkId)}/compare`),
    enabled: !!benchmarkId,
  });
}

export function benchmarkTargetsOptions(benchmarkId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'targets'],
    queryFn: () => fetchJson<TargetsResponse>(`${benchmarkApiBase(benchmarkId)}/targets`),
    enabled: !!benchmarkId,
  });
}

export function benchmarkConfigOptions(benchmarkId: string) {
  return queryOptions({
    queryKey: ['benchmarks', benchmarkId, 'config'],
    queryFn: () => fetchJson<StudioConfigResponse>(`${benchmarkApiBase(benchmarkId)}/config`),
    enabled: !!benchmarkId,
    staleTime: 5_000,
  });
}

export async function syncRemoteResultsApi(benchmarkId?: string): Promise<RemoteStatusResponse> {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/remote/sync` : '/api/remote/sync';
  const res = await fetch(url, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to sync remote results: ${res.status}`);
  }
  return res.json() as Promise<RemoteStatusResponse>;
}

// ── Run label mutations ──────────────────────────────────────────────────

/**
 * Save (create or update) a label for a run. Labels are stored as a sidecar
 * `label.json` file next to the run's manifest and replace the formatted
 * timestamp in compare view column headers.
 */
export async function saveRunLabelApi(
  runId: string,
  label: string,
  benchmarkId?: string,
): Promise<RunLabelResponse> {
  const url = benchmarkId
    ? `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/label`
    : `/api/runs/${encodeURIComponent(runId)}/label`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed to save label: ${res.status}`);
  }
  return res.json() as Promise<RunLabelResponse>;
}

/** Remove the label sidecar for a run. */
export async function deleteRunLabelApi(runId: string, benchmarkId?: string): Promise<void> {
  const url = benchmarkId
    ? `${benchmarkApiBase(benchmarkId)}/runs/${encodeURIComponent(runId)}/label`
    : `/api/runs/${encodeURIComponent(runId)}/label`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed to delete label: ${res.status}`);
  }
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

export function evalDiscoverOptions(benchmarkId?: string) {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/eval/discover` : '/api/eval/discover';
  return queryOptions({
    queryKey: ['eval-discover', benchmarkId ?? ''],
    queryFn: () => fetchJson<EvalDiscoverResponse>(url),
    staleTime: 30_000,
  });
}

export function useEvalDiscover(benchmarkId?: string) {
  return useQuery(evalDiscoverOptions(benchmarkId));
}

export function evalTargetsOptions(benchmarkId?: string) {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/eval/targets` : '/api/eval/targets';
  return queryOptions({
    queryKey: ['eval-targets', benchmarkId ?? ''],
    queryFn: () => fetchJson<EvalTargetsResponse>(url),
    staleTime: 30_000,
  });
}

export function useEvalTargets(benchmarkId?: string) {
  return useQuery(evalTargetsOptions(benchmarkId));
}

export async function launchEvalRun(
  body: RunEvalRequest,
  benchmarkId?: string,
): Promise<EvalRunResponse> {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/eval/run` : '/api/eval/run';
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

export function evalRunsOptions(benchmarkId?: string) {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/eval/runs` : '/api/eval/runs';
  return queryOptions({
    queryKey: ['eval-runs', benchmarkId ?? ''],
    queryFn: () => fetchJson<EvalRunListResponse>(url),
    refetchInterval: 3_000,
  });
}

export function useEvalRuns(benchmarkId?: string) {
  return useQuery(evalRunsOptions(benchmarkId));
}

export async function previewEvalCommand(
  body: RunEvalRequest,
  benchmarkId?: string,
): Promise<EvalPreviewResponse> {
  const url = benchmarkId ? `${benchmarkApiBase(benchmarkId)}/eval/preview` : '/api/eval/preview';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  return res.json() as Promise<EvalPreviewResponse>;
}
