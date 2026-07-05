import { execSync, spawn } from 'node:child_process';
import { accessSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { trackChild } from '../../runtime/child-tracker.js';
import type { PiRuntimeResolvedConfig } from './targets.js';
import type { Message, TargetExecutionEnvelope, TargetExecutionErrorKind } from './types.js';

const INLINE_LOG_LIMIT_BYTES = 64 * 1024;

export interface PiProcessRunOptions {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly stdinEnd?: 'after_write' | 'manual';
  readonly completeOnStdout?: (stdout: string) => boolean;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

export interface PiProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal?: string | null;
  readonly timedOut?: boolean;
  readonly spawnErrorCode?: string;
}

export type PiProcessRunner = (options: PiProcessRunOptions) => Promise<PiProcessRunResult>;

export function splitPiCommand(
  command: readonly string[],
  extraArgs: readonly string[] = [],
): readonly string[] {
  if (command.length === 0) {
    throw new Error('Pi provider command argv must not be empty');
  }
  return [...command, ...extraArgs];
}

export function buildPiRuntimeEnv(params: {
  readonly runtime: PiRuntimeResolvedConfig;
  readonly targetName: string;
  readonly env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const env = { ...(params.env ?? process.env) };
  Object.assign(env, params.runtime.env);

  if (params.runtime.mode === 'profile') {
    const home = params.runtime.home
      ? path.resolve(params.runtime.home)
      : path.resolve('.agentv', 'profiles', params.targetName);
    env.HOME = home;
    env.XDG_CONFIG_HOME = path.join(home, '.config');
    env.XDG_CACHE_HOME = path.join(home, '.cache');
    env.XDG_DATA_HOME = path.join(home, '.local', 'share');
    env.AGENTV_RUNTIME_PROFILE_HOME = home;
  }

  return env;
}

export function buildPiTargetExecution(params: {
  readonly targetName: string;
  readonly providerId: string;
  readonly providerKind: string;
  readonly runtimeMode: string;
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly result?: PiProcessRunResult;
  readonly status: 'success' | 'error';
  readonly errorKind?: TargetExecutionErrorKind;
  readonly message?: string;
  readonly output?: readonly Message[];
  readonly finalOutput?: string;
  readonly details?: Record<string, unknown>;
}): TargetExecutionEnvelope {
  return {
    schemaVersion: 'agentv.target_execution.v1',
    status: params.status,
    targetId: params.targetName,
    providerId: params.providerId,
    providerKind: params.providerKind,
    runtimeMode: params.runtimeMode,
    command: {
      argv: params.command,
      cwd: params.cwd,
    },
    timeoutMs: params.timeoutMs,
    startedAt: new Date(params.startedAt).toISOString(),
    endedAt: new Date(params.endedAt).toISOString(),
    durationMs: params.endedAt - params.startedAt,
    exitCode: params.result?.exitCode,
    signal: params.result?.signal ?? null,
    errorKind: params.errorKind,
    message: params.message,
    logs: {
      stdout: captureLog(params.result?.stdout ?? ''),
      stderr: captureLog(params.result?.stderr ?? ''),
    },
    transcript:
      params.output || params.finalOutput !== undefined
        ? {
            messages: params.output,
            finalOutput: params.finalOutput,
          }
        : undefined,
    details: params.details,
  };
}

export function classifyPiProcessFailure(
  result: PiProcessRunResult,
  signalAborted: boolean | undefined,
): TargetExecutionErrorKind {
  if (signalAborted) {
    return 'cancelled';
  }
  if (result.timedOut) {
    return 'timeout';
  }
  if (result.spawnErrorCode) {
    return 'spawn_failure';
  }
  if (result.signal && result.exitCode === null) {
    return 'signal_crash';
  }
  return 'nonzero_exit';
}

export function piProcessFailureMessage(params: {
  readonly providerLabel: string;
  readonly result: PiProcessRunResult;
  readonly errorKind: TargetExecutionErrorKind;
  readonly timeoutMs?: number;
}): string {
  if (params.errorKind === 'cancelled') {
    return `${params.providerLabel} request was aborted`;
  }
  if (params.errorKind === 'timeout') {
    return `${params.providerLabel} timed out${formatTimeoutSuffix(params.timeoutMs)}`;
  }
  if (params.errorKind === 'spawn_failure') {
    return (
      params.result.stderr.trim() ||
      params.result.stdout.trim() ||
      `${params.providerLabel} failed to spawn (${params.result.spawnErrorCode})`
    );
  }
  if (params.errorKind === 'signal_crash') {
    return `${params.providerLabel} terminated by signal ${params.result.signal ?? 'unknown'}`;
  }
  const codeText = params.result.exitCode !== null ? params.result.exitCode : 'unknown';
  const detail = params.result.stderr.trim() || params.result.stdout.trim();
  return detail
    ? `${params.providerLabel} exited with code ${codeText}: ${detail}`
    : `${params.providerLabel} exited with code ${codeText}`;
}

export function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) return '';
  return ` after ${Math.ceil(timeoutMs / 1000)}s`;
}

export async function defaultPiProcessRunner(
  options: PiProcessRunOptions,
): Promise<PiProcessRunResult> {
  return await new Promise<PiProcessRunResult>((resolve) => {
    const [command, ...args] = options.command;
    const [resolvedExe, prefixArgs] = resolveWindowsCmd(command);
    const allArgs = [...prefixArgs, ...args];

    const child = spawn(resolvedExe, allArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    trackChild(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnErrorCode: string | undefined;
    let settled = false;

    const onAbort = (): void => {
      killChildProcessGroup(child);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killChildProcessGroup(child);
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.setEncoding('utf8');
    let stdinEnded = false;
    const endStdin = (): void => {
      if (stdinEnded || child.stdin.destroyed) {
        return;
      }
      stdinEnded = true;
      child.stdin.end();
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
      if (options.completeOnStdout?.(stdout)) {
        endStdin();
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    const cleanup = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      spawnErrorCode = error.code;
      stderr += error.message;
      resolve({
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        timedOut,
        spawnErrorCode,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ? String(signal) : null,
        timedOut,
        spawnErrorCode,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    if (options.stdinEnd !== 'manual') {
      endStdin();
    }
  });
}

function captureLog(text: string) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= INLINE_LOG_LIMIT_BYTES) {
    return {
      text,
      truncated: false,
      bytes,
      storedBytes: bytes,
    };
  }

  let stored = text;
  while (Buffer.byteLength(stored, 'utf8') > INLINE_LOG_LIMIT_BYTES) {
    stored = stored.slice(0, Math.max(0, stored.length - 1024));
  }
  const storedBytes = Buffer.byteLength(stored, 'utf8');
  return {
    text: stored,
    truncated: true,
    bytes,
    storedBytes,
  };
}

function killChildProcessGroup(child: ReturnType<typeof spawn>): void {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to killing the direct child.
    }
  }
  child.kill('SIGTERM');
}

function resolveWindowsCmd(executable: string): [string, string[]] {
  if (process.platform !== 'win32') return [executable, []];

  const lower = executable.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.exe')) return [executable, []];

  let fullPath: string;
  try {
    fullPath = execSync(`where ${executable}`, { encoding: 'utf-8' })
      .trim()
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return [executable, []];
  }

  const cmdPath = fullPath.endsWith('.cmd') ? fullPath : `${fullPath}.cmd`;
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    const match = content.match(/"?%_prog%"?\s+"([^"]+\.js)"/);
    if (match) {
      const dp0 = path.dirname(path.resolve(cmdPath));
      const scriptPath = match[1].replace(/%dp0%[/\\]?/gi, `${dp0}${path.sep}`);
      try {
        accessSync(scriptPath);
        return ['node', [scriptPath]];
      } catch {
        // Fall through to original executable.
      }
    }
  } catch {
    // No .cmd wrapper.
  }

  return [executable, []];
}
