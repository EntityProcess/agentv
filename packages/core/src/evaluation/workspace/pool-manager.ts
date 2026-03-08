import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspacePoolRoot } from '../../paths.js';
import type { RepoConfig } from '../types.js';
import type { RepoManager } from './repo-manager.js';

const execFileAsync = promisify(execFile);

/** Environment vars to force non-interactive git, stripped of hook-injected vars */
function gitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND') {
      delete env[key];
    }
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  };
}

async function git(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts?.cwd,
    timeout: opts?.timeout ?? 300_000,
    env: gitEnv(),
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.trim();
}

export interface AcquireWorkspaceOptions {
  templatePath?: string;
  repos: readonly RepoConfig[];
  maxSlots: number;
  repoManager: RepoManager;
}

export interface PoolSlot {
  readonly index: number;
  readonly path: string;
  readonly isExisting: boolean;
  readonly lockPath: string;
  readonly fingerprint: string;
  readonly poolDir: string;
}

interface PoolMetadata {
  fingerprint: string;
  templatePath: string | null;
  repos: readonly RepoConfig[];
  createdAt: string;
}

/**
 * Normalize a repo config into a canonical form for fingerprinting.
 * Git URLs are lowercased with .git suffix stripped; local paths are kept as-is.
 */
function normalizeRepoForFingerprint(repo: RepoConfig): Record<string, unknown> {
  const source =
    repo.source.type === 'git'
      ? { type: 'git', url: repo.source.url.toLowerCase().replace(/\.git$/, '') }
      : { type: 'local', path: repo.source.path };

  const result: Record<string, unknown> = {
    path: repo.path,
    source,
    ref: repo.checkout?.ref ?? 'HEAD',
  };

  if (repo.clone?.depth !== undefined) {
    result.depth = repo.clone.depth;
  }
  if (repo.clone?.filter !== undefined) {
    result.filter = repo.clone.filter;
  }
  if (repo.clone?.sparse?.length) {
    result.sparse = [...repo.clone.sparse].sort();
  }

  return result;
}

/**
 * Compute a deterministic SHA-256 fingerprint for a workspace configuration.
 * The fingerprint captures template path and all repo configs in a canonical order.
 */
export function computeWorkspaceFingerprint(
  templatePath: string | undefined | null,
  repos: readonly RepoConfig[],
): string {
  const canonical = {
    templatePath: templatePath ?? null,
    repos: [...repos].sort((a, b) => a.path.localeCompare(b.path)).map(normalizeRepoForFingerprint),
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Recursively copy a directory, skipping .git directories and specified directory names.
 */
async function copyDirectoryRecursive(
  src: string,
  dest: string,
  skipDirs?: ReadonlySet<string>,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === '.git') {
      continue;
    }

    if (entry.isDirectory()) {
      if (skipDirs?.has(entry.name)) {
        continue;
      }
      await copyDirectoryRecursive(srcPath, destPath, skipDirs);
    } else {
      await cp(srcPath, destPath, { preserveTimestamps: true, force: true });
    }
  }
}

/**
 * Pools entire workspaces (template files + git repos) for reuse across eval runs.
 *
 * Pool structure:
 * ```
 * {poolRoot}/
 *   {fingerprint}/
 *     metadata.json       # fingerprint inputs, creation timestamp
 *     slot-0/             # complete workspace (template files + repos)
 *     slot-0.lock         # PID-based lock file
 *     slot-1/             # created on concurrent demand
 *     slot-1.lock
 * ```
 */
export class WorkspacePoolManager {
  private readonly poolRoot: string;

  constructor(poolRoot?: string) {
    this.poolRoot = poolRoot ?? getWorkspacePoolRoot();
  }

  /**
   * Acquire a workspace slot from the pool.
   *
   * 1. Compute fingerprint from template + repos
   * 2. Check drift (compare stored metadata.json fingerprint vs computed)
   * 3. If drift: warn, remove all slots, rematerialize
   * 4. Acquire a slot (try-lock slot-0, slot-1, ..., up to maxSlots)
   * 5. If slot exists: reset repos, re-copy template files (skip repo directories)
   * 6. If new slot: copy template, materialize all repos, write metadata.json
   * 7. Return the slot (with path, index, isExisting)
   */
  async acquireWorkspace(options: AcquireWorkspaceOptions): Promise<PoolSlot> {
    const { templatePath, repos, maxSlots, repoManager } = options;

    const fingerprint = computeWorkspaceFingerprint(templatePath, repos);
    const poolDir = path.join(this.poolRoot, fingerprint);
    await mkdir(poolDir, { recursive: true });

    // Check for drift
    const drifted = await this.checkDrift(poolDir, fingerprint);
    if (drifted) {
      console.warn(
        `[workspace-pool] Drift detected for fingerprint ${fingerprint.slice(0, 12)}... Removing stale slots.`,
      );
      await this.removeAllSlots(poolDir);
    }

    // Try to acquire a slot
    for (let i = 0; i < maxSlots; i++) {
      const slotPath = path.join(poolDir, `slot-${i}`);
      const lockPath = `${slotPath}.lock`;

      const locked = await this.tryLock(lockPath);
      if (!locked) {
        continue;
      }

      const slotExists = existsSync(slotPath);

      if (slotExists) {
        // Reuse existing slot: reset repos and re-copy template
        await this.resetSlot(slotPath, templatePath, repos);
        return {
          index: i,
          path: slotPath,
          isExisting: true,
          lockPath,
          fingerprint,
          poolDir,
        };
      }

      // New slot: materialize from scratch
      await mkdir(slotPath, { recursive: true });

      if (templatePath) {
        await copyDirectoryRecursive(templatePath, slotPath);
      }

      if (repos.length > 0) {
        await repoManager.materializeAll(repos, slotPath);
      }

      await this.writeMetadata(poolDir, fingerprint, templatePath ?? null, repos);

      return {
        index: i,
        path: slotPath,
        isExisting: false,
        lockPath,
        fingerprint,
        poolDir,
      };
    }

    throw new Error(
      `All ${maxSlots} pool slots are locked for fingerprint ${fingerprint.slice(0, 12)}...`,
    );
  }

  /** Remove lock file to release a slot. */
  async releaseSlot(slot: PoolSlot): Promise<void> {
    try {
      await unlink(slot.lockPath);
    } catch {
      // Lock file may already be removed
    }
  }

  /**
   * Try to acquire a PID-based lock file.
   * On EEXIST, read PID and check if process is alive. If dead, stale lock — remove and retry.
   * Returns true if lock acquired, false if slot is actively locked.
   * Uses a bounded loop (max 3 attempts) to avoid unbounded recursion.
   */
  private async tryLock(lockPath: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await writeFile(lockPath, String(process.pid), { flag: 'wx' });
        return true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw err;
        }

        // Lock file exists — check if the holding process is still alive
        try {
          const pidStr = await readFile(lockPath, 'utf-8');
          const pid = Number.parseInt(pidStr.trim(), 10);

          if (!Number.isNaN(pid)) {
            try {
              process.kill(pid, 0); // Signal 0 checks if process exists
              // Process is alive — slot is actively locked
              return false;
            } catch {
              // Process is dead — stale lock, remove and retry
              await unlink(lockPath).catch(() => {});
              continue;
            }
          }
        } catch {
          // Can't read lock — treat as locked
        }

        return false;
      }
    }
    return false; // Exhausted retries
  }

  /**
   * Check if the stored fingerprint in metadata.json differs from the computed one.
   * Returns true if drifted, false otherwise.
   * Returns false (no drift) if metadata.json doesn't exist (first use).
   */
  private async checkDrift(poolDir: string, fingerprint: string): Promise<boolean> {
    const metadataPath = path.join(poolDir, 'metadata.json');
    try {
      const raw = await readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(raw) as PoolMetadata;
      return metadata.fingerprint !== fingerprint;
    } catch {
      // No metadata.json — first use, no drift
      return false;
    }
  }

  /** Write metadata.json with fingerprint, inputs, and timestamp. */
  private async writeMetadata(
    poolDir: string,
    fingerprint: string,
    templatePath: string | null,
    repos: readonly RepoConfig[],
  ): Promise<void> {
    const metadata: PoolMetadata = {
      fingerprint,
      templatePath,
      repos,
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(poolDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  }

  /** Remove all slot directories and their lock files from a pool directory. */
  private async removeAllSlots(poolDir: string): Promise<void> {
    const entries = await readdir(poolDir);
    for (const entry of entries) {
      if (entry.startsWith('slot-') && !entry.endsWith('.lock')) {
        const lockPath = path.join(poolDir, `${entry}.lock`);
        // Skip slots that are actively locked by a live process
        if (existsSync(lockPath)) {
          try {
            const pidStr = await readFile(lockPath, 'utf-8');
            const pid = Number.parseInt(pidStr.trim(), 10);
            if (!Number.isNaN(pid)) {
              try {
                process.kill(pid, 0);
                console.warn(`[workspace-pool] Skipping slot ${entry}: locked by PID ${pid}`);
                continue; // Skip this slot
              } catch {
                // PID dead — safe to remove
              }
            }
          } catch {
            // Can't read lock — safe to remove
          }
        }
        await rm(path.join(poolDir, entry), { recursive: true, force: true });
        // Also remove the lock file if it exists
        await rm(lockPath, { force: true }).catch(() => {});
      }
    }
    // Remove metadata.json to force re-creation
    await rm(path.join(poolDir, 'metadata.json'), { force: true }).catch(() => {});
  }

  /**
   * Reset an existing slot for reuse:
   * 1. Reset repos (git reset --hard {ref} && git clean -fd per repo)
   * 2. Re-copy template files (skip repo directories)
   */
  private async resetSlot(
    slotPath: string,
    templatePath: string | undefined,
    repos: readonly RepoConfig[],
  ): Promise<void> {
    // Reset each repo
    for (const repo of repos) {
      const repoDir = path.join(slotPath, repo.path);
      if (!existsSync(repoDir)) {
        continue;
      }
      const ref = repo.checkout?.ref ?? 'HEAD';
      await git(['reset', '--hard', ref], { cwd: repoDir });
      // Use -fd (not -fdx) to preserve .gitignored files like build outputs,
      // node_modules, and compiled binaries. This lets before_all build steps
      // survive across pool reuse cycles, avoiding expensive rebuilds.
      await git(['clean', '-fd'], { cwd: repoDir });
    }

    // Re-copy template files, skipping repo directories
    if (templatePath) {
      const repoDirNames = new Set(
        repos.map((r) => {
          // Get the top-level directory name from the repo path
          // e.g., './my-repo' -> 'my-repo', 'repos/foo' -> 'repos'
          const normalized = r.path.replace(/^\.\//, '');
          return normalized.split('/')[0];
        }),
      );
      await copyDirectoryRecursive(templatePath, slotPath, repoDirNames);
    }
  }
}
