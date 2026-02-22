import { exec as execCallback } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCallback);

/**
 * Build exec options that ensure git commands target the workspace,
 * not a parent repo. Clears GIT_DIR/GIT_WORK_TREE which may be set
 * by git hooks or other parent processes.
 */
function gitExecOpts(workspacePath: string) {
  const { GIT_DIR: _, GIT_WORK_TREE: __, ...env } = process.env;
  return { cwd: workspacePath, env };
}

/**
 * Initialize a git baseline for workspace file change tracking.
 *
 * Runs `git init` directly in the workspace, stages all files, and creates
 * a baseline commit. Returns the commit hash for later diffing.
 */
export async function initializeBaseline(workspacePath: string): Promise<string> {
  const opts = gitExecOpts(workspacePath);

  await execAsync('git init', opts);
  await execAsync('git add -A', opts);
  await execAsync(
    'git -c user.email=agentv@localhost -c user.name=agentv commit --allow-empty -m "agentv-baseline"',
    opts,
  );

  const { stdout } = await execAsync('git rev-parse HEAD', opts);
  return stdout.trim();
}

/**
 * Capture file changes from workspace relative to the baseline commit.
 * Returns a unified diff string, or empty string if no changes.
 *
 * Supports nested git repos (e.g. cloned dependencies): stages files inside
 * each child repo first, then uses `--submodule=diff` to expand submodule
 * changes into individual file diffs rather than opaque gitlink hashes.
 */
export async function captureFileChanges(
  workspacePath: string,
  baselineCommit: string,
): Promise<string> {
  const opts = gitExecOpts(workspacePath);

  // Stage new files in nested repos so they appear in the submodule diff
  await stageNestedRepoChanges(workspacePath);

  // Stage parent-level changes
  await execAsync('git add -A', opts);

  // Use --submodule=diff to expand nested repo changes into individual file diffs
  const { stdout } = await execAsync(`git diff ${baselineCommit} --submodule=diff`, opts);

  return stdout.trim();
}

/**
 * Find immediate child directories that contain a `.git/` directory
 * and stage all their changes so they appear in the parent's submodule diff.
 */
async function stageNestedRepoChanges(workspacePath: string): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(workspacePath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const childPath = path.join(workspacePath, entry);
    try {
      if (!statSync(childPath).isDirectory()) continue;
      if (!statSync(path.join(childPath, '.git')).isDirectory()) continue;
    } catch {
      continue;
    }
    // Stage all files in the nested repo
    const childOpts = gitExecOpts(childPath);
    await execAsync('git add -A', childOpts);
  }
}
