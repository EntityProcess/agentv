/**
 * Convention-based discovery of custom assertion scripts.
 *
 * Scans `.agentv/assertions/` for TypeScript/JavaScript files and registers
 * them as code graders in the registry. The file name (without
 * extension) becomes the grader type name.
 *
 * Example: `.agentv/assertions/sentiment.ts` → type "sentiment" in EVAL.yaml
 */

import path from 'node:path';
import fg from 'fast-glob';

import { CodeGrader } from '../graders/code-grader.js';
import type { GraderFactoryFn } from './grader-registry.js';
import type { GraderRegistry } from './grader-registry.js';

/**
 * Discover custom assertion scripts from `.agentv/assertions/` and register
 * them as grader types in the registry.
 *
 * @param registry - The grader registry to register discovered assertions into
 * @param baseDir - The base directory to search from (typically project root or eval file dir)
 * @returns Names of discovered assertion types
 */
export async function discoverAssertions(
  registry: GraderRegistry,
  baseDir: string,
): Promise<string[]> {
  const patterns = ['*.ts', '*.js', '*.mts', '*.mjs'];

  // Search baseDir and its ancestors for .agentv/assertions/
  const candidateDirs: string[] = [];
  let dir = path.resolve(baseDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    candidateDirs.push(path.join(dir, '.agentv', 'assertions'));
    dir = path.dirname(dir);
  }

  let files: string[] = [];
  for (const assertionsDir of candidateDirs) {
    try {
      const found = await fg(patterns, {
        cwd: assertionsDir,
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

    const factory: GraderFactoryFn = (_config, context) => {
      return new CodeGrader({
        command: ['bun', 'run', filePath],
        agentTimeoutMs: context.agentTimeoutMs,
      });
    };

    registry.register(typeName, factory);
    discoveredTypes.push(typeName);
  }

  return discoveredTypes;
}
