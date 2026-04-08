/**
 * Docker workspace provider — manages Docker container lifecycle for eval grading.
 *
 * Flow: pull image → create container → copy files in → exec grader → parse output → destroy container.
 * All Docker commands use `execFile` (no shell) for security.
 *
 * To add a new Docker command: add a method that calls `this.exec(...)` with the appropriate argv.
 *
 * Design decisions:
 * - CommandExecutor interface for testability (mock `execFile` in tests)
 * - Always `docker rm -f` in cleanup, even on errors (try/finally)
 * - Lazy-loaded: non-Docker evals never import this module
 */

import type { DockerWorkspaceConfig } from '../types.js';

/** Result of a command execution */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Abstraction over process execution for testability */
export interface CommandExecutor {
  exec(
    argv: readonly string[],
    options?: { timeoutMs?: number; stdin?: string },
  ): Promise<ExecResult>;
}

/**
 * Default command executor using Bun.spawn / Node child_process.
 * Mirrors the pattern in runtime/exec.ts.
 */
export class DefaultCommandExecutor implements CommandExecutor {
  async exec(
    argv: readonly string[],
    options: { timeoutMs?: number; stdin?: string } = {},
  ): Promise<ExecResult> {
    const { execFileWithStdin } = await import('../../runtime/exec.js');
    return execFileWithStdin(argv, options.stdin ?? '', {
      timeoutMs: options.timeoutMs,
    });
  }
}

/** Options for creating a Docker container */
export interface CreateContainerOptions {
  readonly image: string;
  readonly memory?: string;
  readonly cpus?: number;
}

/** Options for executing a command inside a container */
export interface ExecInContainerOptions {
  readonly containerId: string;
  readonly command: readonly string[];
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

const DEFAULT_TIMEOUT_S = 1800;

/**
 * Manages Docker container lifecycle for workspace-based evaluations.
 *
 * Usage:
 *   const docker = new DockerWorkspaceProvider(config);
 *   await docker.pullImage();
 *   const containerId = await docker.createContainer();
 *   try {
 *     await docker.copyToContainer(containerId, localPath, containerPath);
 *     const output = await docker.execInContainer({ containerId, command: [...] });
 *     // parse output...
 *   } finally {
 *     await docker.removeContainer(containerId);
 *   }
 */
export class DockerWorkspaceProvider {
  private readonly config: DockerWorkspaceConfig;
  private readonly executor: CommandExecutor;
  private readonly timeoutMs: number;

  constructor(config: DockerWorkspaceConfig, executor?: CommandExecutor) {
    this.config = config;
    this.executor = executor ?? new DefaultCommandExecutor();
    this.timeoutMs = (config.timeout ?? DEFAULT_TIMEOUT_S) * 1000;
  }

  /** Check whether the Docker CLI is available on the host. */
  async isDockerAvailable(): Promise<boolean> {
    try {
      const result = await this.executor.exec(
        ['docker', 'version', '--format', '{{.Server.Version}}'],
        {
          timeoutMs: 10_000,
        },
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Pull the configured Docker image. No-op if already cached locally. */
  async pullImage(): Promise<void> {
    // Skip pull if image already exists locally (e.g. locally-built images)
    const inspectResult = await this.executor.exec(['docker', 'image', 'inspect', this.config.image], {
      timeoutMs: 10_000,
    });
    if (inspectResult.exitCode === 0) {
      return; // Image exists locally, no pull needed
    }

    const result = await this.executor.exec(['docker', 'pull', this.config.image], {
      timeoutMs: this.timeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new Error(`docker pull failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
  }

  /** Create a stopped container from the configured image with resource limits. Returns container ID. */
  async createContainer(): Promise<string> {
    const argv: string[] = ['docker', 'create'];

    if (this.config.memory) {
      argv.push(`--memory=${this.config.memory}`);
    }
    if (this.config.cpus !== undefined) {
      argv.push(`--cpus=${this.config.cpus}`);
    }

    // Keep the container alive with a long sleep so we can exec into it
    argv.push(this.config.image, 'sleep', 'infinity');

    const result = await this.executor.exec(argv, { timeoutMs: 30_000 });
    if (result.exitCode !== 0) {
      throw new Error(`docker create failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  /** Start a previously created container. */
  async startContainer(containerId: string): Promise<void> {
    const result = await this.executor.exec(['docker', 'start', containerId], {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`docker start failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
  }

  /** Copy a local file or directory into a running container. */
  async copyToContainer(
    containerId: string,
    localPath: string,
    containerPath: string,
  ): Promise<void> {
    const result = await this.executor.exec(
      ['docker', 'cp', localPath, `${containerId}:${containerPath}`],
      { timeoutMs: 60_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(`docker cp failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
  }

  /**
   * Execute a command inside a running container.
   * If stdin is provided, it is piped via `docker exec -i`.
   */
  async execInContainer(options: ExecInContainerOptions): Promise<ExecResult> {
    const { containerId, command, timeoutMs, stdin } = options;
    const argv: string[] = ['docker', 'exec'];

    if (stdin !== undefined) {
      argv.push('-i');
    }

    argv.push(containerId, ...command);

    return this.executor.exec(argv, {
      timeoutMs: timeoutMs ?? this.timeoutMs,
      stdin,
    });
  }

  /** Force-remove a container (always succeeds, even if container doesn't exist). */
  async removeContainer(containerId: string): Promise<void> {
    try {
      await this.executor.exec(['docker', 'rm', '-f', containerId], {
        timeoutMs: 30_000,
      });
    } catch {
      // Best-effort cleanup — don't throw on removal failure
    }
  }

  /** Full lifecycle: create → start → exec → cleanup. Convenience for single-command grading. */
  async runGraderInContainer(options: {
    readonly command: readonly string[];
    readonly stdin?: string;
    readonly copyFiles?: ReadonlyArray<{ localPath: string; containerPath: string }>;
  }): Promise<ExecResult> {
    const containerId = await this.createContainer();
    try {
      await this.startContainer(containerId);

      if (options.copyFiles) {
        for (const file of options.copyFiles) {
          await this.copyToContainer(containerId, file.localPath, file.containerPath);
        }
      }

      return await this.execInContainer({
        containerId,
        command: options.command,
        stdin: options.stdin,
      });
    } finally {
      await this.removeContainer(containerId);
    }
  }
}
