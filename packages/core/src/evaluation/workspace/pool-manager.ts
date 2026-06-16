import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePoolRoot } from '../../paths.js';
import type { RepoConfig } from '../types.js';
import { getRepoCheckoutRef } from './repo-checkout.js';
import { normalizeRepoIdentity } from './repo-identity.js';
import type { RepoManager } from './repo-manager.js';

export interface AcquireWorkspaceOptions {
  templatePath?: string;
  repos: readonly RepoConfig[];
  maxSlots: number;
  repoManager: RepoManager;
  poolReset?: 'none' | 'fast' | 'strict';
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
 * Acquisition choices are intentionally excluded; only declared provenance
 * and checkout content selection affect the workspace pool key.
 */
function normalizeRepoForFingerprint(repo: RepoConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (repo.path) {
    result.path = repo.path;
  }

  if (repo.repo) {
    result.repo = normalizeRepoIdentity(repo.repo);
  }

  result.ref = getRepoCheckoutRef(repo);

  if (repo.ancestor !== undefined) {
    result.ancestor = repo.ancestor;
  }
  if (repo.sparse?.length) {
    result.sparse = [...repo.sparse].sort();
  }

  return result;
}

/**
 * Compute a deterministic SHA-256 fingerprint for a workspace configuration.
 * The fingerprint captures only repo materialization inputs (repo, commit, sparse, ancestor)
 * in a canonical order. Template path is excluded because template files are re-copied on
 * every pool reuse and don't affect the cloned checkout state.
 */
export function computeWorkspaceFingerprint(repos: readonly RepoConfig[]): string {
  const canonical = {
    repos: [...repos]
      .sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''))
      .map(normalizeRepoForFingerprint),
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
    const { templatePath, repos, maxSlots, repoManager, poolReset } = options;

    const fingerprint = computeWorkspaceFingerprint(repos);
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
        await this.resetSlot(slotPath, templatePath, repos, options.repoManager, poolReset);
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
   * 1. Reset repos to their declared checkout, then git clean per repo
   * 2. Re-copy template files (skip repo directories)
   */
  private async resetSlot(
    slotPath: string,
    templatePath: string | undefined,
    repos: readonly RepoConfig[],
    repoManager: RepoManager,
    poolReset: 'none' | 'fast' | 'strict' = 'fast',
  ): Promise<void> {
    if (poolReset !== 'none') {
      await repoManager.reset(repos, slotPath, poolReset);
    }

    // Re-copy template files, skipping repo directories
    if (templatePath) {
      const repoDirNames = new Set(
        repos
          .filter((r) => r.path)
          .map((r) => {
            // Get the top-level directory name from the repo path
            // e.g., './my-repo' -> 'my-repo', 'repos/foo' -> 'repos'
            const normalized = (r.path ?? '').replace(/^\.\//, '');
            return normalized.split('/')[0];
          }),
      );
      await copyDirectoryRecursive(templatePath, slotPath, repoDirNames);
    }
  }
}
