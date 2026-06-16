import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentvConfigDir, getAgentvDataDir } from '../../paths.js';
import { loadProjectRegistry } from '../../projects.js';
import type { RepoConfig } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';
import { getRepoCheckoutRef } from './repo-checkout.js';
import { normalizeRepoIdentity, resolveRepoCloneUrl } from './repo-identity.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_HEARTBEAT_MS = 30_000;
const ERROR_OUTPUT_LIMIT = 1024 * 1024;
const LOCK_POLL_MS = 100;

interface GitRunOptions {
  cwd?: string;
  timeout?: number;
}

interface GitStreamingOptions extends GitRunOptions {
  description: string;
}

interface RepoManagerOptions {
  readonly progress?: boolean;
  readonly heartbeatMs?: number;
  readonly timeoutMs?: number;
}

interface AcquisitionSource {
  readonly kind: 'configured-mirror' | 'registered-project' | 'mirror-cache' | 'remote';
  readonly sourceUrl: string;
  readonly originUrl: string;
}

/** Environment vars to force non-interactive git, stripped of hook-injected vars. */
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

function appendLimited(current: string, chunk: Buffer): string {
  if (current.length >= ERROR_OUTPUT_LIMIT) return current;
  const next = current + chunk.toString();
  return next.length > ERROR_OUTPUT_LIMIT ? next.slice(-ERROR_OUTPUT_LIMIT) : next;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function isFullCommitSha(ref: string | undefined): boolean {
  return typeof ref === 'string' && /^[0-9a-f]{40}$/i.test(ref);
}

function assertSafeGitOperand(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes.`);
  }
  if (value.startsWith('-')) {
    throw new Error(`${label} must not start with '-'.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configPath(): string {
  return path.join(getAgentvConfigDir(), 'config.yaml');
}

function expandHome(value: string): string {
  if (value === '~') return process.env.HOME ?? value;
  if (value.startsWith('~/')) return path.join(process.env.HOME ?? '~', value.slice(2));
  return value;
}

async function git(args: string[], opts?: GitRunOptions): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts?.cwd,
    timeout: opts?.timeout ?? DEFAULT_TIMEOUT_MS,
    env: gitEnv(),
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.trim();
}

export class RepoManager {
  private readonly verbose: boolean;
  private readonly progress: boolean;
  private readonly heartbeatMs: number;
  private readonly timeoutMs: number;

  constructor(verbose = false, options: RepoManagerOptions = {}) {
    this.verbose = verbose;
    this.progress = options.progress ?? true;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async runGit(args: string[], opts?: GitRunOptions): Promise<string> {
    const startedAt = Date.now();
    if (this.verbose) {
      console.log(`[repo] git start cwd=${opts?.cwd ?? process.cwd()} args=${args.join(' ')}`);
    }

    try {
      const output = await git(args, { ...opts, timeout: opts?.timeout ?? this.timeoutMs });
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

  private runGitStreaming(args: string[], opts: GitStreamingOptions): Promise<void> {
    const startedAt = Date.now();
    const timeout = opts.timeout ?? this.timeoutMs;

    if (this.verbose) {
      console.log(`[repo] git start cwd=${opts.cwd ?? process.cwd()} args=${args.join(' ')}`);
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const child = spawn('git', args, {
        cwd: opts.cwd,
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const resetIdleTimeout = (): void => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeout);
      };
      resetIdleTimeout();

      const heartbeatHandle =
        this.progress && this.heartbeatMs > 0
          ? setInterval(() => {
              const elapsed = formatDuration(Date.now() - startedAt);
              console.error(`[repo] ${opts.description} still running after ${elapsed}`);
            }, this.heartbeatMs)
          : undefined;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (heartbeatHandle) clearInterval(heartbeatHandle);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendLimited(stdout, chunk);
        if (!timedOut) resetIdleTimeout();
        if (this.progress) process.stdout.write(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendLimited(stderr, chunk);
        if (!timedOut) resetIdleTimeout();
        if (this.progress) process.stderr.write(chunk);
      });

      child.on('error', (error) => finish(error));
      child.on('close', (code, signal) => {
        const durationMs = Date.now() - startedAt;
        if (this.verbose) {
          console.log(
            `[repo] git ${code === 0 ? 'ok' : 'fail'} durationMs=${durationMs} args=${args.join(' ')}`,
          );
        }

        if (timedOut) {
          finish(
            new Error(
              `${opts.description} made no progress for ${formatDuration(timeout)}. ` +
                `Register a matching local checkout, configure git_cache.mirrors in ${configPath()}, or check network connectivity.`,
            ),
          );
          return;
        }

        if (code !== 0) {
          const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
          finish(
            new Error(
              `git ${args.join(' ')} failed with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}${output ? `:\n${output}` : ''}`,
            ),
          );
          return;
        }

        finish();
      });
    });
  }

  private loadConfiguredMirrors(): Record<string, string> {
    const filePath = configPath();
    if (!existsSync(filePath)) return {};
    try {
      const parsed = parseYamlValue(readFileSync(filePath, 'utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const config = parsed as Record<string, unknown>;
      const gitCache = config.git_cache;
      if (!gitCache || typeof gitCache !== 'object' || Array.isArray(gitCache)) return {};
      const mirrors = (gitCache as Record<string, unknown>).mirrors;
      if (!mirrors || typeof mirrors !== 'object' || Array.isArray(mirrors)) return {};
      const result: Record<string, string> = {};
      for (const [repo, localPath] of Object.entries(mirrors as Record<string, unknown>)) {
        if (typeof localPath === 'string' && localPath.trim().length > 0) {
          result[repo] = expandHome(localPath.trim());
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private findConfiguredMirror(repoIdentity: string): string | undefined {
    const mirrors = this.loadConfiguredMirrors();
    for (const [repo, localPath] of Object.entries(mirrors)) {
      if (normalizeRepoIdentity(repo) !== repoIdentity) continue;
      if (!existsSync(localPath)) {
        console.warn(`[repo] configured mirror not found, falling back: ${localPath}`);
        continue;
      }
      return localPath;
    }
    return undefined;
  }

  private async findRegisteredProject(repoIdentity: string): Promise<string | undefined> {
    for (const project of loadProjectRegistry().projects) {
      if (!existsSync(project.path)) continue;
      try {
        const origin = await this.runGit(['remote', 'get-url', 'origin'], {
          cwd: project.path,
          timeout: 10_000,
        });
        if (normalizeRepoIdentity(origin) === repoIdentity) {
          return project.path;
        }
      } catch {
        if (project.repoUrl && normalizeRepoIdentity(project.repoUrl) === repoIdentity) {
          return project.path;
        }
      }
    }
    return undefined;
  }

  private gitCachePath(repoIdentity: string): string {
    const hash = createHash('sha256').update(repoIdentity).digest('hex');
    return path.join(getAgentvDataDir(), 'git-cache', hash);
  }

  private async withMirrorCacheLock<T>(mirrorPath: string, action: () => Promise<T>): Promise<T> {
    const lockPath = `${mirrorPath}.lock`;
    const startedAt = Date.now();

    while (true) {
      try {
        await mkdir(lockPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;
        if (Date.now() - startedAt > this.timeoutMs) {
          throw new Error(`Timed out waiting for git cache lock: ${lockPath}`);
        }
        await sleep(LOCK_POLL_MS);
      }
    }

    try {
      return await action();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async isValidBareRepo(repoPath: string): Promise<boolean> {
    if (!existsSync(path.join(repoPath, 'HEAD'))) return false;
    try {
      return (
        (await this.runGit(['rev-parse', '--is-bare-repository'], {
          cwd: repoPath,
          timeout: 10_000,
        })) === 'true'
      );
    } catch {
      return false;
    }
  }

  private async removeInvalidMirrorCache(mirrorPath: string): Promise<void> {
    if (!existsSync(mirrorPath)) return;
    const quarantinePath = `${mirrorPath}.invalid-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      await rename(mirrorPath, quarantinePath);
      await rm(quarantinePath, { recursive: true, force: true });
    } catch {
      await rm(mirrorPath, { recursive: true, force: true });
    }
  }

  private async prepareMirrorCache(
    seedSource: string,
    repoIdentity: string,
  ): Promise<string | undefined> {
    assertSafeGitOperand(seedSource, 'repo clone source');
    const mirrorPath = this.gitCachePath(repoIdentity);
    try {
      await mkdir(path.dirname(mirrorPath), { recursive: true });
      return await this.withMirrorCacheLock(mirrorPath, async () => {
        if (await this.isValidBareRepo(mirrorPath)) {
          try {
            await this.runGit(['remote', 'set-url', 'origin', seedSource], {
              cwd: mirrorPath,
              timeout: 10_000,
            });
            await this.runGitStreaming(['fetch', '--prune', '--progress', 'origin'], {
              cwd: mirrorPath,
              description: `git fetch cache for ${seedSource}`,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[repo] mirror cache fetch failed; using existing cache: ${message}`);
          }
          return mirrorPath;
        }

        await this.removeInvalidMirrorCache(mirrorPath);
        const tempPath = path.join(
          path.dirname(mirrorPath),
          `${path.basename(mirrorPath)}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`,
        );
        try {
          await this.runGitStreaming(
            ['clone', '--mirror', '--progress', '--', seedSource, tempPath],
            {
              description: `git mirror clone ${seedSource}`,
            },
          );
          if (!(await this.isValidBareRepo(tempPath))) {
            throw new Error(`git mirror clone did not create a valid bare repo at ${tempPath}`);
          }
          await rename(tempPath, mirrorPath);
          return mirrorPath;
        } finally {
          await rm(tempPath, { recursive: true, force: true });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[repo] mirror cache unavailable; trying next acquisition source: ${message}`);
      return undefined;
    }
  }

  private async resolveCommit(ref: string, cwd: string): Promise<string> {
    assertSafeGitOperand(ref, 'repo checkout ref');
    const candidates = [ref];
    if (!ref.startsWith('refs/') && !ref.startsWith('origin/') && !isFullCommitSha(ref)) {
      candidates.push(`refs/remotes/origin/${ref}`);
    }

    for (const candidate of candidates) {
      try {
        return await this.runGit(
          ['rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`],
          { cwd: cwd },
        );
      } catch {
        // Try the next safe spelling. `git checkout <branch>` can DWIM remote
        // branches; resolving to a SHA first needs that remote-ref fallback.
      }
    }

    throw new Error(`Cannot resolve ref '${ref}' to a commit.`);
  }

  private async resolveCheckoutCommit(repo: RepoConfig, targetDir: string): Promise<string> {
    const ref = getRepoCheckoutRef(repo);
    const checkoutSha = await this.resolveCommit(ref, targetDir);
    const ancestor = repo.ancestor ?? 0;
    if (ancestor === 0) {
      return checkoutSha;
    }

    try {
      return await this.resolveCommit(`${checkoutSha}~${ancestor}`, targetDir);
    } catch {
      const shallowHint = isFullCommitSha(ref)
        ? ''
        : ' Ensure the declared commit has enough reachable history in the selected repo.';
      throw new Error(`Cannot resolve ancestor ${ancestor} of ref '${ref}'.${shallowHint}`);
    }
  }

  private assertNoUserOwnedAlternates(targetDir: string, acquisition: AcquisitionSource): void {
    const alternatesPath = path.join(targetDir, '.git', 'objects', 'info', 'alternates');
    if (!existsSync(alternatesPath)) return;
    const alternates = readFileSync(alternatesPath, 'utf-8').trim();
    if (alternates.length > 0) {
      throw new Error(
        `git clone for ${acquisition.kind} left an alternates dependency at ${alternatesPath}`,
      );
    }
  }

  private async resolveAcquisition(repo: RepoConfig): Promise<AcquisitionSource> {
    const declaredRepo = repo.repo;
    if (!declaredRepo) {
      throw new Error(`repo is required for workspace repo at path ${repo.path ?? '(none)'}`);
    }

    const originUrl = resolveRepoCloneUrl(declaredRepo);
    const repoIdentity = normalizeRepoIdentity(declaredRepo);

    const registeredProject = await this.findRegisteredProject(repoIdentity);
    if (registeredProject) {
      const mirrorCache = await this.prepareMirrorCache(registeredProject, repoIdentity);
      if (mirrorCache) {
        return {
          kind: 'registered-project',
          sourceUrl: mirrorCache,
          originUrl,
        };
      }
    }

    const configuredMirror = this.findConfiguredMirror(repoIdentity);
    if (configuredMirror) {
      const mirrorCache = await this.prepareMirrorCache(configuredMirror, repoIdentity);
      if (mirrorCache) {
        return {
          kind: 'configured-mirror',
          sourceUrl: mirrorCache,
          originUrl,
        };
      }
    }

    const mirrorCache = await this.prepareMirrorCache(originUrl, repoIdentity);
    if (mirrorCache) {
      return {
        kind: 'mirror-cache',
        sourceUrl: mirrorCache,
        originUrl,
      };
    }

    return { kind: 'remote', sourceUrl: originUrl, originUrl };
  }

  /**
   * Clone a repo into the workspace at the configured path.
   * Handles acquisition resolution, sparse checkout, commit checkout, and ancestor walking.
   */
  async materialize(repo: RepoConfig, workspacePath: string): Promise<void> {
    if (!repo.repo || !repo.path) {
      if (this.verbose) {
        console.log(`[repo] materialize skip path=${repo.path ?? '(none)'} (no repo or path)`);
      }
      return;
    }

    const targetDir = path.join(workspacePath, repo.path);
    const acquisition = await this.resolveAcquisition(repo);
    const startedAt = Date.now();

    if (this.verbose) {
      console.log(
        `[repo] materialize start path=${repo.path} repo=${repo.repo} acquisition=${acquisition.kind} workspace=${workspacePath}`,
      );
    }

    // Plain local clones hardlink objects on the same filesystem and copy
    // otherwise; unlike --reference, neither path leaves alternates behind.
    const cloneArgs = ['clone', '--progress', '--no-checkout'];
    assertSafeGitOperand(acquisition.sourceUrl, 'repo clone source');
    cloneArgs.push('--', acquisition.sourceUrl, targetDir);

    await this.runGitStreaming(cloneArgs, {
      description: `git clone ${repo.repo}`,
    });
    this.assertNoUserOwnedAlternates(targetDir, acquisition);

    if (acquisition.sourceUrl !== acquisition.originUrl) {
      assertSafeGitOperand(acquisition.originUrl, 'repo origin URL');
      await this.runGit(['remote', 'set-url', 'origin', acquisition.originUrl], { cwd: targetDir });
    }

    if (repo.sparse?.length) {
      for (const sparsePath of repo.sparse) {
        assertSafeGitOperand(sparsePath, 'repo sparse path');
      }
      await this.runGit(['sparse-checkout', 'init', '--cone'], { cwd: targetDir });
      await this.runGit(['sparse-checkout', 'set', '--', ...repo.sparse], { cwd: targetDir });
    }

    const ref = getRepoCheckoutRef(repo);
    if (this.verbose) {
      console.log(`[repo] checkout path=${repo.path} ref=${ref}`);
    }
    const checkoutSha = await this.resolveCheckoutCommit(repo, targetDir);
    await this.runGit(['checkout', '--detach', checkoutSha], { cwd: targetDir });

    if (this.verbose) {
      console.log(
        `[repo] materialize done path=${repo.path} target=${targetDir} durationMs=${Date.now() - startedAt}`,
      );
    }
  }

  /** Materialize all repos into the workspace. Skips repos without repo (Docker-only repos). */
  async materializeAll(repos: readonly RepoConfig[], workspacePath: string): Promise<void> {
    const materializableRepos = repos.filter((r) => r.repo);
    if (this.verbose) {
      console.log(
        `[repo] materializeAll count=${materializableRepos.length} (${repos.length - materializableRepos.length} skipped, no repo) workspace=${workspacePath}`,
      );
    }
    for (const repo of materializableRepos) {
      await this.materialize(repo, workspacePath);
    }
    if (this.verbose) {
      console.log('[repo] materializeAll complete');
    }
  }

  /** Reset repos in workspace to their checkout state. Skips repos without path or repo. */
  async reset(
    repos: readonly RepoConfig[],
    workspacePath: string,
    reset: 'fast' | 'strict',
  ): Promise<void> {
    const cleanFlag = reset === 'strict' ? '-fdx' : '-fd';
    for (const repo of repos) {
      if (!repo.path || !repo.repo) continue;
      const targetDir = path.join(workspacePath, repo.path);
      const resetSha = await this.resolveCheckoutCommit(repo, targetDir);
      await this.runGit(['reset', '--hard', resetSha], { cwd: targetDir });
      await this.runGit(['clean', cleanFlag], { cwd: targetDir });
    }
  }
}
