/**
 * Zod schema for eval YAML file format.
 * Used to generate eval.schema.json for AI agent reference.
 *
 * IMPORTANT: This schema describes the YAML input format, not the parsed runtime types.
 * When adding new eval features, update this schema AND run `bun run generate:schema`
 * to regenerate eval.schema.json. The sync test will fail if they diverge.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const JsonObjectSchema = z.object({}).catchall(z.unknown());
const JsonRecordSchema = z.record(z.unknown());
const UnsupportedPromptfooAssertionTypes = new Set([
  'tool-call-f1',
  'skill-used',
  'trajectory:goal-success',
  'trajectory:tool-args-match',
  'trajectory:step-count',
  'trajectory:tool-sequence',
  'trajectory:tool-used',
  'trace-error-spans',
  'trace-span-count',
  'trace-span-duration',
]);

/** Message content: string, structured object, or structured array */
const ContentItemSchema = z.object({
  type: z.enum(['text', 'file', 'image']),
  value: z.string(),
});

const MessageContentSchema = z.union([z.string(), JsonObjectSchema, z.array(ContentItemSchema)]);

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: MessageContentSchema,
});

const InputObjectShorthandSchema = z.object({ role: z.never().optional() }).catchall(z.unknown());

/** Input: string/object shorthand, single message, or message array */
const InputSchema = z.union([
  z.string(),
  MessageSchema,
  InputObjectShorthandSchema,
  z.array(MessageSchema),
]);

/** Expected output: string, object, or message array */
const ExpectedOutputSchema = z.union([z.string(), JsonObjectSchema, z.array(MessageSchema)]);

// ---------------------------------------------------------------------------
// Grader schemas (YAML input format)
// ---------------------------------------------------------------------------

/** Common fields shared by all evaluators */
const EvaluatorCommonSchema = z.object({
  metric: z.string().optional(),
  weight: z.number().min(0).optional(),
  required: z.boolean().optional(),
  /** Minimum score (0-1) for this evaluator to pass. Independent of `required` gate. */
  min_score: z.number().gt(0).lte(1).optional(),
  negate: z.boolean().optional(),
});

/** Prompt: string (inline/file path), promptfoo-shaped object, or executable script config */
const PromptSchema = z.union([
  z.string(),
  z.object({
    command: z.union([z.string(), z.array(z.string())]),
    config: z.record(z.unknown()).optional(),
  }),
  z
    .object({
      id: z.string().optional(),
      label: z.string().optional(),
      raw: z.string().optional(),
      function: z.string().optional(),
      function_file: z.string().optional(),
      path: z.string().optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      config: JsonRecordSchema.optional(),
    })
    .passthrough(),
]);

const PromptsSchema = z.union([PromptSchema, z.array(PromptSchema).min(1)]);

/** Score range for analytic rubrics */
const ScoreRangeSchema = z.object({
  score_range: z.tuple([z.number().int().min(0).max(10), z.number().int().min(0).max(10)]),
  outcome: z.string().min(1),
});

/** Rubric item (checklist or score-range mode) */
const RubricItemSchema = z.object({
  id: z.string().optional(),
  outcome: z.string().optional(),
  operator: z.enum(['correctness', 'contradiction']).optional(),
  weight: z.number().optional(),
  required: z.boolean().optional(),
  /** Minimum score (0-1) for this criterion to pass. */
  min_score: z.number().gt(0).lte(1).optional(),
  score_ranges: z.array(ScoreRangeSchema).optional(),
});

// --- Type-specific evaluator schemas ---

const ScriptGraderSchema = EvaluatorCommonSchema.extend({
  type: z.literal('script'),
  command: z.union([z.string(), z.array(z.string())]),
  cwd: z.string().optional(),
  target: z.union([z.boolean(), z.object({ max_calls: z.number().optional() })]).optional(),
  config: z.record(z.unknown()).optional(),
});

const LlmGraderSchema = EvaluatorCommonSchema.extend({
  type: z.literal('llm-grader'),
  prompt: PromptSchema.optional(),
  rubrics: z.array(RubricItemSchema).optional(),
  model: z.string().optional(),
  target: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  max_steps: z.number().int().min(1).max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const IncludeSchema = z
  .object({
    include: z.string().min(1),
  })
  .strict();

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
  type: z.literal('tool-trajectory'),
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
  type: z.literal('field-accuracy'),
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
  type: z.literal('token-usage'),
  max_total: z.number().min(0).optional(),
  max_input: z.number().min(0).optional(),
  max_output: z.number().min(0).optional(),
});

const ExecutionMetricsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('execution-metrics'),
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
  type: z.literal('is-json'),
});

const EqualsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('equals'),
  value: z.string(),
});

const PromptfooAssertionSchema = EvaluatorCommonSchema.extend({
  type: z.enum([
    'assert-set',
    'llm-rubric',
    'javascript',
    'python',
    'webhook',
    'similar',
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
  ]),
  value: z.unknown().optional(),
  threshold: z.number().min(0).max(1).optional(),
  provider: z.union([z.string(), JsonObjectSchema]).optional(),
  config: JsonRecordSchema.optional(),
  assert: z.array(z.union([z.string(), JsonObjectSchema])).optional(),
  transform: z.union([z.string(), JsonObjectSchema]).optional(),
}).passthrough();

/** Union of all grader types */
const EvaluatorSchema = z.union([
  ScriptGraderSchema,
  LlmGraderSchema,
  PromptfooAssertionSchema,
  IncludeSchema,
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
]);

const AssertionObjectSchema = JsonObjectSchema.superRefine((value, ctx) => {
  if (value.preprocessors !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['preprocessors'],
      message: 'preprocessors has been removed from authored eval YAML. Use transform instead.',
    });
  }
  if (value.postprocess !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postprocess'],
      message: 'postprocess has been removed. Use transform instead.',
    });
  }
  const rawType = value.type;
  if (typeof rawType !== 'string') {
    return;
  }
  const type = rawType.replace(/_/g, '-');
  if (type === 'composite') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: "Unsupported assertion type 'composite'. Use 'assert-set' instead.",
    });
    return;
  }
  const baseType = type.startsWith('not-') ? type.slice(4) : type;
  if (UnsupportedPromptfooAssertionTypes.has(baseType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: `Unsupported promptfoo assertion type '${rawType}'. This type is future scope in AgentV and is not accepted as a custom assertion.`,
    });
  }
});

/** Assertion item: string shorthand (becomes a criteria/rubric grader) or full evaluator config. */
const AssertionItemSchema = z.union([z.string(), AssertionObjectSchema]);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const WorkspaceScriptSchema = z
  .object({
    command: z.union([z.string(), z.array(z.string())]).optional(),
    timeout_ms: z.number().min(0).optional(),
    cwd: z.string().optional(),
  })
  .strict();

const ExtensionHookSchema = z.enum(['beforeAll', 'beforeEach', 'afterEach', 'afterAll']);

const FileExtensionSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('file://'), {
    message: 'file extensions must start with file://',
  })
  .refine(
    (value) => {
      const lastColon = value.lastIndexOf(':');
      return (
        lastColon > 'file://'.length &&
        ExtensionHookSchema.safeParse(value.slice(lastColon + 1)).success
      );
    },
    {
      message: 'file extensions must be of the form file://path/to/hook.ts:beforeAll',
    },
  );

const AgentRulesStringExtensionSchema = z.union([
  z.literal('agentv:agent-rules'),
  z
    .string()
    .startsWith('agentv:agent-rules:')
    .refine(
      (value) => ExtensionHookSchema.safeParse(value.slice('agentv:agent-rules:'.length)).success,
      {
        message: 'agentv:agent-rules hook must be beforeAll, beforeEach, afterEach, or afterAll',
      },
    ),
]);

const AgentRulesPathListSchema = z.union([z.string().min(1), z.array(z.string().min(1))]);

const AgentRulesObjectExtensionSchema = z
  .object({
    id: z.literal('agentv:agent-rules'),
    hook: ExtensionHookSchema.optional(),
    skills: AgentRulesPathListSchema.optional(),
    hooks: AgentRulesPathListSchema.optional(),
    agents: AgentRulesPathListSchema.optional(),
    rules: AgentRulesPathListSchema.optional(),
    config: z
      .object({
        skills: AgentRulesPathListSchema.optional(),
        hooks: AgentRulesPathListSchema.optional(),
        agents: AgentRulesPathListSchema.optional(),
        rules: AgentRulesPathListSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ExtensionSchema = z.union([
  FileExtensionSchema,
  AgentRulesStringExtensionSchema,
  AgentRulesObjectExtensionSchema,
]);

// ---------------------------------------------------------------------------
// Repo lifecycle
// ---------------------------------------------------------------------------

const WorkspaceHookSchema = z
  .object({
    command: z.union([z.string(), z.array(z.string())]).optional(),
    timeout_ms: z.number().optional(),
    timeoutMs: z.number().optional(),
    cwd: z.string().optional(),
    reset: z.enum(['none', 'fast', 'strict']).optional(),
  })
  .strict();

const WorkspaceHooksSchema = z
  .object({
    enabled: z.boolean().optional(),
    before_all: WorkspaceHookSchema.optional(),
    before_each: WorkspaceHookSchema.optional(),
    after_each: WorkspaceHookSchema.optional(),
    after_all: WorkspaceHookSchema.optional(),
  })
  .strict();

const WorkspaceEnvSchema = z
  .object({
    required_commands: z.array(z.string().min(1)).optional(),
    required_python_modules: z.array(z.string().min(1)).optional(),
  })
  .strict();

const WorkspaceSchema = z
  .object({
    template: z.never().optional(),
    scope: z.never().optional(),
    repos: z.never().optional(),
    hooks: WorkspaceHooksSchema.optional(),
    docker: z.never().optional(),
    env: WorkspaceEnvSchema.optional(),
  })
  .strict();

const EnvironmentSetupSchema = z
  .object({
    command: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    args: JsonObjectSchema.optional(),
    env: z.record(z.string()).optional(),
    timeout_seconds: z.number().gt(0).optional(),
  })
  .strict();

const EnvironmentBaseSchema = z.object({
  workdir: z.string().min(1),
  setup: EnvironmentSetupSchema.optional(),
  env: z.record(z.string()).optional(),
});

const HostEnvironmentSchema = EnvironmentBaseSchema.extend({
  type: z.literal('host'),
}).strict();

const DockerEnvironmentMountSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    access: z.enum(['ro', 'rw']).optional(),
    read_only: z.boolean().optional(),
  })
  .strict();

const DockerEnvironmentResourcesSchema = z
  .object({
    cpus: z.number().gt(0).optional(),
    memory: z.string().min(1).optional(),
    disk: z.string().min(1).optional(),
    gpu: z.union([z.boolean(), z.string().min(1)]).optional(),
  })
  .strict();

const DockerEnvironmentSchema = EnvironmentBaseSchema.extend({
  type: z.literal('docker'),
  context: z.string().min(1).optional(),
  dockerfile: z.string().min(1).optional(),
  image: z.string().min(1).optional(),
  resources: DockerEnvironmentResourcesSchema.optional(),
  mounts: z.array(DockerEnvironmentMountSchema).optional(),
  secrets: z.record(z.string()).optional(),
})
  .strict()
  .refine((value) => value.context !== undefined || value.image !== undefined, {
    message: "Docker environment recipes must define either 'image' or 'context'.",
  });

const EnvironmentSchema = z.union([
  z.string().regex(/^\s*file:\/\//, 'environment string must start with file://'),
  HostEnvironmentSchema,
  DockerEnvironmentSchema,
]);

// ---------------------------------------------------------------------------
// Target hooks (eval-level per-target customization)
// ---------------------------------------------------------------------------

const TargetHooksSchema = z
  .object({
    before_all: WorkspaceHookSchema.optional(),
    before_each: WorkspaceHookSchema.optional(),
    after_each: WorkspaceHookSchema.optional(),
    after_all: WorkspaceHookSchema.optional(),
  })
  .strict();

/** Eval target reference: string shorthand or object with hooks */
const EvalTargetRefSchema = z
  .object({
    id: z.string().min(1),
    use_target: z.string().optional(),
    hooks: TargetHooksSchema.optional(),
  })
  .strict();

const EvalLocalTargetSchema = z
  .object({
    id: z.string().min(1).optional(),
    extends: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    config: JsonRecordSchema.optional(),
    prompts: PromptsSchema.optional(),
    transform: z.union([z.string(), JsonObjectSchema]).optional(),
    delay: z.number().min(0).optional(),
    env: z.record(z.string()).optional(),
    environment: z.never().optional(),
    container: z.never().optional(),
    install: z.never().optional(),
    reasoning_effort: z.string().min(1).optional(),
    hooks: TargetHooksSchema.optional(),
  })
  .passthrough();

const EvalTargetSchema = z.union([z.string().min(1), EvalLocalTargetSchema]);
const EvalTargetsSchema = z.union([EvalTargetSchema, z.array(EvalTargetSchema).min(1)]);

// ---------------------------------------------------------------------------
// Execution block
// ---------------------------------------------------------------------------

/** Execution error tolerance: true or false */
const FailOnErrorSchema = z.boolean();

const ExecutionSchema = z.object({
  target: z.string().optional(),
  targets: z.array(z.union([z.string(), EvalTargetRefSchema])).optional(),
  workers: z.never().optional(),
  assert: z.array(AssertionItemSchema).optional(),
  skip_defaults: z.boolean().optional(),
  cache: z.boolean().optional(),
  /** Removed before stable release. Repeat counts belong under evaluate_options.repeat.count. */
  trials: z.never().optional(),
  budget_usd: z.number().min(0).optional(),
  budgetUsd: z.number().min(0).optional(),
  fail_on_error: FailOnErrorSchema.optional(),
  failOnError: FailOnErrorSchema.optional(),
  threshold: z.number().min(0).max(1).optional(),
  workspace: z.never().optional(),
});

const ExperimentRepeatSchema = z
  .object({
    count: z.number().int().min(1),
    strategy: z.enum(['pass_any', 'pass_all', 'mean', 'confidence_interval']).optional(),
    early_exit: z.boolean().optional(),
    cost_limit_usd: z.number().min(0).optional(),
  })
  .strict();

const RunOverrideSchema = z
  .object({
    threshold: z.number().min(0).max(1).optional(),
    repeat: ExperimentRepeatSchema.optional(),
    timeout_seconds: z.number().gt(0).optional(),
    budget_usd: z.number().gt(0).optional(),
  })
  .strict();

const DefaultTestSchema = z
  .object({
    vars: JsonObjectSchema.optional(),
    provider: EvalTargetSchema.optional(),
    providers: EvalTargetsSchema.optional(),
    prompts: PromptsSchema.optional(),
    provider_output: ExpectedOutputSchema.optional(),
    expected_output: z.never().optional(),
    assert: z.array(AssertionItemSchema).optional(),
    assert_scoring_function: z.union([z.string().min(1), JsonObjectSchema]).optional(),
    options: JsonObjectSchema.optional(),
    threshold: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const DefaultTestReferenceSchema = z
  .string()
  .regex(/^\s*(file|ref):\/\//, 'default_test string must start with file:// or ref://');

const EvaluateOptionsSchema = z
  .object({
    budget_usd: z.number().gt(0).optional(),
    max_concurrency: z.number().int().min(1).max(50).optional(),
    cache: z.union([z.boolean(), JsonObjectSchema]).optional(),
    delay: z.number().min(0).optional(),
    generate_suggestions: z.boolean().optional(),
    repeat: z.union([z.number().int().min(1), ExperimentRepeatSchema]).optional(),
    timeout_ms: z.number().gt(0).optional(),
    max_eval_time_ms: z.number().gt(0).optional(),
    filter_range: z.union([z.tuple([z.number(), z.number()]), z.string()]).optional(),
  })
  .strict();

/** A single turn in a multi-turn conversation */
const ConversationTurnSchema = z.object({
  input: z.union([z.string(), MessageContentSchema]),
  expected_output: z.union([z.string(), MessageContentSchema]).optional(),
  assert: z.array(AssertionItemSchema).optional(),
});

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

const TestExecutionSchema = ExecutionSchema.omit({ target: true, targets: true }).strict();

const EvalTestSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().optional(),
  vars: JsonObjectSchema.optional(),
  provider: EvalTargetSchema.optional(),
  providers: EvalTargetsSchema.optional(),
  prompts: PromptsSchema.optional(),
  provider_output: ExpectedOutputSchema.optional(),
  input: z.never().optional(),
  input_files: z.array(z.string()).optional(),
  expected_output: z.never().optional(),
  assert: z.array(AssertionItemSchema).optional(),
  assert_scoring_function: z.union([z.string().min(1), JsonObjectSchema]).optional(),
  options: JsonObjectSchema.optional(),
  threshold: z.number().min(0).max(1).optional(),
  execution: TestExecutionSchema.optional(),
  run: RunOverrideSchema.optional(),
  environment: EnvironmentSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  conversation_id: z.string().optional(),
  suite: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  on_dependency_failure: z.enum(['skip', 'fail', 'run']).optional(),
  mode: z.enum(['conversation']).optional(),
  turns: z.array(ConversationTurnSchema).min(1).optional(),
  aggregation: z.enum(['mean', 'min', 'max']).optional(),
  on_turn_failure: z.enum(['continue', 'stop']).optional(),
  window_size: z.number().int().min(1).optional(),
});

const SelectPatternSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const SelectMetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
]);
const TestIncludeSelectSchema = z
  .object({
    test_ids: SelectPatternSchema.optional(),
    tags: SelectPatternSchema.optional(),
    metadata: z.record(SelectMetadataValueSchema).optional(),
  })
  .strict();

const TestIncludeSchema = z
  .object({
    include: z.string().min(1),
    type: z.enum(['suite', 'tests']),
    select: z.union([SelectPatternSchema, TestIncludeSelectSchema]).optional(),
    run: RunOverrideSchema.optional(),
  })
  .strict();

const TestsSchema = z.union([
  z.array(z.union([EvalTestSchema, TestIncludeSchema, z.string().min(1)])),
  z.string().min(1),
]);

const ConfigRuntimeSchema = z.union([
  z.enum(['host', 'profile', 'sandbox']),
  z
    .object({
      mode: z.enum(['host', 'profile', 'sandbox']),
    })
    .passthrough(),
]);

const ConfigTargetSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    runtime: ConfigRuntimeSchema,
    config: JsonRecordSchema.optional(),
    environment: z.never().optional(),
    container: z.never().optional(),
    install: z.never().optional(),
  })
  .strict();

const ConfigGraderSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    config: JsonRecordSchema.optional(),
  })
  .strict();

const ConfigDefaultsSchema = z
  .object({
    target: z.string().min(1).optional(),
    grader: z.string().min(1).optional(),
  })
  .strict();

const ScenarioConfigSchema = z
  .object({
    vars: JsonObjectSchema.optional(),
    provider: EvalTargetSchema.optional(),
    providers: EvalTargetsSchema.optional(),
    prompts: PromptsSchema.optional(),
    provider_output: ExpectedOutputSchema.optional(),
    assert: z.array(AssertionItemSchema).optional(),
    options: JsonObjectSchema.optional(),
    threshold: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const ScenarioSchema = z
  .object({
    description: z.string().optional(),
    config: z.array(ScenarioConfigSchema).optional(),
    tests: z.array(EvalTestSchema).optional(),
  })
  .strict();

const DerivedMetricSchema = z
  .object({
    name: z.string().min(1),
    value: z.union([z.string().min(1), JsonObjectSchema]),
  })
  .strict();

const TagsSchema = z.union([
  z.array(z.string()),
  z.record(z.union([z.string(), z.number(), z.boolean()])),
]);

const TOP_LEVEL_IMPORTS_MESSAGE =
  "Top-level 'imports' is not supported. Run eval files directly with CLI multi-file selection and tags for grouping. For raw case files, use tests: file://... or string entries under tests. For reusable config, use prompts: file://..., default_test: file://..., and environment: file://... for coding-agent testbeds.";

// ---------------------------------------------------------------------------
// Top-level eval file
// ---------------------------------------------------------------------------

export const EvalFileSchema: z.ZodType = z
  .object({
    $schema: z.string().optional(),
    // Metadata
    name: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    version: z.string().optional(),
    author: z.string().optional(),
    tags: TagsSchema.optional(),
    license: z.string().optional(),
    requires: z.object({ agentv: z.string().optional() }).optional(),
    expected_output: z.never().optional(),
    // Suite-level input
    input: z.never().optional(),
    prompts: PromptsSchema.optional(),
    // Suite-level input_files shorthand
    input_files: z.array(z.string()).optional(),
    imports: z.never({ invalid_type_error: TOP_LEVEL_IMPORTS_MESSAGE }).optional(),
    // Tests (inline raw cases, legacy include entries, or external raw-case path)
    tests: TestsSchema.optional(),
    // Shared composable config graph fields
    graders: z.union([z.array(ConfigGraderSchema), z.string().min(1)]).optional(),
    defaults: z.union([ConfigDefaultsSchema, z.string().min(1)]).optional(),
    // Deprecated aliases
    eval_cases: TestsSchema.optional(),
    // Target
    target: z.union([z.string().min(1), EvalLocalTargetSchema]).optional(),
    targets: EvalTargetsSchema.optional(),
    providers: z.never().optional(),
    model: z.never().optional(),
    // Run/result grouping label and flat run controls
    experiment: z.string().min(1).optional(),
    repeat: z.never().optional(),
    runs: z.never().optional(),
    early_exit: z.never().optional(),
    timeout_seconds: z.number().gt(0).optional(),
    evaluate_options: EvaluateOptionsSchema.optional(),
    budget_usd: z.never().optional(),
    threshold: z.number().min(0).max(1).optional(),
    default_test: z.union([DefaultTestReferenceSchema, DefaultTestSchema]).optional(),
    environment: EnvironmentSchema.optional(),
    scenarios: z.array(ScenarioSchema).optional(),
    derived_metrics: z.array(DerivedMetricSchema).optional(),
    output_path: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    env: z.record(z.string()).optional(),
    nunjucks_filters: z.union([JsonObjectSchema, z.array(z.string().min(1))]).optional(),
    extensions: z.array(ExtensionSchema).optional(),
    on_run_complete: z.never().optional(),
    policy: z.never().optional(),
    execution: z.never().optional(),
    // Suite-level assert entries
    assert: z.array(AssertionItemSchema).optional(),
    preprocessors: z.never().optional(),
    // Workspace (inline object or path to external workspace YAML file)
    workspace: z.union([WorkspaceSchema, z.string()]).optional(),
  })
  .refine(
    (value) =>
      value.tests !== undefined || value.eval_cases !== undefined || value.scenarios !== undefined,
    { message: "Eval files must define 'tests' or 'scenarios'." },
  );
