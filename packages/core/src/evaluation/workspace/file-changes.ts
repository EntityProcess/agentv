import { exec as execCallback } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCallback);

/**
 * Initialize a git baseline for workspace file change tracking.
 *
 * Uses an **external git directory** so the workspace stays clean —
 * agents never see an AgentV-created `.git` folder. The git metadata
 * is stored at a sibling path (`<workspacePath>/../.agentv-git-<basename>/`).
 *
 * If the workspace already has a `.git/` directory (e.g., from a setup script),
 * the external git ignores it via `info/exclude`.
 */
export async function initializeBaseline(
  workspacePath: string,
): Promise<{ baselineCommit: string; gitDir: string }> {
  const parentDir = path.dirname(workspacePath);
  const basename = path.basename(workspacePath);
  const gitDir = path.join(parentDir, `.agentv-git-${basename}`);

  await mkdir(gitDir, { recursive: true });

  const gitCmd = `git --git-dir="${gitDir}" --work-tree="${workspacePath}"`;

  // Initialize the external git repo
  await execAsync(`${gitCmd} init`);

  // Exclude .git/ from tracking (handles workspaces that already have their own .git)
  const excludeDir = path.join(gitDir, 'info');
  await mkdir(excludeDir, { recursive: true });
  await writeFile(path.join(excludeDir, 'exclude'), '.git\n', 'utf8');

  // Stage everything and create baseline commit
  await execAsync(`${gitCmd} add -A`);
  await execAsync(`${gitCmd} commit --allow-empty -m "agentv-baseline"`);

  // Get the baseline commit hash
  const { stdout } = await execAsync(`${gitCmd} rev-parse HEAD`);
  const baselineCommit = stdout.trim();

  return { baselineCommit, gitDir };
}

/**
 * Capture file changes from workspace relative to the baseline commit.
 * Returns a unified diff string, or empty string if no changes.
 */
export async function captureFileChanges(
  workspacePath: string,
  baselineCommit: string,
  gitDir: string,
): Promise<string> {
  const gitCmd = `git --git-dir="${gitDir}" --work-tree="${workspacePath}"`;

  // Stage any new/modified/deleted files
  await execAsync(`${gitCmd} add -A`);

  // Generate unified diff against baseline
  const { stdout } = await execAsync(`${gitCmd} diff --cached ${baselineCommit}`);

  return stdout.trim();
}

/**
 * Remove the external git directory used for baseline tracking.
 */
export async function cleanupBaseline(gitDir: string): Promise<void> {
  await rm(gitDir, { recursive: true, force: true });
}
