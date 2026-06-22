/**
 * TanStack Query hooks for the AgentV Dashboard Hono API.
 *
 * All fetches go to /api/* which Vite proxies to the Hono server in dev,
 * and the same-origin Hono server serves in production.
 */

import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';

import { shouldPollRemoteStatus } from './project-sync-status';
import type {
  CategoriesResponse,
  CombineDuplicateConflict,
  CombineRunsResponse,
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
  FilesystemBrowseResponse,
  FilesystemBrowseResponseWire,
  IndexResponse,
  ProjectEntry,
  ProjectEntryWire,
  ProjectListResponse,
  RemoteStatusResponse,
  RunDetailResponse,
  RunEvalRequest,
  RunListResponse,
  RunTagsResponse,
  StudioConfigResponse,
  SuitesResponse,
  TargetsResponse,
  TranscriptArtifactResponse,
} from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch a text/plain endpoint. Treats 404 as `null` so callers can model
 * "log not yet captured" without throwing — used by the RunDetail run log
 * viewer for runs that finished before this feature shipped (no console.log
 * on disk) and for remote runs.
 */
async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ── Query option factories ──────────────────────────────────────────────

const RUNS_PAGE_LIMIT = 50;

function buildRunListUrl(baseUrl: string, cursor?: string): string {
  const params = new URLSearchParams({ limit: String(RUNS_PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  return `${baseUrl}?${params.toString()}`;
}

function flattenRunListPages(pages: RunListResponse[] | undefined): RunListResponse {
  if (!pages || pages.length === 0) {
    return { runs: [] };
  }
  return {
    runs: pages.flatMap((page) => page.runs),
    next_cursor: pages.at(-1)?.next_cursor,
  };
}

function encodeArtifactPath(filePath: string): string {
  return filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function artifactFileContentUrl(options: {
  runId: string;
  evalId: string;
  filePath: string;
  projectId?: string;
  raw?: boolean;
  download?: boolean;
}): string {
  const base = options.projectId
    ? `${projectApiBase(options.projectId)}/runs/${encodeURIComponent(options.runId)}/evals/${encodeURIComponent(options.evalId)}/files/${encodeArtifactPath(options.filePath)}`
    : `/api/runs/${encodeURIComponent(options.runId)}/evals/${encodeURIComponent(options.evalId)}/files/${encodeArtifactPath(options.filePath)}`;
  const params = new URLSearchParams();
  if (options.raw) params.set('raw', '1');
  if (options.download) params.set('download', '1');
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export const runListOptions = queryOptions({
  queryKey: ['runs'],
  queryFn: () => fetchJson<RunListResponse>('/api/runs'),
  refetchInterval: 5_000,
});

export const infiniteRunListOptions = infiniteQueryOptions({
  queryKey: ['runs', 'infinite'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) => fetchJson<RunListResponse>(buildRunListUrl('/api/runs', pageParam)),
  getNextPageParam: (lastPage) => lastPage.next_cursor,
  refetchInterval: 5_000,
});

export function runDetailOptions(filename: string) {
  return queryOptions({
    queryKey: ['runs', filename],
    queryFn: () => fetchJson<RunDetailResponse>(`/api/runs/${encodeURIComponent(filename)}`),
    enabled: !!filename,
  });
}

export function runLogOptions(filename: string, projectId?: string) {
  const url = projectId
    ? `${projectApiBase(projectId)}/runs/${encodeURIComponent(filename)}/log`
    : `/api/runs/${encodeURIComponent(filename)}/log`;
  return queryOptions({
    queryKey: ['runs', filename, 'log', projectId ?? ''],
    queryFn: () => fetchText(url),
    enabled: !!filename,
    // Re-fetch while a run is still capturing output so the viewer streams in.
    refetchInterval: 3_000,
  });
}

export function useRunLog(filename: string, projectId?: string) {
  return useQuery(runLogOptions(filename, projectId));
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

export function feedbackOptions(projectId?: string) {
  const url = projectId ? `${projectApiBase(projectId)}/feedback` : '/api/feedback';
  return queryOptions({
    queryKey: ['feedback', projectId ?? ''],
    queryFn: () => fetchJson<FeedbackData>(url),
  });
}

export const experimentsOptions = queryOptions({
  queryKey: ['experiments'],
  queryFn: () => fetchJson<ExperimentsResponse>('/api/experiments'),
});

export function compareOptionsWithBaseline(baseline?: string) {
  return queryOptions({
    queryKey: ['compare', 'baseline', baseline ?? ''],
    queryFn: () =>
      fetchJson<CompareResponse>(`/api/compare?baseline=${encodeURIComponent(baseline ?? '')}`),
    enabled: !!baseline,
  });
}

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
      fetchJson<FileContentResponse>(artifactFileContentUrl({ runId, evalId, filePath })),
    enabled: !!runId && !!evalId && !!filePath,
  });
}

export function evalTranscriptOptions(runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['runs', runId, 'evals', evalId, 'transcript'],
    queryFn: () =>
      fetchJson<TranscriptArtifactResponse>(
        `/api/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/transcript`,
      ),
    enabled: !!runId && !!evalId,
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

export function remoteStatusOptions(projectId?: string) {
  const url = projectId ? `${projectApiBase(projectId)}/remote/status` : '/api/remote/status';
  return queryOptions({
    queryKey: ['remote-status', projectId ?? ''],
    queryFn: () => fetchJson<RemoteStatusResponse>(url),
    staleTime: 5_000,
    refetchInterval: (query) => (shouldPollRemoteStatus(query.state.data) ? 1_000 : false),
  });
}

// ── Hooks ───────────────────────────────────────────────────────────────

export function useRunList() {
  return useQuery(runListOptions);
}

export function useInfiniteRunList() {
  const query = useInfiniteQuery(infiniteRunListOptions);
  return {
    ...query,
    data: flattenRunListPages(query.data?.pages),
  };
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

export function useFeedback(projectId?: string) {
  return useQuery(feedbackOptions(projectId));
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

export function useEvalTranscript(runId: string, evalId: string) {
  return useQuery(evalTranscriptOptions(runId, evalId));
}

export function useRunCategories(runId: string) {
  return useQuery(runCategoriesOptions(runId));
}

export function useCategorySuites(runId: string, category: string) {
  return useQuery(categorySuitesOptions(runId, category));
}

export function useStudioConfig(projectId?: string) {
  return useQuery(projectId ? projectConfigOptions(projectId) : studioConfigOptions);
}

export function useRemoteStatus(projectId?: string) {
  return useQuery(remoteStatusOptions(projectId));
}

/** Default pass threshold matching @agentv/core DEFAULT_THRESHOLD */
export const DEFAULT_PASS_THRESHOLD = 0.8;
export const DEFAULT_APP_NAME = 'agentv';

export function isPassing(score: number, passThreshold: number = DEFAULT_PASS_THRESHOLD): boolean {
  return score >= passThreshold;
}

// ── Project API ────────────────────────────────────────────────────────

export const projectListOptions = queryOptions({
  queryKey: ['projects'],
  queryFn: () => fetchJson<ProjectListResponse>('/api/projects'),
  refetchInterval: 10_000,
});

export function useProjectList() {
  return useQuery(projectListOptions);
}

export async function browseFilesystemApi(browsePath?: string): Promise<FilesystemBrowseResponse> {
  const params = new URLSearchParams();
  if (browsePath?.trim()) {
    params.set('path', browsePath.trim());
  }
  const query = params.toString();
  const res = await fetch(`/api/filesystem/browse${query ? `?${query}` : ''}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Failed to browse folders: ${res.status}`);
  }
  const body = (await res.json()) as FilesystemBrowseResponseWire;
  return {
    path: body.path,
    parentPath: body.parent_path,
    current: {
      name: body.current.name,
      path: body.current.path,
      hasAgentv: body.current.has_agentv,
    },
    entries: body.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      hasAgentv: entry.has_agentv,
    })),
  };
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
  const body = (await res.json()) as ProjectEntryWire;
  return {
    id: body.id,
    name: body.name,
    path: body.path,
    addedAt: body.added_at,
    lastOpenedAt: body.last_opened_at,
  };
}

export async function removeProjectApi(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Failed to remove project: ${res.status}`);
  }
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

export function infiniteProjectRunListOptions(projectId: string) {
  return infiniteQueryOptions({
    queryKey: ['projects', projectId, 'runs', 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchJson<RunListResponse>(buildRunListUrl(`${projectApiBase(projectId)}/runs`, pageParam)),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: !!projectId,
    refetchInterval: 5_000,
  });
}

export function useProjectRunList(projectId: string) {
  return useQuery(projectRunListOptions(projectId));
}

export function useInfiniteProjectRunList(projectId: string) {
  const query = useInfiniteQuery(infiniteProjectRunListOptions(projectId));
  return {
    ...query,
    data: flattenRunListPages(query.data?.pages),
  };
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
        artifactFileContentUrl({ projectId, runId, evalId, filePath }),
      ),
    enabled: !!projectId && !!runId && !!evalId && !!filePath,
  });
}

export function projectEvalTranscriptOptions(projectId: string, runId: string, evalId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'runs', runId, 'evals', evalId, 'transcript'],
    queryFn: () =>
      fetchJson<TranscriptArtifactResponse>(
        `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/evals/${encodeURIComponent(evalId)}/transcript`,
      ),
    enabled: !!projectId && !!runId && !!evalId,
  });
}

export function projectExperimentsOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId, 'experiments'],
    queryFn: () => fetchJson<ExperimentsResponse>(`${projectApiBase(projectId)}/experiments`),
    enabled: !!projectId,
  });
}

export function projectCompareOptions(projectId: string, baseline?: string) {
  const base = `${projectApiBase(projectId)}/compare`;
  if (baseline) {
    return queryOptions({
      queryKey: ['projects', projectId, 'compare', 'baseline', baseline],
      queryFn: () => fetchJson<CompareResponse>(`${base}?baseline=${encodeURIComponent(baseline)}`),
      enabled: !!projectId,
    });
  }
  return queryOptions({
    queryKey: ['projects', projectId, 'compare'],
    queryFn: () => fetchJson<CompareResponse>(base),
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

export async function syncRemoteResultsApi(projectId?: string): Promise<RemoteStatusResponse> {
  const url = projectId ? `${projectApiBase(projectId)}/remote/sync` : '/api/remote/sync';
  const res = await fetch(url, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (err as { error?: string }).error ?? `Failed to sync remote results: ${res.status}`,
    );
  }
  return res.json() as Promise<RemoteStatusResponse>;
}

export class CombineRunsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly duplicates: readonly CombineDuplicateConflict[] = [],
  ) {
    super(message);
    this.name = 'CombineRunsApiError';
  }
}

export async function combineRunsApi(
  runIds: readonly string[],
  duplicatePolicy: 'error' | 'latest',
  projectId?: string,
  displayName?: string,
): Promise<CombineRunsResponse> {
  const url = projectId ? `${projectApiBase(projectId)}/runs/combine` : '/api/runs/combine';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_ids: runIds,
      duplicate_policy: duplicatePolicy,
      ...(displayName?.trim() ? { display_name: displayName.trim() } : {}),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      duplicates?: CombineDuplicateConflict[];
    };
    throw new CombineRunsApiError(
      err.error ?? `Failed to combine runs: ${res.status}`,
      res.status,
      err.duplicates ?? [],
    );
  }
  return res.json() as Promise<CombineRunsResponse>;
}

export async function deleteRunApi(runId: string, projectId?: string): Promise<void> {
  const url = projectId
    ? `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}`
    : `/api/runs/${encodeURIComponent(runId)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed to delete run: ${res.status}`);
  }
}

// ── Run tag mutations ────────────────────────────────────────────────────

/**
 * Replace the tags on a run. Tags are stored as a sidecar `tags.json` file
 * next to the run's manifest and surface as chips in the compare views.
 * Pass the row's `tag_revision` to reject stale browser edits.
 */
export async function saveRunTagsApi(
  runId: string,
  tags: string[],
  projectId?: string,
  expectedTagRevision?: string,
): Promise<RunTagsResponse> {
  const url = projectId
    ? `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/tags`
    : `/api/runs/${encodeURIComponent(runId)}/tags`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tags,
      ...(expectedTagRevision ? { expected_tag_revision: expectedTagRevision } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed to save tags: ${res.status}`);
  }
  return res.json() as Promise<RunTagsResponse>;
}

/** Clear the tags for a run, rejecting stale browser edits when a revision is provided. */
export async function deleteRunTagsApi(
  runId: string,
  projectId?: string,
  expectedTagRevision?: string,
): Promise<void> {
  const url = projectId
    ? `${projectApiBase(projectId)}/runs/${encodeURIComponent(runId)}/tags`
    : `/api/runs/${encodeURIComponent(runId)}/tags`;
  const res = await fetch(url, {
    method: 'DELETE',
    ...(expectedTagRevision
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_tag_revision: expectedTagRevision }),
        }
      : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed to delete tags: ${res.status}`);
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

export async function stopEvalRun(
  runId: string,
  projectId?: string,
): Promise<{ stopped: boolean; reason?: string; status?: string }> {
  const url = projectId
    ? `${projectApiBase(projectId)}/eval/run/${runId}/stop`
    : `/api/eval/run/${runId}/stop`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Failed: ${res.status}`);
  }
  return res.json() as Promise<{ stopped: boolean; reason?: string; status?: string }>;
}

export function evalRunStatusOptions(runId: string | null, projectId?: string) {
  const url = projectId
    ? `${projectApiBase(projectId)}/eval/status/${runId}`
    : `/api/eval/status/${runId}`;
  return queryOptions({
    queryKey: ['eval-status', projectId ?? '', runId],
    queryFn: () => fetchJson<EvalRunStatus>(url),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'finished' || status === 'failed') return false;
      return 2_000;
    },
  });
}

export function useEvalRunStatus(runId: string | null, projectId?: string) {
  return useQuery(evalRunStatusOptions(runId, projectId));
}

export function evalRunsOptions(projectId?: string) {
  const url = projectId ? `${projectApiBase(projectId)}/eval/runs` : '/api/eval/runs';
  return queryOptions({
    queryKey: ['eval-runs', projectId ?? ''],
    queryFn: () => fetchJson<EvalRunListResponse>(url),
    refetchInterval: 3_000,
  });
}

export function useEvalRuns(projectId?: string) {
  return useQuery(evalRunsOptions(projectId));
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
