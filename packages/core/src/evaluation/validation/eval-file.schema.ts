/**
 * Zod schema for eval YAML file format.
 * Used to generate eval-schema.json for AI agent reference.
 *
 * IMPORTANT: This schema describes the YAML input format, not the parsed runtime types.
 * When adding new eval features, update this schema AND run `bun run generate:schema`
 * to regenerate eval-schema.json. The sync test will fail if they diverge.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Message content: string or structured array */
const ContentItemSchema = z.object({
  type: z.enum(['text', 'file', 'image']),
  value: z.string(),
});

const MessageContentSchema = z.union([z.string(), z.array(ContentItemSchema)]);

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: MessageContentSchema,
});

/** Input: string shorthand or message array */
const InputSchema = z.union([z.string(), z.array(MessageSchema)]);

/** Expected output: string, object, or message array */
const ExpectedOutputSchema = z.union([z.string(), z.record(z.unknown()), z.array(MessageSchema)]);

// ---------------------------------------------------------------------------
// Evaluator schemas (YAML input format)
// ---------------------------------------------------------------------------

/** Common fields shared by all evaluators */
const EvaluatorCommonSchema = z.object({
  name: z.string().optional(),
  weight: z.number().min(0).optional(),
  required: z.union([z.boolean(), z.number().gt(0).lte(1)]).optional(),
  /** Minimum score (0-1) for this evaluator to pass. Independent of `required` gate. */
  min_score: z.number().gt(0).lte(1).optional(),
  negate: z.boolean().optional(),
});

/** Prompt: string (inline/file path) or executable script config */
const PromptSchema = z.union([
  z.string(),
  z.object({
    command: z.union([z.string(), z.array(z.string())]).optional(),
    script: z.union([z.string(), z.array(z.string())]).optional(),
    config: z.record(z.unknown()).optional(),
  }),
]);

/** Score range for analytic rubrics */
const ScoreRangeSchema = z.object({
  score_range: z.tuple([z.number().int().min(0).max(10), z.number().int().min(0).max(10)]),
  outcome: z.string().min(1),
});

/** Rubric item (checklist or score-range mode) */
const RubricItemSchema = z.object({
  id: z.string().optional(),
  outcome: z.string().optional(),
  weight: z.number().optional(),
  required: z.boolean().optional(),
  required_min_score: z.number().int().min(0).max(10).optional(),
  score_ranges: z.array(ScoreRangeSchema).optional(),
});

// --- Type-specific evaluator schemas ---

const CodeGraderSchema = EvaluatorCommonSchema.extend({
  type: z.enum(['code-grader', 'code_grader']),
  command: z.union([z.string(), z.array(z.string())]),
  script: z.union([z.string(), z.array(z.string())]).optional(),
  cwd: z.string().optional(),
  target: z.union([z.boolean(), z.object({ max_calls: z.number().optional() })]).optional(),
  config: z.record(z.unknown()).optional(),
});

const LlmGraderSchema = EvaluatorCommonSchema.extend({
  type: z.enum(['llm-grader', 'llm_grader']),
  prompt: PromptSchema.optional(),
  rubrics: z.array(RubricItemSchema).optional(),
  model: z.string().optional(),
  target: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  max_steps: z.number().int().min(1).max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

/** Aggregator configs for composite evaluator */
const AggregatorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('weighted_average'),
    weights: z.record(z.number()).optional(),
  }),
  z.object({
    type: z.literal('threshold'),
    threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('code-grader'),
    path: z.string(),
    cwd: z.string().optional(),
  }),
  z.object({
    type: z.literal('llm-grader'),
    prompt: z.string().optional(),
    model: z.string().optional(),
  }),
]);

// Use z.lazy for recursive composite evaluator
const CompositeSchema: z.ZodType = z.lazy(() =>
  EvaluatorCommonSchema.extend({
    type: z.literal('composite'),
    assertions: z.array(EvaluatorSchema).optional(),
    evaluators: z.array(EvaluatorSchema).optional(),
    aggregator: AggregatorSchema,
  }),
);

const ArgsMatchSchema = z.union([
  z.enum(['exact', 'ignore', 'subset', 'superset']),
  z.array(z.string()),
]);

const ToolTrajectoryExpectedItemSchema = z.object({
  tool: z.string(),
  args: z.union([z.literal('any'), z.record(z.unknown())]).optional(),
  max_duration_ms: z.number().min(0).optional(),
  maxDurationMs: z.number().min(0).optional(),
  args_match: ArgsMatchSchema.optional(),
  argsMatch: ArgsMatchSchema.optional(),
});

const ToolTrajectorySchema = EvaluatorCommonSchema.extend({
  type: z.enum(['tool-trajectory', 'tool_trajectory']),
  mode: z.enum(['any_order', 'in_order', 'exact', 'subset', 'superset']),
  minimums: z.record(z.number().int().min(0)).optional(),
  expected: z.array(ToolTrajectoryExpectedItemSchema).optional(),
  args_match: ArgsMatchSchema.optional(),
  argsMatch: ArgsMatchSchema.optional(),
});

const FieldConfigSchema = z.object({
  path: z.string(),
  match: z.enum(['exact', 'numeric_tolerance', 'date']),
  required: z.boolean().optional(),
  weight: z.number().optional(),
  tolerance: z.number().min(0).optional(),
  relative: z.boolean().optional(),
  formats: z.array(z.string()).optional(),
});

const FieldAccuracySchema = EvaluatorCommonSchema.extend({
  type: z.enum(['field-accuracy', 'field_accuracy']),
  fields: z.array(FieldConfigSchema).min(1),
  aggregation: z.enum(['weighted_average', 'all_or_nothing']).optional(),
});

const LatencySchema = EvaluatorCommonSchema.extend({
  type: z.literal('latency'),
  threshold: z.number().min(0),
});

const CostSchema = EvaluatorCommonSchema.extend({
  type: z.literal('cost'),
  budget: z.number().min(0),
});

const TokenUsageSchema = EvaluatorCommonSchema.extend({
  type: z.enum(['token-usage', 'token_usage']),
  max_total: z.number().min(0).optional(),
  max_input: z.number().min(0).optional(),
  max_output: z.number().min(0).optional(),
});

const ExecutionMetricsSchema = EvaluatorCommonSchema.extend({
  type: z.enum(['execution-metrics', 'execution_metrics']),
  max_tool_calls: z.number().min(0).optional(),
  max_llm_calls: z.number().min(0).optional(),
  max_tokens: z.number().min(0).optional(),
  max_cost_usd: z.number().min(0).optional(),
  max_duration_ms: z.number().min(0).optional(),
  target_exploration_ratio: z.number().min(0).max(1).optional(),
  exploration_tolerance: z.number().min(0).optional(),
});

const ContainsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('contains'),
  value: z.string(),
});

const RegexSchema = EvaluatorCommonSchema.extend({
  type: z.literal('regex'),
  value: z.string(),
});

const IsJsonSchema = EvaluatorCommonSchema.extend({
  type: z.enum(['is-json', 'is_json']),
});

const EqualsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('equals'),
  value: z.string(),
});

const RubricsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('rubrics'),
  criteria: z.array(RubricItemSchema).min(1),
});

/** Union of all evaluator types */
const EvaluatorSchema = z.union([
  CodeGraderSchema,
  LlmGraderSchema,
  CompositeSchema,
  ToolTrajectorySchema,
  FieldAccuracySchema,
  LatencySchema,
  CostSchema,
  TokenUsageSchema,
  ExecutionMetricsSchema,
  ContainsSchema,
  RegexSchema,
  IsJsonSchema,
  EqualsSchema,
  RubricsSchema,
]);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const WorkspaceScriptSchema = z.object({
  command: z.union([z.string(), z.array(z.string())]).optional(),
  script: z.union([z.string(), z.array(z.string())]).optional(),
  timeout_ms: z.number().min(0).optional(),
  cwd: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Repo lifecycle
// ---------------------------------------------------------------------------

const RepoSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git'), url: z.string().url() }),
  z.object({ type: z.literal('local'), path: z.string() }),
]);

const RepoCheckoutSchema = z.object({
  ref: z.string().optional(),
  resolve: z.enum(['remote', 'local']).optional(),
  ancestor: z.number().int().min(0).optional(),
});

const RepoCloneSchema = z.object({
  depth: z.number().int().min(1).optional(),
  filter: z.string().optional(),
  sparse: z.array(z.string()).optional(),
});

const RepoSchema = z.object({
  path: z.string(),
  source: RepoSourceSchema,
  checkout: RepoCheckoutSchema.optional(),
  clone: RepoCloneSchema.optional(),
});

const WorkspaceHookSchema = z.object({
  command: z.array(z.string()).optional(),
  script: z.array(z.string()).optional(),
  timeout_ms: z.number().optional(),
  timeoutMs: z.number().optional(),
  cwd: z.string().optional(),
  reset: z.enum(['none', 'fast', 'strict']).optional(),
});

const WorkspaceHooksSchema = z.object({
  enabled: z.boolean().optional(),
  before_all: WorkspaceHookSchema.optional(),
  before_each: WorkspaceHookSchema.optional(),
  after_each: WorkspaceHookSchema.optional(),
  after_all: WorkspaceHookSchema.optional(),
});

const WorkspaceSchema = z
  .object({
    template: z.string().optional(),
    isolation: z.enum(['shared', 'per_test']).optional(),
    repos: z.array(RepoSchema).optional(),
    hooks: WorkspaceHooksSchema.optional(),
    mode: z.enum(['pooled', 'temp', 'static']).optional(),
    path: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Execution block
// ---------------------------------------------------------------------------

const TrialsSchema = z.object({
  count: z.number().int().min(1),
  strategy: z.enum(['pass_at_k', 'mean', 'confidence_interval']).optional(),
  cost_limit_usd: z.number().min(0).optional(),
  costLimitUsd: z.number().min(0).optional(),
});

/** Execution error tolerance: true or false */
const FailOnErrorSchema = z.boolean();

const ExecutionSchema = z.object({
  target: z.string().optional(),
  targets: z.array(z.string()).optional(),
  workers: z.number().int().min(1).max(50).optional(),
  assertions: z.array(EvaluatorSchema).optional(),
  evaluators: z.array(EvaluatorSchema).optional(),
  skip_defaults: z.boolean().optional(),
  cache: z.boolean().optional(),
  trials: TrialsSchema.optional(),
  total_budget_usd: z.number().min(0).optional(),
  totalBudgetUsd: z.number().min(0).optional(),
  fail_on_error: FailOnErrorSchema.optional(),
  failOnError: FailOnErrorSchema.optional(),
  threshold: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

const EvalTestSchema = z.object({
  id: z.string().min(1),
  criteria: z.string().optional(),
  input: InputSchema.optional(),
  input_files: z.array(z.string()).optional(),
  expected_output: ExpectedOutputSchema.optional(),
  assertions: z.array(EvaluatorSchema).optional(),
  evaluators: z.array(EvaluatorSchema).optional(),
  execution: ExecutionSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  conversation_id: z.string().optional(),
  suite: z.string().optional(),
  note: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Top-level eval file
// ---------------------------------------------------------------------------

export const EvalFileSchema = z.object({
  $schema: z.string().optional(),
  // Metadata
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  requires: z.object({ agentv: z.string().optional() }).optional(),
  // Suite-level input
  input: InputSchema.optional(),
  // Suite-level input_files shorthand
  input_files: z.array(z.string()).optional(),
  // Tests (array or external file path)
  tests: z.union([z.array(EvalTestSchema), z.string()]),
  // Deprecated aliases
  eval_cases: z.union([z.array(EvalTestSchema), z.string()]).optional(),
  // Target
  target: z.string().optional(),
  // Execution
  execution: ExecutionSchema.optional(),
  // Suite-level assertions
  assertions: z.array(EvaluatorSchema).optional(),
  // Workspace (inline object or path to external workspace YAML file)
  workspace: z.union([WorkspaceSchema, z.string()]).optional(),
});
