/**
 * Convention-based discovery of custom assertion scripts.
 *
 * Scans `.agentv/assertions/` for TypeScript/JavaScript files and registers
 * them as code_judge evaluators in the registry. The file name (without
 * extension) becomes the evaluator type name.
 *
 * Example: `.agentv/assertions/sentiment.ts` → type "sentiment" in EVAL.yaml
 */

import path from 'node:path';
import fg from 'fast-glob';

import { CodeEvaluator } from '../evaluators/code-evaluator.js';
import type { EvaluatorFactoryFn } from './evaluator-registry.js';
import type { EvaluatorRegistry } from './evaluator-registry.js';

/**
 * Discover custom assertion scripts from `.agentv/assertions/` and register
 * them as evaluator types in the registry.
 *
 * @param registry - The evaluator registry to register discovered assertions into
 * @param baseDir - The base directory to search from (typically project root or eval file dir)
 * @returns Names of discovered assertion types
 */
export async function discoverAssertions(
  registry: EvaluatorRegistry,
  baseDir: string,
): Promise<string[]> {
  const assertionsDir = path.join(baseDir, '.agentv', 'assertions');
  const patterns = ['*.ts', '*.js', '*.mts', '*.mjs'];

  let files: string[];
  try {
    files = await fg(patterns, {
      cwd: assertionsDir,
      absolute: true,
      onlyFiles: true,
    });
  } catch {
    // Directory doesn't exist — no custom assertions
    return [];
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
        script: ['bun', 'run', filePath],
        agentTimeoutMs: context.agentTimeoutMs,
      });
    };

    registry.register(typeName, factory);
    discoveredTypes.push(typeName);
  }

  return discoveredTypes;
}
