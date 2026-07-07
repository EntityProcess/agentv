import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { buildDirectoryChain } from '@agentv/core';

export const TARGET_FILE_CANDIDATES = [
  'providers.yaml',
  'providers.yml',
  path.join('.agentv', 'providers.yaml'),
  path.join('.agentv', 'providers.yml'),
] as const;

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverTargetsFile(options: {
  readonly explicitPath?: string;
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
}): Promise<string> {
  const { explicitPath, testFilePath, repoRoot, cwd } = options;

  if (explicitPath) {
    const resolvedExplicit = path.resolve(explicitPath);
    if (await fileExists(resolvedExplicit)) {
      return resolvedExplicit;
    }

    for (const candidate of TARGET_FILE_CANDIDATES) {
      const nested = path.join(resolvedExplicit, candidate);
      if (await fileExists(nested)) {
        return nested;
      }
    }

    throw new Error(`providers.yaml not found at provided path: ${resolvedExplicit}`);
  }

  const directories = [...buildDirectoryChain(testFilePath, repoRoot)];

  // Also check cwd if not already in chain
  const resolvedCwd = path.resolve(cwd);
  if (!directories.includes(resolvedCwd)) {
    directories.push(resolvedCwd);
  }

  for (const directory of directories) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const fullPath = path.join(directory, candidate);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }

  throw new Error(
    'Unable to locate providers.yaml. Use --providers to specify the file explicitly.',
  );
}
