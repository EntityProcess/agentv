/**
 * Shared utilities for Copilot providers (SDK and CLI).
 *
 * Centralises platform binary resolution, log filename generation,
 * elapsed-time formatting, sanitisation helpers, and process lifecycle
 * so both copilot-sdk.ts and copilot-cli.ts stay DRY.
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProviderRequest } from './types.js';

// ---------------------------------------------------------------------------
// Platform binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the platform-specific native Copilot CLI binary from the @github/copilot
 * optional dependency. The SDK's default `getBundledCliPath()` points to a JS entry
 * that imports `node:sqlite` (unsupported by Bun). This function locates the native
 * binary directly.
 */
export function resolvePlatformCliPath(): string | undefined {
  const os = platform();
  const cpu = arch();

  const platformMap: Record<string, string> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'win32',
  };
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
  };

  const osPart = platformMap[os];
  const archPart = archMap[cpu];
  if (!osPart || !archPart) {
    return undefined;
  }

  const packageName = `@github/copilot-${osPart}-${archPart}`;
  const binaryName = os === 'win32' ? 'copilot.exe' : 'copilot';

  try {
    // Try to resolve the platform package via import.meta.resolve
    const resolved = import.meta.resolve(`${packageName}/package.json`);
    // Use fileURLToPath for correct cross-platform conversion (slice(7) breaks on Windows
    // where file:///D:/... becomes /D:/... which is not a valid path)
    const packageJsonPath = resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved;
    const binaryPath = path.join(path.dirname(packageJsonPath), binaryName);
    if (existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // Not resolvable via import.meta.resolve
  }

  // Walk up from cwd looking for node_modules containing the package
  let searchDir = process.cwd();
  for (let i = 0; i < 10; i++) {
    // Standard node_modules layout
    const standardPath = path.join(searchDir, 'node_modules', ...packageName.split('/'), binaryName);
    if (existsSync(standardPath)) {
      return standardPath;
    }

    // Bun's deduped .bun directory layout
    const bunDir = path.join(searchDir, 'node_modules', '.bun');
    const prefix = `@github+copilot-${osPart}-${archPart}@`;
    try {
      const entries = readdirSync(bunDir);
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          const candidate = path.join(
            bunDir,
            entry,
            'node_modules',
            '@github',
            `copilot-${osPart}-${archPart}`,
            binaryName,
          );
          if (existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // .bun directory doesn't exist or can't be read
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Log filename & sanitisation
// ---------------------------------------------------------------------------

export function buildLogFilename(
  request: ProviderRequest,
  targetName: string,
  fallbackId: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? fallbackId);
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

export function sanitizeForFilename(value: string, fallback = 'unknown'): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : fallback;
}

// ---------------------------------------------------------------------------
// Elapsed-time formatting
// ---------------------------------------------------------------------------

export function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

export function killProcess(proc: ChildProcess): void {
  try {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM');
      // Give process 5s to exit gracefully, then force-kill
      const forceTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Already exited
        }
      }, 5000);
      forceTimer.unref?.();
    }
  } catch {
    // Process already exited
  }
}

// ---------------------------------------------------------------------------
// Stream logger
// ---------------------------------------------------------------------------

export interface StreamLoggerOptions {
  readonly filePath: string;
  readonly targetName: string;
  readonly evalCaseId?: string;
  readonly attempt?: number;
  readonly format: 'summary' | 'json';
  readonly headerLabel: string;
}

export class CopilotStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private readonly format: 'summary' | 'json';
  private readonly summarize: (eventType: string, data: unknown) => string | undefined;

  private constructor(
    filePath: string,
    format: 'summary' | 'json',
    summarize: (eventType: string, data: unknown) => string | undefined,
  ) {
    this.filePath = filePath;
    this.format = format;
    this.summarize = summarize;
    this.stream = createWriteStream(filePath, { flags: 'a' });
  }

  static async create(
    options: StreamLoggerOptions,
    summarize: (eventType: string, data: unknown) => string | undefined,
  ): Promise<CopilotStreamLogger> {
    const logger = new CopilotStreamLogger(options.filePath, options.format, summarize);
    const header = [
      `# ${options.headerLabel} stream log`,
      `# target: ${options.targetName}`,
      options.evalCaseId ? `# eval: ${options.evalCaseId}` : undefined,
      options.attempt !== undefined ? `# attempt: ${options.attempt + 1}` : undefined,
      `# started: ${new Date().toISOString()}`,
      '',
    ].filter((line): line is string => Boolean(line));
    for (const line of header) {
      logger.stream.write(`${line}\n`);
    }
    return logger;
  }

  handleEvent(eventType: string, data: unknown): void {
    const elapsed = formatElapsed(this.startedAt);
    if (this.format === 'json') {
      this.stream.write(`${JSON.stringify({ time: elapsed, event: eventType, data })}\n`);
    } else {
      const summary = this.summarize(eventType, data);
      if (summary) {
        this.stream.write(`[+${elapsed}] [${eventType}] ${summary}\n`);
      }
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// Log-streaming env check
// ---------------------------------------------------------------------------

export function isLogStreamingDisabled(envKey: string): boolean {
  const envValue = process.env[envKey];
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}
