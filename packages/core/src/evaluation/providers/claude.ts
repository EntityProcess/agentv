import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { recordClaudeLogEntry } from './claude-log-tracker.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { ClaudeResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

// Lazy-loaded module to avoid bundling issues with dynamic requires
// biome-ignore lint/suspicious/noExplicitAny: dynamic import type
let claudeSdkModule: any = null;

async function loadClaudeSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!claudeSdkModule) {
    try {
      claudeSdkModule = await import('@anthropic-ai/claude-agent-sdk');
    } catch (error) {
      throw new Error(
        `Failed to load @anthropic-ai/claude-agent-sdk. Please install it:\n  npm install @anthropic-ai/claude-agent-sdk\n\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return claudeSdkModule;
}

/**
 * Default system prompt for Claude SDK evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

/**
 * Claude Agent SDK provider using the @anthropic-ai/claude-agent-sdk library directly.
 * This replaces the old CLI subprocess provider with typed SDK access for structured
 * tool calls, token usage, and clean session lifecycle.
 *
 * Note: The SDK is loaded lazily on first use to avoid bundling issues.
 * Users must install @anthropic-ai/claude-agent-sdk separately.
 */
export class ClaudeProvider implements Provider {
  readonly id: string;
  readonly kind = 'claude' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: ClaudeResolvedConfig;

  constructor(targetName: string, config: ClaudeResolvedConfig) {
    this.id = `claude:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Claude SDK request was aborted before execution');
    }

    const sdk = await loadClaudeSdk();

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Build the prompt
    const inputFiles = normalizeInputFiles(request.inputFiles);
    const prompt = buildPromptDocument(request, inputFiles);

    // Skip forced diff prompt when AgentV captures file changes
    const systemPrompt =
      this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);

    // Build query options
    // biome-ignore lint/suspicious/noExplicitAny: SDK options type is dynamically loaded
    const queryOptions: any = {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    if (this.config.model) {
      queryOptions.model = this.config.model;
    }

    const cwd = this.resolveCwd(request.cwd);
    if (cwd) {
      queryOptions.cwd = cwd;
    }

    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    if (this.config.maxTurns !== undefined) {
      queryOptions.maxTurns = this.config.maxTurns;
    }

    if (this.config.maxBudgetUsd !== undefined) {
      queryOptions.maxBudgetUsd = this.config.maxBudgetUsd;
    }

    if (request.signal) {
      queryOptions.abortController = { signal: request.signal } as AbortController;
    }

    // Track state from messages
    const completedToolCalls: ToolCall[] = [];
    const output: Message[] = [];
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;
    let durationMs: number | undefined;

    try {
      const q = sdk.query({ prompt, options: queryOptions });

      // Set up timeout if configured
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      if (this.config.timeoutMs) {
        timeoutTimer = setTimeout(() => {
          q.return(undefined as never).catch(() => {});
        }, this.config.timeoutMs);
        timeoutTimer.unref?.();
      }

      try {
        for await (const message of q) {
          logger?.handleMessage(message);

          if (message.type === 'assistant') {
            const betaMessage = (message as { message?: unknown }).message;
            if (betaMessage && typeof betaMessage === 'object') {
              const msg = betaMessage as Record<string, unknown>;
              const content = msg.content;
              const textContent = extractTextContent(content);
              const toolCalls = extractToolCalls(content);

              const outputMsg: Message = {
                role: 'assistant',
                content: textContent,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              };
              output.push(outputMsg);
              completedToolCalls.push(...toolCalls);
            }
          }

          if (message.type === 'result') {
            const result = message as Record<string, unknown>;
            if (typeof result.total_cost_usd === 'number') {
              costUsd = result.total_cost_usd;
            }
            if (typeof result.duration_ms === 'number') {
              durationMs = result.duration_ms;
            }
            const usage = result.usage as Record<string, unknown> | undefined;
            if (usage) {
              const inputTokens =
                ((usage.input_tokens as number) ?? 0) +
                ((usage.cache_read_input_tokens as number) ?? 0) +
                ((usage.cache_creation_input_tokens as number) ?? 0);
              const outputTokens = (usage.output_tokens as number) ?? 0;
              tokenUsage = {
                input: inputTokens,
                output: outputTokens,
                cached: (usage.cache_read_input_tokens as number) ?? undefined,
              };
            }
          }
        }
      } finally {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
      }

      const endTime = new Date().toISOString();
      const totalDurationMs = durationMs ?? Date.now() - startMs;

      return {
        raw: {
          model: this.config.model,
          logFile: logger?.filePath,
        },
        output,
        tokenUsage,
        costUsd,
        durationMs: totalDurationMs,
        startTime,
        endTime,
      };
    } finally {
      await logger?.close();
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
    const disabled = isClaudeLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'claude');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<ClaudeStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Claude stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await ClaudeStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordClaudeLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Claude stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

/**
 * Extract text content from Claude's content array format.
 * Claude uses: content: [{ type: "text", text: "..." }, ...]
 */
function extractTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      textParts.push(p.text);
    }
  }
  return textParts.length > 0 ? textParts.join('\n') : undefined;
}

/**
 * Extract tool calls from Claude's content array format.
 * Claude uses: content: [{ type: "tool_use", name: "...", input: {...}, id: "..." }, ...]
 */
function extractToolCalls(content: unknown): readonly ToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const toolCalls: ToolCall[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type === 'tool_use' && typeof p.name === 'string') {
      toolCalls.push({
        tool: p.name,
        input: p.input,
        id: typeof p.id === 'string' ? p.id : undefined,
      });
    }
  }
  return toolCalls;
}

class ClaudeStreamLogger {
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
  }): Promise<ClaudeStreamLogger> {
    const logger = new ClaudeStreamLogger(options.filePath, options.format);
    const header = [
      '# Claude SDK stream log',
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

  handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const elapsed = formatElapsed(this.startedAt);
    const msg = message as Record<string, unknown>;
    const type = typeof msg.type === 'string' ? msg.type : 'unknown';

    if (this.format === 'json') {
      this.stream.write(`${JSON.stringify({ time: elapsed, type, data: message })}\n`);
    } else {
      const summary = summarizeMessage(msg);
      if (summary) {
        this.stream.write(`[+${elapsed}] [${type}] ${summary}\n`);
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

function summarizeMessage(msg: Record<string, unknown>): string | undefined {
  const type = msg.type as string;
  switch (type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined;
      if (message) {
        const content = message.content;
        if (Array.isArray(content) && content.length > 0) {
          const first = content[0] as Record<string, unknown> | undefined;
          if (first?.type === 'tool_use') {
            return `tool_use (${first.name})`;
          }
          if (first?.type === 'text') {
            const text = first.text;
            if (typeof text === 'string') {
              const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
              return preview;
            }
          }
        }
      }
      return 'message';
    }
    case 'user': {
      const message = msg.message as Record<string, unknown> | undefined;
      if (message) {
        const content = message.content;
        if (Array.isArray(content) && content.length > 0) {
          const first = content[0] as Record<string, unknown> | undefined;
          if (first?.type === 'tool_result') {
            return `tool_result (${first.tool_use_id})`;
          }
        }
      }
      return 'user';
    }
    case 'result': {
      const cost = msg.total_cost_usd;
      const duration = msg.duration_ms;
      if (typeof cost === 'number' && typeof duration === 'number') {
        return `$${cost.toFixed(4)}, ${Math.round(duration)}ms`;
      }
      return 'result';
    }
    case 'system':
      return 'init';
    default:
      return undefined;
  }
}

function isClaudeLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CLAUDE_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'claude');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'claude';
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
