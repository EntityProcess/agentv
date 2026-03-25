import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { interpolateEnv } from '../interpolation.js';
import type { FailOnError, JsonObject, TrialStrategy, TrialsConfig } from '../types.js';
import { isJsonObject } from '../types.js';
import { buildDirectoryChain, fileExists } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

export const DEFAULT_EVAL_PATTERNS: readonly string[] = [
  '**/evals/**/*.eval.yaml',
  '**/evals/**/eval.yaml',
];

export type ExecutionDefaults = {
  readonly verbose?: boolean;
  readonly keep_workspaces?: boolean;
  readonly otel_file?: string;
  readonly export_otel?: boolean;
  readonly otel_backend?: string;
  readonly otel_capture_content?: boolean;
  readonly otel_group_turns?: boolean;
  readonly pool_workspaces?: boolean;
  readonly pool_slots?: number;
};

export type AgentVConfig = {
  readonly required_version?: string;
  readonly eval_patterns?: readonly string[];
  readonly execution?: ExecutionDefaults;
};

/**
 * Load optional .agentv/config.yaml configuration file.
 * Searches from eval file directory up to repo root.
 */
export async function loadConfig(
  evalFilePath: string,
  repoRoot: string,
): Promise<AgentVConfig | null> {
  const directories = buildDirectoryChain(evalFilePath, repoRoot);

  for (const directory of directories) {
    const configPath = path.join(directory, '.agentv', 'config.yaml');

    if (!(await fileExists(configPath))) {
      continue;
    }

    try {
      const rawConfig = await readFile(configPath, 'utf8');
      const parsed = interpolateEnv(parse(rawConfig), process.env) as unknown;

      if (!isJsonObject(parsed)) {
        logWarning(`Invalid .agentv/config.yaml format at ${configPath}`);
        continue;
      }

      const config = parsed as AgentVConfig;

      const requiredVersion = (parsed as Record<string, unknown>).required_version;
      if (requiredVersion !== undefined && typeof requiredVersion !== 'string') {
        logWarning(`Invalid required_version in ${configPath}, expected string`);
        continue;
      }

      const evalPatterns = (config as Record<string, unknown>).eval_patterns;
      if (evalPatterns !== undefined && !Array.isArray(evalPatterns)) {
        logWarning(`Invalid eval_patterns in ${configPath}, expected array`);
        continue;
      }

      if (Array.isArray(evalPatterns) && !evalPatterns.every((p) => typeof p === 'string')) {
        logWarning(`Invalid eval_patterns in ${configPath}, all entries must be strings`);
        continue;
      }

      const executionDefaults = parseExecutionDefaults(
        (parsed as Record<string, unknown>).execution,
        configPath,
      );

      return {
        required_version: requiredVersion as string | undefined,
        eval_patterns: evalPatterns as readonly string[] | undefined,
        execution: executionDefaults,
      };
    } catch (error) {
      logWarning(
        `Could not read .agentv/config.yaml at ${configPath}: ${(error as Error).message}`,
      );
    }
  }

  return null;
}

/**
 * Extract target name from parsed eval suite (checks execution.target then falls back to root-level target).
 */
export function extractTargetFromSuite(suite: JsonObject): string | undefined {
  // Check execution.target first (new location), fallback to root-level target (legacy)
  const execution = suite.execution;
  if (execution && typeof execution === 'object' && !Array.isArray(execution)) {
    const executionTarget = (execution as Record<string, unknown>).target;
    if (typeof executionTarget === 'string' && executionTarget.trim().length > 0) {
      return executionTarget.trim();
    }
  }

  // Fallback to legacy root-level target
  const targetValue = suite.target;
  if (typeof targetValue === 'string' && targetValue.trim().length > 0) {
    return targetValue.trim();
  }

  return undefined;
}

/**
 * Extract targets array from parsed eval suite.
 * Precedence: execution.targets (array) > execution.target (singular).
 * Returns undefined when no targets array is specified.
 */
export function extractTargetsFromSuite(suite: JsonObject): readonly string[] | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const targets = (execution as Record<string, unknown>).targets;
  if (Array.isArray(targets)) {
    const valid = targets.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return valid.length > 0 ? valid.map((t) => t.trim()) : undefined;
  }

  return undefined;
}

/**
 * Extract workers count from suite-level execution block.
 */
export function extractWorkersFromSuite(suite: JsonObject): number | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const workers = (execution as Record<string, unknown>).workers;
  if (typeof workers === 'number' && Number.isInteger(workers) && workers >= 1 && workers <= 50) {
    return workers;
  }

  return undefined;
}

/**
 * Extract per-test targets array from a raw test case object.
 */
export function extractTargetsFromTestCase(testCase: JsonObject): readonly string[] | undefined {
  const execution = testCase.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const targets = (execution as Record<string, unknown>).targets;
  if (Array.isArray(targets)) {
    const valid = targets.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return valid.length > 0 ? valid.map((t) => t.trim()) : undefined;
  }

  return undefined;
}

const VALID_TRIAL_STRATEGIES: ReadonlySet<string> = new Set([
  'pass_at_k',
  'mean',
  'confidence_interval',
]);

/**
 * Extract trials configuration from parsed eval suite's execution block.
 * Returns undefined when count is 1 or not specified (no-op).
 */
export function extractTrialsConfig(suite: JsonObject): TrialsConfig | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const trials = (execution as Record<string, unknown>).trials;
  if (!trials || typeof trials !== 'object' || Array.isArray(trials)) {
    return undefined;
  }

  const trialsObj = trials as Record<string, unknown>;
  const count = trialsObj.count;

  if (count === undefined || count === null) {
    return undefined;
  }

  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    logWarning(
      `Invalid trials.count: ${count}, must be a positive integer. Ignoring trials config.`,
    );
    return undefined;
  }

  if (count === 1) {
    return undefined;
  }

  // Parse strategy (default: pass_at_k)
  const rawStrategy = trialsObj.strategy;
  let strategy: TrialStrategy = 'pass_at_k';
  if (rawStrategy !== undefined && rawStrategy !== null) {
    if (typeof rawStrategy !== 'string' || !VALID_TRIAL_STRATEGIES.has(rawStrategy)) {
      logWarning(
        `Invalid trials.strategy: '${rawStrategy}'. Must be one of: pass_at_k, mean, confidence_interval. Defaulting to pass_at_k.`,
      );
    } else {
      strategy = rawStrategy as TrialStrategy;
    }
  }

  // Parse cost_limit_usd (accepts both snake_case and camelCase)
  const rawCostLimit = trialsObj.cost_limit_usd ?? trialsObj.costLimitUsd;
  let costLimitUsd: number | undefined;
  if (rawCostLimit !== undefined && rawCostLimit !== null) {
    if (typeof rawCostLimit === 'number' && rawCostLimit > 0) {
      costLimitUsd = rawCostLimit;
    } else {
      logWarning(
        `Invalid trials.cost_limit_usd: ${rawCostLimit}. Must be a positive number. Ignoring.`,
      );
    }
  }

  return { count, strategy, costLimitUsd };
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
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const executionObj = execution as Record<string, unknown>;
  const cache = executionObj.cache;

  if (cache === undefined || cache === null) {
    return undefined;
  }

  if (typeof cache !== 'boolean') {
    logWarning(`Invalid execution.cache: ${cache}. Must be a boolean. Ignoring.`);
    return undefined;
  }

  const cachePath = executionObj.cache_path ?? executionObj.cachePath;
  const resolvedCachePath =
    typeof cachePath === 'string' && cachePath.trim().length > 0 ? cachePath.trim() : undefined;

  return { enabled: cache, cachePath: resolvedCachePath };
}

/**
 * Extract suite-level total budget from parsed eval suite's execution block.
 * Returns undefined when not specified.
 */
export function extractTotalBudgetUsd(suite: JsonObject): number | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const executionObj = execution as Record<string, unknown>;
  const rawBudget = executionObj.total_budget_usd ?? executionObj.totalBudgetUsd;

  if (rawBudget === undefined || rawBudget === null) {
    return undefined;
  }

  if (typeof rawBudget === 'number' && rawBudget > 0) {
    return rawBudget;
  }

  logWarning(
    `Invalid execution.total_budget_usd: ${rawBudget}. Must be a positive number. Ignoring.`,
  );
  return undefined;
}

/**
 * Extract `execution.fail_on_error` from parsed eval suite.
 * Accepts `true` or `false`.
 * Returns undefined when not specified.
 */
export function extractFailOnError(suite: JsonObject): FailOnError | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const executionObj = execution as Record<string, unknown>;
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
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const executionObj = execution as Record<string, unknown>;
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

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
