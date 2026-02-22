import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ResolvedWorkspaceTemplate {
  /** Directory to copy as the working directory (for createTempWorkspace / request.cwd) */
  readonly dir: string;
  /** Optional .code-workspace file for VS Code providers */
  readonly workspaceFile?: string;
}

/**
 * Resolves a workspace.template value into a directory + optional .code-workspace file.
 *
 * Resolution rules:
 * - .code-workspace file → dir = parent directory, workspaceFile = the file
 * - Directory with exactly 1 .code-workspace → dir = directory, workspaceFile = that file
 * - Directory with N .code-workspace → dir = directory, workspaceFile = template.code-workspace (if present)
 * - Directory with 0 .code-workspace → dir = directory, workspaceFile = undefined
 */
export async function resolveWorkspaceTemplate(
  templatePath: string | undefined,
): Promise<ResolvedWorkspaceTemplate | undefined> {
  if (!templatePath) {
    return undefined;
  }

  const resolved = path.resolve(templatePath);
  const stats = await stat(resolved);

  if (stats.isFile()) {
    // Direct .code-workspace file reference
    return {
      dir: path.dirname(resolved),
      workspaceFile: resolved,
    };
  }

  if (!stats.isDirectory()) {
    throw new Error(`workspace template is neither a file nor a directory: ${resolved}`);
  }

  // Scan for .code-workspace files in the directory (top-level only)
  const entries = await readdir(resolved);
  const workspaceFiles = entries.filter((e) => e.endsWith('.code-workspace'));

  if (workspaceFiles.length === 1) {
    return {
      dir: resolved,
      workspaceFile: path.join(resolved, workspaceFiles[0] as string),
    };
  }

  if (workspaceFiles.length > 1) {
    const conventionFile = workspaceFiles.find((f) => f === 'template.code-workspace');
    return {
      dir: resolved,
      workspaceFile: conventionFile ? path.join(resolved, conventionFile) : undefined,
    };
  }

  // No .code-workspace files
  return { dir: resolved };
}
