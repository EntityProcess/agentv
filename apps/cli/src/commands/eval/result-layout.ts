import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const RESULT_INDEX_FILENAME = 'index.jsonl';
export const RESULTS_DIRNAME = 'results';
export const DEFAULT_EXPERIMENT_NAME = 'default';
const RESERVED_EXPERIMENT_NAMES = new Set(['runs']);

export function normalizeExperimentName(experiment?: string): string {
  const trimmed = experiment?.trim();
  if (!trimmed) {
    return DEFAULT_EXPERIMENT_NAME;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid experiment name "${trimmed}". Use only letters, numbers, ".", "_" and "-".`,
    );
  }
  if (RESERVED_EXPERIMENT_NAMES.has(trimmed)) {
    throw new Error(`Invalid experiment name "${trimmed}". This results namespace is reserved.`);
  }
  return trimmed;
}

export function createRunDirName(timestamp = new Date()): string {
  return timestamp.toISOString().replace(/[:.]/g, '-');
}

function defaultRunPathSegments(experiment: string | undefined, runDirName: string): string[] {
  const normalizedExperiment = normalizeExperimentName(experiment);
  return [normalizedExperiment, runDirName];
}

export function buildResultsRootDir(cwd: string): string {
  return path.join(cwd, '.agentv', RESULTS_DIRNAME);
}

export function buildDefaultRunDirFromName(
  cwd: string,
  experiment: string | undefined,
  runDirName: string,
): string {
  return path.join(buildResultsRootDir(cwd), ...defaultRunPathSegments(experiment, runDirName));
}

export function buildDefaultRunDir(
  cwd: string,
  experiment?: string,
  timestamp = new Date(),
): string {
  return buildDefaultRunDirFromName(cwd, experiment, createRunDirName(timestamp));
}

export function buildDefaultIndexPath(cwd: string, experiment?: string): string {
  return path.join(buildDefaultRunDir(cwd, experiment), RESULT_INDEX_FILENAME);
}

export function resolveRunIndexPath(runDir: string): string {
  return path.join(runDir, RESULT_INDEX_FILENAME);
}

export function isRunManifestPath(filePath: string): boolean {
  return path.basename(filePath) === RESULT_INDEX_FILENAME;
}

export function resolveExistingRunPrimaryPath(runDir: string): string | undefined {
  const indexPath = resolveRunIndexPath(runDir);
  if (existsSync(indexPath)) {
    return indexPath;
  }

  return undefined;
}

export function isDirectoryPath(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveWorkspaceOrFilePath(filePath: string): string {
  if (!isDirectoryPath(filePath)) {
    return filePath;
  }

  const existing = resolveExistingRunPrimaryPath(filePath);
  if (!existing) {
    throw new Error(`Result workspace is missing ${RESULT_INDEX_FILENAME}: ${filePath}`);
  }

  return existing;
}

export function resolveRunManifestPath(filePath: string): string {
  if (isDirectoryPath(filePath)) {
    return resolveWorkspaceOrFilePath(filePath);
  }

  if (!isRunManifestPath(filePath)) {
    throw new Error(
      `Expected a run workspace directory or ${RESULT_INDEX_FILENAME} manifest: ${filePath}`,
    );
  }

  return filePath;
}

export function relativeRunPathFromCwd(cwd: string, runDir: string): string | undefined {
  const relative = path.relative(path.resolve(buildResultsRootDir(cwd)), path.resolve(runDir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length < 2 || RESERVED_EXPERIMENT_NAMES.has(parts[0] ?? '')) {
    return undefined;
  }

  return parts.join(path.posix.sep);
}
