import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getGitCacheRoot } from '../../paths.js';
import type { RepoConfig, RepoSource } from '../types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const LOCK_TIMEOUT_MS = 60_000; // 1 minute

/** Environment vars to force non-interactive git, stripped of hook-injected vars */
function gitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  // Remove git hook environment variables that interfere with subprocess git operations
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

function cacheKey(source: RepoSource): string {
  const raw =
    source.type === 'git'
      ? source.url
          .toLowerCase()
          .replace(/\.git$/, '') // Normalize git URLs (case-insensitive)
      : source.path; // Keep local paths case-sensitive
  return createHash('sha256').update(raw).digest('hex');
}

function getSourceUrl(source: RepoSource): string {
  return source.type === 'git' ? source.url : source.path;
}

async function git(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts?.cwd,
    timeout: opts?.timeout ?? DEFAULT_TIMEOUT_MS,
    env: gitEnv(),
    maxBuffer: 50 * 1024 * 1024, // 50MB
  });
  return stdout.trim();
}

async function acquireLock(lockPath: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Timed out waiting for lock: ${lockPath}`);
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // Lock file may already be removed
  }
}

export class RepoManager {
  private readonly cacheDir: string;
  private readonly verbose: boolean;

  constructor(cacheDir?: string, verbose = false) {
    this.cacheDir = cacheDir ?? getGitCacheRoot();
    this.verbose = verbose;
  }

  private async runGit(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
    const startedAt = Date.now();
    if (this.verbose) {
      console.log(`[repo] git start cwd=${opts?.cwd ?? process.cwd()} args=${args.join(' ')}`);
    }

    try {
      const output = await git(args, opts);
      if (this.verbose) {
        console.log(`[repo] git ok durationMs=${Date.now() - startedAt} args=${args.join(' ')}`);
      }
      return output;
    } catch (error) {
      if (this.verbose) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          `[repo] git fail durationMs=${Date.now() - startedAt} args=${args.join(' ')} error=${message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Ensure a bare mirror cache exists for the given source.
   * Creates on first access, fetches updates on subsequent calls.
   * Returns the absolute path to the cache directory.
   */
  async ensureCache(
    source: RepoSource,
    depth?: number,
    resolve?: 'remote' | 'local',
  ): Promise<string> {
    const key = cacheKey(source);
    const cachePath = path.join(this.cacheDir, key);
    const lockPath = `${cachePath}.lock`;
    const cacheExists = existsSync(path.join(cachePath, 'HEAD'));

    if (this.verbose) {
      console.log(
        `[repo] ensureCache source=${getSourceUrl(source)} resolve=${resolve ?? 'remote'} cache=${cachePath}`,
      );
    }

    // Local resolve: use existing cache as-is, no remote operations
    if (resolve === 'local') {
      if (cacheExists) {
        if (this.verbose) {
          console.log(`[repo] using existing local cache ${cachePath}`);
        }
        return cachePath;
      }
      const url = getSourceUrl(source);
      throw new Error(
        `No cache found for \`${url}\`. Run \`agentv cache add --url ${url} --from <local-path>\` to seed it.`,
      );
    }

    await mkdir(this.cacheDir, { recursive: true });
    const lockStartedAt = Date.now();
    await acquireLock(lockPath);
    if (this.verbose) {
      console.log(`[repo] lock acquired path=${lockPath} waitedMs=${Date.now() - lockStartedAt}`);
    }

    try {
      if (cacheExists) {
        if (this.verbose) {
          console.log(`[repo] refreshing existing cache ${cachePath}`);
        }
        // Cache exists — fetch updates
        const fetchArgs = ['fetch', '--prune'];
        if (depth) {
          fetchArgs.push('--depth', String(depth));
        }
        await this.runGit(fetchArgs, { cwd: cachePath });
      } else {
        if (this.verbose) {
          console.log(`[repo] creating new cache ${cachePath}`);
        }
        // Clone as bare mirror
        const cloneArgs = ['clone', '--mirror', '--bare'];
        if (depth) {
          cloneArgs.push('--depth', String(depth));
        }
        // Use file:// protocol for local sources with depth (required for smart transport)
        const sourceUrl = getSourceUrl(source);
        const cloneUrl = depth && source.type === 'local' ? `file://${sourceUrl}` : sourceUrl;
        cloneArgs.push(cloneUrl, cachePath);
        await this.runGit(cloneArgs);
      }
    } finally {
      await releaseLock(lockPath);
      if (this.verbose) {
        console.log(`[repo] lock released path=${lockPath}`);
      }
    }

    return cachePath;
  }

  /**
   * Clone a repo from cache into the workspace at the configured path.
   * Handles checkout, ref resolution, ancestor walking, shallow clone, sparse checkout.
   */
  async materialize(repo: RepoConfig, workspacePath: string): Promise<void> {
    const targetDir = path.join(workspacePath, repo.path);
    const startedAt = Date.now();
    if (this.verbose) {
      console.log(
        `[repo] materialize start path=${repo.path} source=${getSourceUrl(repo.source)} workspace=${workspacePath}`,
      );
    }
    const cachePath = await this.ensureCache(
      repo.source,
      repo.clone?.depth,
      repo.checkout?.resolve,
    );

    // Build clone args — always clone from the bare cache
    const cloneArgs = ['clone'];

    if (repo.clone?.depth) {
      cloneArgs.push('--depth', String(repo.clone.depth));
    }
    if (repo.clone?.filter) {
      cloneArgs.push('--filter', repo.clone.filter);
    }

    // Clone with no checkout so we can control the checkout step
    cloneArgs.push('--no-checkout');
    // Use file:// protocol to force smart transport (required for --depth to work)
    const cloneUrl = repo.clone?.depth || repo.clone?.filter ? `file://${cachePath}` : cachePath;
    cloneArgs.push(cloneUrl, targetDir);

    await this.runGit(cloneArgs);

    // Sparse checkout setup (before actual checkout)
    if (repo.clone?.sparse?.length) {
      await this.runGit(['sparse-checkout', 'init', '--cone'], { cwd: targetDir });
      await this.runGit(['sparse-checkout', 'set', ...repo.clone.sparse], { cwd: targetDir });
    }

    // Resolve ref
    const ref = repo.checkout?.ref ?? 'HEAD';
    const resolve = repo.checkout?.resolve ?? 'remote';

    let resolvedSha: string;
    if (resolve === 'remote' && repo.source.type === 'git') {
      // Resolve via ls-remote for remote refs
      const url = getSourceUrl(repo.source);
      try {
        const lsOutput = await this.runGit(['ls-remote', url, ref]);
        const match = lsOutput.split('\t')[0];
        if (!match) {
          throw new Error(`Ref '${ref}' not found on remote ${url}`);
        }
        resolvedSha = match;
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) throw err;
        // Might be a SHA already — try direct checkout
        resolvedSha = ref;
      }
    } else {
      // Resolve locally from the cloned repo
      resolvedSha = ref;
    }

    // Checkout
    if (this.verbose) {
      console.log(
        `[repo] checkout path=${repo.path} ref=${ref} resolved=${resolvedSha} resolve=${resolve}`,
      );
    }
    await this.runGit(['checkout', resolvedSha], { cwd: targetDir });

    // Walk ancestors if requested
    const ancestor = repo.checkout?.ancestor ?? 0;
    if (ancestor > 0) {
      try {
        const ancestorSha = await this.runGit(['rev-parse', `HEAD~${ancestor}`], {
          cwd: targetDir,
        });
        await this.runGit(['checkout', ancestorSha], { cwd: targetDir });
      } catch {
        // Try to deepen if shallow
        if (repo.clone?.depth) {
          await this.runGit(['fetch', '--deepen', String(ancestor)], { cwd: targetDir });
          const ancestorSha = await this.runGit(['rev-parse', `HEAD~${ancestor}`], {
            cwd: targetDir,
          });
          await this.runGit(['checkout', ancestorSha], { cwd: targetDir });
        } else {
          throw new Error(
            `Cannot resolve ancestor ${ancestor} of ref '${ref}'. ` +
              `If using shallow clone, increase clone.depth to at least ${ancestor + 1}.`,
          );
        }
      }
    }

    if (this.verbose) {
      console.log(
        `[repo] materialize done path=${repo.path} target=${targetDir} durationMs=${Date.now() - startedAt}`,
      );
    }
  }

  /** Materialize all repos into the workspace. */
  async materializeAll(repos: readonly RepoConfig[], workspacePath: string): Promise<void> {
    if (this.verbose) {
      console.log(`[repo] materializeAll count=${repos.length} workspace=${workspacePath}`);
    }
    for (const repo of repos) {
      await this.materialize(repo, workspacePath);
    }
    if (this.verbose) {
      console.log('[repo] materializeAll complete');
    }
  }

  /** Reset repos in workspace to their checkout state. */
  async reset(
    repos: readonly RepoConfig[],
    workspacePath: string,
    strategy: 'hard' | 'recreate',
  ): Promise<void> {
    if (strategy === 'recreate') {
      // Remove and re-materialize
      for (const repo of repos) {
        const targetDir = path.join(workspacePath, repo.path);
        await rm(targetDir, { recursive: true, force: true });
      }
      await this.materializeAll(repos, workspacePath);
      return;
    }

    // strategy === 'hard'
    for (const repo of repos) {
      const targetDir = path.join(workspacePath, repo.path);
      await this.runGit(['reset', '--hard', 'HEAD'], { cwd: targetDir });
      await this.runGit(['clean', '-fd'], { cwd: targetDir });
    }
  }

  /**
   * Seed the cache from a local repository, setting the remote to a given URL.
   * Useful for avoiding slow network clones when a local clone already exists.
   */
  async seedCache(
    localPath: string,
    remoteUrl: string,
    opts?: { force?: boolean },
  ): Promise<string> {
    const source: RepoSource = { type: 'git', url: remoteUrl };
    const key = cacheKey(source);
    const cachePath = path.join(this.cacheDir, key);
    const lockPath = `${cachePath}.lock`;

    await mkdir(this.cacheDir, { recursive: true });
    await acquireLock(lockPath);

    try {
      if (existsSync(path.join(cachePath, 'HEAD'))) {
        if (!opts?.force) {
          throw new Error(
            `Cache already exists for ${remoteUrl} at ${cachePath}. Use force to overwrite.`,
          );
        }
        await rm(cachePath, { recursive: true, force: true });
      }

      // Clone bare mirror from local path
      await git(['clone', '--mirror', '--bare', localPath, cachePath]);

      // Point remote origin to the actual remote URL for future fetches
      await git(['remote', 'set-url', 'origin', remoteUrl], { cwd: cachePath });
    } finally {
      await releaseLock(lockPath);
    }

    return cachePath;
  }

  /** Remove the entire cache directory. */
  async cleanCache(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }
}
