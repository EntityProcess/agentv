import type { TokenUsage, ToolTrajectoryEvaluatorConfig, TraceSummary } from './trace.js';

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
  // Allow messages with tool_calls but no content (for expected_output format)
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
  'code-judge',
  'llm-judge',
  'rubric',
  'composite',
  'tool-trajectory',
  'field-accuracy',
  'latency',
  'cost',
  'token-usage',
  'execution-metrics',
  'agent-judge',
  'contains',
  'contains-any',
  'contains-all',
  'icontains',
  'icontains-any',
  'icontains-all',
  'starts-with',
  'ends-with',
  'regex',
  'is-json',
  'equals',
  'rubrics',
  'inline-assert',
] as const;

export type EvaluatorKind = (typeof EVALUATOR_KIND_VALUES)[number];

const EVALUATOR_KIND_SET: ReadonlySet<string> = new Set(EVALUATOR_KIND_VALUES);

export function isEvaluatorKind(value: unknown): value is EvaluatorKind {
  return typeof value === 'string' && EVALUATOR_KIND_SET.has(value);
}

/**
 * Configuration for enabling target access in code-judge evaluators.
 * When present, the runtime will start a local proxy server that allows
 * the script to invoke configured targets without direct credential access.
 */
export type TargetAccessConfig = {
  /** Maximum number of target invocations allowed per execution (default: 50) */
  readonly max_calls?: number;
};

/**
 * Configuration for workspace lifecycle commands (before_all, after_all, before_each, after_each).
 * Commands are executed with workspace context passed via stdin.
 */
export type WorkspaceScriptConfig = {
  /** Command array to execute (e.g., ["bun", "run", "setup.ts"]) */
  readonly command: readonly string[];
  /** @deprecated Use `command` instead */
  readonly script?: readonly string[];
  /** Optional timeout in milliseconds (default: 60000 for setup, 30000 for teardown) */
  readonly timeout_ms?: number;
  readonly timeoutMs?: number;
  /** Optional working directory for command execution */
  readonly cwd?: string;
};

/**
 * Workspace configuration for eval tests.
 * Can be specified at suite level and overridden per-case.
 * Merge strategy: template/scripts replaced, env deep-merged.
 *
 * Lifecycle hooks follow bun:test/Vitest naming:
 * - before_all: runs ONCE before first test, creates shared workspace
 * - after_all: runs ONCE after last test, final cleanup
 * - before_each: runs before each test (optional)
 * - after_each: runs after each test (e.g., reset git state)
 */
export type RepoSource =
  | { readonly type: 'git'; readonly url: string }
  | { readonly type: 'local'; readonly path: string };

export type RepoCheckout = {
  readonly ref?: string;
  readonly resolve?: 'remote' | 'local';
  readonly ancestor?: number;
};

export type RepoClone = {
  readonly depth?: number;
  readonly filter?: string;
  readonly sparse?: readonly string[];
};

export type RepoConfig = {
  readonly path: string;
  readonly source: RepoSource;
  readonly checkout?: RepoCheckout;
  readonly clone?: RepoClone;
};

export type WorkspaceHookConfig = {
  /** Optional command array to execute (e.g., ["bun", "run", "setup.ts"]) */
  readonly command?: readonly string[];
  /** @deprecated Use `command` instead */
  readonly script?: readonly string[];
  /** Optional timeout in milliseconds */
  readonly timeout_ms?: number;
  readonly timeoutMs?: number;
  /** Optional working directory for command execution */
  readonly cwd?: string;
  /** Optional reset policy for this hook */
  readonly reset?: 'none' | 'fast' | 'strict';
};

export type WorkspaceHooksConfig = {
  /** Whether hooks are enabled (default: true). When false, all hooks are skipped. */
  readonly enabled?: boolean;
  /** Runs once before first test in the workspace lifecycle */
  readonly before_all?: WorkspaceHookConfig;
  /** Runs before each test case */
  readonly before_each?: WorkspaceHookConfig;
  /** Runs after each test case */
  readonly after_each?: WorkspaceHookConfig;
  /** Runs once after final test in the workspace lifecycle */
  readonly after_all?: WorkspaceHookConfig;
};

export type WorkspaceConfig = {
  /** Template directory or .code-workspace file. Directories are copied to temp workspace.
   *  .code-workspace files are used by VS Code providers; CLI providers use the parent directory. */
  readonly template?: string;
  /** Isolation strategy for workspace: shared (default) or per_test */
  readonly isolation?: 'shared' | 'per_test';
  /** Repository definitions to clone/checkout into workspace */
  readonly repos?: readonly RepoConfig[];
  /** Workspace lifecycle hooks */
  readonly hooks?: WorkspaceHooksConfig;
  /** Workspace materialization mode */
  readonly mode?: 'pooled' | 'temp' | 'static';
  /** Required when mode=static: use this existing directory directly */
  readonly path?: string;
};

export type CodeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'code-judge';
  readonly command: readonly string[];
  /** @deprecated Use `command` instead */
  readonly script?: readonly string[];
  readonly resolvedScriptPath?: string;
  readonly cwd?: string;
  readonly resolvedCwd?: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
  /** Pass-through configuration for the code-judge (any unrecognized YAML properties) */
  readonly config?: JsonObject;
  /** When present, enables target access via local proxy */
  readonly target?: TargetAccessConfig;
};

/**
 * Executable prompt template configuration.
 * Matches code-judge pattern for consistency.
 */
export type PromptScriptConfig = {
  /** Command array to execute (e.g., ["bun", "run", "template.ts"]) */
  readonly command: readonly string[];
  /** @deprecated Use `command` instead */
  readonly script?: readonly string[];
  /** Pass-through configuration for the prompt template */
  readonly config?: Record<string, unknown>;
};

export type LlmJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'llm-judge';
  /** Text prompt (inline or file path) or executable script config */
  readonly prompt?: string | PromptScriptConfig;
  readonly promptPath?: string;
  /** Resolved absolute path for prompt file (used for text template prompts) */
  readonly resolvedPromptPath?: string;
  /** Resolved script array for executable prompts (matches code-judge pattern) */
  readonly resolvedPromptScript?: readonly string[];
  readonly rubrics?: readonly RubricItem[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
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
  | { readonly type: 'code-judge'; readonly path: string; readonly cwd?: string }
  | {
      readonly type: 'llm-judge';
      readonly prompt?: string;
      readonly promptPath?: string;
      readonly model?: string;
    }
  | { readonly type: 'threshold'; readonly threshold: number };

export type CompositeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'composite';
  readonly assertions: readonly EvaluatorConfig[];
  readonly aggregator: CompositeAggregatorConfig;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Match type for field accuracy evaluation.
 * Note: For fuzzy string matching (Levenshtein, Jaro-Winkler, etc.), use a code-judge evaluator.
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
 * Configuration for the field-accuracy evaluator.
 */
export type FieldAccuracyEvaluatorConfig = {
  readonly name: string;
  readonly type: 'field-accuracy';
  /** Fields to compare between candidate and expected */
  readonly fields: readonly FieldConfig[];
  /** Strategy for combining field scores (default: weighted_average) */
  readonly aggregation?: FieldAggregationType;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
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
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
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
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the token-usage evaluator.
 * Checks provider-reported token usage against configured limits.
 */
export type TokenUsageEvaluatorConfig = {
  readonly name: string;
  readonly type: 'token-usage';
  /** Maximum allowed total tokens (input + output + cached, when present) */
  readonly max_total?: number;
  /** Maximum allowed input tokens (prompt) */
  readonly max_input?: number;
  /** Maximum allowed output tokens (completion) */
  readonly max_output?: number;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the execution-metrics evaluator.
 * Provides declarative threshold-based checks on execution metrics.
 * Only specified thresholds are checked; omitted ones are ignored.
 */
export type ExecutionMetricsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'execution-metrics';
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
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the agent-judge evaluator.
 * Runs an agentic investigation loop to audit workspaces and verify criteria.
 * Two modes:
 * - Built-in: Uses AI SDK generateText() with sandboxed filesystem tools
 * - Judge target: Delegates to an external agent provider via Provider.invoke()
 */
export type AgentJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'agent-judge';
  /** Custom evaluation prompt (inline text or file path) */
  readonly prompt?: string;
  readonly promptPath?: string;
  /** Resolved absolute path for prompt file */
  readonly resolvedPromptPath?: string;
  /** Rubric items for structured evaluation (reuses llm-judge rubric infra) */
  readonly rubrics?: readonly RubricItem[];
  /** Maximum agent steps for built-in mode (default 10, max 50) */
  readonly max_steps?: number;
  /** Temperature for built-in mode (default 0) */
  readonly temperature?: number;
  /** Target name — delegates agent loop to this provider instead of built-in mode */
  readonly target?: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the contains assertion evaluator.
 * Checks whether the candidate output contains a specified substring.
 */
export type ContainsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'contains';
  readonly value: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the contains_any assertion evaluator.
 * Checks whether the candidate output contains ANY of the specified substrings.
 */
export type ContainsAnyEvaluatorConfig = {
  readonly name: string;
  readonly type: 'contains-any';
  readonly value: readonly string[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the contains_all assertion evaluator.
 * Checks whether the candidate output contains ALL of the specified substrings.
 */
export type ContainsAllEvaluatorConfig = {
  readonly name: string;
  readonly type: 'contains-all';
  readonly value: readonly string[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the icontains assertion evaluator.
 * Case-insensitive check whether the candidate output contains a specified substring.
 */
export type IcontainsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'icontains';
  readonly value: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the icontains_any assertion evaluator.
 * Case-insensitive check whether the candidate output contains ANY of the specified substrings.
 */
export type IcontainsAnyEvaluatorConfig = {
  readonly name: string;
  readonly type: 'icontains-any';
  readonly value: readonly string[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the icontains_all assertion evaluator.
 * Case-insensitive check whether the candidate output contains ALL of the specified substrings.
 */
export type IcontainsAllEvaluatorConfig = {
  readonly name: string;
  readonly type: 'icontains-all';
  readonly value: readonly string[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the starts_with assertion evaluator.
 * Checks whether the candidate output starts with a specified string (both trimmed).
 */
export type StartsWithEvaluatorConfig = {
  readonly name: string;
  readonly type: 'starts-with';
  readonly value: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the ends_with assertion evaluator.
 * Checks whether the candidate output ends with a specified string (both trimmed).
 */
export type EndsWithEvaluatorConfig = {
  readonly name: string;
  readonly type: 'ends-with';
  readonly value: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the regex assertion evaluator.
 * Checks whether the candidate output matches a regular expression pattern.
 */
export type RegexEvaluatorConfig = {
  readonly name: string;
  readonly type: 'regex';
  readonly value: string;
  /** Optional regex flags (e.g., "i" for case-insensitive, "m" for multiline) */
  readonly flags?: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the is_json assertion evaluator.
 * Checks whether the candidate output is valid JSON.
 */
export type IsJsonEvaluatorConfig = {
  readonly name: string;
  readonly type: 'is-json';
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the equals assertion evaluator.
 * Checks whether the candidate output exactly equals a specified string.
 */
export type EqualsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'equals';
  readonly value: string;
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the rubrics evaluator.
 * Evaluates candidate output against a list of rubric criteria.
 */
export type RubricsEvaluatorConfig = {
  readonly name: string;
  readonly type: 'rubrics';
  readonly criteria: readonly RubricItem[];
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
};

/**
 * Configuration for the inline-assert evaluator.
 * Wraps an AssertFn for in-process evaluation via the evaluate() API.
 */
export type InlineAssertEvaluatorConfig = {
  readonly name: string;
  readonly type: 'inline-assert';
  readonly weight?: number;
  readonly required?: boolean | number;
  readonly negate?: boolean;
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
  | AgentJudgeEvaluatorConfig
  | ContainsEvaluatorConfig
  | ContainsAnyEvaluatorConfig
  | ContainsAllEvaluatorConfig
  | IcontainsEvaluatorConfig
  | IcontainsAnyEvaluatorConfig
  | IcontainsAllEvaluatorConfig
  | StartsWithEvaluatorConfig
  | EndsWithEvaluatorConfig
  | RegexEvaluatorConfig
  | IsJsonEvaluatorConfig
  | EqualsEvaluatorConfig
  | RubricsEvaluatorConfig
  | InlineAssertEvaluatorConfig;

/**
 * Eval test definition sourced from AgentV specs.
 */
export interface EvalTest {
  readonly id: string;
  readonly dataset?: string;
  readonly conversation_id?: string;
  readonly question: string;
  readonly input: readonly TestMessage[];
  readonly input_segments: readonly JsonObject[];
  readonly expected_output: readonly JsonObject[];
  readonly reference_answer?: string;
  readonly guideline_paths: readonly string[];
  readonly guideline_patterns?: readonly string[];
  readonly file_paths: readonly string[];
  readonly criteria: string;
  readonly evaluator?: EvaluatorKind;
  readonly assertions?: readonly EvaluatorConfig[];
  /** Workspace configuration (merged from suite-level and case-level) */
  readonly workspace?: WorkspaceConfig;
  /** Arbitrary metadata passed to workspace scripts via stdin */
  readonly metadata?: Record<string, unknown>;
  /** Per-test target override (matrix evaluation) */
  readonly targets?: readonly string[];
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
  readonly scores?: readonly EvaluatorResult[];
  readonly error?: string;
  readonly costUsd?: number;
  /** Primary classification for this trial attempt */
  readonly executionStatus?: ExecutionStatus;
  /** Pipeline stage where failure occurred */
  readonly failureStage?: FailureStage;
  /** Machine-readable failure reason code */
  readonly failureReasonCode?: string;
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
 * Primary classification of evaluation outcome.
 * - 'ok': evaluation completed, score reflects model quality (score >= 0.8)
 * - 'quality_failure': evaluation completed but model scored below threshold
 * - 'execution_error': evaluation could not complete due to infrastructure/tooling error
 */
export type ExecutionStatus = 'ok' | 'quality_failure' | 'execution_error';

/**
 * Pipeline stage where the failure occurred.
 */
export type FailureStage = 'setup' | 'repo_setup' | 'agent' | 'evaluator' | 'teardown';

/**
 * Structured error detail for execution failures.
 */
export interface ExecutionError {
  readonly message: string;
  readonly stage: FailureStage;
}

/**
 * Tolerance for execution errors in an eval run.
 * - `true`: halt on first execution error
 * - `false`: never halt on errors (default)
 */
export type FailOnError = boolean;

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
  readonly answer: string;
  readonly target: string;
  readonly reasoning?: string;
  /** Token usage metrics from provider (optional) */
  readonly tokenUsage?: TokenUsage;
  /** Total cost in USD (optional, from provider) */
  readonly costUsd?: number;
  /** Total execution duration in milliseconds (optional) */
  readonly durationMs?: number;
  /** ISO 8601 timestamp when execution started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended */
  readonly endTime?: string;
  readonly requests?: {
    readonly agent?: JsonObject;
    readonly lm?: JsonObject;
    readonly evaluator?: JsonObject;
  };
  readonly scores?: readonly EvaluatorResult[];
  readonly error?: string;
  /** Lightweight summary of the execution trace (always included when available) */
  readonly trace?: TraceSummary;
  /** Path to the temporary workspace directory (included on failure for debugging) */
  readonly workspacePath?: string;
  /** Input messages or prompt string sent to the agent */
  readonly input?: readonly import('./providers/types.js').Message[] | string;
  /** Full output messages from agent execution (only included when --trace flag is set) */
  readonly output?: readonly import('./providers/types.js').Message[];
  /** Captured output from workspace before_all script */
  readonly beforeAllOutput?: string;
  /** Captured output from workspace before_each script */
  readonly beforeEachOutput?: string;
  /** Captured output from workspace after_all script */
  readonly afterAllOutput?: string;
  /** Captured output from workspace after_each script */
  readonly afterEachOutput?: string;
  /** Unified diff of workspace file changes (when workspace_template is configured) */
  readonly fileChanges?: string;
  /** Individual trial results (only present when trials.count > 1) */
  readonly trials?: readonly TrialResult[];
  /** Aggregation metadata describing how the final score was computed from trials */
  readonly aggregation?: TrialAggregation;
  /** Whether the trial loop was terminated early due to cost limit */
  readonly costLimited?: boolean;
  /** Whether the evaluation was skipped due to suite-level budget exhaustion */
  readonly budgetExceeded?: boolean;
  /** Primary classification: ok, quality_failure, or execution_error */
  readonly executionStatus: ExecutionStatus;
  /** Pipeline stage where failure occurred (only when executionStatus !== 'ok') */
  readonly failureStage?: FailureStage;
  /** Machine-readable failure reason code (only when executionStatus !== 'ok') */
  readonly failureReasonCode?: string;
  /** Structured error detail (only when executionStatus === 'execution_error') */
  readonly executionError?: ExecutionError;
}

export type EvaluationVerdict = 'pass' | 'fail' | 'borderline' | 'skip';

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
  readonly scores?: readonly EvaluatorResult[];
  /** Optional structured details from code judges (e.g., TP/TN/FP/FN counts). */
  readonly details?: JsonObject;
  /** Token usage from LLM calls made by this evaluator (optional). */
  readonly tokenUsage?: TokenUsage;
  /** Wall-clock duration of this judge execution in milliseconds. */
  readonly durationMs?: number;
  /** ISO 8601 UTC timestamp when this judge started executing. */
  readonly startedAt?: string;
  /** ISO 8601 UTC timestamp when this judge finished executing. */
  readonly endedAt?: string;
}

/**
 * Convenience accessor matching the Python hit_count property.
 */
export function getHitCount(result: Pick<EvaluationResult, 'hits'>): number {
  return result.hits.length;
}
