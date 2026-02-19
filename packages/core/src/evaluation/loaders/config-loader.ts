import { readFile } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import { parse } from 'yaml';

import type { JsonObject } from '../types.js';
import { isJsonObject } from '../types.js';
import { buildDirectoryChain, fileExists } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

export const DEFAULT_EVAL_PATTERNS: readonly string[] = [
  '**/evals/**/dataset*.yaml',
  '**/evals/**/eval.yaml',
];

export type AgentVConfig = {
  readonly guideline_patterns?: readonly string[];
  readonly eval_patterns?: readonly string[];
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

      return {
        guideline_patterns: guidelinePatterns as readonly string[] | undefined,
        eval_patterns: evalPatterns as readonly string[] | undefined,
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

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
