/**
 * TypeScript types for the AgentV Studio API responses.
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
  size_bytes: number;
  target?: string;
  experiment?: string;
  source: 'local' | 'remote';
  project_id?: string;
  project_name?: string;
}

export interface RunListResponse {
  runs: RunMeta[];
}

export interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
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
}

export interface AssertionEntry {
  text: string;
  passed: boolean;
  evidence?: string;
  durationMs?: number;
}

export interface EvalResult {
  testId: string;
  timestamp?: string;
  suite?: string;
  category?: string;
  target?: string;
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
  output?: { role: string; content: string }[];
  _toolCalls?: Record<string, unknown>;
  _graderDurationMs?: number;
}

export interface RunDetailResponse {
  results: EvalResult[];
  source: 'local' | 'remote';
  source_label?: string;
}

export interface SuiteSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  avg_score: number;
}

export interface SuitesResponse {
  suites: SuiteSummary[];
}

export interface EvalDetailResponse {
  eval: EvalResult;
}

export interface IndexEntry {
  run_filename: string;
  display_name?: string;
  target?: string;
  test_count: number;
  pass_rate: number;
  avg_score: number;
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
  passed_count: number;
  pass_rate: number;
  last_run: string;
}

export interface ExperimentsResponse {
  experiments: ExperimentSummary[];
}

export interface CompareTestResult {
  test_id: string;
  score: number;
  passed: boolean;
  execution_status?: string;
}

export interface CompareCell {
  experiment: string;
  target: string;
  eval_count: number;
  passed_count: number;
  pass_rate: number;
  avg_score: number;
  tests: CompareTestResult[];
}

export interface CompareResponse {
  experiments: string[];
  targets: string[];
  cells: CompareCell[];
}

export interface TargetSummary {
  name: string;
  run_count: number;
  experiment_count: number;
  pass_rate: number;
  passed_count: number;
  eval_count: number;
}

export interface TargetsResponse {
  targets: TargetSummary[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
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
  suite_count: number;
}

export interface CategoriesResponse {
  categories: CategorySummary[];
}

export interface StudioConfigResponse {
  threshold: number;
  /** @deprecated Use threshold */
  pass_threshold?: number;
  read_only?: boolean;
  project_name?: string;
  multi_project_dashboard?: boolean;
}

export interface RemoteStatusResponse {
  configured: boolean;
  available: boolean;
  repo?: string;
  cache_dir?: string;
  path?: string;
  auto_push?: boolean;
  branch_prefix?: string;
  run_count?: number;
  last_synced_at?: string;
  last_error?: string;
}

// ── Benchmark types ──────────────────────────────────────────────────────

export interface BenchmarkSummary {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
  run_count: number;
  pass_rate: number;
  last_run: string | null;
}

export interface BenchmarkListResponse {
  projects: BenchmarkSummary[];
}

export interface BenchmarkEntry {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
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
  threshold?: number;
  workers?: number;
  dry_run?: boolean;
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
    started_at: string;
    finished_at: string | null;
    exit_code: number | null;
  }>;
}

export interface EvalPreviewResponse {
  command: string;
}
