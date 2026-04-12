/**
 * Workspace file-change tracking for AgentV evaluation.
 *
 * Two strategies are supported — both produce unified-diff output that is
 * stored in `file_changes` and surfaced to LLM / code graders:
 *
 * 1. **Git baseline** (default when `git` is available in workspace_path):
 *    - `initializeBaseline` runs `git init`, stages all existing files, and
 *      creates a baseline commit so a clean diff is available after the agent runs.
 *    - `captureFileChanges` stages everything and emits `git diff <baseline>`.
 *    - Supports nested git repos via `--submodule=diff`.
 *
 * 2. **Snapshot baseline** (fallback when git is unavailable / path is read-only):
 *    - `captureSnapshot` walks the directory tree and records every text file's
 *      content as a `Map<relativePath, content>`.
 *    - `diffFromSnapshots` compares two snapshots and emits synthetic unified
 *      diffs for new, modified, and deleted files.
 *    - Use this when `initializeBaseline` throws (git not installed, permissions,
 *      read-only session-state directories, etc.).
 *
 * 3. **Provider-reported artifacts** (for agents that write outside workspace_path):
 *    - `generateSessionFileDiff` creates a synthetic "new file" diff for a
 *      single file, given its relative path and content.
 *    - Copilot providers use this to surface files written into the agent's own
 *      session-state directory (e.g. `~/.copilot/session-state/<uuid>/files/`).
 *
 * To extend:
 *   - Add a new capture strategy here as an exported function.
 *   - Call it from `orchestrator.ts` alongside the existing git / snapshot logic.
 */

import { exec as execCallback } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCallback);

/** Maximum file size (bytes) to include in snapshot diffs. Larger files are skipped. */
const SNAPSHOT_MAX_FILE_BYTES = 512 * 1024; // 512 KB

/** Directories always excluded from snapshot walks. */
const SNAPSHOT_EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.agentv', '__pycache__']);

/** A point-in-time snapshot of a directory: relative path → UTF-8 content. */
export type WorkspaceSnapshot = Map<string, string>;

// ─── Git baseline ────────────────────────────────────────────────────────────

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

// ─── Snapshot baseline ───────────────────────────────────────────────────────

/**
 * Walk `dir` recursively and return a snapshot of every readable text file.
 * Binary files and files larger than SNAPSHOT_MAX_FILE_BYTES are omitted.
 * Standard noise directories (.git, node_modules, etc.) are skipped.
 */
export async function captureSnapshot(dir: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  await walkDir(dir, dir, snapshot);
  return snapshot;
}

async function walkDir(
  rootDir: string,
  currentDir: string,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDE_DIRS.has(entry)) continue;

    const fullPath = path.join(currentDir, entry);
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      await walkDir(rootDir, fullPath, snapshot);
    } else if (fileStat.isFile()) {
      if (fileStat.size > SNAPSHOT_MAX_FILE_BYTES) continue;
      let content: string;
      try {
        content = await readFile(fullPath, 'utf8');
        // Skip if not valid UTF-8 text (binary file heuristic: contains null bytes)
        if (content.includes('\0')) continue;
      } catch {
        continue;
      }
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      snapshot.set(relativePath, content);
    }
  }
}

/**
 * Compare two snapshots and return a synthetic unified-diff string.
 * Covers new files, modified files, and deleted files.
 * Returns empty string when the snapshots are identical.
 */
export function diffFromSnapshots(
  baseline: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
): string {
  const parts: string[] = [];

  // New and modified files
  for (const [relPath, currentContent] of current) {
    const baseContent = baseline.get(relPath);
    if (baseContent === undefined) {
      // New file
      parts.push(generateNewFileDiff(relPath, currentContent));
    } else if (baseContent !== currentContent) {
      // Modified file
      parts.push(generateModifiedFileDiff(relPath, baseContent, currentContent));
    }
  }

  // Deleted files
  for (const [relPath, baseContent] of baseline) {
    if (!current.has(relPath)) {
      parts.push(generateDeletedFileDiff(relPath, baseContent));
    }
  }

  return parts.join('\n');
}

// ─── Synthetic diff helpers ──────────────────────────────────────────────────

/**
 * Generate a synthetic unified diff entry for a newly created file.
 * Suitable both for snapshot diffs and provider-reported session artifacts.
 */
export function generateNewFileDiff(relativePath: string, content: string): string {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  const addedLines = lines.map((l) => `+${l}`).join('\n');
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    addedLines,
  ].join('\n');
}

function generateDeletedFileDiff(relativePath: string, content: string): string {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  const removedLines = lines.map((l) => `-${l}`).join('\n');
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    'deleted file mode 100644',
    `--- a/${relativePath}`,
    '+++ /dev/null',
    `@@ -1,${lines.length} +0,0 @@`,
    removedLines,
  ].join('\n');
}

function generateModifiedFileDiff(
  relativePath: string,
  oldContent: string,
  newContent: string,
): string {
  // Simple full-file replacement diff (no line-level hunk optimization)
  const oldLines = oldContent.endsWith('\n')
    ? oldContent.slice(0, -1).split('\n')
    : oldContent.split('\n');
  const newLines = newContent.endsWith('\n')
    ? newContent.slice(0, -1).split('\n')
    : newContent.split('\n');
  const removedLines = oldLines.map((l) => `-${l}`).join('\n');
  const addedLines = newLines.map((l) => `+${l}`).join('\n');
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    removedLines,
    addedLines,
  ].join('\n');
}

// ─── Session-state artifact capture ─────────────────────────────────────────

/**
 * Scan a directory (e.g. copilot session-state `files/`) for text files and
 * return a synthetic unified diff string showing all of them as new additions.
 *
 * Returns undefined when the directory does not exist or is empty.
 *
 * Used by copilot providers to surface files that the agent wrote into its
 * own session-state rather than the eval workspace_path.
 */
export async function captureSessionArtifacts(
  filesDir: string,
  pathPrefix = '',
): Promise<string | undefined> {
  const snapshot = await captureSnapshot(filesDir).catch(() => undefined);
  if (!snapshot || snapshot.size === 0) return undefined;

  const parts: string[] = [];
  for (const [relPath, content] of snapshot) {
    const displayPath = pathPrefix ? `${pathPrefix}/${relPath}` : relPath;
    parts.push(generateNewFileDiff(displayPath, content));
  }
  return parts.join('\n');
}
