import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
 * Recursively copy a directory, skipping .git directories.
 *
 * @param src - Source directory path
 * @param dest - Destination directory path
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
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

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
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

    // Copy template to workspace, skipping .git
    await copyDirectoryRecursive(resolvedTemplatePath, workspacePath);

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
