import { readFile } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import { parse } from 'yaml';

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
  readonly trace_file?: string;
  readonly keep_workspaces?: boolean;
  readonly otel_file?: string;
};

export type AgentVConfig = {
  readonly required_version?: string;
  readonly guideline_patterns?: readonly string[];
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
      const parsed = parse(rawConfig) as unknown;

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

      const guidelinePatterns = config.guideline_patterns;
      if (guidelinePatterns !== undefined && !Array.isArray(guidelinePatterns)) {
        logWarning(`Invalid guideline_patterns in ${configPath}, expected array`);
        continue;
      }

      if (
        Array.isArray(guidelinePatterns) &&
        !guidelinePatterns.every((p) => typeof p === 'string')
      ) {
        logWarning(`Invalid guideline_patterns in ${configPath}, all entries must be strings`);
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
        guideline_patterns: guidelinePatterns as readonly string[] | undefined,
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
 * Determine whether a path references guideline content (instructions or prompts).
 */
export function isGuidelineFile(filePath: string, patterns?: readonly string[]): boolean {
  const normalized = filePath.split('\\').join('/');
  const patternsToUse = patterns ?? [];

  return micromatch.isMatch(normalized, patternsToUse as string[]);
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

  const traceFile = obj.trace_file;
  if (typeof traceFile === 'string' && traceFile.trim().length > 0) {
    result.trace_file = traceFile.trim();
  } else if (traceFile !== undefined) {
    logWarning(`Invalid execution.trace_file in ${configPath}, expected non-empty string`);
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

  return Object.keys(result).length > 0 ? (result as ExecutionDefaults) : undefined;
}

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
