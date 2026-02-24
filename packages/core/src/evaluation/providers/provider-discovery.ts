/**
 * Convention-based discovery of custom provider scripts.
 *
 * Scans `.agentv/providers/` for TypeScript/JavaScript files and registers
 * them as CLI-like providers in the registry. The file name (without
 * extension) becomes the provider kind name.
 *
 * Example: `.agentv/providers/my-llm.ts` -> provider kind "my-llm" in targets.yaml
 */

import path from 'node:path';
import fg from 'fast-glob';

import { CliProvider } from './cli.js';
import type { ProviderRegistry } from './provider-registry.js';

/**
 * Discover custom provider scripts from `.agentv/providers/` and register
 * them as provider kinds in the registry.
 *
 * Each discovered script is registered as a CLI-like provider that runs
 * via `bun run <filePath> {PROMPT}`. The script receives the prompt as
 * a CLI argument and should print its response to stdout.
 *
 * @param registry - The provider registry to register discovered providers into
 * @param baseDir - The base directory to search from (typically project root or eval file dir)
 * @returns Names of discovered provider kinds
 */
export async function discoverProviders(
  registry: ProviderRegistry,
  baseDir: string,
): Promise<string[]> {
  const patterns = ['*.ts', '*.js', '*.mts', '*.mjs'];

  // Search baseDir and its ancestors for .agentv/providers/
  const candidateDirs: string[] = [];
  let dir = path.resolve(baseDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    candidateDirs.push(path.join(dir, '.agentv', 'providers'));
    dir = path.dirname(dir);
  }

  let files: string[] = [];
  for (const providersDir of candidateDirs) {
    try {
      const found = await fg(patterns, {
        cwd: providersDir,
        absolute: true,
        onlyFiles: true,
      });
      files = files.concat(found);
    } catch {
      // Directory doesn't exist — skip
    }
  }

  const discoveredKinds: string[] = [];

  for (const filePath of files) {
    const basename = path.basename(filePath);
    const kindName = basename.replace(/\.(ts|js|mts|mjs)$/, '');

    // Don't override built-in kinds
    if (registry.has(kindName)) {
      continue;
    }

    registry.register(kindName, (target) => {
      return new CliProvider(target.name, {
        command: `bun run ${filePath} {PROMPT}`,
      });
    });
    discoveredKinds.push(kindName);
  }

  return discoveredKinds;
}
