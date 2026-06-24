import { stringify as stringifyYaml } from 'yaml';

const EVAL_SUITE_SYMBOL = Symbol.for('@agentv/sdk/eval-suite');
const TO_EVAL_YAML_OBJECT_SYMBOL = Symbol.for('@agentv/sdk/to-eval-yaml-object');

const KNOWN_SNAKE_CASE_KEYS = {
  afterAll: 'after_all',
  afterEach: 'after_each',
  argsMatch: 'args_match',
  baseCommit: 'base_commit',
  beforeAll: 'before_all',
  beforeEach: 'before_each',
  budgetUsd: 'budget_usd',
  conversationId: 'conversation_id',
  costLimitUsd: 'cost_limit_usd',
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
  requiredMinScore: 'required_min_score',
  scoreRange: 'score_range',
  scoreRanges: 'score_ranges',
  skipDefaults: 'skip_defaults',
  targetExplorationRatio: 'target_exploration_ratio',
  timeoutMs: 'timeout_ms',
  useTarget: 'use_target',
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
  readonly [key: string]: unknown;
}

export interface EvalPreprocessor {
  readonly type: string;
  readonly command: string | readonly string[];
  readonly [key: string]: unknown;
}

export interface EvalWorkspaceHook {
  readonly command?: string | readonly string[];
  readonly script?: string | readonly string[];
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly reset?: 'none' | 'fast' | 'strict';
  readonly [key: string]: unknown;
}

export interface EvalWorkspaceHooks {
  readonly enabled?: boolean;
  readonly beforeAll?: EvalWorkspaceHook;
  readonly beforeEach?: EvalWorkspaceHook;
  readonly afterEach?: EvalWorkspaceHook;
  readonly afterAll?: EvalWorkspaceHook;
}

export interface EvalWorkspaceRepo {
  readonly path?: string;
  readonly repo?: string;
  readonly commit?: string;
  readonly baseCommit?: string;
  readonly ancestor?: number;
  readonly sparse?: readonly string[];
}

export interface EvalDockerWorkspace {
  readonly image: string;
  readonly timeout?: number;
  readonly memory?: string;
  readonly cpus?: number;
}

export interface EvalWorkspace {
  readonly template?: string;
  readonly isolation?: 'shared' | 'per_test';
  readonly repos?: readonly EvalWorkspaceRepo[];
  readonly hooks?: EvalWorkspaceHooks;
  readonly mode?: 'pooled' | 'temp' | 'static';
  readonly path?: string;
  readonly docker?: EvalDockerWorkspace;
}

export interface EvalTargetRef {
  readonly name: string;
  readonly useTarget?: string;
  readonly hooks?: EvalWorkspaceHooks;
}

export interface EvalExecution {
  readonly target?: string;
  readonly targets?: readonly (string | EvalTargetRef)[];
  readonly workers?: number;
  readonly assertions?: readonly EvalAssertionConfig[];
  readonly skipDefaults?: boolean;
  readonly cache?: boolean;
  readonly budgetUsd?: number;
  readonly failOnError?: boolean;
  readonly threshold?: number;
  readonly [key: string]: unknown;
}

export interface EvalTurn {
  readonly input: EvalMessageContent;
  readonly expectedOutput?: EvalMessageContent;
  readonly assertions?: readonly (string | EvalAssertionConfig)[];
}

export interface EvalTest {
  readonly id: string;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly criteria?: string;
  readonly input?: string | readonly EvalMessage[];
  readonly inputFiles?: readonly string[];
  readonly expectedOutput?: string | Readonly<Record<string, unknown>> | readonly EvalMessage[];
  readonly assertions?: readonly EvalAssertionConfig[];
  readonly execution?: EvalExecution;
  readonly workspace?: EvalWorkspace;
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

export interface EvalDefinition {
  readonly $schema?: string;
  readonly name?: string;
  readonly description?: string;
  readonly category?: string;
  readonly version?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly license?: string;
  readonly requires?: EvalRequires;
  readonly input?: string | readonly EvalMessage[];
  readonly inputFiles?: readonly string[];
  readonly tests: readonly EvalTest[] | string;
  readonly target?: string;
  readonly execution?: EvalExecution;
  readonly assertions?: readonly EvalAssertionConfig[];
  readonly preprocessors?: readonly EvalPreprocessor[];
  readonly workspace?: EvalWorkspace | string;
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

function attachEvalSuiteBrand<T extends EvalDefinition>(definition: T): T & DefinedEvalSuite {
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

/**
 * Define a YAML-aligned eval suite in TypeScript.
 *
 * The returned object preserves the TypeScript authoring shape and carries a
 * non-enumerable lowering hook so AgentV can materialize the canonical
 * snake_case eval contract when the suite is loaded from a `.eval.ts` file.
 */
export function defineEval<T extends EvalDefinition>(definition: T): T & DefinedEvalSuite {
  return attachEvalSuiteBrand(definition);
}

/**
 * Alias for `defineEval()` when a suite reads more clearly as a plain object.
 */
export function evalSuite<T extends EvalDefinition>(definition: T): T & DefinedEvalSuite {
  return defineEval(definition);
}

/**
 * Lower a TypeScript-authored eval suite into the canonical snake_case object
 * contract used by YAML files and the runtime loader.
 *
 * Only known AgentV wire keys are converted. Unknown keys are preserved as-is
 * so opaque assertion, provider, and metadata payloads are not corrupted.
 */
export function toEvalYamlObject<T extends EvalDefinition | DefinedEvalSuite>(
  definition: T,
): LowerEvalYamlValue<T> {
  return lowerEvalYamlValue(definition) as LowerEvalYamlValue<T>;
}

/**
 * Serialize an eval suite to canonical YAML.
 */
export function serializeEvalYaml<T extends EvalDefinition | DefinedEvalSuite>(
  definition: T,
): string {
  return stringifyYaml(toEvalYamlObject(definition), { lineWidth: 0 }).trimEnd();
}
