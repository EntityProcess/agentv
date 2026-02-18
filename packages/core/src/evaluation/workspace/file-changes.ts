import { exec as execCallback } from 'node:child_process';
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
 */
export async function captureFileChanges(
  workspacePath: string,
  baselineCommit: string,
): Promise<string> {
  const opts = gitExecOpts(workspacePath);

  // Stage any new/modified/deleted files
  await execAsync('git add -A', opts);

  // Generate unified diff against baseline
  const { stdout } = await execAsync(`git diff --cached ${baselineCommit}`, opts);

  return stdout.trim();
}
