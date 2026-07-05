import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { trackChild } from '../../runtime/child-tracker.js';
import {
  SDK_CHILD_PROTOCOL_VERSION,
  type SdkChildEventWire,
  type SdkChildOutputEnvelope,
  type SdkChildProviderKind,
  type SdkChildRequestEnvelope,
  providerRequestToWire,
  providerResponseFromWire,
} from './sdk-child-protocol.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

export class SdkChildRunnerError extends Error {
  readonly reason:
    | 'spawn'
    | 'exit'
    | 'signal'
    | 'timeout'
    | 'cancelled'
    | 'malformed_output'
    | 'protocol'
    | 'child_error';
  readonly details?: unknown;

  constructor(
    providerKind: SdkChildProviderKind,
    reason: SdkChildRunnerError['reason'],
    message: string,
    details?: unknown,
  ) {
    super(`${providerKind} child runner ${reason}: ${message}`);
    this.name = 'SdkChildRunnerError';
    this.reason = reason;
    this.details = details;
  }
}

export interface SdkChildProviderOptions {
  readonly runnerArgv?: readonly string[];
}

export class SdkChildProvider implements Provider {
  readonly id: string;
  readonly targetName: string;
  readonly supportsBatch = false;

  readonly kind: SdkChildProviderKind;

  private readonly config: unknown;
  private readonly runnerArgv?: readonly string[];

  constructor(
    kind: SdkChildProviderKind,
    targetName: string,
    config: unknown,
    options: SdkChildProviderOptions = {},
  ) {
    this.kind = kind;
    this.id = `${kind}:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runnerArgv = options.runnerArgv;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new SdkChildRunnerError(this.kind, 'cancelled', 'request was aborted before execution');
    }

    const childRequest: SdkChildRequestEnvelope = {
      protocol_version: SDK_CHILD_PROTOCOL_VERSION,
      provider_kind: this.kind,
      target_name: this.targetName,
      config: this.config,
      request: providerRequestToWire(request),
    };

    const argv = this.runnerArgv ?? resolveDefaultRunnerArgv();
    if (argv.length === 0) {
      throw new SdkChildRunnerError(this.kind, 'spawn', 'runner argv is empty');
    }

    return await this.runChild(argv, childRequest, request);
  }

  private async runChild(
    argv: readonly string[],
    childRequest: SdkChildRequestEnvelope,
    request: ProviderRequest,
  ): Promise<ProviderResponse> {
    const [command, ...args] = argv;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        env: process.env,
      });
    } catch (error) {
      throw new SdkChildRunnerError(this.kind, 'spawn', formatError(error), { argv });
    }

    trackChild(child);

    const events: SdkChildEventWire[] = [];
    const stderrChunks: Buffer[] = [];
    let finalResponse: ProviderResponse | undefined;
    let childError: (SdkChildOutputEnvelope & { readonly type: 'error' }) | undefined;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let malformedOutput: string | undefined;
    let stdoutBuffer = '';

    const cleanupAbortListener = this.attachAbortHandler(request, child, () => {
      cancelled = true;
    });

    const timeout =
      getTimeoutMs(this.config) !== undefined
        ? setTimeout(() => {
            timedOut = true;
            killChildProcessGroup(child);
          }, getTimeoutMs(this.config))
        : undefined;
    timeout?.unref?.();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        try {
          this.handleProtocolLine(
            line,
            events,
            (response) => {
              finalResponse = response;
            },
            (errorEnvelope) => {
              childError = errorEnvelope;
            },
          );
        } catch (error) {
          malformedOutput = formatError(error);
          killChildProcessGroup(child);
          return;
        }
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const closeResult = await new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          reject(new SdkChildRunnerError(this.kind, 'spawn', formatError(error), { argv }));
        }
      });
      child.once('close', (code, signal) => {
        if (!settled) {
          settled = true;
          resolve({ code, signal });
        }
      });

      child.stdin.end(`${JSON.stringify(childRequest)}\n`);
    }).finally(() => {
      cleanupAbortListener();
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    if (stdoutBuffer.trim().length > 0 && !malformedOutput) {
      try {
        this.handleProtocolLine(
          stdoutBuffer,
          events,
          (response) => {
            finalResponse = response;
          },
          (errorEnvelope) => {
            childError = errorEnvelope;
          },
        );
      } catch (error) {
        malformedOutput = formatError(error);
      }
    }

    const stderr = Buffer.concat(stderrChunks).toString('utf8').replace(/\r\n/g, '\n');

    if (timedOut) {
      throw new SdkChildRunnerError(
        this.kind,
        'timeout',
        formatTimeout(getTimeoutMs(this.config)),
        {
          stderr,
          events,
        },
      );
    }
    if (cancelled) {
      throw new SdkChildRunnerError(this.kind, 'cancelled', 'request was cancelled', {
        stderr,
        events,
      });
    }
    if (malformedOutput) {
      throw new SdkChildRunnerError(this.kind, 'malformed_output', malformedOutput, {
        stderr,
        events,
      });
    }
    if (childError) {
      throw new SdkChildRunnerError(this.kind, 'child_error', childError.error.message, {
        code: childError.error.code,
        stack: childError.error.stack,
        stderr,
        events,
      });
    }
    if (closeResult.signal) {
      throw new SdkChildRunnerError(this.kind, 'signal', String(closeResult.signal), {
        stderr,
        events,
      });
    }
    if (closeResult.code !== 0) {
      throw new SdkChildRunnerError(this.kind, 'exit', `exit code ${closeResult.code}`, {
        stderr,
        events,
      });
    }
    if (!finalResponse) {
      throw new SdkChildRunnerError(this.kind, 'protocol', 'missing final result envelope', {
        stderr,
        events,
      });
    }

    return attachChildRunnerRaw(finalResponse, { events, stderr });
  }

  private handleProtocolLine(
    line: string,
    events: SdkChildEventWire[],
    setResult: (response: ProviderResponse) => void,
    setError: (errorEnvelope: SdkChildOutputEnvelope & { readonly type: 'error' }) => void,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const parsed = JSON.parse(trimmed) as SdkChildOutputEnvelope;
    if (parsed.protocol_version !== SDK_CHILD_PROTOCOL_VERSION) {
      throw new Error(`unexpected protocol_version ${String(parsed.protocol_version)}`);
    }

    if (parsed.type === 'event') {
      events.push(parsed.event);
      return;
    }
    if (parsed.type === 'result') {
      setResult(providerResponseFromWire(parsed.response));
      return;
    }
    if (parsed.type === 'error') {
      setError(parsed);
      return;
    }

    throw new Error(`unknown protocol message type ${(parsed as { type?: unknown }).type}`);
  }

  private attachAbortHandler(
    request: ProviderRequest,
    child: ChildProcessWithoutNullStreams,
    onAbort: () => void,
  ): () => void {
    if (!request.signal) {
      return () => {};
    }
    const abortHandler = () => {
      onAbort();
      killChildProcessGroup(child);
    };
    request.signal.addEventListener('abort', abortHandler, { once: true });
    return () => request.signal?.removeEventListener('abort', abortHandler);
  }
}

function resolveDefaultRunnerArgv(): readonly string[] {
  for (const relativePath of [
    './sdk-child-runner.js',
    './evaluation/providers/sdk-child-runner.js',
    './sdk-child-runner.ts',
  ]) {
    const runnerPath = fileURLToPath(new URL(relativePath, import.meta.url));
    if (existsSync(runnerPath)) {
      return [process.execPath, runnerPath];
    }
  }

  const tsRunnerPath = fileURLToPath(new URL('./sdk-child-runner.ts', import.meta.url));
  return [process.execPath, tsRunnerPath];
}

function killChildProcessGroup(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill('SIGKILL');
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function getTimeoutMs(config: unknown): number | undefined {
  if (typeof config !== 'object' || config === null) {
    return undefined;
  }
  const timeoutMs = (config as { timeoutMs?: unknown }).timeoutMs;
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : undefined;
}

function formatTimeout(timeoutMs: number | undefined): string {
  return timeoutMs ? `timed out after ${timeoutMs}ms` : 'timed out';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachChildRunnerRaw(
  response: ProviderResponse,
  childRunner: { readonly events: readonly SdkChildEventWire[]; readonly stderr: string },
): ProviderResponse {
  const raw =
    typeof response.raw === 'object' && response.raw !== null && !Array.isArray(response.raw)
      ? response.raw
      : response.raw === undefined
        ? {}
        : { provider_raw: response.raw };

  return {
    ...response,
    raw: {
      ...raw,
      child_runner: childRunner,
    },
  };
}
