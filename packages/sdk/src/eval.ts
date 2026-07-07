import { stringify as stringifyYaml } from 'yaml';

const EVAL_SUITE_SYMBOL = Symbol.for('agentv/eval-suite');
const TO_EVAL_YAML_OBJECT_SYMBOL = Symbol.for('agentv/to-eval-yaml-object');

const KNOWN_SNAKE_CASE_KEYS = {
  afterAll: 'after_all',
  afterEach: 'after_each',
  argsMatch: 'args_match',
  beforeAll: 'before_all',
  beforeEach: 'before_each',
  budgetUsd: 'budget_usd',
  conversationId: 'conversation_id',
  dependsOn: 'depends_on',
  expectedOutput: 'expected_output',
  explorationTolerance: 'exploration_tolerance',
  failOnError: 'fail_on_error',
  inputFiles: 'input_files',
  keepWorkspaces: 'keep_workspaces',
  maxCalls: 'max_calls',
  maxCostUsd: 'max_cost_usd',
  maxDurationMs: 'max_duration_ms',
  maxInput: 'max_input',
  maxLlmCalls: 'max_llm_calls',
  maxOutput: 'max_output',
  maxSteps: 'max_steps',
  maxTokens: 'max_tokens',
  maxToolCalls: 'max_tool_calls',
  minScore: 'min_score',
  onDependencyFailure: 'on_dependency_failure',
  onTurnFailure: 'on_turn_failure',
  outputPath: 'output_path',
  readOnly: 'read_only',
  reasoningEffort: 'reasoning_effort',
  rubricPrompt: 'rubric_prompt',
  scoreRange: 'score_range',
  scoreRanges: 'score_ranges',
  skipDefaults: 'skip_defaults',
  targetExplorationRatio: 'target_exploration_ratio',
  timeoutMs: 'timeout_ms',
  timeoutSeconds: 'timeout_seconds',
  useTarget: 'use_target',
  defaultTest: 'default_test',
  windowSize: 'window_size',
} as const;

type KnownSnakeCaseKeyMap = typeof KNOWN_SNAKE_CASE_KEYS;

type LowerEvalKey<Key extends string> = Key extends keyof KnownSnakeCaseKeyMap
  ? KnownSnakeCaseKeyMap[Key]
  : Key;

export type LowerEvalYamlValue<Value> = Value extends readonly (infer Item)[]
  ? LowerEvalYamlValue<Item>[]
  : Value extends object
    ? {
        [Key in keyof Value as Key extends string ? LowerEvalKey<Key> : never]: LowerEvalYamlValue<
          Value[Key]
        >;
      }
    : Value;

export type EvalMessageContent =
  | string
  | Readonly<Record<string, unknown>>
  | readonly (string | Readonly<Record<string, unknown>>)[];

export interface EvalMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: EvalMessageContent;
  readonly [key: string]: unknown;
}

export interface EvalAssertionConfig {
  readonly type: string;
  readonly provider?: string | true | object;
  readonly [key: string]: unknown;
}

export interface EvalLifecycleHook {
  readonly command?: string | readonly string[];
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly reset?: 'none' | 'fast' | 'strict';
  readonly [key: string]: unknown;
}

export interface EvalLifecycleHooks {
  readonly enabled?: boolean;
  readonly beforeAll?: EvalLifecycleHook;
  readonly beforeEach?: EvalLifecycleHook;
  readonly afterEach?: EvalLifecycleHook;
  readonly afterAll?: EvalLifecycleHook;
}

export interface EvalEnvironmentSetup {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface EvalDockerEnvironmentMount {
  readonly source: string;
  readonly target: string;
  readonly access?: 'ro' | 'rw';
  readonly readOnly?: boolean;
}

export interface EvalDockerEnvironmentResources {
  readonly cpus?: number;
  readonly memory?: string;
  readonly disk?: string;
  readonly gpu?: boolean | string;
}

export interface EvalHostEnvironment {
  readonly type: 'host';
  readonly workdir: string;
  readonly setup?: EvalEnvironmentSetup;
  readonly env?: Readonly<Record<string, string>>;
}

export interface EvalDockerEnvironment {
  readonly type: 'docker';
  readonly workdir: string;
  readonly context?: string;
  readonly dockerfile?: string;
  readonly image?: string;
  readonly setup?: EvalEnvironmentSetup;
  readonly env?: Readonly<Record<string, string>>;
  readonly resources?: EvalDockerEnvironmentResources;
  readonly mounts?: readonly EvalDockerEnvironmentMount[];
  readonly secrets?: Readonly<Record<string, string>>;
}

export type EvalEnvironment = EvalHostEnvironment | EvalDockerEnvironment;

export interface EvalProviderRef {
  readonly label: string;
  readonly id?: string;
  readonly useProvider?: string;
  readonly hooks?: EvalLifecycleHooks;
}

export interface EvalProviderConfig {
  readonly extends?: string;
  readonly id: string;
  readonly label?: string;
  readonly model?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly prompts?: unknown;
  readonly transform?: unknown;
  readonly delay?: number;
  readonly inputs?: unknown;
  readonly env?: Readonly<Record<string, string>>;
  readonly reasoningEffort?: string;
  readonly hooks?: EvalLifecycleHooks;
  readonly [key: string]: unknown;
}

export type EvalProviderMap = Readonly<
  Record<
    string,
    Omit<EvalProviderConfig, 'id'> | EvalProviderRef | Readonly<Record<string, unknown>>
  >
>;

export type EvalProviderEntry = string | EvalProviderRef | EvalProviderConfig | EvalProviderMap;

export interface EvalDefaultsConfig {
  readonly provider?: string;
  readonly grader?: string;
  readonly [key: string]: unknown;
}

export interface EvalTestOptions {
  readonly provider?: string;
  readonly transform?: unknown;
  readonly repeat?: EvalRepeat;
  readonly rubricPrompt?: unknown;
  readonly [key: string]: unknown;
}

export interface EvalDefaultTest {
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly assert?: readonly (string | EvalAssertionConfig)[];
  readonly options?: EvalTestOptions;
  readonly [key: string]: unknown;
}

export type EvalRepeat = number;

export interface EvalExecution {
  readonly provider?: string;
  readonly providers?: readonly EvalProviderEntry[];
  readonly assert?: readonly EvalAssertionConfig[];
  readonly skipDefaults?: boolean;
  readonly cache?: boolean;
  readonly trials?: never;
  readonly budgetUsd?: number;
  readonly failOnError?: boolean;
  readonly threshold?: number;
  readonly [key: string]: unknown;
}

export interface EvalTurn {
  readonly input: EvalMessageContent;
  readonly expectedOutput?: EvalMessageContent;
  readonly assert?: readonly (string | EvalAssertionConfig)[];
}

export interface EvalTest {
  readonly id: string;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly criteria?: string;
  readonly inputFiles?: readonly string[];
  readonly expectedOutput?: string | Readonly<Record<string, unknown>> | readonly EvalMessage[];
  readonly assert?: readonly EvalAssertionConfig[];
  readonly options?: EvalTestOptions;
  readonly execution?: EvalExecution;
  readonly environment?: EvalEnvironment | string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly conversationId?: string;
  readonly suite?: string;
  readonly dependsOn?: readonly string[];
  readonly onDependencyFailure?: 'skip' | 'fail' | 'run';
  readonly mode?: 'conversation';
  readonly turns?: readonly EvalTurn[];
  readonly aggregation?: 'mean' | 'min' | 'max';
  readonly onTurnFailure?: 'continue' | 'stop';
  readonly windowSize?: number;
}

export interface EvalRequires {
  readonly agentv?: string;
  readonly [key: string]: unknown;
}

export interface EvalConfig {
  readonly $schema?: string;
  readonly name?: string;
  readonly description?: string;
  readonly category?: string;
  readonly version?: string;
  readonly author?: string;
  /**
   * Suite tags. Either the selection list form (`string[]`, drives
   * `select.tags` / `--tag name` filtering) or the promptfoo-shaped
   * `Record<string,string>` map. In the map form the reserved `experiment` key
   * labels the run/experiment (grouped by the Dashboard), matching
   * `tags.experiment` in YAML evals.
   */
  readonly tags?: readonly string[] | Readonly<Record<string, string>>;
  readonly license?: string;
  readonly requires?: EvalRequires;
  readonly inputFiles?: readonly string[];
  readonly prompts?: unknown;
  readonly providers?: readonly EvalProviderEntry[];
  readonly defaults?: EvalDefaultsConfig;
  readonly defaultTest?: EvalDefaultTest | string;
  readonly tests: readonly EvalTest[] | string;
  /**
   * @deprecated A top-level `experiment` label no longer sets the run's
   * experiment namespace. Use `tags: { experiment: '<name>' }` instead.
   */
  readonly experiment?: string;
  readonly repeat?: EvalRepeat;
  readonly timeoutSeconds?: number;
  readonly threshold?: number;
  readonly budgetUsd?: number;
  readonly assert?: readonly EvalAssertionConfig[];
  readonly environment?: EvalEnvironment | string;
}

export interface DefinedEvalSuite {
  readonly [EVAL_SUITE_SYMBOL]: true;
  readonly [TO_EVAL_YAML_OBJECT_SYMBOL]: () => Record<string, unknown>;
}

function lowerEvalYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => lowerEvalYamlValue(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const loweredKey = KNOWN_SNAKE_CASE_KEYS[key as keyof KnownSnakeCaseKeyMap] ?? key;
      result[loweredKey] = lowerEvalYamlValue(nestedValue);
    }
    return result;
  }

  return value;
}

function lowerEvalConfig(config: unknown): Record<string, unknown> {
  const lowered = lowerEvalYamlValue(config) as Record<string, unknown>;
  const { budget_usd: budgetUsd, repeat, ...loweredWithoutRuntimeOptions } = lowered;
  validateRepeatValue(repeat, 'repeat');
  if (budgetUsd === undefined && repeat === undefined) {
    return lowered;
  }

  const evaluateOptions =
    lowered.evaluate_options &&
    typeof lowered.evaluate_options === 'object' &&
    !Array.isArray(lowered.evaluate_options)
      ? { ...(lowered.evaluate_options as Record<string, unknown>) }
      : {};

  if (budgetUsd !== undefined && evaluateOptions.budget_usd === undefined) {
    evaluateOptions.budget_usd = budgetUsd;
  }
  if (repeat !== undefined && evaluateOptions.repeat === undefined) {
    evaluateOptions.repeat = repeat;
  }
  return {
    ...loweredWithoutRuntimeOptions,
    evaluate_options: evaluateOptions,
  };
}

function validateRepeatValue(value: unknown, location: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `defineEval() expects ${location} to be a positive integer; object-shaped repeat authoring has been removed.`,
    );
  }
}

function attachEvalSuiteBrand<T extends EvalConfig>(definition: T): T & DefinedEvalSuite {
  validateTopLevelRuntimeFields(definition);
  const branded = definition as T & Partial<DefinedEvalSuite>;

  if (branded[EVAL_SUITE_SYMBOL] === true) {
    return branded as T & DefinedEvalSuite;
  }

  Object.defineProperties(branded, {
    [EVAL_SUITE_SYMBOL]: {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    [TO_EVAL_YAML_OBJECT_SYMBOL]: {
      value: () => toEvalYamlObject(definition),
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });

  return branded as T & DefinedEvalSuite;
}

function validateTopLevelRuntimeFields(definition: EvalConfig): void {
  const rawDefinition = definition as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'input')) {
    throw new Error(
      "defineEval() does not accept top-level 'input'. Use prompts with default test vars or tests[].vars instead.",
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'preprocessors')) {
    throw new Error(
      "defineEval() does not accept top-level 'preprocessors'. Use defaultTest.options.transform or assertion-level transform instead.",
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'graders')) {
    throw new Error(
      "defineEval() no longer accepts top-level 'graders'. Put grader providers in 'providers' and select them with defaults.grader, defaultTest.options.provider, tests[].options.provider, or assertion provider.",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(rawDefinition, 'experiment') &&
    typeof rawDefinition.experiment !== 'string'
  ) {
    throw new Error("defineEval() expects top-level 'experiment' to be a string label.");
  }
  for (const field of ['model', 'policy', 'execution', 'runs', 'earlyExit']) {
    if (Object.prototype.hasOwnProperty.call(rawDefinition, field)) {
      throw new Error(
        `defineEval() does not accept top-level '${field}'. Put target overrides in target and repeat controls under repeat, which serializes to evaluate_options.repeat.`,
      );
    }
  }
  validateRepeatValue(rawDefinition.repeat, 'repeat');
  if (Array.isArray(rawDefinition.tests)) {
    rawDefinition.tests.forEach((test, index) => {
      if (test && typeof test === 'object' && Object.prototype.hasOwnProperty.call(test, 'input')) {
        throw new Error(
          `defineEval() does not accept tests[${index}].input. Use prompts with tests[].vars instead.`,
        );
      }
      const options = (test as { readonly options?: unknown }).options;
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        validateRepeatValue(
          (options as { readonly repeat?: unknown }).repeat,
          `tests[${index}].options.repeat`,
        );
      }
    });
  }
  validateProviderSurface(definition);
}

function validateProviderSurface(definition: unknown): void {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (path.endsWith('.defaults') && Object.prototype.hasOwnProperty.call(record, 'target')) {
      throw new Error("defineEval() no longer accepts 'defaults.target'. Use 'defaults.provider'.");
    }
    if (Object.prototype.hasOwnProperty.call(record, 'target')) {
      throw new Error(
        `defineEval() no longer accepts '${path}.target'. Use '${path}.provider' or '${path}.providers' instead.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(record, 'targets')) {
      throw new Error(
        `defineEval() no longer accepts '${path}.targets'. Use '${path}.providers' instead.`,
      );
    }

    for (const [key, nested] of Object.entries(record)) {
      visit(nested, `${path}.${key}`);
    }
  };

  visit(definition, 'eval');
}

/**
 * Define a YAML-aligned eval suite in TypeScript.
 *
 * The returned object preserves the TypeScript authoring shape and carries a
 * non-enumerable lowering hook so AgentV can materialize the canonical
 * snake_case eval contract when the suite is loaded from a `.eval.ts` file.
 */
export function defineEval<T extends EvalConfig>(definition: T): T & DefinedEvalSuite {
  return attachEvalSuiteBrand(definition);
}

/**
 * Lower a TypeScript-authored eval suite into the canonical snake_case object
 * contract used by YAML files and the runtime loader.
 *
 * Only known AgentV wire keys are converted. Unknown keys are preserved as-is
 * so opaque assertion, provider, and metadata payloads are not corrupted.
 */
export function toEvalYamlObject<T extends EvalConfig | DefinedEvalSuite>(
  definition: T,
): LowerEvalYamlValue<T> {
  return lowerEvalConfig(definition) as LowerEvalYamlValue<T>;
}

/**
 * Serialize an eval suite to canonical YAML.
 */
export function serializeEvalYaml<T extends EvalConfig | DefinedEvalSuite>(definition: T): string {
  return stringifyYaml(toEvalYamlObject(definition), { lineWidth: 0 }).trimEnd();
}
