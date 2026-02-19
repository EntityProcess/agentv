import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import path from 'node:path';

import { recordCopilotSdkLogEntry } from './copilot-sdk-log-tracker.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CopilotSdkResolvedConfig } from './targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

// Lazy-loaded module to avoid bundling issues with dynamic requires
// biome-ignore lint/suspicious/noExplicitAny: dynamic import type
let copilotSdkModule: any = null;

async function loadCopilotSdk(): Promise<typeof import('@github/copilot-sdk')> {
  if (!copilotSdkModule) {
    try {
      copilotSdkModule = await import('@github/copilot-sdk');
    } catch (error) {
      throw new Error(
        `Failed to load @github/copilot-sdk. Please install it:\n  npm install @github/copilot-sdk\n\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return copilotSdkModule;
}

/**
 * Default system prompt for Copilot SDK evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

interface ToolCallInProgress {
  readonly tool: string;
  readonly input?: unknown;
  readonly id?: string;
  readonly startTime: string;
  readonly startMs: number;
}

/**
 * Copilot SDK provider using the @github/copilot-sdk library directly.
 * This provides typed event access for structured tool calls, token usage, and clean session lifecycle.
 *
 * Note: The SDK is loaded lazily on first use to avoid bundling issues.
 * Users must install @github/copilot-sdk separately.
 */
export class CopilotSdkProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CopilotSdkResolvedConfig;
  // biome-ignore lint/suspicious/noExplicitAny: SDK client type is dynamically loaded
  private client: any = null;

  constructor(targetName: string, config: CopilotSdkResolvedConfig) {
    this.id = `copilot:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Copilot SDK request was aborted before execution');
    }

    const sdk = await loadCopilotSdk();
    const client = await this.getOrCreateClient(sdk);

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Create a fresh session for this invocation
    // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
    const sessionOptions: any = {
      onPermissionRequest: () => ({ kind: 'approved' }),
    };

    if (this.config.model) {
      sessionOptions.model = this.config.model;
    }

    const cwd = this.resolveCwd(request.cwd);
    if (cwd) {
      sessionOptions.workingDirectory = cwd;
    }

    // Skip forced diff prompt when AgentV captures file changes
    const systemPrompt =
      this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);

    if (systemPrompt) {
      sessionOptions.systemMessage = {
        mode: 'append',
        content: systemPrompt,
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
    let session: any;
    try {
      session = await client.createSession(sessionOptions);
    } catch (error) {
      throw new Error(
        `Failed to create Copilot SDK session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Track events
    const toolCallsInProgress = new Map<string, ToolCallInProgress>();
    const completedToolCalls: ToolCall[] = [];
    let finalContent = '';
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;

    // Subscribe to events via catch-all handler
    const unsubscribe = session.on(
      // biome-ignore lint/suspicious/noExplicitAny: SDK event type is dynamically loaded
      (event: any) => {
        const eventType = event.type as string;
        const data = event.data;

        logger?.handleEvent(eventType, data);

        if (eventType === 'tool.execution_start') {
          const callId = data?.toolCallId ?? data?.id ?? randomUUID();
          toolCallsInProgress.set(callId, {
            tool: data?.toolName ?? data?.name ?? 'unknown',
            input: data?.input ?? data?.arguments,
            id: callId,
            startTime: new Date().toISOString(),
            startMs: Date.now(),
          });
        }

        if (eventType === 'tool.execution_end' || eventType === 'tool.execution_complete') {
          const callId = data?.toolCallId ?? data?.id;
          const inProgress = callId ? toolCallsInProgress.get(callId) : undefined;
          if (inProgress) {
            toolCallsInProgress.delete(callId);
            const endMs = Date.now();
            completedToolCalls.push({
              tool: inProgress.tool,
              input: inProgress.input,
              output: data?.output ?? data?.result,
              id: inProgress.id,
              startTime: inProgress.startTime,
              endTime: new Date().toISOString(),
              durationMs: endMs - inProgress.startMs,
            });
          }
        }

        if (eventType === 'assistant.message') {
          const content = data?.content;
          if (typeof content === 'string') {
            finalContent = content;
          }
        }

        if (eventType === 'assistant.usage') {
          const inputTokens = data?.inputTokens ?? data?.input ?? 0;
          const outputTokens = data?.outputTokens ?? data?.output ?? 0;
          // Aggregate usage across multiple events
          if (tokenUsage) {
            tokenUsage = {
              input: tokenUsage.input + inputTokens,
              output: tokenUsage.output + outputTokens,
            };
          } else {
            tokenUsage = {
              input: inputTokens,
              output: outputTokens,
            };
          }
          if (typeof data?.costUsd === 'number') {
            costUsd = (costUsd ?? 0) + data.costUsd;
          }
        }
      },
    );

    try {
      // Build the prompt
      const inputFiles = normalizeInputFiles(request.inputFiles);
      const prompt = buildPromptDocument(request, inputFiles);

      // Send and wait with optional timeout
      const timeoutMs = this.config.timeoutMs;

      if (request.signal) {
        // Handle abort signal
        const abortHandler = () => {
          session.destroy().catch(() => {});
        };
        request.signal.addEventListener('abort', abortHandler, { once: true });
        try {
          await this.sendWithTimeout(session, prompt, timeoutMs);
        } finally {
          request.signal.removeEventListener('abort', abortHandler);
        }
      } else {
        await this.sendWithTimeout(session, prompt, timeoutMs);
      }

      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Build output messages
      const outputMessages: OutputMessage[] = [];

      if (completedToolCalls.length > 0) {
        outputMessages.push({
          role: 'assistant',
          content: finalContent || undefined,
          toolCalls: completedToolCalls,
        });
      } else if (finalContent) {
        outputMessages.push({
          role: 'assistant',
          content: finalContent,
        });
      }

      return {
        raw: {
          model: this.config.model,
          cliUrl: this.config.cliUrl,
          logFile: logger?.filePath,
        },
        outputMessages,
        tokenUsage,
        costUsd,
        durationMs,
        startTime,
        endTime,
      };
    } finally {
      unsubscribe();
      await logger?.close();
      await session.destroy().catch(() => {});
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK client type is dynamically loaded
  private async getOrCreateClient(sdk: any): Promise<any> {
    if (!this.client) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK constructor options are dynamic
      const clientOptions: any = {};
      if (this.config.cliUrl) {
        clientOptions.cliUrl = this.config.cliUrl;
      }
      if (this.config.cliPath) {
        clientOptions.cliPath = this.config.cliPath;
      } else {
        // The SDK default getBundledCliPath() resolves to a JS entry that requires
        // node:sqlite (unavailable in Bun). Auto-resolve the platform-specific native
        // binary from @github/copilot-{platform}-{arch} when available.
        const nativePath = resolvePlatformCliPath();
        if (nativePath) {
          clientOptions.cliPath = nativePath;
        }
      }
      if (this.config.githubToken) {
        clientOptions.githubToken = this.config.githubToken;
      }
      this.client = new sdk.CopilotClient(clientOptions);
      await this.client.start();
    }
    return this.client;
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
  private async sendWithTimeout(session: any, prompt: string, timeoutMs?: number): Promise<void> {
    if (!timeoutMs) {
      await session.sendAndWait({ prompt });
      return;
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Copilot SDK timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      // Don't block process exit
      timer.unref?.();
    });

    await Promise.race([session.sendAndWait({ prompt }), timeoutPromise]);
  }

  private resolveCwd(cwdOverride?: string): string | undefined {
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (this.config.cwd) {
      return path.resolve(this.config.cwd);
    }
    return undefined;
  }

  private resolveLogDirectory(): string | undefined {
    const disabled = isCopilotSdkLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'copilot-sdk');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CopilotSdkStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot SDK stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await CopilotSdkStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordCopilotSdkLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot SDK stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class CopilotSdkStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private readonly format: 'summary' | 'json';

  private constructor(filePath: string, format: 'summary' | 'json') {
    this.filePath = filePath;
    this.format = format;
    this.stream = createWriteStream(filePath, { flags: 'a' });
  }

  static async create(options: {
    readonly filePath: string;
    readonly targetName: string;
    readonly evalCaseId?: string;
    readonly attempt?: number;
    readonly format: 'summary' | 'json';
  }): Promise<CopilotSdkStreamLogger> {
    const logger = new CopilotSdkStreamLogger(options.filePath, options.format);
    const header = [
      '# Copilot SDK stream log',
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
      const summary = summarizeEvent(eventType, data);
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

function summarizeEvent(eventType: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return eventType;
  }
  const d = data as Record<string, unknown>;
  switch (eventType) {
    case 'assistant.message':
      return typeof d.content === 'string'
        ? `${d.content.slice(0, 200)}${d.content.length > 200 ? '...' : ''}`
        : 'message';
    case 'assistant.message_delta':
      return typeof d.deltaContent === 'string' ? d.deltaContent.slice(0, 100) : undefined;
    case 'tool.execution_start':
      return `${d.toolName ?? d.name ?? 'unknown'}`;
    case 'tool.execution_end':
    case 'tool.execution_complete':
      return `${d.toolName ?? d.name ?? 'unknown'} completed`;
    case 'assistant.usage':
      return `input=${d.inputTokens ?? d.input ?? 0} output=${d.outputTokens ?? d.output ?? 0}`;
    case 'session.error':
      return typeof d.message === 'string' ? d.message : 'error';
    default:
      return undefined;
  }
}

function isCopilotSdkLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_COPILOT_SDK_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'copilot-sdk');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'copilot-sdk';
}

/**
 * Resolve the platform-specific native Copilot CLI binary from the @github/copilot
 * optional dependency. The SDK's default `getBundledCliPath()` points to a JS entry
 * that imports `node:sqlite` (unsupported by Bun). This function locates the native
 * binary directly.
 */
function resolvePlatformCliPath(): string | undefined {
  const os = platform();
  const cpu = arch();

  // Map Node.js platform/arch to @github/copilot package naming
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
    const packageJsonPath = resolved.startsWith('file://') ? resolved.slice(7) : resolved;
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

  return undefined;
}

function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
