import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RepoConfig, RepoSource } from '../types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

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

export class RepoManager {
  private readonly verbose: boolean;

  constructor(verbose = false) {
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
   * Clone a repo directly from source into the workspace at the configured path.
   * Handles checkout, ref resolution, ancestor walking, shallow clone, sparse checkout.
   */
  async materialize(repo: RepoConfig, workspacePath: string): Promise<void> {
    const targetDir = path.join(workspacePath, repo.path);
    const sourceUrl = getSourceUrl(repo.source);
    const startedAt = Date.now();
    if (this.verbose) {
      console.log(
        `[repo] materialize start path=${repo.path} source=${sourceUrl} workspace=${workspacePath}`,
      );
    }

    // Build clone args — clone directly from source
    const cloneArgs = ['clone'];

    if (repo.clone?.depth) {
      cloneArgs.push('--depth', String(repo.clone.depth));
    }
    if (repo.clone?.filter) {
      cloneArgs.push('--filter', repo.clone.filter);
    }

    // Clone with no checkout so we can control the checkout step
    cloneArgs.push('--no-checkout');
    // Use file:// protocol for local sources with depth/filter (required for smart transport)
    const cloneUrl =
      (repo.clone?.depth || repo.clone?.filter) && repo.source.type === 'local'
        ? `file://${sourceUrl}`
        : sourceUrl;
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
}
