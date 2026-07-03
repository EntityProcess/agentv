import type { Message, TargetExecutionEnvelope, TargetExecutionLogCapture } from './types.js';

const INLINE_LOG_LIMIT_BYTES = 128 * 1024;

export function captureTargetExecutionLog(text: string): TargetExecutionLogCapture {
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

export function buildTargetExecutionEnvelope(params: {
  readonly targetName: string;
  readonly providerId: string;
  readonly providerKind: string;
  readonly status: 'success' | 'error';
  readonly commandArgv?: readonly string[];
  readonly commandLine?: string;
  readonly cwd?: string;
  readonly runtimeMode?: string;
  readonly timeoutMs?: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly errorKind?: TargetExecutionEnvelope['errorKind'];
  readonly message?: string;
  readonly stdout?: string;
  readonly stderr?: string;
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
    runtimeMode: params.runtimeMode ?? 'host',
    command:
      params.commandArgv || params.commandLine || params.cwd
        ? {
            argv: params.commandArgv,
            commandLine: params.commandLine,
            cwd: params.cwd,
          }
        : undefined,
    timeoutMs: params.timeoutMs,
    startedAt: new Date(params.startedAt).toISOString(),
    endedAt: new Date(params.endedAt).toISOString(),
    durationMs: params.endedAt - params.startedAt,
    exitCode: params.exitCode,
    signal: params.signal ?? null,
    errorKind: params.errorKind,
    message: params.message,
    logs: {
      stdout: captureTargetExecutionLog(params.stdout ?? ''),
      stderr: captureTargetExecutionLog(params.stderr ?? ''),
    },
    transcript:
      params.output || params.finalOutput
        ? {
            messages: params.output,
            finalOutput: params.finalOutput,
          }
        : undefined,
    details: params.details,
  };
}
