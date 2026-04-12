/**
 * Shared utilities for Copilot providers (SDK and CLI).
 *
 * Centralises platform binary resolution, log filename generation,
 * elapsed-time formatting, sanitisation helpers, and process lifecycle
 * so both copilot-sdk.ts and copilot-cli.ts stay DRY.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
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
 *
 * Resolution order:
 *   1. `import.meta.resolve()` of `@github/copilot-<os>-<arch>/package.json`
 *   2. Walk upward from `process.cwd()` probing local `node_modules` layouts
 *      (standard and Bun's deduped `.bun/` directory)
 *   3. Probe common global npm install roots (e.g. `%APPDATA%\npm\node_modules`
 *      on Windows, `/usr/local/lib/node_modules` on Unix). Users often install
 *      `@github/copilot` globally via `npm install -g`, and on Windows the
 *      `copilot` command on PATH is a `.ps1`/`.cmd` shim — `spawn()` needs the
 *      native `copilot.exe` directly. See #1036.
 *
 * To teach the resolver about a new global install location, add it to
 * `globalNpmRoots()` below — no other change required.
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
    const standardPath = path.join(
      searchDir,
      'node_modules',
      ...packageName.split('/'),
      binaryName,
    );
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

  // Global npm install roots (e.g. `npm install -g @github/copilot`).
  // For each root, probe both the hoisted layout and the nested layout where
  // the platform package lives under the parent `@github/copilot` package.
  for (const root of globalNpmRoots()) {
    const hoisted = path.join(root, '@github', `copilot-${osPart}-${archPart}`, binaryName);
    if (existsSync(hoisted)) {
      return hoisted;
    }
    const nested = path.join(
      root,
      '@github',
      'copilot',
      'node_modules',
      '@github',
      `copilot-${osPart}-${archPart}`,
      binaryName,
    );
    if (existsSync(nested)) {
      return nested;
    }
  }

  return undefined;
}

/**
 * Candidate global `node_modules` roots to probe for `@github/copilot`.
 *
 * Ordered by how commonly each root is used on the relevant platform. To add
 * a new location, append to the platform block below.
 */
function globalNpmRoots(): string[] {
  const roots: string[] = [];
  const os = platform();
  const home = homedir();

  if (os === 'win32') {
    // npm default on Windows: %APPDATA%\npm\node_modules
    if (process.env.APPDATA) {
      roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    }
    // nvm-windows / manual installs sometimes live under the user profile
    roots.push(path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules'));
  } else {
    // Homebrew (Apple Silicon) and common Unix prefixes
    roots.push('/opt/homebrew/lib/node_modules');
    roots.push('/usr/local/lib/node_modules');
    roots.push('/usr/lib/node_modules');
    // User-local npm prefixes (`npm config set prefix ~/.npm-global`)
    roots.push(path.join(home, '.npm-global', 'lib', 'node_modules'));
    roots.push(path.join(home, '.local', 'lib', 'node_modules'));
  }

  // Honour an explicit npm prefix override if present in the environment.
  if (process.env.npm_config_prefix) {
    const prefix = process.env.npm_config_prefix;
    roots.push(
      os === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules'),
    );
  }

  return Array.from(new Set(roots));
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
  /**
   * Optional extractor for streaming text chunk events.
   *
   * When provided, the return value controls how each event is handled:
   *   - `string`    — buffer this text; flush as `[assistant_message]` on the next
   *                   non-chunk event or `close()`.
   *   - `null`      — discard (reset) the accumulated buffer without emitting it.
   *                   Use this for events that signal a new streaming pass is starting,
   *                   e.g. `agent_thought_chunk` in Copilot ACP, which arrives between
   *                   a streaming preview batch and the final response batch.
   *   - `undefined` — not a chunk event; process normally (flush buffer first, then
   *                   call `summarize` and write the line).
   *
   * Example (Copilot CLI ACP):
   *   chunkExtractor: (type, data) => {
   *     if (type === 'agent_thought_chunk') return null;   // reset pre-thinking buffer
   *     if (type !== 'agent_message_chunk') return undefined;
   *     return (data as any)?.content?.text ?? undefined;
   *   }
   */
  readonly chunkExtractor?: (eventType: string, data: unknown) => string | null | undefined;
}

export class CopilotStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private readonly format: 'summary' | 'json';
  private readonly summarize: (eventType: string, data: unknown) => string | undefined;
  private readonly chunkExtractor?: (eventType: string, data: unknown) => string | null | undefined;
  private pendingText = '';

  private constructor(
    filePath: string,
    format: 'summary' | 'json',
    summarize: (eventType: string, data: unknown) => string | undefined,
    chunkExtractor?: (eventType: string, data: unknown) => string | null | undefined,
  ) {
    this.filePath = filePath;
    this.format = format;
    this.summarize = summarize;
    this.chunkExtractor = chunkExtractor;
    this.stream = createWriteStream(filePath, { flags: 'a' });
  }

  static async create(
    options: StreamLoggerOptions,
    summarize: (eventType: string, data: unknown) => string | undefined,
  ): Promise<CopilotStreamLogger> {
    const logger = new CopilotStreamLogger(
      options.filePath,
      options.format,
      summarize,
      options.chunkExtractor,
    );
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
    // Buffer chunk events into a single consolidated entry (both formats).
    if (this.chunkExtractor) {
      const chunkText = this.chunkExtractor(eventType, data);
      if (chunkText === null) {
        // Reset signal: discard the accumulated buffer without emitting.
        // Used for events like agent_thought_chunk that arrive between a
        // streaming preview batch and the final response batch in Copilot ACP —
        // the preview text is stale; the real message follows after thinking.
        this.pendingText = '';
        return;
      }
      if (chunkText !== undefined) {
        this.pendingText += chunkText;
        return;
      }
      // Non-chunk event: flush any accumulated text first.
      this.flushPendingText();
    }

    if (this.format === 'json') {
      const elapsed = formatElapsed(this.startedAt);
      this.stream.write(`${JSON.stringify({ time: elapsed, event: eventType, data })}\n`);
      return;
    }

    const elapsed = formatElapsed(this.startedAt);
    const summary = this.summarize(eventType, data);
    if (summary) {
      this.stream.write(`[+${elapsed}] [${eventType}] ${summary}\n`);
    }
  }

  private flushPendingText(): void {
    if (!this.pendingText) return;
    const elapsed = formatElapsed(this.startedAt);
    if (this.format === 'json') {
      this.stream.write(
        `${JSON.stringify({ time: elapsed, event: 'assistant_message', data: { content: this.pendingText } })}\n`,
      );
    } else {
      this.stream.write(`[+${elapsed}] [assistant_message] ${this.pendingText}\n`);
    }
    this.pendingText = '';
  }

  async close(): Promise<void> {
    this.flushPendingText();
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
