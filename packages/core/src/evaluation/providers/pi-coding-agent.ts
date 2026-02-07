import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { recordPiLogEntry } from './pi-log-tracker.js';
import { normalizeInputFiles } from './preread.js';
import type { PiCodingAgentResolvedConfig } from './targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ToolCall,
} from './types.js';

const WORKSPACE_PREFIX = 'agentv-pi-';
const PROMPT_FILENAME = 'prompt.md';

/**
 * Default system prompt for Pi Coding Agent evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

interface PiRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

interface PiRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

type PiRunner = (options: PiRunOptions) => Promise<PiRunResult>;

export class PiCodingAgentProvider implements Provider {
  readonly id: string;
  readonly kind = 'pi-coding-agent' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: PiCodingAgentResolvedConfig;
  private readonly runPi: PiRunner;

  constructor(
    targetName: string,
    config: PiCodingAgentResolvedConfig,
    runner: PiRunner = defaultPiRunner,
  ) {
    this.id = `pi-coding-agent:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runPi = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Pi coding agent request was aborted before execution');
    }

    const inputFiles = normalizeInputFiles(request.inputFiles);

    const workspaceRoot = await this.createWorkspace();
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      // Save prompt to file for debugging/logging
      const promptFile = path.join(workspaceRoot, PROMPT_FILENAME);
      await writeFile(promptFile, request.question, 'utf8');

      const args = this.buildPiArgs(request.question, inputFiles);
      const cwd = this.resolveCwd(workspaceRoot, request.cwd);

      const result = await this.executePi(args, cwd, request.signal, logger);

      if (result.timedOut) {
        throw new Error(
          `Pi coding agent timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Pi coding agent exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const parsed = parsePiJsonl(result.stdout);
      const outputMessages = extractOutputMessages(parsed);
      const assistantText = extractAssistantText(outputMessages);

      return {
        raw: {
          response: parsed,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          args,
          executable: this.config.executable,
          promptFile,
          workspace: workspaceRoot,
          inputFiles,
          logFile: logger?.filePath,
        },
        outputMessages,
      };
    } finally {
      await logger?.close();
      await this.cleanupWorkspace(workspaceRoot);
    }
  }

  private resolveCwd(workspaceRoot: string, cwdOverride?: string): string {
    // Request cwd override takes precedence (e.g., from workspace_template)
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (!this.config.cwd) {
      return workspaceRoot;
    }
    return path.resolve(this.config.cwd);
  }

  private buildPiArgs(prompt: string, inputFiles: readonly string[] | undefined): string[] {
    const args: string[] = [];

    // Provider and model configuration
    if (this.config.provider) {
      args.push('--provider', this.config.provider);
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.apiKey) {
      args.push('--api-key', this.config.apiKey);
    }

    // Output mode - always use JSON for structured output
    args.push('--mode', 'json');

    // Non-interactive mode
    args.push('--print');

    // No session storage for eval runs
    args.push('--no-session');

    // Tools configuration
    if (this.config.tools) {
      args.push('--tools', this.config.tools);
    }

    // Thinking level
    if (this.config.thinking) {
      args.push('--thinking', this.config.thinking);
    }

    // Custom args
    if (this.config.args && this.config.args.length > 0) {
      args.push(...this.config.args);
    }

    // Input files passed with @path syntax (pi-native file inclusion)
    if (inputFiles && inputFiles.length > 0) {
      for (const file of inputFiles) {
        args.push(`@${file}`);
      }
    }

    // Prepend system prompt (use default if not configured)
    const systemPrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    // Escape @ symbols in prompt that aren't file references
    // Pi CLI interprets @ as file prefix, but AgentV uses @[Role]: for multi-turn
    const escapedPrompt = escapeAtSymbols(fullPrompt);

    // Prompt is passed as the final argument
    args.push(escapedPrompt);

    return args;
  }

  private async executePi(
    args: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
    logger: PiStreamLogger | undefined,
  ): Promise<PiRunResult> {
    try {
      return await this.runPi({
        executable: this.config.executable,
        args,
        cwd,
        timeoutMs: this.config.timeoutMs,
        env: this.buildEnv(),
        signal,
        onStdoutChunk: logger ? (chunk) => logger.handleStdoutChunk(chunk) : undefined,
        onStderrChunk: logger ? (chunk) => logger.handleStderrChunk(chunk) : undefined,
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(
          `Pi coding agent executable '${this.config.executable}' was not found. Update the target settings.executable or add it to PATH.`,
        );
      }
      throw error;
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Map provider-specific API key to the correct env var
    if (this.config.apiKey) {
      const provider = this.config.provider?.toLowerCase() ?? 'google';
      switch (provider) {
        case 'google':
        case 'gemini':
          env.GEMINI_API_KEY = this.config.apiKey;
          break;
        case 'anthropic':
          env.ANTHROPIC_API_KEY = this.config.apiKey;
          break;
        case 'openai':
          env.OPENAI_API_KEY = this.config.apiKey;
          break;
        case 'groq':
          env.GROQ_API_KEY = this.config.apiKey;
          break;
        case 'xai':
          env.XAI_API_KEY = this.config.apiKey;
          break;
        case 'openrouter':
          env.OPENROUTER_API_KEY = this.config.apiKey;
          break;
      }
    }

    return env;
  }

  private async createWorkspace(): Promise<string> {
    return await mkdtemp(path.join(tmpdir(), WORKSPACE_PREFIX));
  }

  private async cleanupWorkspace(workspaceRoot: string): Promise<void> {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  private resolveLogDirectory(): string | undefined {
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'pi-coding-agent');
  }

  private async createStreamLogger(request: ProviderRequest): Promise<PiStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Pi stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await PiStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordPiLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Pi stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class PiStreamLogger {
  readonly filePath: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private stdoutBuffer = '';
  private stderrBuffer = '';
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
  }): Promise<PiStreamLogger> {
    const logger = new PiStreamLogger(options.filePath, options.format);
    const header = [
      '# Pi Coding Agent stream log',
      `# target: ${options.targetName}`,
      options.evalCaseId ? `# eval: ${options.evalCaseId}` : undefined,
      options.attempt !== undefined ? `# attempt: ${options.attempt + 1}` : undefined,
      `# started: ${new Date().toISOString()}`,
      '',
    ].filter((line): line is string => Boolean(line));
    logger.writeLines(header);
    return logger;
  }

  handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    this.flushBuffer('stdout');
  }

  handleStderrChunk(chunk: string): void {
    this.stderrBuffer += chunk;
    this.flushBuffer('stderr');
  }

  async close(): Promise<void> {
    this.flushBuffer('stdout');
    this.flushBuffer('stderr');
    this.flushRemainder();
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });
  }

  private writeLines(lines: readonly string[]): void {
    for (const line of lines) {
      this.stream.write(`${line}\n`);
    }
  }

  private flushBuffer(source: 'stdout' | 'stderr'): void {
    const buffer = source === 'stdout' ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    if (source === 'stdout') {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }
    for (const line of lines) {
      const formatted = this.formatLine(line, source);
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
  }

  private formatLine(rawLine: string, source: 'stdout' | 'stderr'): string | undefined {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const message =
      this.format === 'json' ? formatPiJsonLog(trimmed) : formatPiLogMessage(trimmed, source);
    return `[+${formatElapsed(this.startedAt)}] [${source}] ${message}`;
  }

  private flushRemainder(): void {
    const stdoutRemainder = this.stdoutBuffer.trim();
    if (stdoutRemainder.length > 0) {
      const formatted = this.formatLine(stdoutRemainder, 'stdout');
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
    const stderrRemainder = this.stderrBuffer.trim();
    if (stderrRemainder.length > 0) {
      const formatted = this.formatLine(stderrRemainder, 'stderr');
      if (formatted) {
        this.stream.write(formatted);
        this.stream.write('\n');
      }
    }
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'pi');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'pi';
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

function formatPiLogMessage(rawLine: string, source: 'stdout' | 'stderr'): string {
  const parsed = tryParseJsonValue(rawLine);
  if (parsed) {
    const summary = summarizePiEvent(parsed);
    if (summary) {
      return summary;
    }
  }
  if (source === 'stderr') {
    return `stderr: ${rawLine}`;
  }
  return rawLine;
}

function formatPiJsonLog(rawLine: string): string {
  const parsed = tryParseJsonValue(rawLine);
  if (!parsed) {
    return rawLine;
  }
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return rawLine;
  }
}

function summarizePiEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;

  if (!type) {
    return undefined;
  }

  // Handle specific event types
  switch (type) {
    case 'agent_start':
      return 'agent_start';
    case 'agent_end':
      return 'agent_end';
    case 'turn_start':
      return 'turn_start';
    case 'turn_end':
      return 'turn_end';
    case 'message_start':
    case 'message_end': {
      const message = record.message as Record<string, unknown> | undefined;
      const role = message?.role;
      return `${type}: ${role}`;
    }
    case 'message_update': {
      const event = record.assistantMessageEvent as Record<string, unknown> | undefined;
      const eventType = event?.type;
      if (eventType === 'text_delta') {
        const delta = event?.delta;
        if (typeof delta === 'string') {
          const preview = delta.length > 50 ? `${delta.slice(0, 50)}...` : delta;
          return `text_delta: ${preview}`;
        }
      }
      return `message_update: ${eventType}`;
    }
    default:
      return type;
  }
}

function tryParseJsonValue(rawLine: string): unknown | undefined {
  try {
    return JSON.parse(rawLine);
  } catch {
    return undefined;
  }
}

/**
 * Parse Pi coding agent JSONL output.
 * Returns an array of parsed JSON objects from each line.
 */
function parsePiJsonl(output: string): unknown[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error('Pi coding agent produced no output');
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Skip non-JSON lines (e.g., stderr mixed in)
    }
  }

  if (parsed.length === 0) {
    throw new Error('Pi coding agent produced no valid JSON output');
  }

  return parsed;
}

/**
 * Extract OutputMessage array from Pi JSONL events.
 * Looks for the agent_end event which contains the full message history.
 */
function extractOutputMessages(events: unknown[]): readonly OutputMessage[] {
  // Find the agent_end event which contains all messages
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type !== 'agent_end') {
      continue;
    }

    const messages = record.messages;
    if (!Array.isArray(messages)) {
      continue;
    }

    return messages.map(convertPiMessage).filter((m): m is OutputMessage => m !== undefined);
  }

  // Fallback: collect messages from turn_end events
  const outputMessages: OutputMessage[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type === 'turn_end') {
      const message = record.message;
      const converted = convertPiMessage(message);
      if (converted) {
        outputMessages.push(converted);
      }
    }
  }

  return outputMessages;
}

/**
 * Convert a Pi message to AgentV OutputMessage format.
 */
function convertPiMessage(message: unknown): OutputMessage | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const msg = message as Record<string, unknown>;
  const role = msg.role;
  if (typeof role !== 'string') {
    return undefined;
  }

  // Extract text content from Pi's content array format
  const content = extractTextContent(msg.content);

  // Extract tool calls if present
  const toolCalls = extractToolCalls(msg.content);

  // Extract timestamp
  const timestamp =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.timestamp === 'string'
        ? msg.timestamp
        : undefined;

  // Extract metadata (usage, model info, etc.)
  const metadata: Record<string, unknown> = {};
  if (msg.api) metadata.api = msg.api;
  if (msg.provider) metadata.provider = msg.provider;
  if (msg.model) metadata.model = msg.model;
  if (msg.usage) metadata.usage = msg.usage;
  if (msg.stopReason) metadata.stopReason = msg.stopReason;

  return {
    role,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    timestamp,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Extract text content from Pi's content array format.
 * Pi uses: content: [{ type: "text", text: "..." }, ...]
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
 * Extract tool calls from Pi's content array format.
 * Pi uses: content: [{ type: "tool_use", name: "...", input: {...} }, ...]
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
    // Also handle tool_result for output
    if (p.type === 'tool_result' && typeof p.tool_use_id === 'string') {
      // Find matching tool call and add output
      const existing = toolCalls.find((tc) => tc.id === p.tool_use_id);
      if (existing) {
        // Create new object with output added
        const idx = toolCalls.indexOf(existing);
        toolCalls[idx] = {
          ...existing,
          output: p.content,
        };
      }
    }
  }

  return toolCalls;
}

/**
 * Extract the final assistant text from output messages.
 */
function extractAssistantText(messages: readonly OutputMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content) {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      return JSON.stringify(msg.content);
    }
  }
  return '';
}

/**
 * Escape @ symbols in prompt text that pi CLI would interpret as file references.
 * Pi CLI uses @path syntax for file inclusion, but AgentV prompts use @[Role]: markers.
 * We replace @[ with [[ to avoid pi trying to read these as files.
 */
function escapeAtSymbols(prompt: string): string {
  // Replace @[Role]: patterns with [[Role]]: to avoid pi file interpretation
  // This handles @[System]:, @[User]:, @[Assistant]:, @[Tool]: etc.
  return prompt.replace(/@\[([^\]]+)\]:/g, '[[$1]]:');
}

function pickDetail(stderr: string, stdout: string): string | undefined {
  const errorText = stderr.trim();
  if (errorText.length > 0) {
    return errorText;
  }
  const stdoutText = stdout.trim();
  return stdoutText.length > 0 ? stdoutText : undefined;
}

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) {
    return '';
  }
  const seconds = Math.ceil(timeoutMs / 1000);
  return ` after ${seconds}s`;
}

async function defaultPiRunner(options: PiRunOptions): Promise<PiRunResult> {
  return await new Promise<PiRunResult>((resolve, reject) => {
    // Parse executable - may be "node /path/to/script.js" or just "pi"
    const parts = options.executable.split(/\s+/);
    const executable = parts[0];
    const executableArgs = parts.slice(1);
    const allArgs = [...executableArgs, ...options.args];

    const child = spawn(executable, allArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

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
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    // Close stdin immediately since prompt is passed as argument
    child.stdin.end();

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
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : -1,
        timedOut,
      });
    });
  });
}
