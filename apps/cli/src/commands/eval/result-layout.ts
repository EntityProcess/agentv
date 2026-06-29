import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const RESULT_MANIFEST_FILENAME = 'run_manifest.jsonl';
export const LEGACY_RESULT_INDEX_FILENAME = 'index.jsonl';
// Backward-compatible export name retained for existing callers. New writes use
// the row-level run manifest filename.
export const RESULT_INDEX_FILENAME = RESULT_MANIFEST_FILENAME;
export const RESULT_MANIFEST_FILENAMES = [
  RESULT_MANIFEST_FILENAME,
  LEGACY_RESULT_INDEX_FILENAME,
] as const;
export const RUN_SUMMARY_FILENAME = 'summary.json';
export const RESULTS_DIRNAME = 'results';
export const DEFAULT_EXPERIMENT_NAME = 'default';
export const RESERVED_RESULTS_NAMESPACES = new Set(['export', 'metadata', 'runs']);

export function isReservedResultsNamespace(value: string | undefined): boolean {
  return value !== undefined && RESERVED_RESULTS_NAMESPACES.has(value);
}

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
  if (isReservedResultsNamespace(trimmed)) {
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
  return RESULT_MANIFEST_FILENAMES.includes(
    path.basename(filePath) as (typeof RESULT_MANIFEST_FILENAMES)[number],
  );
}

function safeSummaryManifestPath(runDir: string, manifestPath: unknown): string | undefined {
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    return undefined;
  }
  if (path.isAbsolute(manifestPath)) {
    return undefined;
  }
  const normalized = path.normalize(manifestPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return undefined;
  }
  return path.join(runDir, normalized);
}

function resolveSummaryManifestPath(runDir: string): string | undefined {
  try {
    const summary = JSON.parse(readFileSync(path.join(runDir, RUN_SUMMARY_FILENAME), 'utf8')) as {
      manifest_path?: unknown;
    };
    const manifestPath = safeSummaryManifestPath(runDir, summary.manifest_path);
    return manifestPath && existsSync(manifestPath) ? manifestPath : undefined;
  } catch {
    return undefined;
  }
}

export function resolveExistingRunPrimaryPath(runDir: string): string | undefined {
  const summaryManifestPath = resolveSummaryManifestPath(runDir);
  if (summaryManifestPath) {
    return summaryManifestPath;
  }

  for (const filename of RESULT_MANIFEST_FILENAMES) {
    const manifestPath = path.join(runDir, filename);
    if (existsSync(manifestPath)) {
      return manifestPath;
    }
  }

  return undefined;
}

export function discoverRunManifestPaths(runDir: string): readonly string[] {
  const direct = resolveExistingRunPrimaryPath(runDir);
  if (direct) {
    return [direct];
  }

  const manifests: string[] = [];
  function walk(currentDir: string): void {
    const primary = resolveExistingRunPrimaryPath(currentDir);
    if (primary) {
      manifests.push(primary);
      return;
    }

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name));
      }
    }
  }

  walk(runDir);
  return manifests.sort();
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
  if (existing) {
    return existing;
  }

  const nested = discoverRunManifestPaths(filePath);
  if (nested.length === 1) {
    return nested[0];
  }
  if (nested.length > 1) {
    throw new Error(
      `Result workspace contains multiple run manifests; pass one bundle directory or manifest: ${filePath}`,
    );
  }
  throw new Error(
    `Result workspace is missing ${RESULT_MANIFEST_FILENAME} or legacy ${LEGACY_RESULT_INDEX_FILENAME}: ${filePath}`,
  );
}

export function resolveRunManifestPath(filePath: string): string {
  if (isDirectoryPath(filePath)) {
    return resolveWorkspaceOrFilePath(filePath);
  }

  if (!isRunManifestPath(filePath)) {
    throw new Error(
      `Expected a run workspace directory or ${RESULT_MANIFEST_FILENAME} manifest (legacy ${LEGACY_RESULT_INDEX_FILENAME} is also readable): ${filePath}`,
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
  if (parts.length < 2 || isReservedResultsNamespace(parts[0])) {
    return undefined;
  }

  return parts.join(path.posix.sep);
}
