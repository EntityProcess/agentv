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
  /** Legacy shorthand or Git remote URL for a managed results clone. */
  readonly repo?: string;
  /** Git remote URL for a managed results clone. Preferred in YAML wire config. */
  readonly repo_url?: string;
  /** Local Git repository path. `.` means the current project/source repository. */
  readonly repo_path?: string;
  /** Optional remote branch used as the canonical git-backed results store. */
  readonly branch?: string;
  readonly remote?: string;
  /** Local filesystem path for the results clone. Optional; defaults to ~/.agentv/results/<slug>/. */
  readonly path?: string;
  readonly auto_push?: boolean;
  readonly sync?: {
    readonly auto_push?: boolean;
    readonly require_push?: boolean;
    readonly push_conflict_policy?: ResultPushConflictPolicy;
  };
  readonly branch_prefix?: string;
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

function getSuiteRuntimeBlock(suite: JsonObject): Record<string, unknown> | undefined {
  if (suite.experiment !== undefined && suite.execution !== undefined) {
    throw new Error("Use either top-level 'experiment' or legacy 'execution', not both.");
  }
  const runtime = suite.experiment ?? suite.execution;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    return undefined;
  }
  return runtime as Record<string, unknown>;
}

/**
 * Extract target name from parsed eval suite (checks execution.target then falls back to root-level target).
 */
export function extractTargetFromSuite(suite: JsonObject): string | undefined {
  // Check experiment.target first, then legacy execution.target, then root-level target.
  const runtime = getSuiteRuntimeBlock(suite);
  const runtimeTarget = runtime?.target;
  if (typeof runtimeTarget === 'string' && runtimeTarget.trim().length > 0) {
    return runtimeTarget.trim();
  }

  // Fallback to legacy root-level target
  const targetValue = suite.target;
  if (typeof targetValue === 'string' && targetValue.trim().length > 0) {
    return targetValue.trim();
  }

  return undefined;
}

/**
 * Extract target refs from parsed eval suite.
 * Supports both string shorthand and object form with hooks.
 * Returns undefined when no targets array is specified.
 */
export function extractTargetRefsFromSuite(
  suite: JsonObject,
): readonly EvalTargetRef[] | undefined {
  const runtime = getSuiteRuntimeBlock(suite);
  if (!runtime) {
    return undefined;
  }

  const targets = runtime.targets;
  if (!Array.isArray(targets)) {
    return undefined;
  }

  const refs: EvalTargetRef[] = [];
  for (const t of targets) {
    if (typeof t === 'string' && t.trim().length > 0) {
      refs.push({ name: t.trim() });
    } else if (t && typeof t === 'object' && !Array.isArray(t) && 'name' in t) {
      const obj = t as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      if (name.length === 0) continue;
      const useTarget = typeof obj.use_target === 'string' ? obj.use_target.trim() : undefined;
      const hooks = parseTargetHooks(obj.hooks);
      refs.push({
        name,
        ...(useTarget && { use_target: useTarget }),
        ...(hooks && { hooks }),
      });
    }
  }
  return refs.length > 0 ? refs : undefined;
}

/**
 * Extract target names from parsed eval suite (backward-compat wrapper).
 * Precedence: execution.targets (array) > execution.target (singular).
 * Returns undefined when no targets array is specified.
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
function parseTargetHooks(raw: unknown): TargetHooksConfig | undefined {
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
 * Extract workers count from suite-level execution block.
 */
export function extractWorkersFromSuite(suite: JsonObject): number | undefined {
  const runtime = getSuiteRuntimeBlock(suite);
  if (!runtime) {
    return undefined;
  }

  const workers = runtime.workers;
  if (typeof workers === 'number' && Number.isInteger(workers) && workers >= 1 && workers <= 50) {
    return workers;
  }

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
 * Extract cache configuration from parsed eval suite's execution block.
 * Returns undefined when no cache config is specified.
 */
export function extractCacheConfig(suite: JsonObject): CacheConfig | undefined {
  const executionObj = getSuiteRuntimeBlock(suite);
  if (!executionObj) {
    return undefined;
  }

  const cache = executionObj.cache;

  if (cache === undefined || cache === null) {
    return undefined;
  }

  if (typeof cache !== 'boolean') {
    logWarning(`Invalid execution.cache: ${cache}. Must be a boolean. Ignoring.`);
    return undefined;
  }

  if (executionObj.cachePath !== undefined) {
    logWarning('Invalid execution.cachePath: use snake_case execution.cache_path in YAML.');
  }

  const cachePath = executionObj.cache_path;
  const resolvedCachePath =
    typeof cachePath === 'string' && cachePath.trim().length > 0 ? cachePath.trim() : undefined;

  return { enabled: cache, cachePath: resolvedCachePath };
}

/**
 * Extract suite-level total budget from parsed eval suite's execution block.
 * Returns undefined when not specified.
 */
export function extractBudgetUsd(suite: JsonObject): number | undefined {
  const executionObj = getSuiteRuntimeBlock(suite);
  if (!executionObj) {
    return undefined;
  }

  // Reject the old key with a clear error
  if ('total_budget_usd' in executionObj || 'totalBudgetUsd' in executionObj) {
    throw new Error(
      'execution.total_budget_usd has been renamed to execution.budget_usd. Update your eval YAML.',
    );
  }

  const rawBudget = executionObj.budget_usd ?? executionObj.budgetUsd;

  if (rawBudget === undefined || rawBudget === null) {
    return undefined;
  }

  if (typeof rawBudget === 'number' && rawBudget > 0) {
    return rawBudget;
  }

  logWarning(`Invalid execution.budget_usd: ${rawBudget}. Must be a positive number. Ignoring.`);
  return undefined;
}

/**
 * Extract `execution.fail_on_error` from parsed eval suite.
 * Accepts `true` or `false`.
 * Returns undefined when not specified.
 */
export function extractFailOnError(suite: JsonObject): FailOnError | undefined {
  const executionObj = getSuiteRuntimeBlock(suite);
  if (!executionObj) {
    return undefined;
  }

  const raw = executionObj.fail_on_error ?? executionObj.failOnError;

  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw === 'boolean') {
    return raw;
  }

  logWarning(`Invalid execution.fail_on_error: ${raw}. Must be true or false. Ignoring.`);
  return undefined;
}

/**
 * Extract `execution.threshold` from parsed eval suite.
 * Accepts a number in [0, 1] range.
 * Returns undefined when not specified.
 */
export function extractThreshold(suite: JsonObject): number | undefined {
  const executionObj = getSuiteRuntimeBlock(suite);
  if (!executionObj) {
    return undefined;
  }

  const raw = executionObj.threshold;

  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw === 'number' && raw >= 0 && raw <= 1) {
    return raw;
  }

  logWarning(`Invalid execution.threshold: ${raw}. Must be a number between 0 and 1. Ignoring.`);
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
    `${key} in ${configPath} is ignored. Runtime configuration now belongs in eval.yaml under experiment:.`,
  );
}

function isFilesystemPath(p: string): boolean {
  return (
    p.startsWith('/') ||
    p.startsWith('~/') ||
    p.startsWith('~\\') ||
    p === '~' ||
    /^[A-Za-z]:[/\\]/.test(p)
  );
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isGitRemoteUrl(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@|file:\/\/).+/.test(value);
}

type NestedResultsRepoConfig = {
  readonly repo_url?: string;
  readonly repo_path?: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly path?: string;
};

function parseNestedResultsRepoConfig(
  raw: unknown,
  configPath: string,
): NestedResultsRepoConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    logWarning(`Invalid results.repo in ${configPath}, expected object`);
    return undefined;
  }

  const repo = raw as Record<string, unknown>;
  const url = readTrimmedString(repo.url);
  const repoPath = readTrimmedString(repo.path);
  const branch = readTrimmedString(repo.branch);
  const remote = readTrimmedString(repo.remote);
  const remoteUrl = remote ?? url;

  if (repo.url !== undefined && !url) {
    logWarning(`Invalid results.repo.url in ${configPath}, expected non-empty string`);
    return undefined;
  }
  if (url && !isGitRemoteUrl(url)) {
    logWarning(`Invalid results.repo.url in ${configPath}, expected Git remote URL`);
    return undefined;
  }
  if (repo.path !== undefined && !repoPath) {
    logWarning(`Invalid results.repo.path in ${configPath}, expected non-empty string`);
    return undefined;
  }
  if (repo.branch !== undefined && !branch) {
    logWarning(`Invalid results.repo.branch in ${configPath}, expected non-empty string`);
    return undefined;
  }
  if (repo.remote !== undefined && !remote) {
    logWarning(`Invalid results.repo.remote in ${configPath}, expected non-empty string`);
    return undefined;
  }
  if (remote && !isGitRemoteUrl(remote)) {
    logWarning(`Invalid results.repo.remote in ${configPath}, expected Git remote URL`);
    return undefined;
  }
  if (remote && url) {
    logWarning(`Invalid results.repo in ${configPath}, set only one of remote or url`);
    return undefined;
  }
  if (!remoteUrl && !repoPath) {
    logWarning(`Invalid results.repo in ${configPath}, expected remote or path`);
    return undefined;
  }

  return {
    ...(remoteUrl && { repo_url: remoteUrl }),
    ...(repoPath && !remoteUrl && { repo_path: repoPath }),
    ...(remoteUrl && repoPath && { path: repoPath }),
    ...(branch && { branch }),
  };
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

  const hasNestedRepo = obj.repo !== undefined && typeof obj.repo === 'object' && obj.repo !== null;
  const nestedRepo = hasNestedRepo ? parseNestedResultsRepoConfig(obj.repo, configPath) : undefined;
  if (hasNestedRepo && !nestedRepo) {
    return undefined;
  }
  if (obj.repo !== undefined && !hasNestedRepo && typeof obj.repo !== 'string') {
    logWarning(`Invalid results.repo in ${configPath}, expected string or object`);
    return undefined;
  }
  if (
    nestedRepo &&
    ['repo_url', 'repo_path', 'branch', 'remote', 'path'].some((field) => obj[field] !== undefined)
  ) {
    logWarning(
      `Invalid results in ${configPath}, do not mix nested results.repo with flat repo_url, repo_path, branch, remote, or path fields`,
    );
    return undefined;
  }

  const legacyRepo = typeof obj.repo === 'string' ? obj.repo.trim() : '';
  const repoUrl =
    nestedRepo?.repo_url ?? (typeof obj.repo_url === 'string' ? obj.repo_url.trim() : '');
  const repoPath =
    nestedRepo?.repo_path ?? (typeof obj.repo_path === 'string' ? obj.repo_path.trim() : '');
  const repo = legacyRepo || repoUrl;
  if (!repo && !repoPath) {
    logWarning(
      `Invalid results in ${configPath}, expected nested repo.remote/repo.path or compatible repo_url/repo_path`,
    );
    return undefined;
  }
  if (repo && repoPath) {
    logWarning(
      `Invalid results in ${configPath}, set only one of nested repo.remote/repo.path or compatible repo_url/repo_path`,
    );
    return undefined;
  }

  let branch: string | undefined;
  if (nestedRepo?.branch !== undefined) {
    branch = nestedRepo.branch;
  } else if (obj.branch !== undefined) {
    if (typeof obj.branch !== 'string' || obj.branch.trim().length === 0) {
      logWarning(`Invalid results.branch in ${configPath}, expected non-empty string`);
      return undefined;
    }
    branch = obj.branch.trim();
  }

  let remote: string | undefined;
  if (nestedRepo?.remote !== undefined) {
    remote = nestedRepo.remote;
  } else if (obj.remote !== undefined) {
    if (typeof obj.remote !== 'string' || obj.remote.trim().length === 0) {
      logWarning(`Invalid results.remote in ${configPath}, expected non-empty string`);
      return undefined;
    }
    remote = obj.remote.trim();
  }

  let resultsPath: string | undefined;
  if (nestedRepo?.path !== undefined) {
    resultsPath = nestedRepo.path;
  } else if (obj.path !== undefined) {
    if (typeof obj.path !== 'string' || obj.path.trim().length === 0) {
      logWarning(`Invalid results.path in ${configPath}, expected non-empty string`);
      return undefined;
    }
    const trimmedPath = obj.path.trim();
    if (!isFilesystemPath(trimmedPath)) {
      logWarning(
        `Invalid results.path in ${configPath}: '${trimmedPath}' looks like a repo subdirectory. results.path now specifies the local filesystem directory for the clone (e.g., ~/data/agentv-results). Remove 'path' to use the default or set an absolute/home-relative path.`,
      );
      return undefined;
    }
    resultsPath = trimmedPath;
  }

  if (obj.auto_push !== undefined && typeof obj.auto_push !== 'boolean') {
    logWarning(`Invalid results.auto_push in ${configPath}, expected boolean`);
    return undefined;
  }

  let sync: ResultsConfig['sync'];
  if (obj.sync !== undefined) {
    if (typeof obj.sync !== 'object' || obj.sync === null || Array.isArray(obj.sync)) {
      logWarning(`Invalid results.sync in ${configPath}, expected object`);
      return undefined;
    }
    const syncObj = obj.sync as Record<string, unknown>;
    if (syncObj.auto_push !== undefined && typeof syncObj.auto_push !== 'boolean') {
      logWarning(`Invalid results.sync.auto_push in ${configPath}, expected boolean`);
      return undefined;
    }
    if (syncObj.require_push !== undefined && typeof syncObj.require_push !== 'boolean') {
      logWarning(`Invalid results.sync.require_push in ${configPath}, expected boolean`);
      return undefined;
    }
    if (syncObj.push_conflict_policy === 'backup_and_force_push') {
      logWarning(
        `results.sync.push_conflict_policy: 'backup_and_force_push' in ${configPath} is no longer supported. Remove the field or set it to 'block'; AgentV never force-pushes result branches.`,
      );
      return undefined;
    }
    if (syncObj.push_conflict_policy !== undefined && syncObj.push_conflict_policy !== 'block') {
      logWarning(`Invalid results.sync.push_conflict_policy in ${configPath}, expected 'block'`);
      return undefined;
    }
    sync = {
      ...(typeof syncObj.auto_push === 'boolean' && { auto_push: syncObj.auto_push }),
      ...(typeof syncObj.require_push === 'boolean' && { require_push: syncObj.require_push }),
      ...(syncObj.push_conflict_policy === 'block' && {
        push_conflict_policy: syncObj.push_conflict_policy,
      }),
    };
  }

  let branchPrefix: string | undefined;
  if (obj.branch_prefix !== undefined) {
    if (typeof obj.branch_prefix !== 'string' || obj.branch_prefix.trim().length === 0) {
      logWarning(`Invalid results.branch_prefix in ${configPath}, expected non-empty string`);
      return undefined;
    }
    branchPrefix = obj.branch_prefix.trim();
  }

  return {
    mode: 'github',
    ...(repo && { repo }),
    ...(repoUrl && { repo_url: repoUrl }),
    ...(repoPath && { repo_path: repoPath }),
    ...(branch !== undefined && { branch }),
    ...(remote !== undefined && { remote }),
    ...(resultsPath !== undefined && { path: resultsPath }),
    ...(typeof obj.auto_push === 'boolean' && { auto_push: obj.auto_push }),
    ...(sync && { sync }),
    ...(branchPrefix && { branch_prefix: branchPrefix }),
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
