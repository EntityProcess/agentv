/**
 * Convention-based discovery of custom grader scripts.
 *
 * Scans `.agentv/graders/` (and legacy `.agentv/judges/`) for TypeScript/JavaScript
 * files and registers them as code-grader evaluators in the registry. The file name
 * (without extension) becomes the evaluator type name.
 *
 * Example: `.agentv/graders/custom-grader.ts` → type "custom-grader" in EVAL.yaml
 */

import path from 'node:path';
import fg from 'fast-glob';

import { CodeEvaluator } from '../evaluators/code-evaluator.js';
import type { EvaluatorFactoryFn } from './evaluator-registry.js';
import type { EvaluatorRegistry } from './evaluator-registry.js';

/**
 * Discover custom grader scripts from `.agentv/graders/` (and legacy `.agentv/judges/`)
 * and register them as evaluator types in the registry.
 *
 * @param registry - The evaluator registry to register discovered graders into
 * @param baseDir - The base directory to search from (typically project root or eval file dir)
 * @returns Names of discovered grader types
 */
export async function discoverGraders(
  registry: EvaluatorRegistry,
  baseDir: string,
): Promise<string[]> {
  const patterns = ['*.ts', '*.js', '*.mts', '*.mjs'];

  // Search baseDir and its ancestors for .agentv/graders/ and .agentv/judges/ (backward compat)
  const candidateDirs: string[] = [];
  let dir = path.resolve(baseDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    candidateDirs.push(path.join(dir, '.agentv', 'graders'));
    candidateDirs.push(path.join(dir, '.agentv', 'judges'));
    dir = path.dirname(dir);
  }

  let files: string[] = [];
  for (const gradersDir of candidateDirs) {
    try {
      const found = await fg(patterns, {
        cwd: gradersDir,
        absolute: true,
        onlyFiles: true,
      });
      files = files.concat(found);
    } catch {
      // Directory doesn't exist — skip
    }
  }

  const discoveredTypes: string[] = [];

  for (const filePath of files) {
    const basename = path.basename(filePath);
    const typeName = basename.replace(/\.(ts|js|mts|mjs)$/, '');

    // Don't override built-in types
    if (registry.has(typeName)) {
      continue;
    }

    const factory: EvaluatorFactoryFn = (_config, context) => {
      return new CodeEvaluator({
        command: ['bun', 'run', filePath],
        agentTimeoutMs: context.agentTimeoutMs,
      });
    };

    registry.register(typeName, factory);
    discoveredTypes.push(typeName);
  }

  return discoveredTypes;
}

/** @deprecated Use `discoverGraders` instead */
export const discoverJudges = discoverGraders;
