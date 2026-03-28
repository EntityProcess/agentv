/**
 * TypeScript types for the AgentV Studio API responses.
 *
 * These mirror the wire-format types served by the Hono API in apps/cli/.
 * All JSON keys use snake_case per the agentv wire-format convention.
 */

export interface RunMeta {
  filename: string;
  path: string;
  timestamp: string;
  test_count: number;
  pass_rate: number;
  avg_score: number;
  size_bytes: number;
  target?: string;
  experiment?: string;
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
  eval_set?: string;
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
  source: string;
}

export interface CategorySummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  avg_score: number;
}

export interface CategoriesResponse {
  categories: CategorySummary[];
}

export interface EvalDetailResponse {
  eval: EvalResult;
}

export interface IndexEntry {
  run_filename: string;
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
  pass_rate: number;
  last_run: string;
}

export interface ExperimentsResponse {
  experiments: ExperimentSummary[];
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
