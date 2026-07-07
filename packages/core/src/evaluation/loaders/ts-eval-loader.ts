/**
 * Loads an eval suite from a TypeScript eval config file.
 *
 * Each TS eval file must export an EvalConfig as its default export.
 * Supported filenames are explicit AgentV *.eval.ts / *.eval.mts files.
 *
 * The file is loaded via dynamic import() which works natively in Bun
 * and requires tsx/jiti for Node.js.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type EvalConfig as ProgrammaticEvalConfig, materializeEvalConfig } from '../evaluate.js';
import { createFunctionProvider } from '../providers/function-provider.js';
import type { ProviderFactoryFn } from '../providers/provider-registry.js';
import type { ProviderDefinition } from '../providers/types.js';
import { type EvalSuiteResult, loadTestSuiteFromYamlObject } from '../yaml-parser.js';

const SDK_EVAL_SUITE_SYMBOL = Symbol.for('agentv/eval-suite');
const SDK_TO_EVAL_YAML_OBJECT_SYMBOL = Symbol.for('agentv/to-eval-yaml-object');
const TS_EVAL_CONFIG_NAME_RE = /^.+\.eval\.(?:m)?ts$/i;
const TS_EVAL_CONFIG_GLOB = '*.eval.ts,*.eval.mts' as const;

const KNOWN_SNAKE_CASE_KEYS = {
  afterAll: 'after_all',
  afterEach: 'after_each',
  argsMatch: 'args_match',
  beforeAll: 'before_all',
  beforeEach: 'before_each',
  cachePath: 'cache_path',
  budgetUsd: 'budget_usd',
  conversationId: 'conversation_id',
  defaultTest: 'default_test',
  dependsOn: 'depends_on',
  expectedOutput: 'expected_output',
  failOnError: 'fail_on_error',
  inputFiles: 'input_files',
  keepWorkspaces: 'keep_workspaces',
  maxConcurrency: 'max_concurrency',
  maxCostUsd: 'max_cost_usd',
  maxDurationMs: 'max_duration_ms',
  maxToolCalls: 'max_tool_calls',
  onDependencyFailure: 'on_dependency_failure',
  onTurnFailure: 'on_turn_failure',
  outputPath: 'output_path',
  readOnly: 'read_only',
  reasoningEffort: 'reasoning_effort',
  rubricPrompt: 'rubric_prompt',
  skipDefaults: 'skip_defaults',
  timeoutMs: 'timeout_ms',
  timeoutSeconds: 'timeout_seconds',
  useTarget: 'use_target',
  windowSize: 'window_size',
} as const;

type SdkEvalSuiteExport = Record<string, unknown> & {
  readonly [SDK_EVAL_SUITE_SYMBOL]: true;
  readonly [SDK_TO_EVAL_YAML_OBJECT_SYMBOL]: () => Record<string, unknown>;
};

export interface TsEvalResult {
  readonly config: ProgrammaticEvalConfig | SdkEvalSuiteExport | Record<string, unknown>;
  readonly filePath: string;
}

export interface TsEvalSuiteResult extends EvalSuiteResult {
  readonly inlineTarget?: ProviderDefinition;
  readonly providerFactory?: ProviderFactoryFn;
}

export function isTypeScriptEvalConfigFileName(filePath: string): boolean {
  return TS_EVAL_CONFIG_NAME_RE.test(path.basename(filePath));
}

export function typeScriptEvalConfigGlob(): string {
  return TS_EVAL_CONFIG_GLOB;
}

/** Import a TypeScript eval config file and extract its default EvalConfig export. */
export async function loadTsEvalFile(filePath: string): Promise<TsEvalResult> {
  const absolutePath = path.resolve(filePath);
  const moduleUrl = pathToFileURL(absolutePath).href;
  const module = await import(moduleUrl);

  const config = module.default;
  if (!config) {
    throw new Error(
      `${filePath}: no supported eval export found. Export an EvalConfig as the default export.`,
    );
  }
  if (!isSupportedTsEvalExport(config)) {
    throw new Error(
      `${filePath}: default export must be an EvalConfig object. Export a plain EvalConfig object or defineEval(config) as default.`,
    );
  }

  return { config, filePath: absolutePath };
}

export async function loadTsEvalSuite(
  filePath: string,
  repoRoot: string,
  options?: {
    readonly verbose?: boolean;
    readonly filter?: string | readonly string[];
    readonly category?: string;
  },
): Promise<TsEvalSuiteResult> {
  const { config, filePath: absolutePath } = await loadTsEvalFile(filePath);

  if (isSdkEvalSuiteExport(config)) {
    return loadTestSuiteFromYamlObject(
      absolutePath,
      lowerTypeScriptEvalConfig(config[SDK_TO_EVAL_YAML_OBJECT_SYMBOL]()),
      repoRoot,
      { ...options, allowInternalExpectedOutput: true },
    );
  }

  if (!isProgrammaticEvalConfig(config) && isYamlAlignedEvalConfig(config)) {
    return loadTestSuiteFromYamlObject(absolutePath, lowerTypeScriptEvalConfig(config), repoRoot, {
      ...options,
      allowInternalExpectedOutput: true,
    });
  }

  const materialized = await materializeEvalConfig(config as ProgrammaticEvalConfig, {
    repoRoot,
    baseDir: path.dirname(absolutePath),
    filter: options?.filter,
    category: options?.category,
  });

  return {
    tests: materialized.tests,
    ...(materialized.cache !== undefined && {
      cacheConfig: {
        enabled: materialized.cache,
        ...(materialized.cachePath !== undefined && { cachePath: materialized.cachePath }),
      },
    }),
    ...(materialized.budgetUsd !== undefined && { budgetUsd: materialized.budgetUsd }),
    ...(materialized.threshold !== undefined && { threshold: materialized.threshold }),
    ...(materialized.metadata !== undefined && { metadata: materialized.metadata }),
    ...(materialized.target !== undefined && { inlineTarget: materialized.target }),
    ...(materialized.task !== undefined && {
      providerFactory: (() => {
        const task = materialized.task;
        if (!task) {
          throw new Error(`${filePath}: missing task function for providerFactory`);
        }
        return createFunctionProvider(task);
      }) as ProviderFactoryFn,
    }),
  };
}

function isSdkEvalSuiteExport(value: unknown): value is SdkEvalSuiteExport {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as SdkEvalSuiteExport)[SDK_EVAL_SUITE_SYMBOL] === true &&
    typeof (value as SdkEvalSuiteExport)[SDK_TO_EVAL_YAML_OBJECT_SYMBOL] === 'function'
  );
}

function isSupportedTsEvalExport(
  value: unknown,
): value is ProgrammaticEvalConfig | SdkEvalSuiteExport | Record<string, unknown> {
  return (
    isSdkEvalSuiteExport(value) || (!!value && typeof value === 'object' && !Array.isArray(value))
  );
}

function isYamlAlignedEvalConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.task !== 'function' && obj.specFile === undefined;
}

function isProgrammaticEvalConfig(value: unknown): value is ProgrammaticEvalConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const target = obj.target;
  return (
    typeof obj.task === 'function' ||
    typeof obj.specFile === 'string' ||
    (!!target &&
      typeof target === 'object' &&
      !Array.isArray(target) &&
      typeof (target as Record<string, unknown>).name === 'string')
  );
}

function lowerTypeScriptEvalConfig(config: Record<string, unknown>): Record<string, unknown> {
  const lowered = lowerEvalYamlValue(config) as Record<string, unknown>;
  const { budget_usd: budgetUsd, repeat, ...withoutRuntimeAliases } = lowered;
  validateTypeScriptRepeat(repeat, 'repeat');
  if (budgetUsd === undefined && repeat === undefined) {
    return withoutRuntimeAliases;
  }

  const evaluateOptions =
    withoutRuntimeAliases.evaluate_options &&
    typeof withoutRuntimeAliases.evaluate_options === 'object' &&
    !Array.isArray(withoutRuntimeAliases.evaluate_options)
      ? { ...(withoutRuntimeAliases.evaluate_options as Record<string, unknown>) }
      : {};

  if (budgetUsd !== undefined && evaluateOptions.budget_usd === undefined) {
    evaluateOptions.budget_usd = budgetUsd;
  }
  if (repeat !== undefined && evaluateOptions.repeat === undefined) {
    evaluateOptions.repeat = repeat;
  }

  return {
    ...withoutRuntimeAliases,
    evaluate_options: evaluateOptions,
  };
}

function validateTypeScriptRepeat(value: unknown, location: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `TypeScript eval ${location} must be a positive integer; object-shaped repeat authoring has been removed.`,
    );
  }
}

function lowerEvalYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => lowerEvalYamlValue(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const loweredKey = KNOWN_SNAKE_CASE_KEYS[key as keyof typeof KNOWN_SNAKE_CASE_KEYS] ?? key;
      result[loweredKey] = lowerEvalYamlValue(nestedValue);
    }
    return result;
  }

  return value;
}
