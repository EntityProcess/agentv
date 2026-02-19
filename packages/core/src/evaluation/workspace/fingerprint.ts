import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * SHA-256 fingerprint of workspace state.
 * Computed after setup + baseline init to verify reproducibility.
 */
export interface WorkspaceFingerprint {
  readonly hash: string;
  readonly fileCount: number;
}

/**
 * Compute a deterministic SHA-256 fingerprint of a workspace directory.
 * Walks the file tree in sorted order (excluding .git), hashing relative paths
 * and file contents. Returns the hash and file count.
 */
export async function computeWorkspaceFingerprint(
  workspacePath: string,
): Promise<WorkspaceFingerprint> {
  const hash = createHash('sha256');
  let fileCount = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    // Sort for deterministic hashing
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workspacePath, fullPath);
      hash.update(relativePath);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const content = await readFile(fullPath);
        hash.update(content);
        fileCount++;
      }
    }
  }

  await walk(workspacePath);
  return { hash: `sha256:${hash.digest('hex')}`, fileCount };
}
