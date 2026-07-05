import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type TargetRuntimeMode = 'host' | 'profile' | 'sandbox';

export interface TargetRuntimeConfig {
  readonly mode: TargetRuntimeMode;
  readonly [key: string]: unknown;
}

export interface SandboxMountConfig {
  readonly source: string;
  readonly target: string;
  readonly access?: 'ro' | 'rw' | 'read_only' | 'read_write';
}

export interface SandboxCommandRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly runtime: TargetRuntimeConfig;
}

export interface SandboxCommandRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly failed: boolean;
  readonly timedOut?: boolean;
  readonly signal?: NodeJS.Signals | null;
  readonly spawnErrorCode?: string;
  readonly sandboxInfraFailure?: boolean;
  readonly sandboxDetails?: Record<string, unknown>;
}

const DOCKER_INFRA_EXIT_CODES = new Set([125]);

interface DockerSetupCommand {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === 'string') {
      record[key] = rawValue;
    }
  }
  return record;
}

function asMounts(value: unknown): readonly SandboxMountConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const source = asString((entry as Record<string, unknown>).source);
    const target = asString((entry as Record<string, unknown>).target);
    if (!source || !target) {
      return [];
    }
    const access = asString((entry as Record<string, unknown>).access);
    return [
      {
        source,
        target,
        ...(access === 'ro' || access === 'rw' || access === 'read_only' || access === 'read_write'
          ? { access }
          : {}),
      },
    ];
  });
}

function mountAccessSuffix(access: SandboxMountConfig['access']): string {
  return access === 'ro' || access === 'read_only' ? 'ro' : 'rw';
}

function dockerEnv(runtime: TargetRuntimeConfig): Record<string, string> {
  return {
    ...asStringRecord(runtime.env),
    ...asStringRecord(runtime.secrets),
  };
}

function dockerImage(runtime: TargetRuntimeConfig): string | undefined {
  return asString(runtime.image) ?? asString(runtime.container_image);
}

function dockerWorkdir(runtime: TargetRuntimeConfig): string | undefined {
  return asString(runtime.workdir) ?? asString(runtime.workspace);
}

function dockerHostCwd(runtime: TargetRuntimeConfig): string | undefined {
  return asString(runtime.host_cwd);
}

function dockerNetwork(runtime: TargetRuntimeConfig): string {
  const network = asString(runtime.network);
  return network ?? 'none';
}

function asDockerSetupCommand(value: unknown): DockerSetupCommand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const command = asStringArray(record.command);
  if (command.length === 0) {
    return undefined;
  }
  const cwd = asString(record.cwd);
  const stdin = typeof record.stdin === 'string' ? record.stdin : undefined;
  const timeoutMs =
    typeof record.timeout_ms === 'number' && record.timeout_ms > 0
      ? record.timeout_ms
      : typeof record.timeoutMs === 'number' && record.timeoutMs > 0
        ? record.timeoutMs
        : undefined;
  return {
    command,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(stdin !== undefined ? { stdin } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function dockerSetupCommands(runtime: TargetRuntimeConfig): readonly DockerSetupCommand[] {
  if (!Array.isArray(runtime.setup)) {
    return [];
  }
  return runtime.setup.flatMap((entry) => {
    const setupCommand = asDockerSetupCommand(entry);
    return setupCommand ? [setupCommand] : [];
  });
}

function dockerMemory(runtime: TargetRuntimeConfig): string | undefined {
  return asString(runtime.memory);
}

function dockerCpus(runtime: TargetRuntimeConfig): number | undefined {
  return typeof runtime.cpus === 'number' && runtime.cpus > 0 ? runtime.cpus : undefined;
}

async function runDockerCli(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly stdin?: string;
    readonly sandboxDetails: Record<string, unknown>;
  },
): Promise<SandboxCommandRunResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: options.stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`;

    const terminate = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.();
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          terminate();
        }, options.timeoutMs)
      : undefined;
    timeout?.unref?.();

    const abort = () => {
      cancelled = true;
      terminate();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      resolve({
        stdout,
        stderr: stderr || error.message,
        exitCode: null,
        failed: true,
        timedOut,
        signal: null,
        spawnErrorCode: error.code,
        sandboxInfraFailure: true,
        sandboxDetails: options.sandboxDetails,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      const sandboxInfraFailure =
        code !== null && DOCKER_INFRA_EXIT_CODES.has(code) && !timedOut && !cancelled;
      resolve({
        stdout,
        stderr,
        exitCode: code,
        failed: code !== 0 || signal !== null || timedOut || cancelled,
        timedOut,
        signal,
        sandboxInfraFailure,
        sandboxDetails: options.sandboxDetails,
      });
    });
  });
}

export async function runDockerSandboxCommand(
  command: string,
  options: SandboxCommandRunOptions,
): Promise<SandboxCommandRunResult> {
  const engine = asString(options.runtime.engine) ?? 'docker';
  if (engine !== 'docker') {
    return {
      stdout: '',
      stderr: `Unsupported sandbox engine '${engine}'. The built-in sandbox runner currently supports engine: docker.`,
      exitCode: null,
      failed: true,
      sandboxInfraFailure: true,
      sandboxDetails: { engine },
    };
  }

  const image = dockerImage(options.runtime);
  if (!image) {
    return {
      stdout: '',
      stderr: 'Sandbox runtime requires runtime.image for engine: docker.',
      exitCode: null,
      failed: true,
      sandboxInfraFailure: true,
      sandboxDetails: { engine },
    };
  }

  const containerName = `agentv-sandbox-${randomUUID()}`;
  const setupCommands = dockerSetupCommands(options.runtime);
  const argv = [
    setupCommands.length > 0 ? 'create' : 'run',
    ...(setupCommands.length === 0 ? ['--rm'] : []),
    '--name',
    containerName,
    '--network',
    dockerNetwork(options.runtime),
  ];

  const workdir = dockerWorkdir(options.runtime);
  if (workdir) {
    argv.push('--workdir', workdir);
  }

  const memory = dockerMemory(options.runtime);
  if (memory) {
    argv.push('--memory', memory);
  }

  const cpus = dockerCpus(options.runtime);
  if (cpus !== undefined) {
    argv.push('--cpus', String(cpus));
  }

  for (const [key, value] of Object.entries(dockerEnv(options.runtime))) {
    argv.push('--env', `${key}=${value}`);
  }

  for (const mount of asMounts(options.runtime.mounts)) {
    argv.push('--volume', `${mount.source}:${mount.target}:${mountAccessSuffix(mount.access)}`);
  }

  argv.push(
    image,
    ...(setupCommands.length > 0 ? ['sleep', 'infinity'] : ['/bin/sh', '-lc', command]),
  );

  if (setupCommands.length > 0) {
    const dockerCwd = dockerHostCwd(options.runtime) ?? options.cwd;
    const createResult = await runDockerCli(argv, {
      cwd: dockerCwd,
      timeoutMs: 30_000,
      signal: options.signal,
      sandboxDetails: { engine, image, containerName, argv: ['docker', ...argv] },
    });
    if (createResult.failed) {
      return createResult;
    }

    const cleanupContainer = async () => {
      await runDockerCli(['rm', '-f', containerName], {
        cwd: dockerCwd,
        timeoutMs: 30_000,
        sandboxDetails: {
          engine,
          image,
          containerName,
          argv: ['docker', 'rm', '-f', containerName],
        },
      });
    };

    try {
      const startArgs = ['start', containerName];
      const startResult = await runDockerCli(startArgs, {
        cwd: dockerCwd,
        timeoutMs: 30_000,
        signal: options.signal,
        sandboxDetails: { engine, image, containerName, argv: ['docker', ...startArgs] },
      });
      if (startResult.failed) {
        return startResult;
      }

      let setupStdout = '';
      let setupStderr = '';
      for (const setup of setupCommands) {
        const setupArgs = [
          'exec',
          ...(setup.stdin !== undefined ? ['-i'] : []),
          ...(setup.cwd !== undefined ? ['--workdir', setup.cwd] : []),
          containerName,
          ...setup.command,
        ];
        const setupResult = await runDockerCli(setupArgs, {
          cwd: dockerCwd,
          timeoutMs: setup.timeoutMs,
          signal: options.signal,
          stdin: setup.stdin,
          sandboxDetails: { engine, image, containerName, argv: ['docker', ...setupArgs] },
        });
        setupStdout += setupResult.stdout;
        setupStderr += setupResult.stderr;
        if (setupResult.failed) {
          return {
            ...setupResult,
            stdout: setupStdout,
            stderr: setupStderr,
          };
        }
      }

      const targetArgs = [
        'exec',
        ...(workdir ? ['--workdir', workdir] : []),
        containerName,
        '/bin/sh',
        '-lc',
        command,
      ];
      const targetResult = await runDockerCli(targetArgs, {
        cwd: dockerCwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        sandboxDetails: { engine, image, containerName, argv: ['docker', ...targetArgs] },
      });
      return {
        ...targetResult,
        stdout: `${setupStdout}${targetResult.stdout}`,
        stderr: `${setupStderr}${targetResult.stderr}`,
      };
    } finally {
      await cleanupContainer();
    }
  }

  return new Promise((resolve) => {
    const child = spawn('docker', argv, {
      cwd: dockerHostCwd(options.runtime) ?? options.cwd,
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`;

    const cleanupContainer = () => {
      const cleanup = spawn('docker', ['rm', '-f', containerName], {
        stdio: 'ignore',
        windowsHide: true,
      });
      cleanup.unref?.();
    };

    const terminate = () => {
      child.kill('SIGTERM');
      cleanupContainer();
      setTimeout(() => {
        child.kill('SIGKILL');
        cleanupContainer();
      }, 2_000).unref?.();
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          terminate();
        }, options.timeoutMs)
      : undefined;
    timeout?.unref?.();

    const abort = () => {
      cancelled = true;
      terminate();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      resolve({
        stdout,
        stderr: stderr || error.message,
        exitCode: null,
        failed: true,
        timedOut,
        signal: null,
        spawnErrorCode: error.code,
        sandboxInfraFailure: true,
        sandboxDetails: { engine, image, containerName, argv: ['docker', ...argv] },
      });
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      const sandboxInfraFailure =
        code !== null && DOCKER_INFRA_EXIT_CODES.has(code) && !timedOut && !cancelled;
      resolve({
        stdout,
        stderr,
        exitCode: code,
        failed: code !== 0 || signal !== null || timedOut || cancelled,
        timedOut,
        signal,
        sandboxInfraFailure,
        sandboxDetails: { engine, image, containerName, argv: ['docker', ...argv] },
      });
    });
  });
}
