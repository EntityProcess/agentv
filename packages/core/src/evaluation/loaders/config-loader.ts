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
import { interpolateEnv } from '../interpolation.js';
import type {
  EvalTargetRef,
  FailOnError,
  JsonObject,
  TargetHooksConfig,
  WorkspaceHookConfig,
} from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';
import { buildDirectoryChain, fileExists } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

export const DEFAULT_EVAL_PATTERNS: readonly string[] = [
  '**/evals/**/*.eval.yaml',
  '**/evals/**/eval.yaml',
  '**/evals/**/*.eval.ts',
];

export type ExecutionDefaults = {
  readonly workers?: number;
  readonly verbose?: boolean;
  readonly keep_workspaces?: boolean;
  readonly workspace_mode?: 'pooled' | 'temp' | 'static';
  readonly workspace_path?: string;
  readonly otel_file?: string;
  readonly export_otel?: boolean;
  readonly otel_backend?: string;
  readonly otel_capture_content?: boolean;
  readonly otel_group_turns?: boolean;
  readonly pool_workspaces?: boolean;
  readonly pool_slots?: number;
};

export type ResultPushConflictPolicy = 'block';

export type ResultsConfig = {
  readonly mode?: 'github';
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
  /** Shell command to run once at agentv startup. stdout is parsed for env var exports. */
  readonly before_session?: string;
};

export type AgentVConfig = {
  readonly required_version?: string;
  readonly eval_patterns?: readonly string[];
  readonly execution?: ExecutionDefaults;
  readonly results?: ResultsConfig;
  readonly hooks?: HooksConfig;
};

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

    return readConfigFilePair(configPath);
  }

  return (await configPairExists(globalConfigPath)) ? readConfigFilePair(globalConfigPath) : null;
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

async function readConfigFilePair(configPath: string): Promise<AgentVConfig | null> {
  const localConfigPath = getLocalConfigPath(configPath);
  const base = stripLocalOnlyExecutionDefaults(await readConfigObjectFile(configPath), configPath);
  const local = stripLocalOnlyExecutionDefaults(
    await readConfigObjectFile(localConfigPath),
    localConfigPath,
  );
  const rawMerged = base && local ? mergeConfigObjects(base, local) : (local ?? base);
  if (!rawMerged) {
    return null;
  }
  return parseConfigObject(rawMerged, local ? localConfigPath : configPath);
}

function parseConfigObject(
  rawConfig: Record<string, unknown>,
  configPath: string,
): AgentVConfig | null {
  try {
    const parsed = interpolateEnv(rawConfig, process.env) as unknown;

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

    const executionDefaults = parseExecutionDefaults(
      (parsed as Record<string, unknown>).execution,
      configPath,
    );
    warnRemovedExperimentPointer(
      (parsed as Record<string, unknown>).default_experiment,
      configPath,
      'default_experiment',
    );
    warnRemovedExperimentPointer(
      (parsed as Record<string, unknown>).experiments,
      configPath,
      'experiments',
    );
    const results = parseResultsConfig((parsed as Record<string, unknown>).results, configPath);
    const hooks = parseHooksConfig((parsed as Record<string, unknown>).hooks, configPath);

    return {
      required_version: requiredVersion as string | undefined,
      eval_patterns: evalPatterns as readonly string[] | undefined,
      execution: executionDefaults,
      results,
      ...(hooks && { hooks }),
    };
  } catch (error) {
    logWarning(`Could not parse AgentV config at ${configPath}: ${(error as Error).message}`);
    return null;
  }
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
      `execution.workspace_mode in ${configPath} is machine-local and only supported in config.local.yaml; ignoring.`,
    );
  }

  if (!stripped) {
    return rawConfig;
  }

  const nextConfig = { ...rawConfig };
  const nextExecution = Object.fromEntries(
    Object.entries(execution).filter(
      ([key]) => key !== 'workspace_path' && key !== 'workspace_mode',
    ),
  );
  if (Object.keys(nextExecution).length === 0) {
    return Object.fromEntries(Object.entries(nextConfig).filter(([key]) => key !== 'execution'));
  }
  nextConfig.execution = nextExecution;
  return nextConfig;
}

function rejectAuthoredRuntimeContainers(suite: JsonObject): void {
  if (suite.experiment !== undefined && typeof suite.experiment !== 'string') {
    throw new Error("Invalid top-level 'experiment': use a string run/result grouping label.");
  }
  if (suite.policy !== undefined) {
    throw new Error(
      "Top-level 'policy' is not part of eval YAML. Put repeat, timeout_seconds, and threshold at the top level, and budget_usd under evaluate_options.",
    );
  }
  if (suite.execution !== undefined) {
    throw new Error(
      "Top-level 'execution' is not part of eval YAML. Put target and run controls at the top level; configure concurrency with CLI flags or project config.",
    );
  }
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

/** Extract the single top-level target name from a parsed eval suite. */
export function extractTargetFromSuite(suite: JsonObject): string | undefined {
  rejectAuthoredRuntimeContainers(suite);
  const targetValue = suite.target;
  if (typeof targetValue === 'string' && targetValue.trim().length > 0) {
    return targetValue.trim();
  }
  if (isJsonObject(targetValue)) {
    const name = targetValue.name;
    const extendsTarget = targetValue.extends;
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim();
    }
    if (typeof extendsTarget === 'string' && extendsTarget.trim().length > 0) {
      return extendsTarget.trim();
    }
  }

  return undefined;
}

/**
 * Matrix target refs are not authored in eval YAML. The CLI keeps this helper
 * as an internal no-op for call sites that still handle runtime-only matrices.
 */
export function extractTargetRefsFromSuite(
  suite: JsonObject,
): readonly EvalTargetRef[] | undefined {
  rejectAuthoredRuntimeContainers(suite);
  return undefined;
}

/**
 * Extract runtime-only matrix target names from parsed eval suite.
 */
export function extractTargetsFromSuite(suite: JsonObject): readonly string[] | undefined {
  const refs = extractTargetRefsFromSuite(suite);
  if (!refs) return undefined;
  const names = refs.map((r) => r.name);
  return names.length > 0 ? names : undefined;
}

/**
 * Parse a single workspace hook config from a raw object.
 * Accepts both string shorthand (shell command) and object form.
 */
function parseHookConfig(raw: unknown): WorkspaceHookConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  // Accept command as string (shell command) or array
  let command: readonly string[] | undefined;
  if (typeof obj.command === 'string') {
    command = ['sh', '-c', obj.command];
  } else if (Array.isArray(obj.command)) {
    command = obj.command.filter((s): s is string => typeof s === 'string');
  } else if (typeof obj.script === 'string') {
    command = ['sh', '-c', obj.script];
  } else if (Array.isArray(obj.script)) {
    command = obj.script.filter((s): s is string => typeof s === 'string');
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
 * Eval YAML does not own concurrency.
 */
export function extractWorkersFromSuite(suite: JsonObject): number | undefined {
  rejectAuthoredRuntimeContainers(suite);
  return undefined;
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
 * Preferred authoring uses evaluate_options.budget_usd. Legacy top-level
 * budget_usd remains accepted for compatibility, but the nested option wins
 * when both are present.
 * Returns undefined when not specified.
 */
export function extractBudgetUsd(suite: JsonObject): number | undefined {
  const evaluateOptionsBudgetUsd = getSuiteEvaluateOptionsNumber(
    suite,
    'budget_usd',
    (value) => value > 0,
    'budget_usd. Must be a positive number',
  );
  if (evaluateOptionsBudgetUsd !== undefined) {
    return evaluateOptionsBudgetUsd;
  }
  return getSuiteTopLevelNumber(
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

export function parseExecutionDefaults(
  raw: unknown,
  configPath: string,
): ExecutionDefaults | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  const workers = obj.workers;
  if (typeof workers === 'number' && Number.isInteger(workers) && workers >= 1 && workers <= 50) {
    result.workers = workers;
  } else if (workers !== undefined) {
    logWarning(`Invalid execution.workers in ${configPath}, expected integer 1-50`);
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

  const workspaceMode = obj.workspace_mode;
  if (workspaceMode === 'pooled' || workspaceMode === 'temp' || workspaceMode === 'static') {
    if (isLocalConfigPath(configPath)) {
      result.workspace_mode = workspaceMode;
    } else {
      logWarning(
        `execution.workspace_mode in ${configPath} is machine-local and only supported in config.local.yaml; ignoring.`,
      );
    }
  } else if (workspaceMode !== undefined) {
    logWarning(
      `Invalid execution.workspace_mode in ${configPath}, expected 'pooled', 'temp', or 'static'`,
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

  const otelFile = obj.otel_file;
  if (typeof otelFile === 'string' && otelFile.trim().length > 0) {
    result.otel_file = otelFile.trim();
  } else if (otelFile !== undefined) {
    logWarning(`Invalid execution.otel_file in ${configPath}, expected non-empty string`);
  }

  if (typeof obj.export_otel === 'boolean') {
    result.export_otel = obj.export_otel;
  } else if (obj.export_otel !== undefined) {
    logWarning(`Invalid execution.export_otel in ${configPath}, expected boolean`);
  }

  const otelBackend = obj.otel_backend;
  if (typeof otelBackend === 'string' && otelBackend.trim().length > 0) {
    result.otel_backend = otelBackend.trim();
  } else if (otelBackend !== undefined) {
    logWarning(`Invalid execution.otel_backend in ${configPath}, expected non-empty string`);
  }

  if (typeof obj.otel_capture_content === 'boolean') {
    result.otel_capture_content = obj.otel_capture_content;
  } else if (obj.otel_capture_content !== undefined) {
    logWarning(`Invalid execution.otel_capture_content in ${configPath}, expected boolean`);
  }

  if (typeof obj.otel_group_turns === 'boolean') {
    result.otel_group_turns = obj.otel_group_turns;
  } else if (obj.otel_group_turns !== undefined) {
    logWarning(`Invalid execution.otel_group_turns in ${configPath}, expected boolean`);
  }

  if (typeof obj.pool_workspaces === 'boolean') {
    result.pool_workspaces = obj.pool_workspaces;
  } else if (obj.pool_workspaces !== undefined) {
    logWarning(`Invalid execution.pool_workspaces in ${configPath}, expected boolean`);
  }

  const poolSlots = obj.pool_slots;
  if (
    typeof poolSlots === 'number' &&
    Number.isInteger(poolSlots) &&
    poolSlots >= 1 &&
    poolSlots <= 50
  ) {
    result.pool_slots = poolSlots;
  } else if (poolSlots !== undefined) {
    logWarning(`Invalid execution.pool_slots in ${configPath}, expected integer 1-50`);
  }

  return Object.keys(result).length > 0 ? (result as ExecutionDefaults) : undefined;
}

function warnRemovedExperimentPointer(raw: unknown, configPath: string, key: string): void {
  if (raw === undefined || raw === null) {
    return;
  }
  logWarning(
    `${key} in ${configPath} is ignored. Runtime configuration belongs in eval.yaml under top-level target and run controls.`,
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
    logWarning(`Invalid results.mode in ${configPath}, expected 'github'`);
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
    mode: 'github',
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
    return { before_session: beforeSession.trim() };
  }

  return undefined;
}

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
