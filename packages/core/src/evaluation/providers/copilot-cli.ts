import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import * as acp from '@agentclientprotocol/sdk';

import { recordCopilotCliLogEntry } from './copilot-cli-log-tracker.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CopilotCliResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

/**
 * Default system prompt for Copilot CLI evaluations.
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
 * Copilot CLI provider using the Agent Client Protocol (ACP).
 *
 * Spawns `copilot --acp --stdio` and communicates via NDJSON using
 * @agentclientprotocol/sdk. This bypasses the @github/copilot-sdk's
 * 60s session.idle timeout, enabling long-running agent tasks.
 */
export class CopilotCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-cli' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CopilotCliResolvedConfig;

  constructor(targetName: string, config: CopilotCliResolvedConfig) {
    this.id = `copilot-cli:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Copilot CLI request was aborted before execution');
    }

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Build command args
    const executable = this.resolveExecutable();
    const args = this.buildCliArgs(request);

    // Spawn the CLI process
    const agentProcess = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Track events
    const toolCallsInProgress = new Map<string, ToolCallInProgress>();
    const completedToolCalls: ToolCall[] = [];
    let finalContent = '';
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;

    // Set up ACP connection
    if (!agentProcess.stdin || !agentProcess.stdout) {
      throw new Error('Copilot CLI process missing stdin/stdout (stdio: pipe required)');
    }
    const input = Writable.toWeb(agentProcess.stdin);
    const output = Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    const client: acp.Client = {
      async requestPermission(): Promise<acp.RequestPermissionResponse> {
        // Auto-approve all permissions for autonomous execution
        return {
          outcome: { outcome: 'selected', optionId: 'allow' },
        };
      },
      async sessionUpdate(params: acp.SessionNotification): Promise<void> {
        const update = params.update;
        const sessionUpdate = update.sessionUpdate;

        logger?.handleEvent(sessionUpdate, update);

        if (sessionUpdate === 'tool_call') {
          const callId = update.toolCallId ?? randomUUID();
          // Track new or in-progress tool calls
          if (!update.status || update.status === 'pending' || update.status === 'in_progress') {
            toolCallsInProgress.set(callId, {
              tool: update.title ?? update.kind ?? 'unknown',
              input: update.rawInput,
              id: callId,
              startTime: new Date().toISOString(),
              startMs: Date.now(),
            });
          }
          // Tool call arrived already completed
          if (update.status === 'completed' || update.status === 'failed') {
            completedToolCalls.push({
              tool: update.title ?? update.kind ?? 'unknown',
              input: update.rawInput,
              output: update.rawOutput,
              id: callId,
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              durationMs: 0,
            });
          }
        }

        if (sessionUpdate === 'tool_call_update') {
          const callId = update.toolCallId;
          if (callId && (update.status === 'completed' || update.status === 'failed')) {
            const inProgress = toolCallsInProgress.get(callId);
            if (inProgress) {
              toolCallsInProgress.delete(callId);
              completedToolCalls.push({
                tool: inProgress.tool,
                input: inProgress.input,
                output: update.rawOutput,
                id: inProgress.id,
                startTime: inProgress.startTime,
                endTime: new Date().toISOString(),
                durationMs: Date.now() - inProgress.startMs,
              });
            }
          }
        }

        if (sessionUpdate === 'agent_message_chunk') {
          const content = update.content;
          if (content?.type === 'text' && typeof content.text === 'string') {
            finalContent += content.text;
          }
        }

        if (sessionUpdate === 'usage_update') {
          // UsageUpdate has { size, used, cost? } — cost has { amount, currency }
          if (update.cost && update.cost.currency === 'USD') {
            costUsd = update.cost.amount;
          }
          // Approximate token usage from context window info
          if (tokenUsage) {
            tokenUsage = { input: update.used, output: tokenUsage.output };
          } else {
            tokenUsage = { input: update.used, output: 0 };
          }
        }
      },
    };

    const connection = new acp.ClientSideConnection((_agent) => client, stream);

    try {
      // Initialize the ACP connection
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      });

      // Create a session
      const cwd = this.resolveCwd(request.cwd);
      const session = await connection.newSession({
        cwd: cwd ?? process.cwd(),
        mcpServers: [],
      });

      // Build the prompt
      const inputFiles = normalizeInputFiles(request.inputFiles);
      const prompt = buildPromptDocument(request, inputFiles);

      // Send and wait with timeout
      const sendPromise = connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });

      if (request.signal) {
        const abortHandler = () => {
          killProcess(agentProcess);
        };
        request.signal.addEventListener('abort', abortHandler, { once: true });
        try {
          await this.raceWithTimeout(sendPromise, agentProcess);
        } finally {
          request.signal.removeEventListener('abort', abortHandler);
        }
      } else {
        await this.raceWithTimeout(sendPromise, agentProcess);
      }

      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Build output messages
      const outputMessages: Message[] = [];

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
          executable,
          logFile: logger?.filePath,
        },
        output: outputMessages,
        tokenUsage,
        costUsd,
        durationMs,
        startTime,
        endTime,
      };
    } finally {
      await logger?.close();
      killProcess(agentProcess);
    }
  }

  private buildCliArgs(request: ProviderRequest): string[] {
    const args = ['--acp', '--stdio', '--allow-all-tools'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Skip forced diff prompt when AgentV captures file changes
    const systemPrompt =
      this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Append user-provided extra args
    if (this.config.args) {
      args.push(...this.config.args);
    }

    return args;
  }

  private async raceWithTimeout(
    sendPromise: Promise<unknown>,
    agentProcess: ChildProcess,
  ): Promise<void> {
    const timeoutMs = this.config.timeoutMs;
    if (!timeoutMs) {
      await sendPromise;
      return;
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        killProcess(agentProcess);
        reject(new Error(`Copilot CLI timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();
    });

    await Promise.race([sendPromise, timeoutPromise]);
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

  private resolveExecutable(): string {
    if (this.config.executable !== 'copilot') {
      return this.config.executable;
    }

    // Try to resolve the platform-specific native binary
    const nativePath = resolvePlatformCliPath();
    if (nativePath) {
      return nativePath;
    }

    return 'copilot';
  }

  private resolveLogDirectory(): string | undefined {
    const disabled = isCopilotCliLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'copilot-cli');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CopilotCliStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot CLI stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await CopilotCliStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordCopilotCliLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot CLI stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

function killProcess(proc: ChildProcess): void {
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

class CopilotCliStreamLogger {
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
  }): Promise<CopilotCliStreamLogger> {
    const logger = new CopilotCliStreamLogger(options.filePath, options.format);
    const header = [
      '# Copilot CLI (ACP) stream log',
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
    case 'agent_message_chunk': {
      const content = d.content as Record<string, unknown> | undefined;
      if (content?.type === 'text' && typeof content.text === 'string') {
        return `${content.text.slice(0, 200)}${content.text.length > 200 ? '...' : ''}`;
      }
      return 'message chunk';
    }
    case 'tool_call':
      return `${d.title ?? d.kind ?? 'unknown'} (${d.status ?? 'running'})`;
    case 'tool_call_update':
      return `${d.toolCallId ?? 'unknown'} ${d.status ?? 'updated'}`;
    case 'usage': {
      return `input=${d.inputTokens ?? 0} output=${d.outputTokens ?? 0}`;
    }
    default:
      return undefined;
  }
}

function isCopilotCliLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_COPILOT_CLI_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'copilot-cli');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'copilot-cli';
}

/**
 * Resolve the platform-specific native Copilot CLI binary from the @github/copilot
 * optional dependency.
 */
function resolvePlatformCliPath(): string | undefined {
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
    const resolved = import.meta.resolve(`${packageName}/package.json`);
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
