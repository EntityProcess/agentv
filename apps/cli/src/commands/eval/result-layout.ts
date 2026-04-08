import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const RESULT_INDEX_FILENAME = 'index.jsonl';
export const RESULT_RUNS_DIRNAME = 'runs';
export const DEFAULT_EXPERIMENT_NAME = 'default';

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
  return trimmed;
}

export function createRunDirName(timestamp = new Date()): string {
  return timestamp.toISOString().replace(/[:.]/g, '-');
}

export function buildDefaultRunDir(
  cwd: string,
  experiment?: string,
  timestamp = new Date(),
): string {
  return path.join(
    cwd,
    '.agentv',
    'results',
    RESULT_RUNS_DIRNAME,
    normalizeExperimentName(experiment),
    createRunDirName(timestamp),
  );
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
