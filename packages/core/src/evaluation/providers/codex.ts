import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { recordCodexLogEntry } from './codex-log-tracker.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CodexResolvedConfig } from './targets.js';
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
let codexSdkModule: any = null;

async function loadCodexSdk(): Promise<typeof import('@openai/codex-sdk')> {
  if (!codexSdkModule) {
    try {
      codexSdkModule = await import('@openai/codex-sdk');
    } catch (error) {
      throw new Error(
        `Failed to load @openai/codex-sdk. Please install it:\n  npm install @openai/codex-sdk\n\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return codexSdkModule;
}

/**
 * Default system prompt for Codex SDK evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

/**
 * Codex SDK provider using the @openai/codex-sdk library directly.
 * This provides typed event access for structured tool calls, token usage, and clean thread lifecycle.
 *
 * Note: The SDK is loaded lazily on first use to avoid bundling issues.
 * Users must install @openai/codex-sdk separately.
 */
export class CodexProvider implements Provider {
  readonly id: string;
  readonly kind = 'codex' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CodexResolvedConfig;

  constructor(targetName: string, config: CodexResolvedConfig) {
    this.id = `codex:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Codex SDK request was aborted before execution');
    }

    const sdk = await loadCodexSdk();

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Build Codex SDK options
    // biome-ignore lint/suspicious/noExplicitAny: SDK constructor options are dynamic
    const codexOptions: any = {};
    if (this.config.model) {
      codexOptions.config = { model: this.config.model };
    }

    const codex = new sdk.Codex(codexOptions);

    // Build thread options
    // biome-ignore lint/suspicious/noExplicitAny: SDK thread options are dynamic
    const threadOptions: any = {
      skipGitRepoCheck: true,
    };

    const cwd = this.resolveCwd(request.cwd);
    if (cwd) {
      threadOptions.workingDirectory = cwd;
    }

    const thread = codex.startThread(threadOptions);

    // Build the prompt
    const inputFiles = normalizeInputFiles(request.inputFiles);
    const basePrompt = buildPromptDocument(request, inputFiles);

    // Skip forced diff prompt when AgentV captures file changes
    const systemPrompt =
      this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);
    const prompt = systemPrompt ? `${systemPrompt}\n\n${basePrompt}` : basePrompt;

    // Track events
    const completedToolCalls: ToolCall[] = [];
    let finalContent = '';
    let tokenUsage: ProviderTokenUsage | undefined;

    try {
      const timeoutMs = this.config.timeoutMs;

      // Run with streaming to capture events
      const runPromise = this.runStreamedWithEvents(
        thread,
        prompt,
        completedToolCalls,
        logger,
        (content) => {
          finalContent = content;
        },
        (usage) => {
          tokenUsage = usage;
        },
        request.signal,
      );

      if (timeoutMs) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Codex SDK timed out after ${Math.ceil(timeoutMs / 1000)}s`));
          }, timeoutMs);
          timer.unref?.();
        });
        await Promise.race([runPromise, timeoutPromise]);
      } else {
        await runPromise;
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
          logFile: logger?.filePath,
        },
        outputMessages,
        tokenUsage,
        durationMs,
        startTime,
        endTime,
      };
    } finally {
      await logger?.close();
    }
  }

  private async runStreamedWithEvents(
    // biome-ignore lint/suspicious/noExplicitAny: SDK thread type is dynamically loaded
    thread: any,
    prompt: string,
    completedToolCalls: ToolCall[],
    logger: CodexSdkStreamLogger | undefined,
    onContent: (content: string) => void,
    onUsage: (usage: ProviderTokenUsage) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: SDK types are dynamic
    const turnOptions: any = {};
    if (signal) {
      turnOptions.signal = signal;
    }

    const { events } = await thread.runStreamed(prompt, turnOptions);

    for await (const event of events) {
      const eventType = event.type as string;

      logger?.handleEvent(eventType, event);

      if (eventType === 'item.completed') {
        // biome-ignore lint/suspicious/noExplicitAny: SDK event item is dynamic
        const item = (event as any).item;
        if (item) {
          this.processCompletedItem(item, completedToolCalls, onContent);
        }
      }

      if (eventType === 'turn.completed') {
        // biome-ignore lint/suspicious/noExplicitAny: SDK event usage is dynamic
        const usage = (event as any).usage;
        if (usage) {
          onUsage({
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            cached: usage.cached_input_tokens ?? undefined,
          });
        }
      }

      if (eventType === 'turn.failed') {
        // biome-ignore lint/suspicious/noExplicitAny: SDK event error is dynamic
        const error = (event as any).error;
        throw new Error(`Codex SDK turn failed: ${error?.message ?? 'unknown error'}`);
      }
    }
  }

  private processCompletedItem(
    // biome-ignore lint/suspicious/noExplicitAny: SDK item type is dynamic
    item: any,
    completedToolCalls: ToolCall[],
    onContent: (content: string) => void,
  ): void {
    const itemType = item.type as string;

    if (itemType === 'agent_message') {
      const text = item.text;
      if (typeof text === 'string') {
        onContent(text);
      }
    }

    if (itemType === 'command_execution') {
      completedToolCalls.push({
        tool: 'command_execution',
        input: item.command,
        output: item.aggregated_output,
        id: item.id,
      });
    }

    if (itemType === 'file_change') {
      completedToolCalls.push({
        tool: 'file_change',
        input: item.changes,
        id: item.id,
      });
    }

    if (itemType === 'mcp_tool_call') {
      completedToolCalls.push({
        tool: `mcp:${item.server}/${item.tool}`,
        input: item.arguments,
        output: item.result ?? item.error,
        id: item.id,
      });
    }
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
    const disabled = isCodexLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'codex');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CodexSdkStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Codex SDK stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await CodexSdkStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordCodexLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Codex SDK stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class CodexSdkStreamLogger {
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
  }): Promise<CodexSdkStreamLogger> {
    const logger = new CodexSdkStreamLogger(options.filePath, options.format);
    const header = [
      '# Codex SDK stream log',
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
  // biome-ignore lint/suspicious/noExplicitAny: SDK event item is dynamic
  const item = (d as any).item;
  switch (eventType) {
    case 'item.completed':
    case 'item.started':
    case 'item.updated': {
      if (!item || typeof item !== 'object') return eventType;
      const itemType = item.type as string;
      if (itemType === 'agent_message') {
        const text = typeof item.text === 'string' ? item.text : '';
        return `${itemType}: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`;
      }
      if (itemType === 'command_execution') {
        return `${itemType}: ${item.command ?? 'unknown'}`;
      }
      if (itemType === 'file_change') {
        return `${itemType}: ${Array.isArray(item.changes) ? item.changes.length : 0} files`;
      }
      if (itemType === 'mcp_tool_call') {
        return `${itemType}: ${item.server}/${item.tool}`;
      }
      return itemType;
    }
    case 'turn.completed': {
      // biome-ignore lint/suspicious/noExplicitAny: SDK event usage is dynamic
      const usage = (d as any).usage;
      if (usage) {
        return `input=${usage.input_tokens ?? 0} output=${usage.output_tokens ?? 0}`;
      }
      return 'completed';
    }
    case 'turn.failed': {
      // biome-ignore lint/suspicious/noExplicitAny: SDK event error is dynamic
      const error = (d as any).error;
      return typeof error?.message === 'string' ? error.message : 'failed';
    }
    default:
      return undefined;
  }
}

function isCodexLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CODEX_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'codex');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'codex';
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
