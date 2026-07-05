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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): readonly string[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
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

function dockerSetupCommands(runtime: TargetRuntimeConfig): readonly string[] {
  return asStringArray(runtime.setup);
}

function dockerMemory(runtime: TargetRuntimeConfig): string | undefined {
  return asString(runtime.memory);
}

function dockerCpus(runtime: TargetRuntimeConfig): number | undefined {
  return typeof runtime.cpus === 'number' && runtime.cpus > 0 ? runtime.cpus : undefined;
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
  const argv = [
    'run',
    '--rm',
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

  const commandLine = [...dockerSetupCommands(options.runtime), command].join(' && ');
  argv.push(image, '/bin/sh', '-lc', commandLine);

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
