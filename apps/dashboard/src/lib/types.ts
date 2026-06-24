import type {
  ExternalTraceMetadataWire as CoreExternalTraceMetadata,
  TraceSessionArtifactLink as CoreTraceSessionArtifactLink,
  TraceSessionConversionWarning as CoreTraceSessionConversionWarning,
  TraceSessionEvent as CoreTraceSessionEvent,
  TraceSessionEventKind as CoreTraceSessionEventKind,
  TraceSessionResponse as CoreTraceSessionResponse,
  TraceSessionScore as CoreTraceSessionScore,
  TraceSessionSource as CoreTraceSessionSource,
  TraceSessionSourceRef as CoreTraceSessionSourceRef,
  TraceSessionSpan as CoreTraceSessionSpan,
  TraceSessionSpanStatus as CoreTraceSessionSpanStatus,
  TraceSessionTokenUsage as CoreTraceSessionTokenUsage,
} from '@agentv/core';

/**
 * TypeScript types for the AgentV Dashboard API responses.
 *
 * These mirror the wire-format types served by the Hono API in apps/cli/.
 * All JSON keys use snake_case per the agentv wire-format convention.
 */

export interface RunMeta {
  filename: string;
  display_name?: string;
  path: string;
  timestamp: string;
  test_count: number;
  pass_rate: number;
  avg_score: number;
  execution_error_count?: number;
  size_bytes: number;
  target?: string;
  experiment?: string;
  source: 'local' | 'remote';
  /**
   * True when this run is present on the configured remote results branch.
   * Drives the per-run "Remote" indicator and the "N of M runs on remote"
   * summary. A run synced to the remote keeps `source: 'local'` but reports
   * `on_remote: true`, so the indicator and the count always agree.
   */
  on_remote?: boolean;
  project_id?: string;
  project_name?: string;
  /** Optional user-assigned tags from the run's sidecar tags.json. */
  tags?: string[];
  /** Tags currently present in the remote results repo before local metadata overlays. */
  remote_tags?: string[];
  /** Locally edited tags waiting to sync back to the remote results repo. */
  pending_tags?: string[];
  /** True when local editable metadata differs from the fetched remote metadata. */
  metadata_dirty?: boolean;
  /** Materialized final run state from the result bundle and tag sidecar. */
  final_state?: RunFinalState;
  /** Optimistic-concurrency token for mutable tag state. */
  tag_revision?: string;
  /**
   * Live execution status. Only present for Dashboard-launched runs that are
   * still being tracked in-memory — used to render a spinner in RunList
   * instead of the pass/fail dot when pass_rate is 0 simply because no
   * results have been written yet.
   */
  status?: 'starting' | 'running' | 'finished' | 'failed';
}

export interface RunFinalState {
  lifecycle: 'active' | 'hidden' | 'deleted';
  tags: string[];
}

export interface RunListResponse {
  runs: RunMeta[];
  next_cursor?: string;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cached?: number;
}

export interface ScoreEntry {
  name?: string;
  type?: string;
  score: number;
  assertions?: AssertionEntry[];
  weight?: number;
  verdict?: string;
  details?: string | Record<string, unknown>;
  durationMs?: number;
  target?: string;
  tokenUsage?: TokenUsage;
  scores?: ScoreEntry[];
}

export interface AssertionEntry {
  text: string;
  passed: boolean;
  evidence?: string;
  durationMs?: number;
}

export interface SourceOmittedContent {
  reason: string;
  message?: string;
  max_bytes?: number;
}

export interface SourceCapturedFile {
  kind?: string;
  display_path: string;
  repo_relative_path?: string;
  absolute_path?: string;
  content_sha256?: string;
  size_bytes?: number;
  content?: string;
  omitted?: SourceOmittedContent;
}

export interface SourceReferencedFile extends SourceCapturedFile {
  kind: string;
  grader_name?: string;
  command?: string[];
}

export interface SourceTraceability {
  status: 'captured' | 'not_captured';
  message?: string;
  eval_file?: SourceCapturedFile;
  test_id?: string;
  source_test?: {
    test_id: string;
    yaml: string;
  };
  graders?: {
    name: string;
    type: string;
    weight?: number;
    required?: boolean | number;
    min_score?: number;
    definition: Record<string, unknown>;
  }[];
  referenced_files?: SourceReferencedFile[];
}

export type ExternalTraceMetadata = CoreExternalTraceMetadata;

export interface CamelExternalTraceMetadata {
  provider?: string;
  source?: string;
  endpoint?: string;
  profile?: string;
  project?: string;
  projectId?: string;
  sessionId?: string;
  sessionNodeId?: string;
  traceId?: string;
  traceNodeId?: string;
  spanId?: string;
  spanNodeId?: string;
  traceparent?: string;
  tracestate?: string;
  uiUrl?: string;
  runId?: string;
  testId?: string;
  target?: string;
}

export type TraceSessionTokenUsage = CoreTraceSessionTokenUsage;
export type TraceSessionSpanStatus = CoreTraceSessionSpanStatus;
export type TraceSessionEventKind = CoreTraceSessionEventKind;
export type TraceSessionEvent = CoreTraceSessionEvent;
export type TraceSessionSpan = CoreTraceSessionSpan;
export type TraceSessionScore = CoreTraceSessionScore;
export type TraceSessionSource = CoreTraceSessionSource;
export type TraceSessionArtifactLink = CoreTraceSessionArtifactLink;
export type TraceSessionSourceRef = CoreTraceSessionSourceRef;
export type TraceSessionConversionWarning = CoreTraceSessionConversionWarning;
export type TraceSessionResponse = CoreTraceSessionResponse;

export interface EvalResult {
  testId: string;
  timestamp?: string;
  suite?: string;
  category?: string;
  target?: string;
  targetUsed?: string;
  model?: string;
  experiment?: string;
  score: number;
  executionStatus?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  scores?: ScoreEntry[];
  assertions?: AssertionEntry[];
  input?: { role: string; content: string }[];
  output?: string;
  _toolCalls?: Record<string, unknown>;
  _graderDurationMs?: number;
  external_trace?: ExternalTraceMetadata;
  externalTrace?: CamelExternalTraceMetadata;
  metadata?: Record<string, unknown>;
  source_traceability?: SourceTraceability;
}

export interface RunDetailResponse {
  results: EvalResult[];
  source: 'local' | 'remote';
  source_label?: string;
  final_state?: RunFinalState;
  tag_revision?: string;
  /** Live execution status when this run is still tracked in-memory by Dashboard. */
  status?: 'starting' | 'running' | 'finished' | 'failed';
  /** Path to the run workspace directory (relative to cwd when inside, otherwise absolute). Local runs only. */
  run_dir?: string;
  /** Eval file path the run was launched against, if recorded in summary.json. Local runs only. */
  suite_filter?: string;
  /** Total (test_id, target) executions originally planned for this run. Used to detect incomplete partial runs as resumable. Local runs only, populated when the run was launched after the planned-count metadata feature shipped. */
  planned_test_count?: number;
}

export interface SuiteSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  avg_score: number;
  execution_error_count?: number;
}

export interface SuitesResponse {
  suites: SuiteSummary[];
}

export interface EvalDetailResponse {
  eval: EvalResult;
}

export type TranscriptArtifactStatus = 'ok' | 'missing' | 'dangling' | 'unsupported';

export interface TranscriptArtifactResponse {
  status: TranscriptArtifactStatus;
  transcript_path?: string;
  answer_path?: string;
  answer_content?: string;
  content?: string;
  language?: string;
  message?: string;
  pointer?: string;
}

export interface IndexEntry {
  run_filename: string;
  display_name?: string;
  target?: string;
  test_count: number;
  pass_rate: number;
  avg_score: number;
  execution_error_count?: number;
  total_cost_usd: number;
  timestamp: string;
}

export interface IndexResponse {
  entries: IndexEntry[];
}

export interface FeedbackReview {
  test_id: string;
  comment: string;
  updated_at: string;
}

export interface FeedbackData {
  reviews: FeedbackReview[];
}

export interface ExperimentSummary {
  name: string;
  run_count: number;
  target_count: number;
  eval_count: number;
  quality_count?: number;
  passed_count: number;
  execution_error_count?: number;
  pass_rate: number;
  last_run: string;
}

export interface ExperimentsResponse {
  experiments: ExperimentSummary[];
}

export interface CompareTestResult {
  test_id: string;
  /** Optional per-test category from the source eval result, when available. */
  category?: string;
  score: number;
  passed: boolean;
  execution_status?: string;
}

export interface CompareCell {
  experiment: string;
  target: string;
  eval_count: number;
  quality_count?: number;
  passed_count: number;
  execution_error_count?: number;
  pass_rate: number;
  avg_score: number;
  tests: CompareTestResult[];
  /** Score delta vs baseline (avg_score − baseline avg_score). Present when ?baseline= is set. */
  delta?: number;
  /** Normalized gain `g` vs baseline. Null when baseline score is 1.0 (no headroom). */
  normalized_gain?: number | null;
}

/**
 * A single evaluation run surfaced in the per-run compare view.
 *
 * Each run workspace contributes exactly one entry, independent of the
 * aggregated `(experiment, target)` cells. Users select multiple runs to
 * compare them side-by-side, regardless of whether the runs share an
 * experiment or target.
 */
export interface CompareRunEntry {
  run_id: string;
  started_at: string;
  experiment: string;
  target: string;
  tags?: string[];
  remote_tags?: string[];
  pending_tags?: string[];
  metadata_dirty?: boolean;
  final_state?: RunFinalState;
  tag_revision?: string;
  source: 'local' | 'remote';
  eval_count: number;
  quality_count?: number;
  passed_count: number;
  execution_error_count?: number;
  pass_rate: number;
  avg_score: number;
  tests: CompareTestResult[];
}

export interface CompareResponse {
  experiments: string[];
  targets: string[];
  cells: CompareCell[];
  /** Per-run entries, sorted newest first. */
  runs?: CompareRunEntry[];
}

export interface RunTagsResponse {
  tags: string[];
  remote_tags?: string[];
  pending_tags?: string[];
  metadata_dirty?: boolean;
  final_state?: RunFinalState;
  tag_revision: string;
  updated_at: string;
}

export interface CombineDuplicateConflict {
  key: string;
  test_id: string;
  target: string;
  kept_source_id: string;
  incoming_source_id: string;
  kept_timestamp?: string;
  incoming_timestamp?: string;
  latest_source_id: string;
}

export interface CombineRunsResponse {
  ok: true;
  run_id: string;
  display_name: string;
  experiment: string;
  combined_from_run_ids: string[];
  duplicate_conflicts?: CombineDuplicateConflict[];
  tags?: string[];
}

export interface TargetSummary {
  name: string;
  run_count: number;
  experiment_count: number;
  pass_rate: number;
  passed_count: number;
  eval_count: number;
  quality_count?: number;
  execution_error_count?: number;
}

export interface TargetsResponse {
  targets: TargetSummary[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  kind?: string;
  storage?: string;
  ref?: string;
  key?: string;
  sha256?: string;
  media_type?: string;
  children?: FileNode[];
}

export interface FileTreeResponse {
  files: FileNode[];
}

export interface FileContentResponse {
  content: string;
  language: string;
}

export interface CategorySummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  avg_score: number;
  execution_error_count?: number;
  suite_count: number;
}

export interface CategoriesResponse {
  categories: CategorySummary[];
}

export interface StudioConfigResponse {
  threshold: number;
  app_name: string;
  /** @deprecated Use threshold */
  pass_threshold?: number;
  read_only?: boolean;
  project_name?: string;
  project_dashboard?: boolean;
  current_project_id?: string;
}

export interface RemoteStatusResponse {
  configured: boolean;
  available: boolean;
  repo?: string;
  local_dir?: string;
  path?: string;
  auto_push?: boolean;
  push_conflict_policy?: 'block' | 'backup_and_force_push';
  branch_prefix?: string;
  run_count?: number;
  last_synced_at?: string;
  last_error?: string;
  sync_status?:
    | 'clean'
    | 'unavailable'
    | 'behind'
    | 'ahead'
    | 'diverged'
    | 'dirty'
    | 'conflicted'
    | 'push_conflict'
    | 'syncing';
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty_paths?: string[];
  conflicted_paths?: string[];
  git_status?: string;
  git_diff_summary?: string;
  blocked?: boolean;
  block_reason?: string;
  pull_performed?: boolean;
  push_performed?: boolean;
  commit_created?: boolean;
  target_branch?: string;
  remote_commit?: string;
  local_commit?: string;
  backup_ref?: string;
  backup_commit?: string;
  previous_remote_commit?: string;
  force_pushed_commit?: string;
  lease_commit?: string;
}

// ── Project types ──────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
  run_count: number;
  pass_rate: number;
  execution_error_count?: number;
  last_run: string | null;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface ProjectEntryWire {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
}

export interface FilesystemBrowseEntryWire {
  name: string;
  path: string;
  has_agentv: boolean;
}

export interface FilesystemBrowseResponseWire {
  path: string;
  parent_path?: string;
  current: FilesystemBrowseEntryWire;
  entries: FilesystemBrowseEntryWire[];
}

export interface FilesystemBrowseEntry {
  name: string;
  path: string;
  hasAgentv: boolean;
}

export interface FilesystemBrowseResponse {
  path: string;
  parentPath?: string;
  current: FilesystemBrowseEntry;
  entries: FilesystemBrowseEntry[];
}

// ── Eval runner types ────────────────────────────────────────────────────

export interface DiscoveredEvalFile {
  path: string;
  relative_path: string;
  category: string;
}

export interface EvalDiscoverResponse {
  eval_files: DiscoveredEvalFile[];
}

export interface EvalTargetsResponse {
  targets: string[];
}

export interface RunEvalRequest {
  suite_filter?: string;
  test_ids?: string[];
  target?: string;
  experiment?: string;
  tags?: string[];
  threshold?: number;
  workers?: number;
  dry_run?: boolean;
  /** Resume an interrupted run: skip already-completed tests and append to `output`. */
  resume?: boolean;
  /** Re-run failed/errored tests while keeping passing results. */
  rerun_failed?: boolean;
  /** Path to a previous run dir or index.jsonl — re-run only execution_error cases. */
  retry_errors?: string;
  /** Artifact directory for run output — required to target an existing run dir. */
  output?: string;
}

export interface EvalRunResponse {
  id: string;
  status: string;
  command: string;
}

export interface EvalRunStatus {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed';
  command: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

export interface EvalRunListResponse {
  runs: Array<{
    id: string;
    status: string;
    command: string;
    target?: string;
    started_at: string;
    finished_at: string | null;
    exit_code: number | null;
  }>;
}

export interface EvalPreviewResponse {
  command: string;
}
