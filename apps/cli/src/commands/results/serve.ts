/**
 * `agentv dashboard` / `agentv serve` — starts the AgentV Dashboard server, a React SPA for
 * reviewing evaluation results.
 *
 * The server uses Hono for routing and @hono/node-server to listen.
 * The Dashboard SPA is served from a pre-built dist directory.
 *
 * API endpoints:
 *   - GET /           — Dashboard SPA (React app)
 *   - GET /api/runs   — list available run workspaces with metadata
 *   - GET /api/runs/:filename — load results from a specific run workspace
 *   - GET /api/runs/:filename/log — stream the captured console.log for a run
 *   - GET /api/runs/:filename/evals/:evalId/files/* — read artifact files as JSON,
 *     or as raw/downloadable text with ?raw=1 / ?download=1
 *   - GET /api/feedback  — read feedback reviews
 *   - POST /api/feedback — write feedback reviews
 *   - GET /api/projects  — list registered projects
 *   - POST /api/projects — register a project by path
 *   - DELETE /api/projects/:projectId — unregister a project
 *   - GET /api/projects/:projectId/runs — project-scoped run list
 *
 * All data routes (runs, suites, categories, evals, experiments, targets)
 * exist in both unscoped (/api/...) and project-scoped (/api/projects/:projectId/...)
 * variants. They share handler functions via DataContext, differing only in
 * how searchDir is resolved.
 *
 * Before starting the server, the command checks `required_version` from
 * the cwd's `.agentv/config.yaml` (single-project scope) and warns on
 * mismatches without prompting, self-updating, or blocking startup.
 *
 * Exported functions (for testing):
 *   - resolveSourceFile(source, cwd) — resolves the canonical project run source
 *   - loadResults(content) — parses JSONL into EvaluationResult[]
 *   - createApp(results, cwd) — Hono app factory
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, flag, number, option, optional, positional, string } from 'cmd-ts';

import {
  AGENTV_RESULTS_ARTIFACTS_REF,
  DEFAULT_CATEGORY,
  type EvaluationResult,
  addProject,
  getProject,
  loadConfig,
  loadProjectRegistry,
  readGitResultArtifact,
  removeProject,
  syncProjects,
  touchProject,
} from '@agentv/core';
import type { Context } from 'hono';
import { Hono } from 'hono';

import { enforceRequiredVersion } from '../../version-check.js';
import { parseJsonlResults } from '../eval/artifact-writer.js';
import { loadRunCache, resolveRunCacheFile } from '../eval/run-cache.js';
import { findRepoRoot } from '../eval/shared.js';
import { listResultFiles } from '../inspect/utils.js';
import {
  CombineDuplicateError,
  type CombineDuplicatePolicy,
  buildCombineRunSources,
  combineRunSources,
} from './combine-run.js';
import { deleteLocalRun } from './delete-run.js';
import { getActiveRunStatus, getActiveRunTarget, registerEvalRoutes } from './eval-runner.js';
import {
  type ResultManifestRecord,
  loadLightweightResults,
  loadManifestResults,
  parseResultManifest,
} from './manifest.js';
import {
  type SourcedResultFileMeta,
  clearRemoteRunTags,
  ensureRemoteRunAvailable,
  findRunById,
  getRemoteResultsStatus,
  listMergedResultFiles,
  loadNormalizedResultsConfig,
  readRemoteRunTagState,
  setRemoteRunTags,
  syncRemoteResults,
} from './remote.js';
import {
  type RunFinalState,
  type RunOplogWatermark,
  type RunReadStateFields,
  materializeRunState,
} from './run-oplog.js';
import { readRunTags, writeRunTags } from './run-tags.js';
import { type StudioConfig, loadStudioConfig, saveStudioConfig } from './studio-config.js';

// ── Source resolution ────────────────────────────────────────────────────

/**
 * Dashboard has one run source per project: the project's
 * `.agentv/results/runs/` tree plus any `results:` repo configured for that
 * project. Direct run workspaces and index manifests are supported by
 * `agentv results report`, not the live Dashboard server.
 */
const DIRECT_DASHBOARD_SOURCE_GUIDANCE = [
  'Dashboard reads configured project run sources only.',
  'Run it from a project root, or pass --dir so Dashboard uses <project>/.agentv/results/runs/:',
  '  agentv dashboard --dir <project-dir>',
  'To browse external results, configure results.repo_url or results.repo_path in config YAML.',
  'For a one-off run bundle, use: agentv results report <run-workspace-or-index.jsonl>',
].join('\n');

function unsupportedDashboardSourceError(source: string, cwd: string): Error {
  const resolved = path.isAbsolute(source) ? source : path.resolve(cwd, source);
  return new Error(
    `Unsupported Dashboard source: ${resolved}\n${DIRECT_DASHBOARD_SOURCE_GUIDANCE}`,
  );
}

/**
 * Resolve a canonical project run manifest path from run cache or directory
 * scan. Throws if an unsupported direct source is provided or no run workspace
 * can be found.
 */
export async function resolveSourceFile(source: string | undefined, cwd: string): Promise<string> {
  if (source) {
    throw unsupportedDashboardSourceError(source, cwd);
  }

  // Prefer cache pointer, fall back to directory scan
  const cache = await loadRunCache(cwd);
  const cachedFile = cache ? resolveRunCacheFile(cache) : '';
  if (cachedFile && existsSync(cachedFile)) {
    return cachedFile;
  }

  const metas = listResultFiles(cwd, 10);
  if (metas.length === 0) {
    throw new Error(
      'No run workspaces found in .agentv/results/runs/\nRun an evaluation first: agentv eval <eval-file>',
    );
  }
  if (metas.length > 1) {
    console.log('Available run workspaces:');
    for (const m of metas) {
      console.log(`  ${m.path}`);
    }
    console.log(`\nServing most recent: ${metas[0].path}\n`);
  }
  return metas[0].path;
}

// ── JSONL parsing ────────────────────────────────────────────────────────

/**
 * Parse JSONL content into EvaluationResult[].
 */
export function loadResults(content: string): EvaluationResult[] {
  const results = parseJsonlResults(content);
  if (results.length === 0) {
    throw new Error('No valid results found in JSONL content');
  }

  return results;
}

export function resolveDashboardMode(
  _projectCount: number,
  options: { single?: boolean },
): { projectDashboard: boolean } {
  if (options.single === true) {
    return { projectDashboard: false };
  }

  return { projectDashboard: true };
}

function bootstrapCurrentProject(
  cwd: string,
  options: { single?: boolean },
): { currentProjectId?: string } {
  if (options.single === true) return {};
  if (!existsSync(path.join(cwd, '.agentv'))) return {};

  const entry = addProject(cwd);
  touchProject(entry.id);
  return { currentProjectId: entry.id };
}

// ── Feedback persistence ─────────────────────────────────────────────────

interface FeedbackReview {
  test_id: string;
  comment: string;
  updated_at: string;
}

interface FeedbackData {
  reviews: FeedbackReview[];
}

function feedbackPath(resultDir: string): string {
  return path.join(resultDir, 'feedback.json');
}

function readFeedback(cwd: string): FeedbackData {
  const fp = feedbackPath(cwd);
  if (!existsSync(fp)) {
    return { reviews: [] };
  }
  try {
    return JSON.parse(readFileSync(fp, 'utf8')) as FeedbackData;
  } catch (err) {
    console.error(`Warning: could not parse ${fp}, starting fresh: ${(err as Error).message}`);
    return { reviews: [] };
  }
}

function writeFeedback(cwd: string, data: FeedbackData): void {
  writeFileSync(feedbackPath(cwd), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ── Shared utilities (used by handler functions) ─────────────────────────

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

function buildFileTree(dirPath: string, relativeTo: string): FileNode[] {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return [];
  }
  const entries = readdirSync(dirPath, { withFileTypes: true });
  return entries
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(relativeTo, fullPath);
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relPath,
          type: 'dir' as const,
          children: buildFileTree(fullPath, relativeTo),
        };
      }
      return { name: entry.name, path: relPath, type: 'file' as const };
    });
}

function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.json': 'json',
    '.jsonl': 'json',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.log': 'plaintext',
    '.txt': 'plaintext',
    '.py': 'python',
    '.sh': 'shell',
    '.bash': 'shell',
    '.css': 'css',
    '.html': 'html',
    '.xml': 'xml',
    '.svg': 'xml',
    '.toml': 'toml',
    '.diff': 'diff',
    '.patch': 'diff',
  };
  return langMap[ext] ?? 'plaintext';
}

function inferRawContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json; charset=utf-8';
  // Raw artifact links should be inspectable in a tab instead of rendered as
  // same-origin HTML/SVG. The explicit ?download=1 path adds
  // Content-Disposition for users that want a file.
  if (ext === '.jsonl') return 'text/plain; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function contentDispositionFilename(filePath: string): string {
  return path.basename(filePath).replace(/["\\\r\n]/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function artifactPointerPath(pointer: unknown): string | undefined {
  if (typeof pointer === 'string') return nonEmptyString(pointer);
  if (!isRecord(pointer)) return undefined;
  return (
    nonEmptyString(pointer.path) ??
    nonEmptyString(pointer.artifact_path) ??
    nonEmptyString(pointer.relative_path)
  );
}

function artifactPointerDescription(pointer: unknown): string | undefined {
  if (typeof pointer === 'string') return pointer;
  if (!isRecord(pointer)) return undefined;
  const ref = nonEmptyString(pointer.ref);
  const storage = nonEmptyString(pointer.storage);
  const uri = nonEmptyString(pointer.uri) ?? nonEmptyString(pointer.href);
  const pointerPath = artifactPointerPath(pointer);
  const parts = [
    ref ? `ref ${ref}` : undefined,
    storage ? `storage ${storage}` : undefined,
    uri ? `uri ${uri}` : undefined,
    pointerPath ? `path ${pointerPath}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function artifactPointerRef(pointer: unknown): string | undefined {
  return isRecord(pointer) ? nonEmptyString(pointer.ref) : undefined;
}

function artifactPointerKey(pointer: unknown): string | undefined {
  return isRecord(pointer) ? nonEmptyString(pointer.key) : undefined;
}

function artifactPointerSha256(pointer: unknown): string | undefined {
  return isRecord(pointer) ? nonEmptyString(pointer.sha256) : undefined;
}

function artifactPointerObjectVersion(pointer: unknown): string | undefined {
  return isRecord(pointer) ? nonEmptyString(pointer.object_version) : undefined;
}

interface ResolvedArtifactPointer {
  readonly path?: string;
  readonly key?: string;
  readonly description?: string;
  readonly ref?: string;
  readonly sha256?: string;
  readonly objectVersion?: string;
  readonly unsupportedReason?: string;
}

function resolveRecordArtifactPointer(
  record: ResultManifestRecord,
  kind: 'transcript' | 'answer' | 'trace',
): ResolvedArtifactPointer {
  const pointer =
    kind === 'transcript'
      ? (record.transcript ?? record.artifacts?.transcript ?? record.artifact_pointers?.transcript)
      : kind === 'trace'
        ? (record.artifact_pointers?.trace ?? record.artifacts?.trace)
        : record.artifacts?.answer;
  const pointerPath = artifactPointerPath(pointer);
  const description = artifactPointerDescription(pointer);
  const ref = artifactPointerRef(pointer);
  const key = artifactPointerKey(pointer);
  const sha256 = artifactPointerSha256(pointer);
  const objectVersion = artifactPointerObjectVersion(pointer);
  if ((kind === 'transcript' || kind === 'trace') && pointerPath) {
    return {
      path: pointerPath,
      description,
      ref,
      ...(key && { key }),
      ...(sha256 && { sha256 }),
      ...(objectVersion && { objectVersion }),
    };
  }

  const recordWithTrace = record as ResultManifestRecord & { readonly trace_path?: string };
  const directPath =
    kind === 'transcript'
      ? (record.transcript_path ?? record.artifacts?.transcript_path)
      : kind === 'trace'
        ? (recordWithTrace.trace_path ?? nonEmptyString(record.artifacts?.trace_path))
        : (record.answer_path ?? record.artifacts?.answer_path ?? record.output_path);
  if (directPath) {
    return { path: directPath, description: directPath };
  }

  if (pointerPath) {
    return {
      path: pointerPath,
      description,
      ref,
      ...(key && { key }),
      ...(sha256 && { sha256 }),
      ...(objectVersion && { objectVersion }),
    };
  }
  if (pointer) {
    return {
      description,
      ref,
      ...(key && { key }),
      ...(sha256 && { sha256 }),
      ...(objectVersion && { objectVersion }),
      unsupportedReason: description
        ? `${kind} artifact pointer does not include a local path (${description}).`
        : `${kind} artifact pointer does not include a local path.`,
    };
  }
  return {};
}

function resolveRunArtifactPath(
  baseDir: string,
  relativePath: string,
): { absolutePath?: string; error?: string } {
  const absolutePath = path.resolve(baseDir, relativePath);
  const resolvedBase = path.resolve(baseDir);
  if (!isPathInsideDirectory(resolvedBase, absolutePath)) {
    return { error: 'Artifact path is outside the run workspace.' };
  }
  return { absolutePath };
}

function isPathInsideDirectory(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function resolveReadableRunArtifactFile(
  baseDir: string,
  relativePath: string,
): { absolutePath?: string; error?: string } {
  const resolved = resolveRunArtifactPath(baseDir, relativePath);
  if (!resolved.absolutePath) return { error: resolved.error };

  let realBase: string;
  let realArtifact: string;
  try {
    realBase = realpathSync(baseDir);
    realArtifact = realpathSync(resolved.absolutePath);
  } catch {
    return {};
  }

  if (!isPathInsideDirectory(realBase, realArtifact)) {
    return { error: 'Artifact path is outside the run workspace.' };
  }

  try {
    if (!statSync(realArtifact).isFile()) {
      return {};
    }
  } catch {
    return {};
  }

  return { absolutePath: realArtifact };
}

function readOptionalRunArtifactText(
  baseDir: string,
  artifact: ResolvedArtifactPointer,
): string | undefined {
  if (!artifact.path) return undefined;
  const resolved = resolveReadableRunArtifactFile(baseDir, artifact.path);
  if (!resolved.absolutePath) return undefined;
  return readFileSync(resolved.absolutePath, 'utf8');
}

function normalizeArtifactRelativePath(relativePath: string): string | undefined {
  const normalized = relativePath.split(path.sep).join('/');
  const segments = normalized.split('/').filter(Boolean);
  if (
    segments.length === 0 ||
    normalized.startsWith('/') ||
    segments.some((segment) => segment === '..')
  ) {
    return undefined;
  }
  return segments.join('/');
}

function relativeRunPathFromManifest(repoDir: string, manifestPath: string): string | undefined {
  const relativeManifestPath = path.relative(repoDir, manifestPath).split(path.sep).join('/');
  if (
    relativeManifestPath.length === 0 ||
    relativeManifestPath === manifestPath ||
    relativeManifestPath.startsWith('../')
  ) {
    return undefined;
  }

  const parts = relativeManifestPath.split('/').filter(Boolean);
  const runsIndex = parts.lastIndexOf('runs');
  if (runsIndex === -1 || parts.at(-1) !== 'index.jsonl') {
    return undefined;
  }
  const runParts = parts.slice(runsIndex + 1, -1);
  return runParts.length > 0 ? runParts.join('/') : undefined;
}

function sidecarArtifactKeyForPointer(
  repoDir: string,
  manifestPath: string,
  artifact: ResolvedArtifactPointer,
): string | undefined {
  const publishedKey = artifact.key ? normalizeArtifactRelativePath(artifact.key) : undefined;
  if (publishedKey?.startsWith('runs/')) {
    return publishedKey;
  }
  if (!artifact.path) {
    return undefined;
  }
  const relativeArtifactPath = normalizeArtifactRelativePath(artifact.path);
  const relativeRunPath = relativeRunPathFromManifest(repoDir, manifestPath);
  if (!relativeArtifactPath || !relativeRunPath) {
    return undefined;
  }
  return ['runs', relativeRunPath, relativeArtifactPath].join('/');
}

async function readSidecarArtifactText(
  searchDir: string,
  projectId: string | undefined,
  meta: SourcedResultFileMeta,
  artifact: ResolvedArtifactPointer,
): Promise<string | undefined> {
  if (artifact.ref !== AGENTV_RESULTS_ARTIFACTS_REF) {
    return undefined;
  }
  const config = await loadNormalizedResultsConfig(searchDir, projectId);
  if (!config) {
    return undefined;
  }
  const key = sidecarArtifactKeyForPointer(config.path, meta.path, artifact);
  if (!key) {
    return undefined;
  }
  const bytes = await readGitResultArtifact({
    repoDir: config.path,
    key,
    ref: AGENTV_RESULTS_ARTIFACTS_REF,
    remote: config.remote,
    ...(artifact.sha256 && { sha256: artifact.sha256 }),
    ...(artifact.objectVersion && { objectVersion: artifact.objectVersion }),
  });
  return bytes?.toString('utf8');
}

function artifactFileContentResponse(c: C, filePath: string, fileContent: string) {
  if (c.req.query('raw') === '1' || c.req.query('download') === '1') {
    c.header('Content-Type', inferRawContentType(filePath));
    if (c.req.query('download') === '1') {
      c.header(
        'Content-Disposition',
        `attachment; filename="${contentDispositionFilename(filePath)}"`,
      );
    }
    return c.body(fileContent);
  }
  const language = inferLanguage(filePath);
  return c.json({ content: fileContent, language });
}

function missingTranscriptMessage(): string {
  return [
    'This result does not include canonical outputs/transcript.jsonl metadata.',
    'Dashboard does not parse response.md or markdown transcripts for this view.',
  ].join(' ');
}

function stripHeavyFields(results: readonly EvaluationResult[]) {
  return results.map((r) => {
    const { requests, trace, ...rest } = r as EvaluationResult & Record<string, unknown>;
    const toolCalls =
      trace?.toolCalls && Object.keys(trace.toolCalls).length > 0 ? trace.toolCalls : undefined;
    const graderDurationMs = (r.scores ?? []).reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    return {
      ...rest,
      ...(toolCalls && { _toolCalls: toolCalls }),
      ...(graderDurationMs > 0 && { _graderDurationMs: graderDurationMs }),
    };
  });
}

// ── Shared data-route handlers ───────────────────────────────────────────
//
// Each handler takes a Hono Context and a DataContext (resolved directories).
// Both unscoped and project-scoped routes call the same handler, differing
// only in how the DataContext is constructed.

interface DataContext {
  searchDir: string;
  agentvDir: string;
  projectId?: string;
}

interface RunTagFields {
  readonly tags?: string[];
  readonly remote_tags?: string[];
  readonly pending_tags?: string[];
  readonly metadata_dirty?: boolean;
  readonly final_state: RunFinalState;
  readonly oplog_watermark: RunOplogWatermark;
}

// biome-ignore lint/suspicious/noExplicitAny: Hono Context generic varies by route
type C = Context<any, any, any>;

function inferExperimentFromRunId(runId: string): string | undefined {
  const separatorIndex = runId.lastIndexOf('::');
  if (separatorIndex === -1) {
    return undefined;
  }
  const experiment = runId.slice(0, separatorIndex).trim();
  if (!experiment || experiment === 'default') {
    return undefined;
  }
  return experiment;
}

async function readRunTagFields(
  searchDir: string,
  meta: SourcedResultFileMeta,
  projectId?: string,
): Promise<RunTagFields> {
  if (meta.source === 'local') {
    const tagsEntry = readRunTags(meta.path);
    const runState = materializeRunState({
      tags: tagsEntry?.tags ?? [],
      watermark: tagsEntry?.oplog_watermark,
      updatedAt: tagsEntry?.updated_at || undefined,
    });
    return {
      ...(tagsEntry ? { tags: tagsEntry.tags } : {}),
      ...runState,
    };
  }

  const state = await readRemoteRunTagState(searchDir, meta, projectId);
  if (!state) {
    return {
      tags: [],
      remote_tags: [],
      metadata_dirty: false,
      ...materializeRunState({ tags: [] }),
    };
  }

  return {
    tags: state.tags,
    remote_tags: state.remoteTags,
    metadata_dirty: state.dirty,
    ...(state.dirty && { pending_tags: state.pendingTags ?? state.tags }),
    ...materializeRunState({
      tags: state.tags,
      watermark: state.oplogWatermark,
      updatedAt: state.updatedAt,
    }),
  };
}

function remoteTagMutationResponse(state: {
  readonly tags: string[];
  readonly remoteTags: string[];
  readonly pendingTags?: string[];
  readonly dirty: boolean;
  readonly updatedAt?: string;
  readonly oplogWatermark: RunOplogWatermark;
}) {
  return {
    tags: state.tags,
    remote_tags: state.remoteTags,
    metadata_dirty: state.dirty,
    ...(state.dirty && { pending_tags: state.pendingTags ?? state.tags }),
    ...materializeRunState({
      tags: state.tags,
      watermark: state.oplogWatermark,
      updatedAt: state.updatedAt,
    }),
    updated_at: state.updatedAt ?? new Date().toISOString(),
  };
}

function localTagMutationResponse(input: {
  readonly tags: readonly string[];
  readonly updatedAt?: string;
  readonly watermark?: RunOplogWatermark;
}): RunReadStateFields {
  return materializeRunState({
    tags: input.tags,
    watermark: input.watermark,
    updatedAt: input.updatedAt,
  });
}

function remoteMetadataErrorStatus(error: unknown): 400 | 409 {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('not configured') ||
    message.includes('not a writable git checkout') ||
    message.includes('outside the results repo runs directory')
  ) {
    return 409;
  }
  return 400;
}

async function ensureRunReadable(
  searchDir: string,
  meta: SourcedResultFileMeta,
  projectId?: string,
): Promise<void> {
  await ensureRemoteRunAvailable(searchDir, meta, projectId);
}

async function loadManifestResultsForMeta(
  searchDir: string,
  meta: SourcedResultFileMeta,
  projectId?: string,
): Promise<EvaluationResult[]> {
  await ensureRunReadable(searchDir, meta, projectId);
  return loadManifestResults(meta.path, { hydrateTranscriptTrace: false });
}

async function loadLightweightResultsForMeta(
  searchDir: string,
  meta: SourcedResultFileMeta,
  projectId?: string,
): Promise<ReturnType<typeof loadLightweightResults>> {
  await ensureRunReadable(searchDir, meta, projectId);
  return loadLightweightResults(meta.path);
}

async function parseManifestForMeta(
  searchDir: string,
  meta: SourcedResultFileMeta,
  projectId?: string,
): Promise<ReturnType<typeof parseResultManifest>> {
  await ensureRunReadable(searchDir, meta, projectId);
  return parseResultManifest(readFileSync(meta.path, 'utf8'));
}

const DEFAULT_RUN_PAGE_LIMIT = 50;

function parseRunPageLimit(limitParam: string | undefined): number | undefined | null {
  if (limitParam === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(limitParam)) {
    return null;
  }
  const limit = Number.parseInt(limitParam, 10);
  return limit > 0 ? limit : null;
}

function hasUsableTimestamp(timestamp: string | undefined): boolean {
  return !!timestamp && timestamp !== 'unknown' && !Number.isNaN(new Date(timestamp).getTime());
}

function compareRunsByTimestampDesc<T extends { timestamp: string; filename: string }>(
  a: T,
  b: T,
): number {
  const aTime = hasUsableTimestamp(a.timestamp) ? new Date(a.timestamp).getTime() : null;
  const bTime = hasUsableTimestamp(b.timestamp) ? new Date(b.timestamp).getTime() : null;

  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return bTime - aTime;
  }
  if (aTime !== null && bTime === null) return -1;
  if (aTime === null && bTime !== null) return 1;

  return b.filename.localeCompare(a.filename);
}

interface QualitySummaryInput {
  readonly score: number;
  readonly executionStatus?: string;
}

interface QualitySummaryStats {
  readonly totalCount: number;
  readonly qualityCount: number;
  readonly passedCount: number;
  readonly qualityFailureCount: number;
  readonly executionErrorCount: number;
  readonly scoreSum: number;
  readonly passRate: number;
  readonly avgScore: number;
}

function isExecutionErrorResult(result: QualitySummaryInput): boolean {
  return result.executionStatus === 'execution_error';
}

function summarizeQualityResults(
  results: readonly QualitySummaryInput[],
  passThreshold: number,
): QualitySummaryStats {
  let qualityCount = 0;
  let passedCount = 0;
  let executionErrorCount = 0;
  let scoreSum = 0;

  for (const result of results) {
    if (isExecutionErrorResult(result)) {
      executionErrorCount++;
      continue;
    }

    qualityCount++;
    scoreSum += result.score;
    if (result.score >= passThreshold) {
      passedCount++;
    }
  }

  const qualityFailureCount = qualityCount - passedCount;
  return {
    totalCount: results.length,
    qualityCount,
    passedCount,
    qualityFailureCount,
    executionErrorCount,
    scoreSum,
    passRate: qualityCount > 0 ? passedCount / qualityCount : 0,
    avgScore: qualityCount > 0 ? scoreSum / qualityCount : 0,
  };
}

function paginateRuns<T extends { filename: string }>(
  runs: T[],
  cursor: string | undefined,
  limit: number | undefined,
): { runs: T[]; nextCursor?: string } {
  if (limit === undefined) {
    return { runs };
  }

  if (!cursor) {
    const page = runs.slice(0, limit);
    return {
      runs: page,
      ...(limit < runs.length && page.length > 0 ? { nextCursor: page.at(-1)?.filename } : {}),
    };
  }

  const cursorIndex = runs.findIndex((run) => run.filename === cursor);
  if (cursorIndex === -1) {
    return { runs: [] };
  }

  const page = runs.slice(cursorIndex + 1, cursorIndex + 1 + limit);
  return {
    runs: page,
    ...(cursorIndex + 1 + limit < runs.length && page.length > 0
      ? { nextCursor: page.at(-1)?.filename }
      : {}),
  };
}

async function handleRuns(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir, undefined, projectId);
  const { threshold: passThreshold } = loadStudioConfig(agentvDir);
  const parsedLimit = parseRunPageLimit(c.req.query('limit'));
  if (parsedLimit === null) {
    return c.json({ error: 'limit must be a positive integer' }, 400);
  }

  const cursor = c.req.query('cursor');
  const limit = parsedLimit ?? (cursor ? DEFAULT_RUN_PAGE_LIMIT : undefined);
  const runs = await Promise.all(
    metas.map(async (m) => {
      let target: string | undefined;
      let experiment = inferExperimentFromRunId(m.raw_filename);
      let timestamp = m.timestamp;
      let testCount = m.testCount;
      let passRate = m.passRate;
      let avgScore = m.avgScore;
      let executionErrorCount = 0;
      try {
        const records = await loadLightweightResultsForMeta(searchDir, m, projectId);
        if (records.length > 0) {
          const qualitySummary = summarizeQualityResults(records, passThreshold);
          target = records[0].target;
          experiment = records[0].experiment ?? experiment;
          timestamp =
            hasUsableTimestamp(timestamp) || !records[0].timestamp
              ? timestamp
              : records[0].timestamp;
          testCount = qualitySummary.totalCount;
          passRate = qualitySummary.passRate;
          avgScore = qualitySummary.avgScore;
          executionErrorCount = qualitySummary.executionErrorCount;
        } else {
          // Run is in-progress with 0 results written yet — fall back to the
          // in-memory target stored when the Dashboard launched this run.
          target = getActiveRunTarget(m.path);
        }
      } catch {
        // ignore enrichment errors
      }
      // Surface live status for Dashboard-launched runs that are still starting
      // or running so the RunList can render a spinner instead of the
      // pass/fail dot derived from a 0% pass rate.
      const liveStatus = getActiveRunStatus(m.path);
      const tagFields = await readRunTagFields(searchDir, m, projectId);
      return {
        filename: m.filename,
        display_name: m.displayName,
        path: m.path,
        timestamp,
        test_count: testCount,
        pass_rate: passRate,
        avg_score: avgScore,
        execution_error_count: executionErrorCount,
        size_bytes: m.sizeBytes,
        source: m.source,
        on_remote: m.on_remote,
        ...(target && { target }),
        ...(experiment && { experiment }),
        ...tagFields,
        ...(liveStatus && { status: liveStatus }),
      };
    }),
  );
  runs.sort(compareRunsByTimestampDesc);
  const page = paginateRuns(runs, cursor, limit);
  return c.json({
    runs: page.runs,
    ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
  });
}

async function handleRunLog(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  if (meta.source === 'remote') {
    return c.json({ error: 'Run log is not available for remote runs' }, 404);
  }
  const logPath = path.join(path.dirname(meta.path), 'console.log');
  if (!existsSync(logPath)) {
    return c.json({ error: 'Run log not found for this run' }, 404);
  }
  try {
    const content = readFileSync(logPath, 'utf8');
    return c.text(content);
  } catch {
    return c.json({ error: 'Failed to read run log' }, 500);
  }
}

async function handleRunDetail(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = await loadManifestResultsForMeta(searchDir, meta, projectId);
    // Surface run_dir + suite_filter for local runs so the UI can launch a
    // Dashboard-side resume against this exact run. Remote runs live in the
    // results-repo cache and cannot be resumed in place, so omit both fields.
    const resumeMeta = meta.source === 'local' ? deriveResumeMeta(searchDir, meta.path) : {};
    const liveStatus = meta.source === 'local' ? getActiveRunStatus(meta.path) : undefined;
    const tagFields = await readRunTagFields(searchDir, meta, projectId);
    return c.json({
      results: stripHeavyFields(loaded),
      source: meta.source,
      source_label: meta.displayName,
      ...tagFields,
      ...(liveStatus && { status: liveStatus }),
      ...resumeMeta,
    });
  } catch {
    return c.json({ error: 'Failed to load run' }, 500);
  }
}

/**
 * Compute `run_dir` (relative to cwd, snake_case) and `suite_filter` (the
 * eval file path stored in benchmark.json metadata) for a local run manifest.
 * Returns whatever fields could be resolved — both are best-effort and only
 * needed by the Dashboard "Resume run" / "Rerun failed" actions.
 */
function deriveResumeMeta(
  cwd: string,
  manifestPath: string,
): { run_dir?: string; suite_filter?: string; planned_test_count?: number } {
  const out: { run_dir?: string; suite_filter?: string; planned_test_count?: number } = {};
  const runDir = path.dirname(manifestPath);
  const relative = path.relative(cwd, runDir);
  // path.relative returns '..'-prefixed paths when runDir is outside cwd; keep
  // those absolute so the CLI doesn't get confused. An empty string ('' = same
  // dir as cwd) is unusual but valid — fall through to absolute in that case.
  out.run_dir = relative !== '' && !relative.startsWith('..') ? relative : runDir;
  try {
    const benchmarkPath = path.join(runDir, 'benchmark.json');
    if (existsSync(benchmarkPath)) {
      const parsed = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as {
        metadata?: { eval_file?: string; planned_test_count?: number };
      };
      const evalFile = parsed.metadata?.eval_file;
      if (typeof evalFile === 'string' && evalFile.trim()) {
        out.suite_filter = evalFile.trim();
      }
      const planned = parsed.metadata?.planned_test_count;
      if (typeof planned === 'number' && Number.isFinite(planned) && planned > 0) {
        out.planned_test_count = planned;
      }
    }
  } catch {
    // benchmark.json missing / unreadable / malformed — leave fields unset.
  }
  return out;
}

async function handleRunSuites(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = await loadManifestResultsForMeta(searchDir, meta, projectId);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const suiteMap = new Map<string, EvaluationResult[]>();
    for (const r of loaded) {
      const ds = r.suite ?? r.target ?? 'default';
      const entry = suiteMap.get(ds) ?? [];
      entry.push(r);
      suiteMap.set(ds, entry);
    }
    const suites = [...suiteMap.entries()].map(([name, entry]) => {
      const qualitySummary = summarizeQualityResults(entry, pass_threshold);
      return {
        name,
        total: qualitySummary.totalCount,
        passed: qualitySummary.passedCount,
        failed: qualitySummary.qualityFailureCount,
        avg_score: qualitySummary.avgScore,
        execution_error_count: qualitySummary.executionErrorCount,
      };
    });
    return c.json({ suites });
  } catch {
    return c.json({ error: 'Failed to load suites' }, 500);
  }
}

async function handleRunCategories(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = await loadManifestResultsForMeta(searchDir, meta, projectId);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const categoryMap = new Map<string, { results: EvaluationResult[]; suites: Set<string> }>();
    for (const r of loaded) {
      const cat = r.category ?? DEFAULT_CATEGORY;
      const entry = categoryMap.get(cat) ?? {
        results: [],
        suites: new Set<string>(),
      };
      entry.results.push(r);
      entry.suites.add(r.suite ?? r.target ?? 'default');
      categoryMap.set(cat, entry);
    }
    const categories = [...categoryMap.entries()].map(([name, entry]) => {
      const qualitySummary = summarizeQualityResults(entry.results, pass_threshold);
      return {
        name,
        total: qualitySummary.totalCount,
        passed: qualitySummary.passedCount,
        failed: qualitySummary.qualityFailureCount,
        avg_score: qualitySummary.avgScore,
        execution_error_count: qualitySummary.executionErrorCount,
        suite_count: entry.suites.size,
      };
    });
    return c.json({ categories });
  } catch {
    return c.json({ error: 'Failed to load categories' }, 500);
  }
}

async function handleCategorySuites(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const category = decodeURIComponent(c.req.param('category') ?? '');
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = await loadManifestResultsForMeta(searchDir, meta, projectId);
    const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
    const filtered = loaded.filter((r) => (r.category ?? DEFAULT_CATEGORY) === category);
    const suiteMap = new Map<string, EvaluationResult[]>();
    for (const r of filtered) {
      const ds = r.suite ?? r.target ?? 'default';
      const entry = suiteMap.get(ds) ?? [];
      entry.push(r);
      suiteMap.set(ds, entry);
    }
    const suites = [...suiteMap.entries()].map(([name, entry]) => {
      const qualitySummary = summarizeQualityResults(entry, pass_threshold);
      return {
        name,
        total: qualitySummary.totalCount,
        passed: qualitySummary.passedCount,
        failed: qualitySummary.qualityFailureCount,
        avg_score: qualitySummary.avgScore,
        execution_error_count: qualitySummary.executionErrorCount,
      };
    });
    return c.json({ suites });
  } catch {
    return c.json({ error: 'Failed to load suites' }, 500);
  }
}

async function handleEvalDetail(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const loaded = await loadManifestResultsForMeta(searchDir, meta, projectId);
    const result = loaded.find((r) => r.testId === evalId);
    if (!result) return c.json({ error: 'Eval not found' }, 404);
    const [stripped] = stripHeavyFields([result]);
    return c.json({ eval: stripped });
  } catch {
    return c.json({ error: 'Failed to load eval' }, 500);
  }
}

async function handleEvalFiles(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    const records = await parseManifestForMeta(searchDir, meta, projectId);
    const record = records.find((r) => r.test_id === evalId);
    if (!record) return c.json({ error: 'Eval not found' }, 404);

    const baseDir = path.dirname(meta.path);
    const transcriptArtifact = resolveRecordArtifactPointer(record, 'transcript');
    const answerArtifact = resolveRecordArtifactPointer(record, 'answer');
    const knownPaths = [
      record.grading_path,
      record.timing_path,
      record.input_path,
      record.output_path,
      record.response_path,
      record.answer_path,
      record.transcript_path,
      transcriptArtifact.path,
      answerArtifact.path,
      record.task_dir,
      record.eval_path,
      record.targets_path,
      record.files_path,
      record.graders_path,
    ].filter((p, index, all): p is string => !!p && all.indexOf(p) === index);

    if (knownPaths.length === 0) return c.json({ files: [] });

    const artifactDirs = knownPaths.map((p) => path.dirname(p));
    let commonDir = artifactDirs[0];
    for (const dir of artifactDirs) {
      while (!dir.startsWith(commonDir)) {
        commonDir = path.dirname(commonDir);
      }
    }

    const artifactAbsDir = path.join(baseDir, commonDir);
    const files = buildFileTree(artifactAbsDir, baseDir);
    return c.json({ files });
  } catch {
    return c.json({ error: 'Failed to load file tree' }, 500);
  }
}

async function handleEvalFileContent(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);

  // Extract the wildcard suffix without depending on decoded route params.
  const marker = '/files/';
  const markerIdx = c.req.path.indexOf(marker);
  const encodedFilePath = markerIdx >= 0 ? c.req.path.slice(markerIdx + marker.length) : '';
  let filePath = '';
  try {
    filePath = encodedFilePath ? decodeURIComponent(encodedFilePath) : '';
  } catch {
    return c.json({ error: 'Invalid file path encoding' }, 400);
  }

  if (!filePath) return c.json({ error: 'No file path specified' }, 400);

  await ensureRunReadable(searchDir, meta, projectId);
  const baseDir = path.dirname(meta.path);
  const resolvedFile = resolveReadableRunArtifactFile(baseDir, filePath);
  if (resolvedFile.error) {
    return c.json({ error: 'Path traversal not allowed' }, 403);
  }
  if (!resolvedFile.absolutePath) {
    const records = parseResultManifest(readFileSync(meta.path, 'utf8'));
    const record = records.find((r) => r.test_id === evalId);
    if (record) {
      const normalizedFilePath = normalizeArtifactRelativePath(filePath);
      const artifact = [
        resolveRecordArtifactPointer(record, 'trace'),
        resolveRecordArtifactPointer(record, 'transcript'),
      ].find((candidate) => {
        const pointerPath = candidate.path
          ? normalizeArtifactRelativePath(candidate.path)
          : undefined;
        return pointerPath !== undefined && pointerPath === normalizedFilePath;
      });
      if (artifact) {
        const sidecarContent = await readSidecarArtifactText(searchDir, projectId, meta, artifact);
        if (sidecarContent !== undefined) {
          return artifactFileContentResponse(c, filePath, sidecarContent);
        }
      }
    }
    return c.json({ error: 'File not found' }, 404);
  }

  try {
    const fileContent = readFileSync(resolvedFile.absolutePath, 'utf8');
    return artifactFileContentResponse(c, filePath, fileContent);
  } catch {
    return c.json({ error: 'Failed to read file' }, 500);
  }
}

async function handleEvalTranscript(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const evalId = c.req.param('evalId');
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);

  try {
    const records = await parseManifestForMeta(searchDir, meta, projectId);
    const record = records.find((r) => r.test_id === evalId);
    if (!record) return c.json({ error: 'Eval not found' }, 404);

    const baseDir = path.dirname(meta.path);
    const transcript = resolveRecordArtifactPointer(record, 'transcript');
    const answer = resolveRecordArtifactPointer(record, 'answer');

    if (!transcript.path) {
      return c.json({
        status: transcript.unsupportedReason ? 'unsupported' : 'missing',
        message: transcript.unsupportedReason ?? missingTranscriptMessage(),
        ...(transcript.description && { pointer: transcript.description }),
      });
    }

    const resolvedTranscript = resolveReadableRunArtifactFile(baseDir, transcript.path);
    if (resolvedTranscript.error) {
      return c.json({
        status: 'dangling',
        transcript_path: transcript.path,
        message: resolvedTranscript.error ?? 'Transcript artifact path could not be resolved.',
        ...(transcript.description && { pointer: transcript.description }),
      });
    }

    let content: string | undefined;
    if (resolvedTranscript.absolutePath) {
      content = readFileSync(resolvedTranscript.absolutePath, 'utf8');
    } else {
      content = await readSidecarArtifactText(searchDir, projectId, meta, transcript);
    }

    if (content === undefined) {
      const refMessage = transcript.ref ? ` on ${transcript.ref}` : '';
      return c.json({
        status: 'dangling',
        transcript_path: transcript.path,
        message: `Transcript artifact pointer${refMessage} is present, but ${transcript.path} is not available in this run workspace.`,
        ...(transcript.description && { pointer: transcript.description }),
      });
    }

    const answerContent = readOptionalRunArtifactText(baseDir, answer);

    return c.json({
      status: 'ok',
      transcript_path: transcript.path,
      content,
      language: inferLanguage(transcript.path),
      ...(answer.path && { answer_path: answer.path }),
      ...(answerContent !== undefined && { answer_content: answerContent }),
      ...(transcript.description && { pointer: transcript.description }),
    });
  } catch {
    return c.json({ error: 'Failed to load transcript artifact' }, 500);
  }
}

async function handleExperiments(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir, undefined, projectId);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
  const experimentMap = new Map<
    string,
    {
      targets: Set<string>;
      runFilenames: Set<string>;
      evalCount: number;
      qualityCount: number;
      passedCount: number;
      executionErrorCount: number;
      lastTimestamp: string;
    }
  >();

  for (const m of metas) {
    try {
      const records = await loadLightweightResultsForMeta(searchDir, m, projectId);
      for (const r of records) {
        const experiment = r.experiment ?? 'default';
        const entry = experimentMap.get(experiment) ?? {
          targets: new Set<string>(),
          runFilenames: new Set<string>(),
          evalCount: 0,
          qualityCount: 0,
          passedCount: 0,
          executionErrorCount: 0,
          lastTimestamp: '',
        };
        entry.runFilenames.add(m.filename);
        if (r.target) entry.targets.add(r.target);
        entry.evalCount++;
        if (isExecutionErrorResult(r)) {
          entry.executionErrorCount++;
        } else {
          entry.qualityCount++;
          if (r.score >= pass_threshold) entry.passedCount++;
        }
        if (r.timestamp && r.timestamp > entry.lastTimestamp) {
          entry.lastTimestamp = r.timestamp;
        }
        experimentMap.set(experiment, entry);
      }
    } catch {
      // skip runs that fail to load
    }
  }

  const experiments = [...experimentMap.entries()].map(([name, entry]) => ({
    name,
    run_count: entry.runFilenames.size,
    target_count: entry.targets.size,
    eval_count: entry.evalCount,
    quality_count: entry.qualityCount,
    passed_count: entry.passedCount,
    execution_error_count: entry.executionErrorCount,
    pass_rate: entry.qualityCount > 0 ? entry.passedCount / entry.qualityCount : 0,
    last_run: entry.lastTimestamp || null,
  }));

  return c.json({ experiments });
}

async function handleCompare(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir, undefined, projectId);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);

  // Optional tag filter: `?tags=baseline,v2-prompt` keeps only runs that
  // carry at least one of the given tags (OR semantics). Empty / missing
  // param is a no-op. Filtering is applied before aggregation so it
  // propagates through `cells[]`, `runs[]`, `experiments[]`, and
  // `targets[]` uniformly.
  const tagsParam = c.req.query('tags') ?? '';
  const filterTags = new Set(
    tagsParam
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  );

  type CompareTestEntry = {
    test_id: string;
    category?: string;
    score: number;
    passed: boolean;
    execution_status?: string;
  };

  // Collect per-test-case results keyed by experiment × target (aggregated view)
  const cellMap = new Map<
    string,
    {
      experiment: string;
      target: string;
      evalCount: number;
      qualityCount: number;
      passedCount: number;
      executionErrorCount: number;
      scoreSum: number;
      tests: CompareTestEntry[];
    }
  >();

  // Per-run entries (per-run view). Each run workspace contributes exactly
  // one entry, independent of the aggregated matrix.
  const runEntries: Array<{
    run_id: string;
    started_at: string;
    experiment: string;
    target: string;
    tags?: string[];
    remote_tags?: string[];
    pending_tags?: string[];
    metadata_dirty?: boolean;
    final_state: RunFinalState;
    oplog_watermark: RunOplogWatermark;
    source: 'local' | 'remote';
    eval_count: number;
    quality_count: number;
    passed_count: number;
    execution_error_count: number;
    pass_rate: number;
    avg_score: number;
    tests: CompareTestEntry[];
  }> = [];

  const experimentsSet = new Set<string>();
  const targetsSet = new Set<string>();
  const MAX_TESTS_PER_CELL = 100;

  for (const m of metas) {
    try {
      // Read tags before any heavy work so the `?tags=` filter can skip
      // non-matching runs without loading their JSONL records.
      const tagFields = await readRunTagFields(searchDir, m, projectId);
      if (filterTags.size > 0) {
        const runTags = tagFields.tags ?? [];
        if (!runTags.some((t) => filterTags.has(t))) continue;
      }

      const records = await loadLightweightResultsForMeta(searchDir, m, projectId);
      const runTestMap = new Map<string, CompareTestEntry>();
      let runEvalCount = 0;
      let runQualityCount = 0;
      let runPassedCount = 0;
      let runExecutionErrorCount = 0;
      let runScoreSum = 0;
      let runExperiment = 'default';
      let runTarget = 'default';
      let runStartedAt = m.timestamp;

      for (const r of records) {
        const experiment = r.experiment ?? 'default';
        const target = r.target ?? 'default';
        experimentsSet.add(experiment);
        targetsSet.add(target);
        runExperiment = experiment;
        runTarget = target;
        if (r.timestamp && r.timestamp < runStartedAt) runStartedAt = r.timestamp;

        const key = JSON.stringify([experiment, target]);
        const entry = cellMap.get(key) ?? {
          experiment,
          target,
          evalCount: 0,
          qualityCount: 0,
          passedCount: 0,
          executionErrorCount: 0,
          scoreSum: 0,
          tests: [],
        };
        const isExecutionError = isExecutionErrorResult(r);
        const passed = !isExecutionError && r.score >= pass_threshold;
        entry.evalCount++;
        if (isExecutionError) {
          entry.executionErrorCount++;
        } else {
          entry.qualityCount++;
          if (passed) entry.passedCount++;
          entry.scoreSum += r.score;
        }
        entry.tests.push({
          test_id: r.testId,
          ...(r.category && { category: r.category }),
          score: r.score,
          passed,
          execution_status: r.executionStatus,
        });
        cellMap.set(key, entry);

        // Per-run accumulation. Dedupe tests within the run by last-wins.
        runTestMap.set(r.testId, {
          test_id: r.testId,
          ...(r.category && { category: r.category }),
          score: r.score,
          passed,
          execution_status: r.executionStatus,
        });
        runEvalCount++;
        if (isExecutionError) {
          runExecutionErrorCount++;
        } else {
          runQualityCount++;
          if (passed) runPassedCount++;
          runScoreSum += r.score;
        }
      }

      if (runEvalCount === 0) continue;

      const runTests = [...runTestMap.values()].slice(-MAX_TESTS_PER_CELL);
      runEntries.push({
        run_id: m.filename,
        started_at: runStartedAt,
        experiment: runExperiment,
        target: runTarget,
        ...tagFields,
        source: m.source,
        eval_count: runEvalCount,
        quality_count: runQualityCount,
        passed_count: runPassedCount,
        execution_error_count: runExecutionErrorCount,
        pass_rate: runQualityCount > 0 ? runPassedCount / runQualityCount : 0,
        avg_score: runQualityCount > 0 ? runScoreSum / runQualityCount : 0,
        tests: runTests,
      });
    } catch {
      // skip runs that fail to load
    }
  }

  // ── Baseline delta / normalized-gain computation ─────────────────────
  const baselineTarget = c.req.query('baseline') ?? '';
  if (baselineTarget && !targetsSet.has(baselineTarget)) {
    return c.json({ error: `Baseline target "${baselineTarget}" does not exist in the data` }, 400);
  }

  // Build baseline lookup before constructing cells so we can include
  // delta/normalized_gain in the initial cell objects (no mutation needed).
  const baselineScores = new Map<string, number>();
  if (baselineTarget) {
    for (const entry of cellMap.values()) {
      if (entry.target === baselineTarget && entry.qualityCount > 0) {
        baselineScores.set(entry.experiment, entry.scoreSum / entry.qualityCount);
      }
    }
  }

  const cells = [...cellMap.values()].map((entry) => {
    // Deduplicate tests: keep only the latest entry per test_id (last wins by insertion order)
    const dedupMap = new Map<string, (typeof entry.tests)[number]>();
    for (const t of entry.tests) {
      dedupMap.set(t.test_id, t);
    }
    const dedupedTests = [...dedupMap.values()];

    // Cap to most recent entries to prevent unbounded payloads
    const cappedTests = dedupedTests.slice(-MAX_TESTS_PER_CELL);

    const avgScore = entry.qualityCount > 0 ? entry.scoreSum / entry.qualityCount : 0;
    const cell: Record<string, unknown> = {
      experiment: entry.experiment,
      target: entry.target,
      eval_count: entry.evalCount,
      quality_count: entry.qualityCount,
      passed_count: entry.passedCount,
      execution_error_count: entry.executionErrorCount,
      pass_rate: entry.qualityCount > 0 ? entry.passedCount / entry.qualityCount : 0,
      avg_score: avgScore,
      tests: cappedTests,
    };

    // Append baseline comparison fields when a baseline is selected
    if (baselineTarget && entry.target !== baselineTarget) {
      const baseAvg = baselineScores.get(entry.experiment);
      if (baseAvg !== undefined) {
        cell.delta = Math.round((avgScore - baseAvg) * 1000) / 1000;
        cell.normalized_gain =
          baseAvg >= 1.0 ? null : Math.round(((avgScore - baseAvg) / (1 - baseAvg)) * 1000) / 1000;
      }
    }

    return cell;
  });

  // Per-run entries sorted by timestamp descending (newest first).
  runEntries.sort((a, b) => b.started_at.localeCompare(a.started_at));

  return c.json({
    experiments: [...experimentsSet].sort(),
    targets: [...targetsSet].sort(),
    cells,
    runs: runEntries,
  });
}

async function handleTargets(c: C, { searchDir, agentvDir, projectId }: DataContext) {
  const { runs: metas } = await listMergedResultFiles(searchDir, undefined, projectId);
  const { threshold: pass_threshold } = loadStudioConfig(agentvDir);
  const targetMap = new Map<
    string,
    {
      experiments: Set<string>;
      runFilenames: Set<string>;
      evalCount: number;
      qualityCount: number;
      passedCount: number;
      executionErrorCount: number;
    }
  >();

  for (const m of metas) {
    try {
      const records = await loadLightweightResultsForMeta(searchDir, m, projectId);
      for (const r of records) {
        const target = r.target ?? 'default';
        const entry = targetMap.get(target) ?? {
          experiments: new Set<string>(),
          runFilenames: new Set<string>(),
          evalCount: 0,
          qualityCount: 0,
          passedCount: 0,
          executionErrorCount: 0,
        };
        entry.runFilenames.add(m.filename);
        if (r.experiment) entry.experiments.add(r.experiment);
        entry.evalCount++;
        if (isExecutionErrorResult(r)) {
          entry.executionErrorCount++;
        } else {
          entry.qualityCount++;
          if (r.score >= pass_threshold) entry.passedCount++;
        }
        targetMap.set(target, entry);
      }
    } catch {
      // skip runs that fail to load
    }
  }

  const targets = [...targetMap.entries()].map(([name, entry]) => ({
    name,
    run_count: entry.runFilenames.size,
    experiment_count: entry.experiments.size,
    eval_count: entry.evalCount,
    quality_count: entry.qualityCount,
    passed_count: entry.passedCount,
    execution_error_count: entry.executionErrorCount,
    pass_rate: entry.qualityCount > 0 ? entry.passedCount / entry.qualityCount : 0,
  }));

  return c.json({ targets });
}

function handleConfig(
  c: C,
  { agentvDir, searchDir }: DataContext,
  options?: { readOnly?: boolean; projectDashboard?: boolean; currentProjectId?: string },
) {
  const config = loadStudioConfig(agentvDir);
  return c.json({
    threshold: config.threshold,
    app_name: config.appName,
    read_only: options?.readOnly === true,
    project_name: path.basename(searchDir),
    project_dashboard: options?.projectDashboard === true,
    ...(options?.currentProjectId && { current_project_id: options.currentProjectId }),
  });
}

function handleFeedbackRead(c: C, { searchDir }: DataContext) {
  return c.json(readFeedback(feedbackStoreDir(searchDir)));
}

function feedbackStoreDir(searchDir: string): string {
  const resultsDir = path.join(searchDir, '.agentv', 'results');
  return existsSync(resultsDir) ? resultsDir : searchDir;
}

async function handleFeedbackWrite(c: C, resultDir: string) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.reviews)) {
    return c.json({ error: 'Missing reviews array' }, 400);
  }

  const incoming = payload.reviews as Record<string, unknown>[];
  for (const review of incoming) {
    if (typeof review.test_id !== 'string' || typeof review.comment !== 'string') {
      return c.json({ error: 'Each review must have test_id and comment strings' }, 400);
    }
  }

  const existing = readFeedback(resultDir);
  const now = new Date().toISOString();

  for (const review of incoming) {
    const newReview: FeedbackReview = {
      test_id: review.test_id as string,
      comment: review.comment as string,
      updated_at: now,
    };

    const idx = existing.reviews.findIndex((r) => r.test_id === newReview.test_id);
    if (idx >= 0) {
      existing.reviews[idx] = newReview;
    } else {
      existing.reviews.push(newReview);
    }
  }

  writeFeedback(resultDir, existing);
  return c.json(existing);
}

function expandHomePath(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveBrowsePath(inputPath: string | undefined, cwd: string): string {
  const trimmed = inputPath?.trim() ?? '';
  const expanded = trimmed.length > 0 ? expandHomePath(trimmed) : cwd;
  return path.resolve(cwd, expanded);
}

function hasAgentvDir(dirPath: string): boolean {
  try {
    return statSync(path.join(dirPath, '.agentv')).isDirectory();
  } catch {
    return false;
  }
}

interface DirectoryBrowseEntry {
  name: string;
  path: string;
  hasAgentv: boolean;
}

interface DirectoryBrowseResult {
  path: string;
  parentPath?: string;
  current: DirectoryBrowseEntry;
  entries: DirectoryBrowseEntry[];
}

function directoryBrowseEntry(dirPath: string): DirectoryBrowseEntry {
  return {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    hasAgentv: hasAgentvDir(dirPath),
  };
}

function browseFilesystemDirectories(
  inputPath: string | undefined,
  cwd: string,
): DirectoryBrowseResult {
  const browsePath = resolveBrowsePath(inputPath, cwd);

  if (!existsSync(browsePath)) {
    throw new Error(`Directory not found: ${browsePath}`);
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(browsePath);
  } catch (err) {
    throw new Error(`Unable to read directory: ${(err as Error).message}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${browsePath}`);
  }

  let entries: DirectoryBrowseEntry[];
  try {
    entries = readdirSync(browsePath, { withFileTypes: true })
      .map((entry) => {
        const entryPath = path.join(browsePath, entry.name);
        if (entry.isDirectory()) return directoryBrowseEntry(entryPath);
        if (entry.isSymbolicLink()) {
          try {
            return statSync(entryPath).isDirectory() ? directoryBrowseEntry(entryPath) : null;
          } catch {
            return null;
          }
        }
        return null;
      })
      .filter((entry): entry is ReturnType<typeof directoryBrowseEntry> => entry !== null)
      .sort((a, b) => {
        if (a.hasAgentv !== b.hasAgentv) return a.hasAgentv ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    throw new Error(`Unable to read directory: ${(err as Error).message}`);
  }

  const parentPath = path.dirname(browsePath);
  return {
    path: browsePath,
    parentPath: parentPath !== browsePath ? parentPath : undefined,
    current: directoryBrowseEntry(browsePath),
    entries,
  };
}

function directoryBrowseEntryToWire(entry: DirectoryBrowseEntry) {
  return {
    name: entry.name,
    path: entry.path,
    has_agentv: entry.hasAgentv,
  };
}

function directoryBrowseResultToWire(result: DirectoryBrowseResult) {
  return {
    path: result.path,
    ...(result.parentPath !== undefined && { parent_path: result.parentPath }),
    current: directoryBrowseEntryToWire(result.current),
    entries: result.entries.map(directoryBrowseEntryToWire),
  };
}

async function handleRunTagsPut(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid payload' }, 400);
  }
  const tags = (body as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) {
    return c.json({ error: 'Missing tags array' }, 400);
  }
  try {
    if (meta.source === 'remote') {
      const state = await setRemoteRunTags(searchDir, meta, tags as string[], projectId);
      return c.json(remoteTagMutationResponse(state));
    }

    const entry = writeRunTags(meta.path, tags as string[]);
    const responseState = localTagMutationResponse({
      tags: entry?.tags ?? [],
      updatedAt: entry?.updated_at,
      watermark: entry?.oplog_watermark,
    });
    return c.json({
      tags: entry?.tags ?? [],
      ...responseState,
      updated_at: entry?.updated_at ?? new Date().toISOString(),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, remoteMetadataErrorStatus(err));
  }
}

async function handleRunTagsDelete(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  try {
    if (meta.source === 'remote') {
      const state = await clearRemoteRunTags(searchDir, meta, projectId);
      return c.json({
        ok: true,
        ...remoteTagMutationResponse(state),
      });
    }

    const entry = writeRunTags(meta.path, []);
    const responseState = localTagMutationResponse({
      tags: entry.tags,
      updatedAt: entry.updated_at,
      watermark: entry.oplog_watermark,
    });
    return c.json({
      ok: true,
      tags: entry.tags,
      ...responseState,
      updated_at: entry.updated_at,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, remoteMetadataErrorStatus(err));
  }
}

async function handleRunDelete(c: C, { searchDir, projectId }: DataContext) {
  const filename = c.req.param('filename') ?? '';
  const meta = await findRunById(searchDir, filename, projectId);
  if (!meta) return c.json({ error: 'Run not found' }, 404);
  if (meta.source === 'remote') {
    return c.json({ error: 'Run deletion is only available for local runs' }, 400);
  }
  if (getActiveRunStatus(meta.path) === 'starting' || getActiveRunStatus(meta.path) === 'running') {
    return c.json({ error: 'Run is still active' }, 409);
  }

  try {
    const deleted = deleteLocalRun(searchDir, filename);
    return c.json({ ok: true, run_id: deleted.runId });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

function getLocalRunsRoot(searchDir: string): string {
  return path.join(searchDir, '.agentv', 'results', 'runs');
}

function validateLocalCompletedRun(
  searchDir: string,
  meta: SourcedResultFileMeta,
  actionName = 'Run combine',
): { ok: true } | { error: string; status: 400 | 409 } {
  if (meta.source === 'remote') {
    return { error: `${actionName} is only available for local runs`, status: 400 };
  }
  if (getActiveRunStatus(meta.path) === 'starting' || getActiveRunStatus(meta.path) === 'running') {
    return { error: 'Run is still active', status: 409 };
  }

  const manifestPath = path.resolve(meta.path);
  if (path.basename(manifestPath) !== 'index.jsonl') {
    return { error: 'Run workspace is invalid', status: 400 };
  }

  const runDir = path.dirname(manifestPath);
  const runsRoot = path.resolve(getLocalRunsRoot(searchDir));
  if (runDir !== runsRoot && runDir.startsWith(`${runsRoot}${path.sep}`) && existsSync(runDir)) {
    return { ok: true };
  }
  return { error: 'Run workspace is outside the local results directory', status: 400 };
}

async function handleRunsCombine(c: C, { searchDir, projectId }: DataContext) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const payload = body as Record<string, unknown>;
  const runIds = payload.run_ids;
  if (!Array.isArray(runIds) || !runIds.every((id) => typeof id === 'string' && id.trim())) {
    return c.json({ error: 'Missing run_ids array' }, 400);
  }
  if (runIds.length < 2) {
    return c.json({ error: 'Select at least two runs to combine' }, 400);
  }
  const uniqueRunIds = new Set(runIds);
  if (uniqueRunIds.size !== runIds.length) {
    return c.json({ error: 'Duplicate run_ids are not allowed' }, 400);
  }
  const displayNameValue = payload.display_name;
  if (displayNameValue !== undefined && typeof displayNameValue !== 'string') {
    return c.json({ error: 'display_name must be a string' }, 400);
  }
  const duplicatePolicyValue = payload.duplicate_policy;
  const duplicatePolicy =
    duplicatePolicyValue === undefined ? 'error' : String(duplicatePolicyValue);
  if (duplicatePolicy !== 'error' && duplicatePolicy !== 'latest') {
    return c.json({ error: 'duplicate_policy must be error or latest' }, 400);
  }

  const displayName = displayNameValue?.trim();
  const metas: SourcedResultFileMeta[] = [];

  for (const runId of runIds) {
    const meta = await findRunById(searchDir, runId, projectId);
    if (!meta) return c.json({ error: `Run not found: ${runId}` }, 404);
    const safe = validateLocalCompletedRun(searchDir, meta);
    if ('error' in safe) return c.json({ error: safe.error }, safe.status);
    metas.push(meta);
  }

  try {
    const sources = buildCombineRunSources(
      metas.map((meta) => meta.path),
      searchDir,
      {
        ids: runIds,
        displayNames: metas.map((meta) => meta.displayName),
        tags: metas.map((meta) => readRunTags(meta.path)?.tags ?? []),
      },
    );
    const combined = combineRunSources({
      cwd: searchDir,
      sources,
      displayName,
      duplicatePolicy: duplicatePolicy as Exclude<CombineDuplicatePolicy, 'prompt'>,
    });
    const tagEntry =
      combined.tags.length > 0 ? writeRunTags(combined.manifestPath, combined.tags) : undefined;
    return c.json(
      {
        ok: true,
        run_id: combined.runId,
        display_name: combined.displayName,
        combined_from_run_ids: combined.combinedFromRunIds,
        duplicate_conflicts: combined.duplicateConflicts,
        ...(tagEntry && { tags: tagEntry.tags }),
      },
      201,
    );
  } catch (err) {
    if (err instanceof CombineDuplicateError) {
      return c.json({ error: err.message, duplicates: err.conflicts }, 409);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
}

// ── Hono app factory ─────────────────────────────────────────────────────

/**
 * Create a Hono app with dashboard, result picker, and feedback API routes.
 * Accepts an empty results array for the empty-state dashboard.
 */
export function createApp(
  results: EvaluationResult[],
  resultDir: string,
  cwd?: string,
  sourceFile?: string,
  options?: {
    studioDir?: string;
    readOnly?: boolean;
    projectDashboard?: boolean;
    currentProjectId?: string;
  },
): Hono {
  const searchDir = cwd ?? resultDir;
  const agentvDir = path.join(searchDir, '.agentv');
  const defaultCtx: DataContext = { searchDir, agentvDir, projectId: options?.currentProjectId };
  const readOnly = options?.readOnly === true;
  const app = new Hono();

  // ── Benchmark resolution wrapper ──────────────────────────────────────
  // Resolves projectId → DataContext, returning 404 if not found. The
  // registry is re-read on every request, so edits to config.yaml (or
  // POST /api/projects) take effect without restarting the server.
  function withProject(
    c: C,
    handler: (c: C, ctx: DataContext) => Response | Promise<Response>,
  ): Response | Promise<Response> {
    const project = getProject(c.req.param('projectId') ?? '');
    if (!project || !existsSync(project.path)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return handler(c, {
      searchDir: project.path,
      agentvDir: path.join(project.path, '.agentv'),
      projectId: project.id,
    });
  }

  // ── Dashboard configuration ──────────────────────────────────────────────

  app.post('/api/config', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    try {
      const body = await c.req.json<Partial<StudioConfig>>();
      const current = loadStudioConfig(agentvDir);
      const updated = { ...current, ...body };
      if (typeof updated.threshold === 'number') {
        updated.threshold = Math.min(1, Math.max(0, updated.threshold));
      }
      saveStudioConfig(agentvDir, updated);
      return c.json(updated);
    } catch {
      return c.json({ error: 'Failed to save config' }, 500);
    }
  });

  // ── Benchmark management endpoints ───────────────────────────────────

  /** Convert a ProjectEntry to snake_case wire format. */
  function projectEntryToWire(entry: {
    id: string;
    name: string;
    path: string;
    addedAt: string;
    lastOpenedAt: string;
  }) {
    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      added_at: entry.addedAt,
      last_opened_at: entry.lastOpenedAt,
    };
  }

  async function summarizeProjectRunMetas(project: { id: string; path: string }) {
    const { runs: metas } = await listMergedResultFiles(project.path, undefined, project.id);
    const threshold = loadStudioConfig(path.join(project.path, '.agentv')).threshold;
    let passRateSum = 0;
    let executionErrorCount = 0;

    for (const meta of metas) {
      try {
        const records = await loadLightweightResultsForMeta(project.path, meta, project.id);
        if (records.length > 0) {
          const qualitySummary = summarizeQualityResults(records, threshold);
          passRateSum += qualitySummary.passRate;
          executionErrorCount += qualitySummary.executionErrorCount;
          continue;
        }
      } catch {
        // Fall back to metadata below when materialized rows are unavailable.
      }
      passRateSum += meta.passRate;
    }

    return {
      runCount: metas.length,
      passRate: metas.length > 0 ? passRateSum / metas.length : 0,
      executionErrorCount,
      lastRun: metas.length > 0 ? metas[0].timestamp : null,
    };
  }

  app.get('/api/projects', async (c) => {
    const registry = loadProjectRegistry();
    const projects = await Promise.all(
      registry.projects.map(async (p) => {
        let summary = {
          runCount: 0,
          passRate: 0,
          executionErrorCount: 0,
          lastRun: null as string | null,
        };
        try {
          summary = await summarizeProjectRunMetas(p);
        } catch {
          // Project path may be missing or inaccessible
        }
        return {
          ...projectEntryToWire(p),
          run_count: summary.runCount,
          pass_rate: summary.passRate,
          execution_error_count: summary.executionErrorCount,
          last_run: summary.lastRun,
        };
      }),
    );
    return c.json({ projects });
  });

  app.get('/api/filesystem/browse', (c) => {
    try {
      return c.json(
        directoryBrowseResultToWire(browseFilesystemDirectories(c.req.query('path'), searchDir)),
      );
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/projects', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path) return c.json({ error: 'Missing path' }, 400);
      const entry = addProject(body.path);
      return c.json(projectEntryToWire(entry), 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/projects/:projectId/summary', async (c) => {
    const project = getProject(c.req.param('projectId') ?? '');
    if (!project) return c.json({ error: 'Project not found' }, 404);
    try {
      const summary = await summarizeProjectRunMetas(project);
      return c.json({
        id: project.id,
        name: project.name,
        path: project.path,
        run_count: summary.runCount,
        pass_rate: summary.passRate,
        execution_error_count: summary.executionErrorCount,
        last_run: summary.lastRun,
      });
    } catch {
      return c.json({ error: 'Failed to read project' }, 500);
    }
  });

  /** Aggregate runs from all registered projects, sorted by timestamp descending. */
  app.get('/api/projects/all-runs', async (c) => {
    const registry = loadProjectRegistry();
    const allRuns: Array<{
      filename: string;
      display_name: string;
      path: string;
      timestamp: string;
      test_count: number;
      pass_rate: number;
      avg_score: number;
      execution_error_count: number;
      size_bytes: number;
      target?: string;
      experiment?: string;
      tags?: string[];
      remote_tags?: string[];
      pending_tags?: string[];
      metadata_dirty?: boolean;
      final_state: RunFinalState;
      oplog_watermark: RunOplogWatermark;
      source: 'local' | 'remote';
      project_id: string;
      project_name: string;
    }> = [];

    for (const p of registry.projects) {
      try {
        const { runs: metas } = await listMergedResultFiles(p.path, undefined, p.id);
        for (const m of metas) {
          let target: string | undefined;
          let experiment = inferExperimentFromRunId(m.raw_filename);
          let passRate = m.passRate;
          let avgScore = m.avgScore;
          let executionErrorCount = 0;
          try {
            const records = await loadLightweightResultsForMeta(p.path, m, p.id);
            if (records.length > 0) {
              const qualitySummary = summarizeQualityResults(
                records,
                loadStudioConfig(path.join(p.path, '.agentv')).threshold,
              );
              target = records[0].target;
              experiment = records[0].experiment ?? experiment;
              passRate = qualitySummary.passRate;
              avgScore = qualitySummary.avgScore;
              executionErrorCount = qualitySummary.executionErrorCount;
            }
          } catch {
            // ignore enrichment errors
          }
          const tagFields = await readRunTagFields(p.path, m, p.id);
          allRuns.push({
            filename: m.filename,
            display_name: m.displayName,
            path: m.path,
            timestamp: m.timestamp,
            test_count: m.testCount,
            pass_rate: passRate,
            avg_score: avgScore,
            execution_error_count: executionErrorCount,
            size_bytes: m.sizeBytes,
            source: m.source,
            ...(target && { target }),
            ...(experiment && { experiment }),
            ...tagFields,
            project_id: p.id,
            project_name: p.name,
          });
        }
      } catch {
        // skip inaccessible projects
      }
    }

    allRuns.sort(compareRunsByTimestampDesc);
    return c.json({ runs: allRuns });
  });

  app.delete('/api/projects/:projectId', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    const removed = removeProject(c.req.param('projectId') ?? '');
    if (!removed) return c.json({ error: 'Project not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Data routes (unscoped) ────────────────────────────────────────────

  app.get('/api/config', (c) =>
    handleConfig(c, defaultCtx, {
      readOnly,
      projectDashboard: options?.projectDashboard,
      currentProjectId: options?.currentProjectId,
    }),
  );
  app.get('/api/remote/status', async (c) =>
    c.json(await getRemoteResultsStatus(searchDir, defaultCtx.projectId)),
  );
  app.post('/api/remote/sync', async (c) =>
    c.json(await syncRemoteResults(searchDir, defaultCtx.projectId)),
  );
  app.get('/api/runs', (c) => handleRuns(c, defaultCtx));
  app.post('/api/runs/combine', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return handleRunsCombine(c, defaultCtx);
  });
  app.put('/api/runs/:filename/tags', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return handleRunTagsPut(c, defaultCtx);
  });
  app.delete('/api/runs/:filename/tags', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return handleRunTagsDelete(c, defaultCtx);
  });
  app.delete('/api/runs/:filename', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return handleRunDelete(c, defaultCtx);
  });
  app.get('/api/runs/:filename', (c) => handleRunDetail(c, defaultCtx));
  app.get('/api/runs/:filename/log', (c) => handleRunLog(c, defaultCtx));
  app.get('/api/runs/:filename/suites', (c) => handleRunSuites(c, defaultCtx));
  app.get('/api/runs/:filename/categories', (c) => handleRunCategories(c, defaultCtx));
  app.get('/api/runs/:filename/categories/:category/suites', (c) =>
    handleCategorySuites(c, defaultCtx),
  );
  app.get('/api/runs/:filename/evals/:evalId', (c) => handleEvalDetail(c, defaultCtx));
  app.get('/api/runs/:filename/evals/:evalId/transcript', (c) =>
    handleEvalTranscript(c, defaultCtx),
  );
  app.get('/api/runs/:filename/evals/:evalId/files', (c) => handleEvalFiles(c, defaultCtx));
  app.get('/api/runs/:filename/evals/:evalId/files/*', (c) => handleEvalFileContent(c, defaultCtx));
  app.get('/api/experiments', (c) => handleExperiments(c, defaultCtx));
  app.get('/api/compare', (c) => handleCompare(c, defaultCtx));
  app.get('/api/targets', (c) => handleTargets(c, defaultCtx));

  // Feedback (unscoped — read uses defaultCtx.searchDir as resultDir)
  app.get('/api/feedback', (c) => {
    const data = readFeedback(resultDir);
    return c.json(data);
  });

  app.post('/api/feedback', async (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return handleFeedbackWrite(c, resultDir);
  });

  // Aggregated index (unscoped only)
  app.get('/api/index', async (c) => {
    const { runs: metas } = await listMergedResultFiles(searchDir, undefined, defaultCtx.projectId);
    const entries = await Promise.all(
      metas.map(async (m) => {
        let totalCostUsd = 0;
        let passRate = m.passRate;
        let avgScore = m.avgScore;
        let testCount = m.testCount;
        let executionErrorCount = 0;
        try {
          const records = await loadLightweightResultsForMeta(searchDir, m, defaultCtx.projectId);
          totalCostUsd = records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
          if (records.length > 0) {
            const qualitySummary = summarizeQualityResults(
              records,
              loadStudioConfig(agentvDir).threshold,
            );
            testCount = qualitySummary.totalCount;
            passRate = qualitySummary.passRate;
            avgScore = qualitySummary.avgScore;
            executionErrorCount = qualitySummary.executionErrorCount;
          }
        } catch {
          // ignore load errors for aggregate
        }
        return {
          run_filename: m.filename,
          display_name: m.displayName,
          test_count: testCount,
          pass_rate: passRate,
          avg_score: avgScore,
          execution_error_count: executionErrorCount,
          total_cost_usd: totalCostUsd,
          timestamp: m.timestamp,
        };
      }),
    );
    return c.json({ entries });
  });

  // ── Data routes (project-scoped) ───────────────────────────────────
  // Same handlers as above, with project-resolved DataContext via withProject.

  app.get('/api/projects/:projectId/config', (c) =>
    withProject(c, (ctx, dataCtx) =>
      handleConfig(ctx, dataCtx, {
        readOnly,
        projectDashboard: options?.projectDashboard,
      }),
    ),
  );
  app.get('/api/projects/:projectId/remote/status', (c) =>
    withProject(c, async (ctx, dataCtx) =>
      ctx.json(await getRemoteResultsStatus(dataCtx.searchDir, dataCtx.projectId)),
    ),
  );
  app.post('/api/projects/:projectId/remote/sync', (c) =>
    withProject(c, async (ctx, dataCtx) =>
      ctx.json(await syncRemoteResults(dataCtx.searchDir, dataCtx.projectId)),
    ),
  );
  app.get('/api/projects/:projectId/runs', (c) => withProject(c, handleRuns));
  app.post('/api/projects/:projectId/runs/combine', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return withProject(c, handleRunsCombine);
  });
  app.put('/api/projects/:projectId/runs/:filename/tags', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return withProject(c, handleRunTagsPut);
  });
  app.delete('/api/projects/:projectId/runs/:filename/tags', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return withProject(c, handleRunTagsDelete);
  });
  app.delete('/api/projects/:projectId/runs/:filename', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return withProject(c, handleRunDelete);
  });
  app.get('/api/projects/:projectId/runs/:filename', (c) => withProject(c, handleRunDetail));
  app.get('/api/projects/:projectId/runs/:filename/log', (c) => withProject(c, handleRunLog));
  app.get('/api/projects/:projectId/runs/:filename/suites', (c) => withProject(c, handleRunSuites));
  app.get('/api/projects/:projectId/runs/:filename/categories', (c) =>
    withProject(c, handleRunCategories),
  );
  app.get('/api/projects/:projectId/runs/:filename/categories/:category/suites', (c) =>
    withProject(c, handleCategorySuites),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId', (c) =>
    withProject(c, handleEvalDetail),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId/transcript', (c) =>
    withProject(c, handleEvalTranscript),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId/files', (c) =>
    withProject(c, handleEvalFiles),
  );
  app.get('/api/projects/:projectId/runs/:filename/evals/:evalId/files/*', (c) =>
    withProject(c, handleEvalFileContent),
  );
  app.get('/api/projects/:projectId/experiments', (c) => withProject(c, handleExperiments));
  app.get('/api/projects/:projectId/compare', (c) => withProject(c, handleCompare));
  app.get('/api/projects/:projectId/targets', (c) => withProject(c, handleTargets));
  app.get('/api/projects/:projectId/feedback', (c) => withProject(c, handleFeedbackRead));
  app.post('/api/projects/:projectId/feedback', (c) => {
    if (readOnly) {
      return c.json({ error: 'Dashboard is running in read-only mode' }, 403);
    }
    return withProject(c, (projectContext, ctx) =>
      handleFeedbackWrite(projectContext, feedbackStoreDir(ctx.searchDir)),
    );
  });

  // ── Eval runner routes (discovery, launch, status) ────────────────────

  registerEvalRoutes(
    app,
    (c) => {
      // For project-scoped routes, resolve to project path; otherwise use searchDir
      const projectId = c.req.param('projectId');
      if (projectId) {
        const project = getProject(projectId);
        if (project) return project.path;
      }
      return searchDir;
    },
    { readOnly },
  );

  // ── Static file serving for Dashboard SPA ────────────────────────────────

  const studioDistPath = options?.studioDir ?? resolveStudioDistDir();
  if (!studioDistPath || !existsSync(path.join(studioDistPath, 'index.html'))) {
    throw new Error(
      'Dashboard dist not found. Run "bun run build" in apps/dashboard/ to build the SPA.',
    );
  }

  app.get('/', (c) => {
    const indexPath = path.join(studioDistPath, 'index.html');
    if (existsSync(indexPath)) return c.html(readFileSync(indexPath, 'utf8'));
    return c.notFound();
  });

  app.get('/assets/*', (c) => {
    const assetPath = c.req.path;
    const filePath = path.join(studioDistPath, assetPath);
    if (!existsSync(filePath)) return c.notFound();
    const content = readFileSync(filePath);
    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
    };
    const contentType = mimeTypes[ext] ?? 'application/octet-stream';
    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  // SPA fallback: serve index.html for any non-API route that isn't matched
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    const indexPath = path.join(studioDistPath, 'index.html');
    if (existsSync(indexPath)) return c.html(readFileSync(indexPath, 'utf8'));
    return c.notFound();
  });

  return app;
}

/**
 * Resolve the path to the dashboard dist directory.
 *
 * Searches several candidate locations covering:
 *   - Running from TypeScript source (`bun apps/cli/src/cli.ts`)
 *   - Running from built dist (`bun apps/cli/dist/cli.js`)
 *   - Published npm package (dashboard bundled inside `dist/dashboard/`)
 */
function resolveStudioDistDir(): string | undefined {
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // From src/commands/results/ → sibling apps/dashboard/dist
    path.resolve(currentDir, '../../../../dashboard/dist'),
    // From dist/ → sibling apps/dashboard/dist (monorepo dev)
    path.resolve(currentDir, '../../dashboard/dist'),
    // Bundled inside CLI dist (published package: dist/dashboard/)
    path.resolve(currentDir, 'dashboard'),
    // From dist/ in monorepo root context
    path.resolve(currentDir, '../../../apps/dashboard/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return undefined;
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsServeCommand = command({
  name: 'dashboard',
  description: 'Start AgentV Dashboard — a local dashboard for reviewing evaluation results',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description:
        'Legacy direct run source (unsupported); use --dir <project-dir> or results: config',
    }),
    port: option({
      type: optional(number),
      long: 'port',
      short: 'p',
      description: 'Port to listen on (flag → PORT env var → 3117)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
    single: flag({
      long: 'single',
      description: 'Force single-project dashboard mode',
    }),
    add: option({
      type: optional(string),
      long: 'add',
      description: 'Register a project by path',
    }),
    remove: option({
      type: optional(string),
      long: 'remove',
      description: 'Unregister a project by ID',
    }),
    readOnly: flag({
      long: 'read-only',
      description: 'Disable write operations and launch Dashboard in read-only leaderboard mode',
    }),
  },
  handler: async ({ source, port, dir, single, add, remove, readOnly }) => {
    const cwd = dir ?? process.cwd();
    const listenPort = port ?? (process.env.PORT ? Number(process.env.PORT) : 3117);

    // ── Benchmark management commands (non-server) ───────────────────
    if (add) {
      try {
        const entry = addProject(add);
        console.log(`Registered project: ${entry.name} (${entry.id}) at ${entry.path}`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    if (remove) {
      const removed = removeProject(remove);
      if (removed) {
        console.log(`Unregistered project: ${remove}`);
      } else {
        console.error(`Project not found: ${remove}`);
        process.exit(1);
      }
      return;
    }

    // ── Version check ────────────────────────────────────────────────
    // Check `required_version` from .agentv/config.yaml so Dashboard/serve
    // match `agentv eval` behavior. Version mismatches are advisory by
    // default. Single-project scope only — when one agentv instance serves
    // multiple repos with differing version requirements, a per-project local
    // install is required instead.
    const repoRoot = await findRepoRoot(cwd);
    const yamlConfig = await loadConfig(path.join(cwd, '_'), repoRoot);
    if (yamlConfig?.required_version) {
      await enforceRequiredVersion(yamlConfig.required_version);
    }

    const { currentProjectId } = bootstrapCurrentProject(cwd, { single });

    // ── Determine dashboard mode ─────────────────────────────────────
    const registry = loadProjectRegistry();
    const { projectDashboard } = resolveDashboardMode(registry.projects.length, { single });

    // ── Project sync preflight ───────────────────────────────────────
    // Clone or pull any project entries that declare a source.
    // Non-blocking: fire-and-forget so startup is instant even when some
    // project paths are missing or slow (e.g. /tmp paths that timeout).
    syncProjects(registry.projects).catch((err) =>
      console.error('Background project sync failed:', err),
    );

    try {
      let results: EvaluationResult[] = [];
      let sourceFile: string | undefined;

      // Reject unsupported direct sources. Otherwise, auto-discover the
      // project's configured run workspace and fall back to the empty state.
      if (source) {
        sourceFile = await resolveSourceFile(source, cwd);
        results = loadManifestResults(sourceFile, { hydrateTranscriptTrace: false });
      } else {
        // Auto-discover: run cache -> directory scan -> empty state
        const cache = await loadRunCache(cwd);
        const cachedFile = cache ? resolveRunCacheFile(cache) : '';
        if (cachedFile && existsSync(cachedFile)) {
          sourceFile = cachedFile;
          results = loadManifestResults(cachedFile, { hydrateTranscriptTrace: false });
        } else {
          const metas = listResultFiles(cwd, 1);
          if (metas.length > 0) {
            sourceFile = metas[0].path;
            results = loadManifestResults(metas[0].path, { hydrateTranscriptTrace: false });
          }
          // If no metas, results stays empty — dashboard shows welcome state
        }
      }

      // Use the run directory for feedback storage (matches #764 behavior)
      const resultDir = sourceFile ? path.dirname(path.resolve(sourceFile)) : cwd;
      const app = createApp(results, resultDir, cwd, sourceFile, {
        readOnly,
        projectDashboard,
        currentProjectId,
      });

      if (projectDashboard) {
        console.log(`Project dashboard: ${registry.projects.length} project(s) registered`);
        if (currentProjectId) {
          console.log(`Default project: ${currentProjectId}`);
        }
      } else if (results.length > 0 && sourceFile) {
        console.log(`Serving ${results.length} result(s) from ${sourceFile}`);
      } else {
        console.log('No results found. Dashboard will show an empty state.');
        console.log('Run an evaluation to see results: agentv eval <eval-file>');
      }
      console.log(`Dashboard: http://localhost:${listenPort}`);
      console.log(`Projects API: http://localhost:${listenPort}/api/projects`);
      console.log('Press Ctrl+C to stop');

      const { serve: startServer } = await import('@hono/node-server');
      startServer({
        fetch: app.fetch,
        port: listenPort,
      });
      await new Promise(() => {});
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
