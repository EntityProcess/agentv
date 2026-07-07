import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENTV_CONFIG_FILE_NAME,
  AGENTV_LOCAL_CONFIG_FILE_NAME,
  AGENTV_LOCAL_CONFIG_YML_FILE_NAME,
  getLocalConfigPath,
  isPlainConfigObject,
  mergeConfigObjects,
} from '../../config-overlays.js';
import { getAgentvConfigDir } from '../../paths.js';
import { createEvalConfigEnv, interpolateEnv } from '../interpolation.js';
import {
  expandProviderDefinitionEntries,
  isProviderSpecString,
  resolveProviderDefinitionEnvironments,
} from '../providers/targets.js';
import type { ProviderDefinition } from '../providers/types.js';
import type {
  EvalTargetRef,
  FailOnError,
  JsonObject,
  JsonValue,
  TargetHooksConfig,
  WorkspaceHookConfig,
} from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';
import {
  type ComposableConfigGraph,
  normalizeComposableConfigGraph,
  resolveConfigFieldReferences,
} from './config-graph.js';
import { buildDirectoryChain, fileExists } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

export const DEFAULT_EVAL_PATTERNS: readonly string[] = [
  '**/evals/**/suite.yaml',
  '**/evals/**/suite.yml',
  '**/evals/**/*.eval.yaml',
  '**/evals/**/eval.yaml',
  '**/evals/**/*.eval.ts',
  '**/evals/**/*.eval.mts',
];

export type ExecutionDefaults = {
  readonly max_concurrency?: number;
  readonly verbose?: boolean;
  readonly keep_workspaces?: boolean;
  readonly workspace_path?: string;
};

export type ResultPushConflictPolicy = 'block';

export type ResultsConfig = {
  /** Git remote slug/URL for a managed results clone, or omit to default to the source repo. */
  readonly repo?: string;
  /** Local Git checkout path for results. */
  readonly path?: string;
  /** Optional remote branch used as the canonical git-backed results store. */
  readonly branch?: string;
  /** Push committed results to the remote automatically. */
  readonly auto_push?: boolean;
};

export type HooksConfig = {
  /**
   * Shell command to run once at agentv startup. stdout is parsed for env var
   * exports.
   *
   * @deprecated Use `env_path` and/or `env_from` instead. `before_session`
   * keeps running for now but will be removed in a future breaking release.
   */
  readonly before_session?: string;
};

export type EnvFromFormat = 'shell_exports' | 'json';

export type EnvFromEntry = {
  /** Argv command array. Shell command strings are not accepted. */
  readonly command: readonly string[];
  /** Defaults to `shell_exports` when omitted. */
  readonly format?: EnvFromFormat;
};

export type ReferenceMap = Readonly<Record<string, string>>;

export type AgentVConfig = {
  readonly required_version?: string;
  readonly eval_patterns?: readonly string[];
  readonly execution?: ExecutionDefaults;
  readonly results?: ResultsConfig;
  readonly hooks?: HooksConfig;
  /** Dotenv file(s) loaded before validation/eval, relative to `configDir` unless absolute. */
  readonly env_path?: readonly string[];
  /** Argv commands run before validation/eval to inject environment variables. */
  readonly env_from?: readonly EnvFromEntry[];
  readonly refs?: ReferenceMap;
  /**
   * Promptfoo-shaped tags map applied to every run. Merged between eval `tags`
   * and CLI `--tag key=value` (precedence CLI > project config > eval). The
   * reserved key `experiment` participates in experiment-namespace resolution.
   */
  readonly tags?: Record<string, string>;
  /** Project directory containing `.agentv/`, for resolving relative `env_path` entries and `env_from` cwd. */
  readonly configDir?: string;
  /** Resolved file path when top-level `providers` was authored as a file:// reference. */
  readonly providerCatalogPath?: string;
  /** Provider definitions resolved from top-level `providers`, including inline arrays and file refs. */
  readonly providerDefinitions?: readonly ProviderDefinition[];
} & ComposableConfigGraph;

/**
 * Load optional AgentV YAML configuration.
 *
 * Project-local `.agentv/config.yaml` and `.agentv/config.local.yaml` files
 * are searched from the eval file directory up to the repo root. The first
 * directory with either file is the project-local config source. If no
 * project-local config is found, AgentV falls back to the home/global pair at
 * `${AGENTV_HOME:-~/.agentv}/config.yaml` plus `config.local.yaml`.
 *
 * Within a pair, `config.yaml` loads first and `config.local.yaml` overlays it:
 * plain objects deep-merge, arrays replace, and scalar overlay values win.
 * Registered project bindings such as result repos live in the home config
 * `projects:` registry and are resolved by Dashboard/remote-results code
 * separately.
 */
export async function loadConfig(
  evalFilePath: string,
  repoRoot: string,
): Promise<AgentVConfig | null> {
  const directories = buildDirectoryChain(evalFilePath, repoRoot);
  const globalConfigPath = path.join(getAgentvConfigDir(), AGENTV_CONFIG_FILE_NAME);

  for (const directory of directories) {
    const configPath = path.join(directory, '.agentv', AGENTV_CONFIG_FILE_NAME);

    if (!(await configPairExists(configPath))) {
      continue;
    }

    return readConfigFilePair(configPath, repoRoot, directory);
  }

  return (await configPairExists(globalConfigPath))
    ? readConfigFilePair(globalConfigPath, repoRoot, getAgentvConfigDir())
    : null;
}

async function configPairExists(configPath: string): Promise<boolean> {
  return (await fileExists(configPath)) || (await fileExists(getLocalConfigPath(configPath)));
}

async function readConfigObjectFile(
  configPath: string,
): Promise<Record<string, unknown> | undefined> {
  if (!(await fileExists(configPath))) {
    return undefined;
  }
  try {
    const rawConfig = await readFile(configPath, 'utf8');
    const parsed = parseYamlValue(rawConfig) as unknown;

    if (!isPlainConfigObject(parsed)) {
      logWarning(`Invalid AgentV config format at ${configPath}`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    logWarning(`Could not read AgentV config at ${configPath}: ${(error as Error).message}`);
    return undefined;
  }
}

async function readConfigFilePair(
  configPath: string,
  repoRoot: string,
  projectDir: string,
): Promise<AgentVConfig | null> {
  const localConfigPath = getLocalConfigPath(configPath);
  const rawBase = await readConfigObjectFile(configPath);
  const rawLocal = await readConfigObjectFile(localConfigPath);
  const rawProviderConfig =
    rawLocal && Object.prototype.hasOwnProperty.call(rawLocal, 'providers') ? rawLocal : rawBase;
  const rawProviderOwnerPath = rawProviderConfig === rawLocal ? localConfigPath : configPath;
  const providerCatalogPath = rawProviderConfig
    ? resolveProviderCatalogPath(rawProviderConfig.providers, rawProviderOwnerPath)
    : undefined;
  const base = stripLocalOnlyExecutionDefaults(
    await resolveConfigObjectFileReferences(rawBase, configPath),
    configPath,
  );
  const local = stripLocalOnlyExecutionDefaults(
    await resolveConfigObjectFileReferences(rawLocal, localConfigPath),
    localConfigPath,
  );
  const resolvedMerged = base && local ? mergeConfigObjects(base, local) : (local ?? base);
  if (!resolvedMerged) {
    return null;
  }
  return parseConfigObject(
    resolvedMerged,
    local ? localConfigPath : configPath,
    repoRoot,
    projectDir,
    providerCatalogPath,
  );
}

function resolveProviderCatalogPath(rawProviders: unknown, ownerPath: string): string | undefined {
  if (typeof rawProviders !== 'string' || !rawProviders.startsWith('file://')) {
    return undefined;
  }
  const filePath = rawProviders.slice('file://'.length);
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(path.resolve(ownerPath)), filePath);
}

async function resolveConfigObjectFileReferences(
  rawConfig: Record<string, unknown> | undefined,
  configPath: string,
): Promise<Record<string, unknown> | undefined> {
  if (!rawConfig) {
    return undefined;
  }
  return resolveConfigFieldReferences(rawConfig, configPath);
}

async function parseConfigObject(
  rawConfig: Record<string, unknown>,
  configPath: string,
  repoRoot: string,
  projectDir: string,
  providerCatalogPath?: string,
): Promise<AgentVConfig | null> {
  try {
    const parsed = interpolateEnv(rawConfig, createEvalConfigEnv(repoRoot)) as unknown;

    if (!isJsonObject(parsed)) {
      logWarning(`Invalid AgentV config format at ${configPath}`);
      return null;
    }

    const config = parsed as AgentVConfig;

    const requiredVersion = (parsed as Record<string, unknown>).required_version;
    if (requiredVersion !== undefined && typeof requiredVersion !== 'string') {
      logWarning(`Invalid required_version in ${configPath}, expected string`);
      return null;
    }

    const evalPatterns = (config as Record<string, unknown>).eval_patterns;
    if (evalPatterns !== undefined && !Array.isArray(evalPatterns)) {
      logWarning(`Invalid eval_patterns in ${configPath}, expected array`);
      return null;
    }

    if (Array.isArray(evalPatterns) && !evalPatterns.every((p) => typeof p === 'string')) {
      logWarning(`Invalid eval_patterns in ${configPath}, all entries must be strings`);
      return null;
    }

    const rawExecution = (parsed as Record<string, unknown>).execution;
    if (isJsonObject(rawExecution) && rawExecution.workers !== undefined) {
      logWarning(
        `Invalid execution.workers in ${configPath}; use execution.max_concurrency for eval parallelism.`,
      );
      return null;
    }

    const executionDefaults = parseExecutionDefaults(rawExecution, configPath);
    const results = parseResultsConfig((parsed as Record<string, unknown>).results, configPath);
    const hooks = parseHooksConfig((parsed as Record<string, unknown>).hooks, configPath);
    const envPath = parseEnvPathConfig((parsed as Record<string, unknown>).env_path, configPath);
    const envFrom = parseEnvFromConfig((parsed as Record<string, unknown>).env_from, configPath);
    const tags = parseTagsConfig((parsed as Record<string, unknown>).tags, configPath);
    const refs = parseRefsConfig((parsed as Record<string, unknown>).refs, configPath);
    const graph = normalizeComposableConfigGraph(parsed as Record<string, unknown>, configPath, {
      allowExecutionDefaultFields: true,
    });
    const execution = mergeExecutionConfig(executionDefaults, graph.execution);
    const providerDefinitions = await parseProviderDefinitions(
      (parsed as Record<string, unknown>).providers,
      configPath,
      providerCatalogPath ? path.dirname(providerCatalogPath) : path.dirname(configPath),
    );

    return {
      required_version: requiredVersion as string | undefined,
      eval_patterns: evalPatterns as readonly string[] | undefined,
      ...(execution && { execution }),
      results,
      ...(hooks && { hooks }),
      ...(envPath && { env_path: envPath }),
      ...(envFrom && { env_from: envFrom }),
      ...(refs && { refs }),
      ...(tags && { tags }),
      ...(graph.targets && { targets: graph.targets }),
      ...(graph.tests && { tests: graph.tests }),
      ...(graph.defaults && { defaults: graph.defaults }),
      configDir: projectDir,
      ...(providerCatalogPath && { providerCatalogPath }),
      ...(providerDefinitions && { providerDefinitions }),
    };
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('execution.otel_') || message.includes('execution.export_otel')) {
      throw new Error(`Invalid AgentV config at ${configPath}: ${message}`);
    }
    logWarning(`Could not parse AgentV config at ${configPath}: ${message}`);
    return null;
  }
}

function parseProviderDefinitions(
  rawProviders: unknown,
  configPath: string,
  baseDir: string,
): Promise<readonly ProviderDefinition[] | undefined> {
  if (rawProviders === undefined) {
    return Promise.resolve(undefined);
  }
  if (!Array.isArray(rawProviders)) {
    return Promise.resolve(undefined);
  }
  const definitions = expandProviderDefinitionEntries(rawProviders, {
    location: `${configPath}:providers`,
    stringMode: 'all',
  }).map((entry) => entry.definition);
  return resolveProviderDefinitionEnvironments(definitions, baseDir, {
    location: `${configPath}:providers`,
  });
}

function parseInlineProviderRefs(rawProviders: readonly unknown[]): readonly EvalTargetRef[] {
  const refs: EvalTargetRef[] = [];
  rawProviders.forEach((entry, index) => {
    const location = `providers[${index}]`;
    if (typeof entry === 'string' && !isProviderSpecString(entry)) {
      const name = entry.trim();
      if (name.length === 0) {
        throw new Error(`Invalid ${location}: provider reference must be non-empty.`);
      }
      refs.push({ name });
      return;
    }

    refs.push(...parseEvalProviderRefs(entry, location));
  });
  return refs;
}

function parseEvalProviderRefs(raw: unknown, location: string): readonly EvalTargetRef[] {
  const entries = expandProviderDefinitionEntries([raw], {
    location: location.replace(/\[\d+\]$/, ''),
    stringMode: 'spec-only',
  });

  return entries.map((entry) =>
    providerDefinitionToRef(entry.rawDefinition, entry.rawId, entry.definition),
  );
}

function mergeExecutionConfig(
  defaults: ExecutionDefaults | undefined,
  graph: ComposableConfigGraph['execution'],
): ExecutionDefaults | undefined {
  const merged = { ...(defaults ?? {}), ...(graph ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseRefsConfig(raw: unknown, configPath: string): ReferenceMap | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isJsonObject(raw)) {
    logWarning(`Invalid refs in ${configPath}, expected object`);
    return undefined;
  }

  const refs: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name.trim().length === 0 || typeof value !== 'string' || value.trim().length === 0) {
      logWarning(`Invalid refs entry in ${configPath}: ${name}`);
      continue;
    }
    refs[name] = value;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function isLocalConfigPath(configPath: string): boolean {
  const basename = path.basename(configPath);
  return (
    basename === AGENTV_LOCAL_CONFIG_FILE_NAME || basename === AGENTV_LOCAL_CONFIG_YML_FILE_NAME
  );
}

function stripLocalOnlyExecutionDefaults(
  rawConfig: Record<string, unknown> | undefined,
  configPath: string,
): Record<string, unknown> | undefined {
  if (!rawConfig || isLocalConfigPath(configPath)) {
    return rawConfig;
  }

  const execution = rawConfig.execution;
  if (!isPlainConfigObject(execution)) {
    return rawConfig;
  }

  let stripped = false;
  if ('workspace_path' in execution) {
    stripped = true;
    logWarning(
      `execution.workspace_path in ${configPath} is machine-local and only supported in config.local.yaml; ignoring.`,
    );
  }
  if ('workspace_mode' in execution) {
    stripped = true;
    logWarning(
      `execution.workspace_mode in ${configPath} has been removed; use execution.workspace_path for a static workspace override.`,
    );
  }
  if ('pool_workspaces' in execution) {
    stripped = true;
    logWarning(
      `execution.pool_workspaces in ${configPath} has been removed; use workspace.scope for portable workspace lifetime.`,
    );
  }
  if ('pool_slots' in execution) {
    stripped = true;
    logWarning(
      `execution.pool_slots in ${configPath} has been removed; use workspace.scope for portable workspace lifetime.`,
    );
  }

  if (!stripped) {
    return rawConfig;
  }

  const nextConfig = { ...rawConfig };
  const nextExecution = Object.fromEntries(
    Object.entries(execution).filter(
      ([key]) =>
        key !== 'workspace_path' &&
        key !== 'workspace_mode' &&
        key !== 'pool_workspaces' &&
        key !== 'pool_slots',
    ),
  );
  if (Object.keys(nextExecution).length === 0) {
    return Object.fromEntries(Object.entries(nextConfig).filter(([key]) => key !== 'execution'));
  }
  nextConfig.execution = nextExecution;
  return nextConfig;
}

function rejectAuthoredRuntimeContainers(suite: JsonObject): void {
  if (suite.experiment !== undefined) {
    throw new Error(
      "Top-level 'experiment' has been removed from authored eval YAML. Use tags.experiment in the eval file or CLI --experiment at run time.",
    );
  }
  if (suite.policy !== undefined) {
    throw new Error(
      "Top-level 'policy' is not part of eval YAML. Put repeat under evaluate_options.repeat, timeout_seconds and threshold at the top level, and budget_usd under evaluate_options.",
    );
  }
  if (suite.budget_usd !== undefined) {
    throw new Error("Top-level 'budget_usd' has been removed. Use evaluate_options.budget_usd.");
  }
  if (suite.execution !== undefined) {
    rejectAuthoredSuiteExecution(suite.execution);
  }
}

function rejectAuthoredSuiteExecution(rawExecution: JsonValue): void {
  if (!isJsonObject(rawExecution)) {
    throw new Error("Invalid top-level 'execution': expected an object.");
  }
  for (const key of Object.keys(rawExecution)) {
    if (key === 'max_concurrency') {
      throw new Error(
        "Top-level 'execution.max_concurrency' has been removed from eval YAML. Use evaluate_options.max_concurrency for authored suite concurrency.",
      );
    }
    if (key === 'workers') {
      throw new Error(
        "Top-level 'execution.workers' has been removed from eval YAML. Use evaluate_options.max_concurrency for authored suite concurrency.",
      );
    }
    throw new Error(
      `Top-level 'execution.${key}' is not part of eval YAML. Use supported top-level fields or evaluate_options for authored run controls.`,
    );
  }
  throw new Error(
    "Top-level 'execution' is not part of eval YAML. Use supported top-level fields or evaluate_options for authored run controls.",
  );
}

function getSuiteTopLevelNumber(
  suite: JsonObject,
  field: string,
  validate: (value: number) => boolean,
  label: string,
): number | undefined {
  rejectAuthoredRuntimeContainers(suite);
  const raw = suite[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === 'number' && validate(raw)) {
    return raw;
  }
  logWarning(`Invalid ${label}: ${raw}. Ignoring.`);
  return undefined;
}

function getSuiteEvaluateOptionsNumber(
  suite: JsonObject,
  field: string,
  validate: (value: number) => boolean,
  label: string,
): number | undefined {
  rejectAuthoredRuntimeContainers(suite);
  const rawOptions = suite.evaluate_options;
  if (rawOptions === undefined || rawOptions === null) {
    return undefined;
  }
  if (!isJsonObject(rawOptions)) {
    logWarning('Invalid evaluate_options: expected object. Ignoring.');
    return undefined;
  }
  const raw = rawOptions[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === 'number' && validate(raw)) {
    return raw;
  }
  logWarning(`Invalid evaluate_options.${label}: ${raw}. Ignoring.`);
  return undefined;
}

/** @deprecated Authored eval YAML now uses top-level providers. */
export function extractTargetFromSuite(suite: JsonObject): string | undefined {
  rejectAuthoredRuntimeContainers(suite);
  if (suite.target !== undefined) {
    throw new Error("Top-level 'target' has been removed. Use top-level 'providers' instead.");
  }
  return undefined;
}

export function extractTargetRefsFromSuite(
  suite: JsonObject,
): readonly EvalTargetRef[] | undefined {
  rejectAuthoredRuntimeContainers(suite);
  if (suite.target !== undefined) {
    throw new Error("Top-level 'target' has been removed. Use top-level 'providers' instead.");
  }
  if (suite.targets !== undefined) {
    throw new Error(
      "Top-level 'targets' has been removed. Use 'providers'; map targets[].id to providers[].label and targets[].provider to providers[].id.",
    );
  }
  const rawProviders = suite.providers;
  if (rawProviders === undefined) {
    return undefined;
  }

  const entries = Array.isArray(rawProviders) ? rawProviders : [rawProviders];
  const refs = parseInlineProviderRefs(entries);
  assertUniqueProviderRefs(refs);
  return refs.length > 0 ? refs : undefined;
}

/**
 * Extract live matrix target names from parsed eval suite.
 */
export function extractTargetsFromSuite(suite: JsonObject): readonly string[] | undefined {
  const refs = extractTargetRefsFromSuite(suite);
  if (!refs) return undefined;
  const names = refs.map((r) => r.name);
  return names.length > 0 ? names : undefined;
}

function providerDefinitionToRef(
  raw: Record<string, unknown>,
  rawId: string,
  definition: ProviderDefinition,
): EvalTargetRef {
  const hooks = parseTargetHooks(raw.hooks);
  return {
    name: definition.name,
    id: rawId,
    ...(definition.label !== undefined ? { label: definition.label } : {}),
    definition,
    ...(hooks !== undefined ? { hooks } : {}),
  };
}

function assertUniqueProviderRefs(refs: readonly EvalTargetRef[]): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.name)) {
      throw new Error(
        `Duplicate provider identity '${ref.name}'. Provider labels and unlabeled provider ids must be unique.`,
      );
    }
    seen.add(ref.name);
  }
}

/**
 * Parse a single workspace hook config from a raw object.
 * Accepts both string shorthand (shell command) and object form.
 */
function parseHookConfig(raw: unknown): WorkspaceHookConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.script !== undefined) {
    throw new Error("Workspace hook field 'script' has been removed. Use 'command' instead.");
  }

  let command: readonly string[] | undefined;
  if (typeof obj.command === 'string') {
    command = ['sh', '-c', obj.command];
  } else if (Array.isArray(obj.command)) {
    command = obj.command.filter((s): s is string => typeof s === 'string');
  }

  if (!command || command.length === 0) return undefined;

  const timeoutMs =
    typeof obj.timeout_ms === 'number'
      ? obj.timeout_ms
      : typeof obj.timeoutMs === 'number'
        ? obj.timeoutMs
        : undefined;
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;

  return {
    command,
    ...(timeoutMs !== undefined && { timeout_ms: timeoutMs }),
    ...(cwd && { cwd }),
  };
}

/**
 * Parse target hooks from a raw hooks object.
 * Returns undefined if no valid hooks are found.
 */
export function parseTargetHooks(raw: unknown): TargetHooksConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const beforeAll = parseHookConfig(obj.before_all);
  const beforeEach = parseHookConfig(obj.before_each);
  const afterEach = parseHookConfig(obj.after_each);
  const afterAll = parseHookConfig(obj.after_all);

  if (!beforeAll && !beforeEach && !afterEach && !afterAll) return undefined;

  return {
    ...(beforeAll && { before_all: beforeAll }),
    ...(beforeEach && { before_each: beforeEach }),
    ...(afterEach && { after_each: afterEach }),
    ...(afterAll && { after_all: afterAll }),
  };
}

/**
 * Extract suite-level max concurrency from eval YAML.
 *
 * AgentV eval YAML accepts promptfoo-shaped evaluate_options.max_concurrency.
 * The runner still receives the resolved value through its historical workers
 * slot.
 */
export function extractWorkersFromSuite(suite: JsonObject): number | undefined {
  rejectAuthoredRuntimeContainers(suite);
  return getSuiteEvaluateOptionsNumber(
    suite,
    'max_concurrency',
    (value) => Number.isInteger(value) && value >= 1 && value <= 50,
    'max_concurrency. Must be an integer between 1 and 50',
  );
}

/**
 * Cache configuration parsed from execution block.
 */
export interface CacheConfig {
  readonly enabled: boolean;
  readonly cachePath?: string;
}

/**
 * Eval YAML does not own response cache configuration.
 * Returns undefined when no cache config is specified.
 */
export function extractCacheConfig(suite: JsonObject): CacheConfig | undefined {
  rejectAuthoredRuntimeContainers(suite);
  return undefined;
}

/**
 * Extract suite-level total budget from eval YAML.
 *
 * Preferred authoring uses evaluate_options.budget_usd.
 * Returns undefined when not specified.
 */
export function extractBudgetUsd(suite: JsonObject): number | undefined {
  return getSuiteEvaluateOptionsNumber(
    suite,
    'budget_usd',
    (value) => value > 0,
    'budget_usd. Must be a positive number',
  );
}

/**
 * Eval YAML does not own execution error tolerance.
 * Accepts `true` or `false`.
 * Returns undefined when not specified.
 */
export function extractFailOnError(suite: JsonObject): FailOnError | undefined {
  rejectAuthoredRuntimeContainers(suite);
  return undefined;
}

/**
 * Extract the legacy top-level suite quality threshold.
 * Accepts a number in [0, 1] range.
 * Returns undefined when not specified.
 */
export function extractThreshold(suite: JsonObject): number | undefined {
  return getSuiteTopLevelNumber(
    suite,
    'threshold',
    (value) => value >= 0 && value <= 1,
    'threshold. Must be a number between 0 and 1',
  );
}

/**
 * Extract the preferred inherited per-test default threshold.
 * Accepts default_test.threshold as a number in [0, 1] range.
 * Returns undefined when not specified.
 */
export function extractDefaultTestThreshold(suite: JsonObject): number | undefined {
  rejectAuthoredRuntimeContainers(suite);
  const rawDefaultTest = suite.default_test;
  if (rawDefaultTest === undefined || rawDefaultTest === null) {
    return undefined;
  }
  if (!isJsonObject(rawDefaultTest)) {
    logWarning(`Invalid default_test: ${rawDefaultTest}. Ignoring.`);
    return undefined;
  }
  const rawThreshold = rawDefaultTest.threshold;
  if (rawThreshold === undefined || rawThreshold === null) {
    return undefined;
  }
  if (typeof rawThreshold === 'number' && rawThreshold >= 0 && rawThreshold <= 1) {
    return rawThreshold;
  }
  logWarning(
    `Invalid default_test.threshold. Must be a number between 0 and 1: ${rawThreshold}. Ignoring.`,
  );
  return undefined;
}

/**
 * Extract an optional inherited rubric prompt override for llm-rubric assertions.
 * Accepts default_test.options.rubric_prompt.
 */
export function extractDefaultTestRubricPrompt(suite: JsonObject): JsonValue | undefined {
  rejectAuthoredRuntimeContainers(suite);
  const rawDefaultTest = suite.default_test;
  if (rawDefaultTest === undefined || rawDefaultTest === null) {
    return undefined;
  }
  if (!isJsonObject(rawDefaultTest)) {
    return undefined;
  }

  const rawOptions = rawDefaultTest.options;
  if (rawOptions === undefined || rawOptions === null) {
    return undefined;
  }
  if (!isJsonObject(rawOptions)) {
    logWarning(`Invalid default_test.options: ${rawOptions}. Ignoring rubric prompt.`);
    return undefined;
  }

  const rawPrompt = rawOptions.rubric_prompt;
  if (rawPrompt === undefined || rawPrompt === null) {
    return undefined;
  }
  if (typeof rawPrompt === 'string' || isJsonObject(rawPrompt) || Array.isArray(rawPrompt)) {
    return rawPrompt as JsonValue;
  }

  logWarning('Invalid default_test.options.rubric_prompt. Must be string, object, or array.');
  return undefined;
}

export function parseExecutionDefaults(
  raw: unknown,
  configPath: string,
): ExecutionDefaults | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  if (obj.workers !== undefined) {
    logWarning(
      `execution.workers in ${configPath} has been removed; use execution.max_concurrency`,
    );
  }

  const maxConcurrency = obj.max_concurrency;
  if (
    typeof maxConcurrency === 'number' &&
    Number.isInteger(maxConcurrency) &&
    maxConcurrency >= 1 &&
    maxConcurrency <= 50
  ) {
    result.max_concurrency = maxConcurrency;
  } else if (maxConcurrency !== undefined) {
    logWarning(`Invalid execution.max_concurrency in ${configPath}, expected integer 1-50`);
  }

  if (typeof obj.verbose === 'boolean') {
    result.verbose = obj.verbose;
  } else if (obj.verbose !== undefined) {
    logWarning(`Invalid execution.verbose in ${configPath}, expected boolean`);
  }

  if (typeof obj.keep_workspaces === 'boolean') {
    result.keep_workspaces = obj.keep_workspaces;
  } else if (obj.keep_workspaces !== undefined) {
    logWarning(`Invalid execution.keep_workspaces in ${configPath}, expected boolean`);
  }

  if (obj.workspace_mode !== undefined) {
    logWarning(
      `execution.workspace_mode in ${configPath} has been removed; use execution.workspace_path for a static workspace override.`,
    );
  }

  const workspacePath = obj.workspace_path;
  if (typeof workspacePath === 'string' && workspacePath.trim().length > 0) {
    if (isLocalConfigPath(configPath)) {
      result.workspace_path = workspacePath.trim();
    } else {
      logWarning(
        `execution.workspace_path in ${configPath} is machine-local and only supported in config.local.yaml; ignoring.`,
      );
    }
  } else if (workspacePath !== undefined) {
    logWarning(`Invalid execution.workspace_path in ${configPath}, expected non-empty string`);
  }

  rejectRemovedOtelExecutionDefaults(obj, configPath);

  if (obj.pool_workspaces !== undefined) {
    logWarning(
      `execution.pool_workspaces in ${configPath} has been removed; use workspace.scope for portable workspace lifetime.`,
    );
  }

  if (obj.pool_slots !== undefined) {
    logWarning(
      `execution.pool_slots in ${configPath} has been removed; use workspace.scope for portable workspace lifetime.`,
    );
  }

  return Object.keys(result).length > 0 ? (result as ExecutionDefaults) : undefined;
}

function rejectRemovedOtelExecutionDefaults(
  obj: Record<string, unknown>,
  configPath: string,
): void {
  const removedFields = [
    'otel_file',
    'export_otel',
    'otel_backend',
    'otel_capture_content',
    'otel_group_turns',
  ].filter((field) => obj[field] !== undefined);
  if (removedFields.length === 0) {
    return;
  }
  throw new Error(
    `${removedFields
      .map((field) => `execution.${field}`)
      .join(
        ', ',
      )} in ${configPath} ${removedFields.length === 1 ? 'has' : 'have'} been removed. The system under test or provider should emit OpenTelemetry/OpenInference traces directly; use AgentV run artifacts and external_trace metadata for correlation.`,
  );
}

export function parseResultsConfig(raw: unknown, configPath: string): ResultsConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logWarning(`Invalid results in ${configPath}, expected object`);
    return undefined;
  }

  const obj = raw as Record<string, unknown>;

  if (obj.mode !== undefined && obj.mode !== 'github') {
    logWarning(`Invalid results.mode in ${configPath}; remove results.mode`);
    return undefined;
  }

  let repo: string | undefined;
  if (obj.repo !== undefined) {
    if (typeof obj.repo !== 'string' || obj.repo.trim().length === 0) {
      logWarning(`Invalid results.repo in ${configPath}, expected non-empty string`);
      return undefined;
    }
    repo = obj.repo.trim();
  }

  let resultsPath: string | undefined;
  if (obj.path !== undefined) {
    if (typeof obj.path !== 'string' || obj.path.trim().length === 0) {
      logWarning(`Invalid results.path in ${configPath}, expected non-empty string`);
      return undefined;
    }
    resultsPath = obj.path.trim();
  }

  if (!repo && !resultsPath) {
    logWarning(`Invalid results in ${configPath}, expected repo or path`);
    return undefined;
  }

  let branch: string | undefined;
  if (obj.branch !== undefined) {
    if (typeof obj.branch !== 'string' || obj.branch.trim().length === 0) {
      logWarning(`Invalid results.branch in ${configPath}, expected non-empty string`);
      return undefined;
    }
    branch = obj.branch.trim();
  }

  if (obj.auto_push !== undefined && typeof obj.auto_push !== 'boolean') {
    logWarning(`Invalid results.auto_push in ${configPath}, expected boolean`);
    return undefined;
  }

  return {
    ...(repo && { repo }),
    ...(resultsPath !== undefined && { path: resultsPath }),
    ...(branch !== undefined && { branch }),
    ...(typeof obj.auto_push === 'boolean' && { auto_push: obj.auto_push }),
  };
}

export function resolveResultsConfigForProject(
  config: AgentVConfig | null | undefined,
  _projectId?: string,
): ResultsConfig | undefined {
  if (!config) {
    return undefined;
  }

  return config.results;
}

/**
 * Parse the `hooks` block from .agentv/config.yaml.
 * Currently supports `before_session` only.
 */
export function parseHooksConfig(raw: unknown, configPath: string): HooksConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logWarning(`Invalid hooks in ${configPath}, expected object`);
    return undefined;
  }

  const obj = raw as Record<string, unknown>;

  const beforeSession = obj.before_session;
  if (beforeSession !== undefined) {
    if (typeof beforeSession !== 'string' || beforeSession.trim().length === 0) {
      logWarning(`Invalid hooks.before_session in ${configPath}, expected non-empty string`);
      return undefined;
    }
    logWarning(
      `hooks.before_session in ${configPath} is deprecated; use env_path and/or env_from instead. before_session will keep running for now.`,
    );
    return { before_session: beforeSession.trim() };
  }

  return undefined;
}

const ENV_FROM_FORMATS: ReadonlySet<EnvFromFormat> = new Set(['shell_exports', 'json']);

/**
 * Parse the `env_path` field from .agentv/config.yaml.
 * Accepts a single string or an array of strings; invalid entries are dropped with a warning.
 */
export function parseEnvPathConfig(
  raw: unknown,
  configPath: string,
): readonly string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  const paths: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      logWarning(`Invalid env_path entry in ${configPath}, expected non-empty string`);
      continue;
    }
    paths.push(entry.trim());
  }

  return paths.length > 0 ? paths : undefined;
}

/**
 * Parse the `env_from` field from .agentv/config.yaml.
 * Accepts a single entry object or an array of entry objects. Each entry
 * requires a non-empty argv `command` array; shell command strings are
 * rejected. `format` defaults to `shell_exports`. Invalid entries are dropped
 * with a warning.
 */
export function parseEnvFromConfig(
  raw: unknown,
  configPath: string,
): readonly EnvFromEntry[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const isList = Array.isArray(raw);
  const entries = isList ? raw : [raw];
  const result: EnvFromEntry[] = [];

  entries.forEach((entry, index) => {
    const location = isList ? `env_from[${index}]` : 'env_from';
    if (!isJsonObject(entry)) {
      logWarning(`Invalid ${location} in ${configPath}, expected object`);
      return;
    }

    const rawCommand = entry.command;
    if (typeof rawCommand === 'string') {
      logWarning(
        `Invalid ${location}.command in ${configPath}: shell command strings are not supported, use an argv array such as ["bun", "scripts/load-secrets.ts"]`,
      );
      return;
    }
    if (
      !Array.isArray(rawCommand) ||
      rawCommand.length === 0 ||
      !rawCommand.every((part) => typeof part === 'string' && part.length > 0)
    ) {
      logWarning(`Invalid ${location}.command in ${configPath}, expected a non-empty string array`);
      return;
    }

    const rawFormat = entry.format;
    let format: EnvFromFormat = 'shell_exports';
    if (rawFormat !== undefined) {
      if (typeof rawFormat !== 'string' || !ENV_FROM_FORMATS.has(rawFormat as EnvFromFormat)) {
        logWarning(
          `Invalid ${location}.format in ${configPath}, expected "shell_exports" or "json"`,
        );
        return;
      }
      format = rawFormat as EnvFromFormat;
    }

    result.push({ command: rawCommand as readonly string[], format });
  });

  return result.length > 0 ? result : undefined;
}

/**
 * Parse the optional project-config `tags` map (promptfoo-shaped
 * `Record<string,string>`). Non-string entries are dropped with a warning; a
 * non-object value is rejected. Returns undefined when no valid entry remains.
 */
export function parseTagsConfig(
  raw: unknown,
  configPath: string,
): Record<string, string> | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logWarning(`Invalid tags in ${configPath}, expected a key=value map of strings`);
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else {
      logWarning(`Ignoring non-string tag "${key}" in ${configPath}`);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
