import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitUrlInfo } from './git-url-parser.js';

const execFileAsync = promisify(execFile);

/**
 * Default cache root directory for cloned repositories.
 * Located at ~/.agentv/cache/repos
 */
const DEFAULT_CACHE_ROOT = path.join(os.homedir(), '.agentv', 'cache', 'repos');

/**
 * Sanitize a git ref for use as a directory name.
 * Replaces slashes with dashes to create valid path segments.
 *
 * Example: "feature/my-branch" -> "feature-my-branch"
 */
function sanitizeRef(ref: string): string {
  return ref.replace(/\//g, '-');
}

/**
 * Validate git URL info to prevent path traversal and other attacks.
 * @throws Error if validation fails
 */
function validateGitUrlInfo(info: GitUrlInfo): void {
  if (!info.ref) {
    throw new Error('Invalid git ref: empty');
  }
  if (info.owner.includes('..') || info.repo.includes('..') || info.path.includes('..')) {
    throw new Error('Path traversal detected in git URL');
  }
}

/**
 * Get the cache directory path for a git URL.
 *
 * Cache structure:
 * {cacheRoot}/{host}/{owner}/{repo}/{sanitizedRef}
 *
 * Example:
 * ~/.agentv/cache/repos/github.com/owner/repo/main
 *
 * @param info - Parsed git URL info
 * @param cacheRoot - Optional custom cache root directory (defaults to ~/.agentv/cache/repos)
 * @returns Absolute path to the cache directory for this repo/ref
 */
export function getCachePath(info: GitUrlInfo, cacheRoot?: string): string {
  const root = cacheRoot ?? DEFAULT_CACHE_ROOT;
  const sanitizedRef = sanitizeRef(info.ref);

  // Handle owner paths that may contain slashes (e.g., GitLab groups)
  // The owner is already a path, so we split and join properly
  const ownerSegments = info.owner.split('/');

  return path.join(root, info.host, ...ownerSegments, info.repo, sanitizedRef);
}

/**
 * Check if a directory exists.
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a git repository (has a .git directory or file).
 */
async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(dirPath, '.git');
    await access(gitPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone or fetch a repository to the cache.
 *
 * Behavior:
 * - If repo dir doesn't exist: clones with `git clone --depth 1 --single-branch --branch {ref} {cloneUrl} {path}`
 * - If repo dir exists: fetches and resets with `git fetch origin {ref} --depth=1 && git reset --hard FETCH_HEAD`
 *
 * @param info - Parsed git URL info
 * @param cacheRoot - Optional custom cache root directory
 * @returns Absolute path to the cloned repository directory
 * @throws Error if git operations fail
 */
export async function ensureRepoCloned(info: GitUrlInfo, cacheRoot?: string): Promise<string> {
  // Validate input to prevent path traversal attacks
  validateGitUrlInfo(info);

  const repoDir = getCachePath(info, cacheRoot);
  const repoExists = await directoryExists(repoDir);
  const isRepo = repoExists && (await isGitRepo(repoDir));

  if (!repoExists) {
    // Create parent directories
    const parentDir = path.dirname(repoDir);
    await mkdir(parentDir, { recursive: true });

    // Clone the repository with shallow clone for efficiency
    // Using execFile instead of exec to prevent command injection
    try {
      await execFileAsync('git', [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--branch',
        info.ref,
        info.cloneUrl,
        repoDir,
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clone repository ${info.cloneUrl}: ${errorMessage}`);
    }
  } else if (isRepo) {
    // Fetch latest changes and reset to FETCH_HEAD
    // Using execFile instead of exec to prevent command injection
    try {
      await execFileAsync('git', ['-C', repoDir, 'fetch', 'origin', info.ref, '--depth=1']);
      await execFileAsync('git', ['-C', repoDir, 'reset', '--hard', 'FETCH_HEAD']);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update repository ${info.cloneUrl}: ${errorMessage}`);
    }
  } else {
    // Directory exists but is not a git repo - this is unexpected
    throw new Error(
      `Cache directory exists but is not a git repository: ${repoDir}. Please remove it manually and try again.`,
    );
  }

  return repoDir;
}

/**
 * Resolve a git URL to a local file path.
 *
 * This function ensures the repository is cloned/updated and returns
 * the absolute path to the specified file within the cached repository.
 *
 * @param info - Parsed git URL info
 * @param cacheRoot - Optional custom cache root directory
 * @returns Absolute path to the file in the cached repository
 * @throws Error if the file doesn't exist in the repository
 */
export async function resolveGitFile(info: GitUrlInfo, cacheRoot?: string): Promise<string> {
  // Validate input to prevent path traversal attacks
  validateGitUrlInfo(info);

  const repoDir = await ensureRepoCloned(info, cacheRoot);
  const filePath = path.join(repoDir, info.path);

  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`File not found in repository: ${info.path} (looked in ${filePath})`);
  }

  return filePath;
}

/**
 * Resolve a git URL to a local file path from existing cache only.
 *
 * Unlike resolveGitFile, this function does NOT clone or update the repository.
 * It only checks if the file exists in the current cache.
 * Useful for testing and for scenarios where you want to check cache without network.
 *
 * @param info - Parsed git URL info
 * @param cacheRoot - Optional custom cache root directory
 * @returns Absolute path to the file in the cached repository
 * @throws Error if the cache doesn't exist or the file doesn't exist
 */
export async function resolveGitFileFromCache(
  info: GitUrlInfo,
  cacheRoot?: string,
): Promise<string> {
  const repoDir = getCachePath(info, cacheRoot);
  const repoExists = await directoryExists(repoDir);

  if (!repoExists) {
    throw new Error(
      `Repository not cloned: ${info.cloneUrl} ref ${info.ref} (expected at ${repoDir})`,
    );
  }

  const filePath = path.join(repoDir, info.path);

  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`File not found in repository: ${info.path} (looked in ${filePath})`);
  }

  return filePath;
}
