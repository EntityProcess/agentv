import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Check if a file exists on disk.
 */
export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert URL or string to absolute file path.
 */
export function resolveToAbsolutePath(candidate: URL | string): string {
  if (candidate instanceof URL) {
    return new URL(candidate).pathname;
  }
  if (typeof candidate === "string") {
    if (candidate.startsWith("file://")) {
      return new URL(candidate).pathname;
    }
    return path.resolve(candidate);
  }
  throw new TypeError("Unsupported repoRoot value. Expected string or URL.");
}

/**
 * Build a chain of directories walking from a file's location up to repo root.
 * Used for discovering configuration files.
 */
export function buildDirectoryChain(filePath: string, repoRoot: string): readonly string[] {
  const directories: string[] = [];
  const seen = new Set<string>();
  const boundary = path.resolve(repoRoot);
  let current: string | undefined = path.resolve(path.dirname(filePath));

  while (current !== undefined) {
    if (!seen.has(current)) {
      directories.push(current);
      seen.add(current);
    }
    if (current === boundary) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (!seen.has(boundary)) {
    directories.push(boundary);
  }

  return directories;
}

/**
 * Build search roots for file resolution.
 * Searches from eval file directory up to repo root.
 */
export function buildSearchRoots(evalPath: string, repoRoot: string): readonly string[] {
  const uniqueRoots: string[] = [];
  const addRoot = (root: string): void => {
    const normalized = path.resolve(root);
    if (!uniqueRoots.includes(normalized)) {
      uniqueRoots.push(normalized);
    }
  };

  let currentDir = path.dirname(evalPath);
  let reachedBoundary = false;
  while (!reachedBoundary) {
    addRoot(currentDir);
    const parentDir = path.dirname(currentDir);
    if (currentDir === repoRoot || parentDir === currentDir) {
      reachedBoundary = true;
    } else {
      currentDir = parentDir;
    }
  }

  addRoot(repoRoot);
  addRoot(process.cwd());
  return uniqueRoots;
}

/**
 * Trim leading path separators for display.
 */
function trimLeadingSeparators(value: string): string {
  const trimmed = value.replace(/^[/\\]+/, "");
  return trimmed.length > 0 ? trimmed : value;
}

/**
 * Resolve a file reference using search roots.
 */
export async function resolveFileReference(
  rawValue: string,
  searchRoots: readonly string[],
): Promise<{
  readonly displayPath: string;
  readonly resolvedPath?: string;
  readonly attempted: readonly string[];
}> {
  const displayPath = trimLeadingSeparators(rawValue);
  const potentialPaths: string[] = [];

  if (path.isAbsolute(rawValue)) {
    potentialPaths.push(path.normalize(rawValue));
  }

  for (const base of searchRoots) {
    potentialPaths.push(path.resolve(base, displayPath));
  }

  const attempted: string[] = [];
  const seen = new Set<string>();
  for (const candidate of potentialPaths) {
    const absoluteCandidate = path.resolve(candidate);
    if (seen.has(absoluteCandidate)) {
      continue;
    }
    seen.add(absoluteCandidate);
    attempted.push(absoluteCandidate);
    if (await fileExists(absoluteCandidate)) {
      return { displayPath, resolvedPath: absoluteCandidate, attempted };
    }
  }

  return { displayPath, attempted };
}
