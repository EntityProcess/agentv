import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Content } from '../content.js';
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

/**
 * Claude CLI provider that spawns `claude -p` as a subprocess.
 * Uses --output-format stream-json --include-partial-messages for structured output.
 * This is the default `claude` provider. Use `claude-sdk` for SDK-based invocation.
 */
export class ClaudeCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'claude-cli' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: ClaudeResolvedConfig;

  constructor(targetName: string, config: ClaudeResolvedConfig) {
    this.id = `claude-cli:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Claude CLI request was aborted before execution');
    }

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Build the prompt
    const inputFiles = normalizeInputFiles(request.inputFiles);
    const prompt = buildPromptDocument(request, inputFiles);

    const args = this.buildArgs();
    const cwd = this.resolveCwd(request.cwd);
    const env = sanitizeEnvForClaude(request.braintrustSpanIds);

    // Track state from stream events
    const completedToolCalls: ToolCall[] = [];
    const output: Message[] = [];
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;
    let durationMs: number | undefined;

    try {
      const result = await this.runClaude({
        args,
        cwd,
        prompt,
        env,
        signal: request.signal,
        onLine: (line) => {
          logger?.handleLine(line);
          const event = tryParseJson(line);
          if (!event) return;

          if (event.type === 'assistant') {
            const betaMessage = event.message;
            if (betaMessage && typeof betaMessage === 'object') {
              const msg = betaMessage as Record<string, unknown>;
              const content = msg.content;
              const structuredContent = toContentArray(content);
              const textContent = extractTextContent(content);
              const toolCalls = extractToolCalls(content);

              const outputMsg: Message = {
                role: 'assistant',
                content: structuredContent ?? textContent,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              };
              output.push(outputMsg);
              completedToolCalls.push(...toolCalls);

              // Stream callbacks for real-time observability
              if (request.streamCallbacks) {
                for (const tc of toolCalls) {
                  request.streamCallbacks.onToolCallEnd?.(
                    tc.tool,
                    tc.input,
                    tc.output,
                    tc.durationMs ?? 0,
                    tc.id,
                  );
                }
              }
            }
          }

          if (event.type === 'result') {
            const resultEvent = event as Record<string, unknown>;
            if (typeof resultEvent.total_cost_usd === 'number') {
              costUsd = resultEvent.total_cost_usd;
            }
            if (typeof resultEvent.duration_ms === 'number') {
              durationMs = resultEvent.duration_ms;
            }
            const usage = resultEvent.usage as Record<string, unknown> | undefined;
            if (usage) {
              const inputTokens =
                ((usage.input_tokens as number) ?? 0) +
                ((usage.cache_read_input_tokens as number) ?? 0) +
                ((usage.cache_creation_input_tokens as number) ?? 0);
              const outputTokens = (usage.output_tokens as number) ?? 0;
              const reasoningTokens = (usage.reasoning_tokens as number) ?? undefined;
              tokenUsage = {
                input: inputTokens,
                output: outputTokens,
                cached: (usage.cache_read_input_tokens as number) ?? undefined,
                reasoning: reasoningTokens,
              };

              // Stream callback for LLM usage
              request.streamCallbacks?.onLlmCallEnd?.(this.config.model ?? 'claude', tokenUsage);
            }
          }
        },
      });

      if (result.timedOut) {
        throw new Error(
          `Claude CLI timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        const prefix = `Claude CLI exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const endTime = new Date().toISOString();
      const totalDurationMs = durationMs ?? Date.now() - startMs;

      return {
        raw: {
          model: this.config.model,
          logFile: logger?.filePath,
          args,
          exitCode: result.exitCode,
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

  private buildArgs(): string[] {
    // --verbose is required when combining -p with --output-format stream-json
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.maxTurns !== undefined) {
      args.push('--max-turns', String(this.config.maxTurns));
    }

    return args;
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
    const disabled = isClaudeCliLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'claude-cli');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<ClaudeCliStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Claude CLI stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await ClaudeCliStreamLogger.create({
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
      console.warn(`Skipping Claude CLI stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }

  private async runClaude(options: {
    readonly args: string[];
    readonly cwd: string | undefined;
    readonly prompt: string;
    readonly env: Record<string, string | undefined>;
    readonly signal?: AbortSignal;
    readonly onLine: (line: string) => void;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const spawnOptions: Parameters<typeof spawn>[2] = {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: options.env as NodeJS.ProcessEnv,
      };
      if (options.cwd) {
        spawnOptions.cwd = options.cwd;
      }

      const child = spawn('claude', options.args, spawnOptions);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let stdoutBuffer = '';

      const onAbort = (): void => {
        child.kill('SIGTERM');
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      let timeoutHandle: NodeJS.Timeout | undefined;
      if (this.config.timeoutMs && this.config.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, this.config.timeoutMs);
        timeoutHandle.unref?.();
      }

      if (child.stdout) {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
          stdoutBuffer += chunk;
          // Process complete lines
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              options.onLine(trimmed);
            }
          }
        });
      }

      if (child.stderr) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
      }

      // Send prompt via stdin
      child.stdin?.end(options.prompt);

      const cleanup = (): void => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      child.on('error', (error) => {
        cleanup();
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `Claude CLI executable 'claude' was not found on PATH. Install claude-code or ensure it is in PATH.`,
            ),
          );
        } else {
          reject(error);
        }
      });

      child.on('close', (code) => {
        cleanup();
        // Flush remaining buffer
        if (stdoutBuffer.trim().length > 0) {
          options.onLine(stdoutBuffer.trim());
        }
        resolve({
          stdout,
          stderr,
          exitCode: typeof code === 'number' ? code : -1,
          timedOut,
        });
      });
    });
  }
}

class ClaudeCliStreamLogger {
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
  }): Promise<ClaudeCliStreamLogger> {
    const logger = new ClaudeCliStreamLogger(options.filePath, options.format);
    const header = [
      '# Claude CLI stream log',
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

  handleLine(line: string): void {
    const elapsed = formatElapsed(this.startedAt);
    const event = tryParseJson(line);

    if (this.format === 'json') {
      if (event) {
        this.stream.write(`${JSON.stringify({ time: elapsed, data: event })}\n`);
      } else {
        this.stream.write(`${JSON.stringify({ time: elapsed, raw: line })}\n`);
      }
    } else {
      if (event) {
        const summary = summarizeEvent(event);
        if (summary) {
          const type = typeof event.type === 'string' ? event.type : 'unknown';
          this.stream.write(`[+${elapsed}] [${type}] ${summary}\n`);
        }
      } else {
        this.stream.write(`[+${elapsed}] ${line}\n`);
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

function summarizeEvent(event: Record<string, unknown>): string | undefined {
  const type = event.type as string;
  switch (type) {
    case 'assistant': {
      const message = event.message as Record<string, unknown> | undefined;
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
      const message = event.message as Record<string, unknown> | undefined;
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
      const cost = event.total_cost_usd;
      const duration = event.duration_ms;
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

/**
 * Convert Claude's content array to Content[] preserving non-text blocks.
 * Returns undefined if content is a plain string or has only text blocks
 * (no benefit over the simpler string representation).
 */
function toContentArray(content: unknown): Content[] | undefined {
  if (!Array.isArray(content)) return undefined;

  let hasNonText = false;
  const blocks: Content[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;

    if (p.type === 'text' && typeof p.text === 'string') {
      blocks.push({ type: 'text', text: p.text });
    } else if (p.type === 'image' && typeof p.source === 'object' && p.source !== null) {
      const src = p.source as Record<string, unknown>;
      const mediaType =
        typeof p.media_type === 'string'
          ? p.media_type
          : typeof src.media_type === 'string'
            ? src.media_type
            : 'application/octet-stream';
      const data =
        typeof src.data === 'string'
          ? `data:${mediaType};base64,${src.data}`
          : typeof p.url === 'string'
            ? (p.url as string)
            : '';
      blocks.push({ type: 'image', media_type: mediaType, source: data });
      hasNonText = true;
    } else if (p.type === 'tool_use') {
      // tool_use blocks are handled separately as ToolCall — skip
    } else if (p.type === 'tool_result') {
      // tool_result blocks are not user content — skip
    }
  }

  return hasNonText && blocks.length > 0 ? blocks : undefined;
}

/**
 * Extract text content from Claude's content array format.
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

/**
 * Build a sanitized process.env without variables that block nested Claude sessions.
 * Removes CLAUDECODE so the spawned CLI doesn't refuse to run inside another session.
 */
function sanitizeEnvForClaude(braintrustSpanIds?: {
  readonly parentSpanId: string;
  readonly rootSpanId: string;
}): Record<string, string | undefined> {
  const env = { ...process.env };
  // Remove all Claude Code session markers to allow nested sessions
  env.CLAUDECODE = undefined;
  env.CLAUDE_CODE_ENTRYPOINT = undefined;
  // Inject Braintrust trace IDs so the trace-claude-code plugin can attach
  // Claude Code session traces to the AgentV eval span
  if (braintrustSpanIds) {
    env.CC_PARENT_SPAN_ID = braintrustSpanIds.parentSpanId;
    env.CC_ROOT_SPAN_ID = braintrustSpanIds.rootSpanId;
  }
  return env;
}

function isClaudeCliLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CLAUDE_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'claude-cli');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'claude-cli';
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

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) {
    return '';
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}

function tryParseJson(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
