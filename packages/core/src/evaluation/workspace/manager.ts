import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import micromatch from 'micromatch';
import { fileExists } from '../file-utils.js';

/**
 * Default workspace root directory for temporary eval workspaces.
 * Located at ~/.agentv/workspaces
 */
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), '.agentv', 'workspaces');

/**
 * Error thrown when the template path does not exist.
 */
export class TemplateNotFoundError extends Error {
  constructor(templatePath: string) {
    super(`Workspace template not found: ${templatePath}`);
    this.name = 'TemplateNotFoundError';
  }
}

/**
 * Error thrown when the template path is a file instead of a directory.
 */
export class TemplateNotDirectoryError extends Error {
  constructor(templatePath: string) {
    super(`Workspace template is not a directory: ${templatePath}`);
    this.name = 'TemplateNotDirectoryError';
  }
}

/**
 * Error thrown when there is insufficient disk space or other I/O errors.
 */
export class WorkspaceCreationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'WorkspaceCreationError';
  }
}

/**
 * Check if a path is a directory.
 */
async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the workspace path for a specific eval case.
 *
 * Workspace structure:
 * {workspaceRoot}/{evalRunId}/{caseId}
 *
 * Example:
 * ~/.agentv/workspaces/abc123/case-01
 *
 * @param evalRunId - The unique identifier for the evaluation run
 * @param caseId - The unique identifier for the evaluation case
 * @param workspaceRoot - Optional custom workspace root directory (defaults to ~/.agentv/workspaces)
 * @returns Absolute path to the workspace directory
 */
export function getWorkspacePath(
  evalRunId: string,
  caseId: string,
  workspaceRoot?: string,
): string {
  const root = workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  return path.join(root, evalRunId, caseId);
}

/**
 * Parse .gitignore patterns from a template directory.
 * Returns an array of glob patterns to ignore during copy.
 */
async function loadIgnorePatterns(templateRoot: string): Promise<string[]> {
  const gitignorePath = path.join(templateRoot, '.gitignore');
  try {
    const content = await readFile(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if a relative path matches any ignore pattern.
 */
function isIgnored(relativePath: string, ignorePatterns: readonly string[]): boolean {
  if (ignorePatterns.length === 0) return false;
  return micromatch.isMatch(relativePath, ignorePatterns as string[], { dot: true });
}

/**
 * Recursively copy a directory, skipping .git directories and .gitignore patterns.
 *
 * @param src - Source directory path
 * @param dest - Destination directory path
 * @param templateRoot - Root of the template (for computing relative paths)
 * @param ignorePatterns - Glob patterns from .gitignore to skip
 */
async function copyDirectoryRecursive(
  src: string,
  dest: string,
  templateRoot: string,
  ignorePatterns: readonly string[],
): Promise<void> {
  // Create destination directory
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip .git directory
    if (entry.name === '.git') {
      continue;
    }

    // Check if entry matches .gitignore patterns
    const relativePath = path.relative(templateRoot, srcPath);
    // Check both with and without trailing slash for directories
    if (entry.isDirectory()) {
      if (
        isIgnored(relativePath, ignorePatterns) ||
        isIgnored(`${relativePath}/`, ignorePatterns)
      ) {
        continue;
      }
      await copyDirectoryRecursive(srcPath, destPath, templateRoot, ignorePatterns);
    } else {
      if (isIgnored(relativePath, ignorePatterns)) {
        continue;
      }
      // Use cp to preserve permissions
      await cp(srcPath, destPath, { preserveTimestamps: true });
    }
  }
}

/**
 * Create a temporary workspace by copying a template directory.
 *
 * The workspace is created at ~/.agentv/workspaces/{evalRunId}/{caseId}/
 * The .git directory from the template is skipped during copy.
 *
 * @param templatePath - Absolute path to the template directory
 * @param evalRunId - The unique identifier for the evaluation run
 * @param caseId - The unique identifier for the evaluation case
 * @param workspaceRoot - Optional custom workspace root directory
 * @returns Absolute path to the created workspace directory
 * @throws TemplateNotFoundError if the template path does not exist
 * @throws TemplateNotDirectoryError if the template path is not a directory
 * @throws WorkspaceCreationError if there's an error creating the workspace
 */
export async function createTempWorkspace(
  templatePath: string,
  evalRunId: string,
  caseId: string,
  workspaceRoot?: string,
): Promise<string> {
  // Validate template path
  const resolvedTemplatePath = path.resolve(templatePath);

  if (!(await fileExists(resolvedTemplatePath))) {
    throw new TemplateNotFoundError(resolvedTemplatePath);
  }

  if (!(await isDirectory(resolvedTemplatePath))) {
    throw new TemplateNotDirectoryError(resolvedTemplatePath);
  }

  // Determine workspace path
  const workspacePath = getWorkspacePath(evalRunId, caseId, workspaceRoot);

  try {
    // Remove workspace if it already exists (clean slate)
    if (await fileExists(workspacePath)) {
      await rm(workspacePath, { recursive: true, force: true });
    }

    // Load .gitignore patterns from template
    const ignorePatterns = await loadIgnorePatterns(resolvedTemplatePath);

    // Copy template to workspace, skipping .git and .gitignore patterns
    await copyDirectoryRecursive(
      resolvedTemplatePath,
      workspacePath,
      resolvedTemplatePath,
      ignorePatterns,
    );

    return workspacePath;
  } catch (error) {
    // Check for common disk-related errors
    if (error instanceof Error) {
      const errCode = (error as NodeJS.ErrnoException).code;

      if (errCode === 'ENOSPC') {
        throw new WorkspaceCreationError(
          `Insufficient disk space to create workspace at ${workspacePath}`,
          error,
        );
      }

      if (errCode === 'EACCES' || errCode === 'EPERM') {
        throw new WorkspaceCreationError(
          `Permission denied when creating workspace at ${workspacePath}`,
          error,
        );
      }

      // Re-throw our own errors
      if (
        error instanceof TemplateNotFoundError ||
        error instanceof TemplateNotDirectoryError ||
        error instanceof WorkspaceCreationError
      ) {
        throw error;
      }

      throw new WorkspaceCreationError(
        `Failed to create workspace at ${workspacePath}: ${error.message}`,
        error,
      );
    }

    throw new WorkspaceCreationError(
      `Failed to create workspace at ${workspacePath}: ${String(error)}`,
    );
  }
}

/**
 * Remove a single workspace directory.
 *
 * @param workspacePath - Absolute path to the workspace directory to remove
 * @throws Error if the cleanup fails
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  if (await fileExists(workspacePath)) {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

/**
 * Remove all workspaces for an evaluation run.
 *
 * This removes the entire {workspaceRoot}/{evalRunId} directory,
 * cleaning up all case workspaces for that run.
 *
 * @param evalRunId - The unique identifier for the evaluation run
 * @param workspaceRoot - Optional custom workspace root directory
 * @throws Error if the cleanup fails
 */
export async function cleanupEvalWorkspaces(
  evalRunId: string,
  workspaceRoot?: string,
): Promise<void> {
  const root = workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const evalDir = path.join(root, evalRunId);

  if (await fileExists(evalDir)) {
    await rm(evalDir, { recursive: true, force: true });
  }
}
