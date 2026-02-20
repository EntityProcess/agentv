import type { ToolTrajectoryEvaluatorConfig, TraceSummary } from './trace.js';

/**
 * JSON primitive values appearing in AgentV payloads.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Immutable JSON object representation for test fixtures.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Recursive JSON value supporting nested structures.
 */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

const TEST_MESSAGE_ROLE_VALUES = ['system', 'user', 'assistant', 'tool'] as const;

/**
 * Immutable list of supported message roles.
 */
export const TEST_MESSAGE_ROLES = TEST_MESSAGE_ROLE_VALUES;

/**
 * Role literals used by test messages.
 */
export type TestMessageRole = (typeof TEST_MESSAGE_ROLE_VALUES)[number];

const TEST_MESSAGE_ROLE_SET: ReadonlySet<string> = new Set(TEST_MESSAGE_ROLE_VALUES);

/**
 * Text or structured payload attached to a message.
 */
export type TestMessageContent = string | JsonObject | readonly JsonObject[];

/**
 * System-authored instruction message.
 */
export type SystemTestMessage = {
  readonly role: 'system';
  readonly content: TestMessageContent;
};

/**
 * User-authored prompt message.
 */
export type UserTestMessage = {
  readonly role: 'user';
  readonly content: TestMessageContent;
};

/**
 * Assistant response message.
 */
export type AssistantTestMessage = {
  readonly role: 'assistant';
  readonly content: TestMessageContent;
};

/**
 * Tool invocation message.
 */
export type ToolTestMessage = {
  readonly role: 'tool';
  readonly content: TestMessageContent;
};

/**
 * Conversation message union with role discrimination.
 */
export type TestMessage =
  | SystemTestMessage
  | UserTestMessage
  | AssistantTestMessage
  | ToolTestMessage;

/**
 * Guard validating supported message roles.
 */
export function isTestMessageRole(value: unknown): value is TestMessageRole {
  return typeof value === 'string' && TEST_MESSAGE_ROLE_SET.has(value);
}

/**
 * Guard matching AgentV JSON objects.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

/**
 * Guard matching AgentV JSON values.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return isJsonObject(value);
  }
  return false;
}

/**
 * Guard validating raw test messages.
 * A valid test message has:
 * - A valid role (system, user, assistant, tool)
 * - Either content (string or array of objects) OR tool_calls (for assistant messages)
 */
export function isTestMessage(value: unknown): value is TestMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { role?: unknown; content?: unknown; tool_calls?: unknown };
  if (!isTestMessageRole(candidate.role)) {
    return false;
  }
  // Check for valid content
  if (typeof candidate.content === 'string') {
    return true;
  }
  if (Array.isArray(candidate.content) && candidate.content.every(isJsonObject)) {
    return true;
  }
  // Allow messages with tool_calls but no content (for expected_messages format)
  if (Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
    return true;
  }
  // Allow messages with structured content object (e.g., { recommendation: ..., summary: ... })
  if (isJsonObject(candidate.content)) {
    return true;
  }
  return false;
}

const EVALUATOR_KIND_VALUES = [
  'code_judge',
  'llm_judge',
  'rubric',
  'composite',
  'tool_trajectory',
  'field_accuracy',
  'latency',
  'cost',
  'token_usage',
  'execution_metrics',
  'agent_judge',
] as const;

export type EvaluatorKind = (typeof EVALUATOR_KIND_VALUES)[number];

const EVALUATOR_KIND_SET: ReadonlySet<string> = new Set(EVALUATOR_KIND_VALUES);

export function isEvaluatorKind(value: unknown): value is EvaluatorKind {
  return typeof value === 'string' && EVALUATOR_KIND_SET.has(value);
}

/**
 * Configuration for enabling target access in code_judge evaluators.
 * When present, the runtime will start a local proxy server that allows
 * the script to invoke configured targets without direct credential access.
 */
export type TargetAccessConfig = {
  /** Maximum number of target invocations allowed per execution (default: 50) */
  readonly max_calls?: number;
};

/**
 * Configuration for workspace setup/teardown scripts.
 * Scripts are executed with workspace context passed via stdin.
 */
export type WorkspaceScriptConfig = {
  /** Command array to execute (e.g., ["bun", "run", "setup.ts"]) */
  readonly script: readonly string[];
  /** Optional timeout in milliseconds (default: 60000 for setup, 30000 for teardown) */
  readonly timeout_ms?: number;
  readonly timeoutMs?: number;
  /** Optional working directory for script execution */
  readonly cwd?: string;
};

/**
 * Workspace configuration for eval tests.
 * Can be specified at suite level and overridden per-case.
 * Merge strategy: template/scripts replaced, env deep-merged.
 */
export type WorkspaceConfig = {
  /** Template directory to copy */
  readonly template?: string;
  /** Script to run after workspace creation, before git baseline */
  readonly setup?: WorkspaceScriptConfig;
  /** Script to run after evaluation, before cleanup */
  readonly teardown?: WorkspaceScriptConfig;
};

export type CodeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'code';
  readonly script: readonly string[];
  readonly resolvedScriptPath?: string;
  readonly cwd?: string;
  readonly resolvedCwd?: string;
  readonly weight?: number;
  /** Pass-through configuration for the code_judge script (any unrecognized YAML properties) */
  readonly config?: JsonObject;
  /** When present, enables target access for the script via local proxy */
  readonly target?: TargetAccessConfig;
};

/**
 * Executable prompt template configuration.
 * Matches code_judge pattern for consistency.
 */
export type PromptScriptConfig = {
  /** Command array to execute (e.g., ["bun", "run", "template.ts"]) */
  readonly script: readonly string[];
  /** Pass-through configuration for the prompt template */
  readonly config?: Record<string, unknown>;
};

export type LlmJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'llm_judge';
  /** Text prompt (inline or file path) or executable script config */
  readonly prompt?: string | PromptScriptConfig;
  readonly promptPath?: string;
  /** Resolved absolute path for prompt file (used for text template prompts) */
  readonly resolvedPromptPath?: string;
  /** Resolved script array for executable prompts (matches code_judge pattern) */
  readonly resolvedPromptScript?: readonly string[];
  readonly rubrics?: readonly RubricItem[];
  readonly weight?: number;
  /** Pass-through configuration for custom evaluator prompts (legacy, prefer prompt.config) */
  readonly config?: Record<string, unknown>;
};

/**
 * Score range definition for analytic rubric scoring.
 * Each range maps an integer score band (0-10) to an outcome description.
 */
export type ScoreRange = {
  /** Inclusive integer range [min, max] within 0-10 */
  readonly score_range: readonly [number, number];
  /** Description of what this score range represents */
  readonly outcome: string;
};

/**
 * Rubric item for LLM judge evaluation.
 * Supports two modes:
 * - Checklist mode: boolean satisfied/not-satisfied with `outcome`
 * - Score-range mode: 0-10 integer scoring with `score_ranges`
 */
export type RubricItem = {
  readonly id: string;
  /**
   * For checklist rubrics: the outcome text (required).
   * For score-range rubrics: optional overall criterion description.
   */
  readonly outcome?: string;
  readonly weight: number;
  /**
   * Legacy boolean gating (deprecated, treated as required_min_score: 10).
   * Use required_min_score instead for finer control.
   */
  readonly required?: boolean;
  /**
   * Minimum score (0-10) required to pass this criterion.
   * If the criterion score is below this threshold, the overall verdict is 'fail'.
   */
  readonly required_min_score?: number;
  /**
   * Score range definitions for analytic rubric scoring.
   * When present, the judge outputs an integer 0-10 score per criterion.
   * Ranges must be non-overlapping and cover 0-10 inclusive.
   */
  readonly score_ranges?: readonly ScoreRange[];
};

export type CompositeAggregatorConfig =
  | { readonly type: 'weighted_average'; readonly weights?: Record<string, number> }
  | { readonly type: 'code_judge'; readonly path: string; readonly cwd?: string }
  | {
      readonly type: 'llm_judge';
      readonly prompt?: string;
      readonly promptPath?: string;
      readonly model?: string;
    }
  | { readonly type: 'threshold'; readonly threshold: number };

export type CompositeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'composite';
  readonly evaluators: readonly EvaluatorConfig[];
  readonly aggregator: CompositeAggregatorConfig;
  readonly weight?: number;
};

/**
 * Match type for field accuracy evaluation.
 * Note: For fuzzy string matching (Levenshtein, Jaro-Winkler, etc.), use a code_judge evaluator.
 * See examples/features/document-extraction/fuzzy_match.ts for an example.
 */
export type FieldMatchType = 'exact' | 'numeric_tolerance' | 'date';

/**
 * Aggregation strategy for combining field scores.
 */
export type FieldAggregationType = 'weighted_average' | 'all_or_nothing';

/**
 * Configuration for a single field to evaluate.
 */
export type FieldConfig = {
  /** Dot-notation path to the field (e.g., "invoice.vendor.name" or "items[0].amount") */
  readonly path: string;
  /** Match strategy for this field */
  readonly match: FieldMatchType;
  /** Whether this field is required (missing required fields count as failures) */
  readonly required?: boolean;
  /** Weight for aggregation (default: 1.0) */
  readonly weight?: number;
  /** Tolerance for numeric matching (absolute value unless relative is true) */
  readonly tolerance?: number;
  /** Whether tolerance is relative (percentage) vs absolute */
  readonly relative?: boolean;
  /** Date formats to try when parsing (default: common formats) */
  readonly formats?: readonly string[];
};

/**
 * Configuration for the field_accuracy evaluator.
 */
export type FieldAccuracyEvaluatorConfig = {
  readonly name: string;
  readonly type: 'field_accuracy';
  /** Fields to compare between candidate and expected */
  readonly fields: readonly FieldConfig[];
  /** Strategy for combining field scores (default: weighted_average) */
  readonly aggregation?: FieldAggregationType;
  readonly weight?: number;
};

/**
 * Configuration for the latency evaluator.
 * Checks execution duration against a threshold.
 */
export type LatencyEvaluatorConfig = {
  readonly name: string;
  readonly type: 'latency';
  /** Maximum allowed duration in milliseconds */
  readonly threshold: number;
  readonly weight?: number;
};

/**
 * Configuration for the cost evaluator.
 * Checks execution cost against a budget.
 */
export type CostEvaluatorConfig = {
  readonly name: string;
  readonly type: 'cost';
  /** Maximum allowed cost in USD */
  readonly budget: number;
  readonly weight?: number;
};

/**
 * Configuration for the token_usage evaluator.
 * Checks provider-reported token usage against configured limits.
 */
export type TokenUsageEvaluatorConfig = {
  readonly name: string;
  readonly type: 'token_usage';
  /** Maximum allowed total tokens (input + output + cached, when present) */
  readonly max_total?: number;
  /** Maximum allowed input tokens (prompt) */
  readonly max_input?: number;
  /** Maximum allowed output tokens (completion) */
  readonly max_output?: number;
  readonly weight?: number;
};

/**
 * Configuration for the execution_metrics evaluator.
 * Provides declarative threshold-based checks on execution metrics.
 * Only specified thresholds are checked; omitted ones are ignored.
 */
export type ExecutionMetricsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'execution_metrics';
  /** Maximum allowed number of tool calls */
  readonly max_tool_calls?: number;
  /** Maximum allowed number of LLM calls (assistant messages) */
  readonly max_llm_calls?: number;
  /** Maximum allowed total tokens (input + output) */
  readonly max_tokens?: number;
  /** Maximum allowed cost in USD */
  readonly max_cost_usd?: number;
  /** Maximum allowed duration in milliseconds */
  readonly max_duration_ms?: number;
  /** Target exploration ratio (0-1, proportion of read-only tool calls) */
  readonly target_exploration_ratio?: number;
  /** Tolerance for exploration ratio check (default: 0.2) */
  readonly exploration_tolerance?: number;
  readonly weight?: number;
};

/**
 * Configuration for the agent_judge evaluator.
 * Runs an agentic investigation loop to audit workspaces and verify criteria.
 * Two modes:
 * - Built-in: Uses AI SDK generateText() with sandboxed filesystem tools
 * - Judge target: Delegates to an external agent provider via Provider.invoke()
 */
export type AgentJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'agent_judge';
  /** Custom evaluation prompt (inline text or file path) */
  readonly prompt?: string;
  readonly promptPath?: string;
  /** Resolved absolute path for prompt file */
  readonly resolvedPromptPath?: string;
  /** Rubric items for structured evaluation (reuses llm_judge rubric infra) */
  readonly rubrics?: readonly RubricItem[];
  /** Maximum agent steps for built-in mode (default 10, max 50) */
  readonly max_steps?: number;
  /** Temperature for built-in mode (default 0) */
  readonly temperature?: number;
  /** Target name — delegates agent loop to this provider instead of built-in mode */
  readonly judge_target?: string;
  readonly weight?: number;
};

export type EvaluatorConfig =
  | CodeEvaluatorConfig
  | LlmJudgeEvaluatorConfig
  | CompositeEvaluatorConfig
  | ToolTrajectoryEvaluatorConfig
  | FieldAccuracyEvaluatorConfig
  | LatencyEvaluatorConfig
  | CostEvaluatorConfig
  | TokenUsageEvaluatorConfig
  | ExecutionMetricsEvaluatorConfig
  | AgentJudgeEvaluatorConfig;

/**
 * Eval test definition sourced from AgentV specs.
 */
export interface EvalTest {
  readonly id: string;
  readonly dataset?: string;
  readonly conversation_id?: string;
  readonly question: string;
  readonly input_messages: readonly TestMessage[];
  readonly input_segments: readonly JsonObject[];
  readonly expected_messages: readonly JsonObject[];
  readonly reference_answer?: string;
  readonly guideline_paths: readonly string[];
  readonly guideline_patterns?: readonly string[];
  readonly file_paths: readonly string[];
  readonly criteria: string;
  readonly evaluator?: EvaluatorKind;
  readonly evaluators?: readonly EvaluatorConfig[];
  /** Workspace configuration (merged from suite-level and case-level) */
  readonly workspace?: WorkspaceConfig;
  /** Arbitrary metadata passed to workspace scripts via stdin */
  readonly metadata?: Record<string, unknown>;
}

/** @deprecated Use `EvalTest` instead */
export type EvalCase = EvalTest;

/**
 * Supported trial aggregation strategies.
 */
export type TrialStrategy = 'pass_at_k' | 'mean' | 'confidence_interval';

/**
 * Configuration for running multiple trials per eval case.
 */
export interface TrialsConfig {
  readonly count: number;
  readonly strategy: TrialStrategy;
  readonly costLimitUsd?: number;
}

/**
 * Result of a single trial attempt.
 */
export interface TrialResult {
  readonly attempt: number;
  readonly score: number;
  readonly verdict: EvaluationVerdict;
  readonly evaluatorResults?: readonly EvaluatorResult[];
  readonly error?: string;
  readonly costUsd?: number;
}

/**
 * Aggregation metadata for pass_at_k strategy.
 */
export interface PassAtKAggregation {
  readonly strategy: 'pass_at_k';
  readonly passedAttempts: number;
  readonly totalAttempts: number;
}

/**
 * Aggregation metadata for mean strategy.
 */
export interface MeanAggregation {
  readonly strategy: 'mean';
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Aggregation metadata for confidence_interval strategy.
 */
export interface ConfidenceIntervalAggregation {
  readonly strategy: 'confidence_interval';
  readonly mean: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly stddev: number;
}

/**
 * Discriminated union of trial aggregation results.
 */
export type TrialAggregation = PassAtKAggregation | MeanAggregation | ConfidenceIntervalAggregation;

/**
 * Evaluator scorecard for a single eval case run.
 */
export interface EvaluationResult {
  readonly timestamp: string;
  readonly testId: string;
  readonly dataset?: string;
  readonly conversationId?: string;
  readonly score: number;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly candidateAnswer: string;
  readonly target: string;
  readonly reasoning?: string;
  readonly agentProviderRequest?: JsonObject;
  readonly lmProviderRequest?: JsonObject;
  readonly evaluatorProviderRequest?: JsonObject;
  readonly evaluatorResults?: readonly EvaluatorResult[];
  readonly error?: string;
  /** Lightweight summary of the execution trace (always included when available) */
  readonly traceSummary?: TraceSummary;
  /** Path to the temporary workspace directory (included on failure for debugging) */
  readonly workspacePath?: string;
  /** Full output messages from agent execution (only included when --trace flag is set) */
  readonly outputMessages?: readonly import('./providers/types.js').OutputMessage[];
  /** Captured output from workspace setup script */
  readonly setupOutput?: string;
  /** Captured output from workspace teardown script */
  readonly teardownOutput?: string;
  /** Unified diff of workspace file changes (when workspace_template is configured) */
  readonly fileChanges?: string;
  /** SHA-256 fingerprint of workspace state after setup */
  readonly workspaceFingerprint?: { readonly hash: string; readonly fileCount: number };
  /** Individual trial results (only present when trials.count > 1) */
  readonly trials?: readonly TrialResult[];
  /** Aggregation metadata describing how the final score was computed from trials */
  readonly aggregation?: TrialAggregation;
  /** Whether the trial loop was terminated early due to cost limit */
  readonly costLimited?: boolean;
}

export type EvaluationVerdict = 'pass' | 'fail' | 'borderline';

export interface EvaluatorResult {
  readonly name: string;
  readonly type: EvaluatorKind;
  readonly score: number;
  readonly weight?: number;
  readonly verdict?: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly reasoning?: string;
  readonly rawRequest?: JsonObject;
  readonly evaluatorProviderRequest?: JsonObject;
  readonly evaluatorResults?: readonly EvaluatorResult[];
  /** Optional structured details from code judges (e.g., TP/TN/FP/FN counts). */
  readonly details?: JsonObject;
}

/**
 * Convenience accessor matching the Python hit_count property.
 */
export function getHitCount(result: Pick<EvaluationResult, 'hits'>): number {
  return result.hits.length;
}
