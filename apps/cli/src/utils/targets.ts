import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildDirectoryChain } from '@agentv/core';

export const PROVIDER_FILE_CANDIDATES = [
  'providers.yaml',
  'providers.yml',
  path.join('.agentv', 'providers.yaml'),
  path.join('.agentv', 'providers.yml'),
] as const;

const LEGACY_TARGET_FILE_CANDIDATES = [
  'targets.yaml',
  'targets.yml',
  path.join('.agentv', 'targets.yaml'),
  path.join('.agentv', 'targets.yml'),
] as const;

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathKind(filePath: string): Promise<'file' | 'directory' | undefined> {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return 'directory';
    }
    if (info.isFile()) {
      return 'file';
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isLegacyTargetFile(filePath: string): boolean {
  return /^targets\.ya?ml$/i.test(path.basename(filePath));
}

function removedTargetsFileError(filePath: string): Error {
  return new Error(
    `Authored targets.yaml files were removed. Rename ${filePath} to providers.yaml and use --providers to specify it explicitly.`,
  );
}

async function findProviderFileInDirectory(directory: string): Promise<string | undefined> {
  for (const candidate of PROVIDER_FILE_CANDIDATES) {
    const fullPath = path.join(directory, candidate);
    if ((await pathKind(fullPath)) === 'file') {
      return fullPath;
    }
  }
  return undefined;
}

async function findLegacyTargetFileInDirectory(directory: string): Promise<string | undefined> {
  for (const candidate of LEGACY_TARGET_FILE_CANDIDATES) {
    const fullPath = path.join(directory, candidate);
    if ((await pathKind(fullPath)) === 'file') {
      return fullPath;
    }
  }
  return undefined;
}

export async function discoverTargetsFile(options: {
  readonly explicitPath?: string;
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly allowLegacyTargetFiles?: boolean;
}): Promise<string> {
  const { explicitPath, testFilePath, repoRoot, cwd, allowLegacyTargetFiles = false } = options;

  if (explicitPath) {
    const resolvedExplicit = path.resolve(explicitPath);
    const kind = await pathKind(resolvedExplicit);
    if (kind === 'file') {
      if (!allowLegacyTargetFiles && isLegacyTargetFile(resolvedExplicit)) {
        throw removedTargetsFileError(resolvedExplicit);
      }
      return resolvedExplicit;
    }

    if (kind === 'directory') {
      const providerFile = await findProviderFileInDirectory(resolvedExplicit);
      if (providerFile) {
        return providerFile;
      }
      const legacyTargetFile = await findLegacyTargetFileInDirectory(resolvedExplicit);
      if (legacyTargetFile) {
        if (allowLegacyTargetFiles) {
          return legacyTargetFile;
        }
        throw removedTargetsFileError(legacyTargetFile);
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
    const providerFile = await findProviderFileInDirectory(directory);
    if (providerFile) {
      return providerFile;
    }
  }

  for (const directory of directories) {
    const legacyTargetFile = await findLegacyTargetFileInDirectory(directory);
    if (legacyTargetFile) {
      if (allowLegacyTargetFiles) {
        return legacyTargetFile;
      }
      throw removedTargetsFileError(legacyTargetFile);
    }
  }

  throw new Error(
    'Unable to locate providers.yaml. Use --providers to specify the file explicitly.',
  );
}
