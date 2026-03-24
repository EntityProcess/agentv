import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const RESULT_INDEX_FILENAME = 'index.jsonl';
export const LEGACY_RESULTS_FILENAME = 'results.jsonl';

export function createRunDirName(timestamp = new Date()): string {
  return `eval_${timestamp.toISOString().replace(/[:.]/g, '-')}`;
}

export function buildDefaultRunDir(cwd: string): string {
  return path.join(cwd, '.agentv', 'results', 'raw', createRunDirName());
}

export function buildDefaultIndexPath(cwd: string): string {
  return path.join(buildDefaultRunDir(cwd), RESULT_INDEX_FILENAME);
}

export function resolveRunIndexPath(runDir: string): string {
  return path.join(runDir, RESULT_INDEX_FILENAME);
}

export function resolveRunLegacyResultsPath(runDir: string): string {
  return path.join(runDir, LEGACY_RESULTS_FILENAME);
}

export function resolveExistingRunPrimaryPath(runDir: string): string | undefined {
  const indexPath = resolveRunIndexPath(runDir);
  if (existsSync(indexPath)) {
    return indexPath;
  }

  const legacyPath = resolveRunLegacyResultsPath(runDir);
  if (existsSync(legacyPath)) {
    return legacyPath;
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
    throw new Error(
      `Result workspace is missing ${RESULT_INDEX_FILENAME} and ${LEGACY_RESULTS_FILENAME}: ${filePath}`,
    );
  }

  return existing;
}
