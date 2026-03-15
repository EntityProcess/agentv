/**
 * Convention-based discovery of custom judge scripts.
 *
 * Scans `.agentv/judges/` for TypeScript/JavaScript files and registers
 * them as code-judge evaluators in the registry. The file name (without
 * extension) becomes the evaluator type name.
 *
 * Example: `.agentv/judges/custom-judge.ts` → type "custom-judge" in EVAL.yaml
 */

import path from 'node:path';
import fg from 'fast-glob';

import { CodeEvaluator } from '../evaluators/code-evaluator.js';
import type { EvaluatorFactoryFn } from './evaluator-registry.js';
import type { EvaluatorRegistry } from './evaluator-registry.js';

/**
 * Discover custom judge scripts from `.agentv/judges/` and register
 * them as evaluator types in the registry.
 *
 * @param registry - The evaluator registry to register discovered judges into
 * @param baseDir - The base directory to search from (typically project root or eval file dir)
 * @returns Names of discovered judge types
 */
export async function discoverJudges(
  registry: EvaluatorRegistry,
  baseDir: string,
): Promise<string[]> {
  const patterns = ['*.ts', '*.js', '*.mts', '*.mjs'];

  // Search baseDir and its ancestors for .agentv/judges/
  const candidateDirs: string[] = [];
  let dir = path.resolve(baseDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    candidateDirs.push(path.join(dir, '.agentv', 'judges'));
    dir = path.dirname(dir);
  }

  let files: string[] = [];
  for (const judgesDir of candidateDirs) {
    try {
      const found = await fg(patterns, {
        cwd: judgesDir,
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
