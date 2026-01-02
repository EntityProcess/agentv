import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JsonObject } from '../types.js';
import { recordClaudeCodeLogEntry } from './claude-code-log-tracker.js';
import { normalizeInputFiles } from './preread.js';
import type { ClaudeCodeResolvedConfig } from './targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ToolCall,
} from './types.js';

const WORKSPACE_PREFIX = 'agentv-claude-code-';
const PROMPT_FILENAME = 'prompt.md';

/**
 * Default system prompt for Claude Code CLI evaluations.
 * Ensures the agent returns code in its response rather than just writing files.
 */
const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

interface ClaudeCodeRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

interface ClaudeCodeRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

type ClaudeCodeRunner = (options: ClaudeCodeRunOptions) => Promise<ClaudeCodeRunResult>;

export class ClaudeCodeProvider implements Provider {
  readonly id: string;
  readonly kind = 'claude-code' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: ClaudeCodeResolvedConfig;
  private readonly runClaudeCode: ClaudeCodeRunner;

  constructor(
    targetName: string,
    config: ClaudeCodeResolvedConfig,
    runner: ClaudeCodeRunner = defaultClaudeCodeRunner,
  ) {
    this.id = `claude-code:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runClaudeCode = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Claude Code request was aborted before execution');
    }

    const inputFiles = normalizeInputFiles(request.inputFiles);

    const workspaceRoot = await this.createWorkspace();
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      // Save prompt to file for debugging/logging
      const promptFile = path.join(workspaceRoot, PROMPT_FILENAME);
      await writeFile(promptFile, request.question, 'utf8');

      const args = this.buildClaudeCodeArgs(request.question, inputFiles);
      const cwd = this.resolveCwd();

      const result = await this.executeClaudeCode(args, cwd, request.signal, logger);

      if (result.timedOut) {
        throw new Error(
          `Claude Code CLI timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Claude Code CLI exited with code ${result.exitCode}`;

        // Check for nested Claude Code session auth failure
        // When running AgentV inside a Claude Code session, the nested
        // claude process detects nesting and requires API key authentication
        if (isNestedClaudeCodeAuthError(result.stdout)) {
          throw new Error(
            `${prefix}: Claude Code detected a nested session and requires API key authentication. Set ANTHROPIC_API_KEY environment variable or run AgentV outside of a Claude Code session.`,
          );
        }

        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const parsed = parseClaudeCodeJsonl(result.stdout);
      const outputMessages = extractOutputMessages(parsed);
      const usage = extractUsage(parsed);

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
        usage,
      };
    } finally {
      await logger?.close();
      await this.cleanupWorkspace(workspaceRoot);
    }
  }

  private resolveCwd(): string {
    if (!this.config.cwd) {
      // Default to process.cwd() to preserve Claude Code OAuth/local credentials
      // Claude Code stores credentials per-project, so running from a temp dir breaks auth
      return process.cwd();
    }
    return path.resolve(this.config.cwd);
  }

  private buildClaudeCodeArgs(prompt: string, inputFiles: readonly string[] | undefined): string[] {
    const args: string[] = [];

    // Output mode - always use stream-json for structured output
    args.push('--output-format', 'stream-json');

    // Verbose mode for detailed output
    args.push('--verbose');

    // Non-interactive mode with prompt flag
    args.push('-p');

    // Model configuration
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Custom args
    if (this.config.args && this.config.args.length > 0) {
      args.push(...this.config.args);
    }

    // Prepend system prompt (use default if not configured)
    const systemPrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    // Add input files as context if present
    let finalPrompt = fullPrompt;
    if (inputFiles && inputFiles.length > 0) {
      const filesContext = inputFiles.map((f) => `[File: ${f}]`).join('\n');
      finalPrompt = `${fullPrompt}\n\n## Input Files\n${filesContext}`;
    }

    // Prompt is passed as the final argument
    args.push(finalPrompt);

    return args;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Remove Claude Code nesting detection env vars to allow proper auth
    // Note: When running inside a Claude Code session, nested Claude Code
    // instances may still use ANTHROPIC_API_KEY auth due to parent process detection
    env.CLAUDECODE = undefined;
    env.CLAUDE_CODE_ENTRYPOINT = undefined;
    return env;
  }

  private async executeClaudeCode(
    args: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
    logger: ClaudeCodeStreamLogger | undefined,
  ): Promise<ClaudeCodeRunResult> {
    try {
      return await this.runClaudeCode({
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
          `Claude Code executable '${this.config.executable}' was not found. Update the target settings.executable or add it to PATH.`,
        );
      }
      throw error;
    }
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
    const disabled = isClaudeCodeLogStreamingDisabled();
    if (disabled) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'claude-code');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<ClaudeCodeStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory();
    if (!logDir) {
      return undefined;
    }
    try {
      await mkdir(logDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Claude Code stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName));

    try {
      const logger = await ClaudeCodeStreamLogger.create({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
        format: this.config.logFormat ?? 'summary',
      });
      recordClaudeCodeLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Claude Code stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

class ClaudeCodeStreamLogger {
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
  }): Promise<ClaudeCodeStreamLogger> {
    const logger = new ClaudeCodeStreamLogger(options.filePath, options.format);
    const header = [
      '# Claude Code CLI stream log',
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
      this.format === 'json'
        ? formatClaudeCodeJsonLog(trimmed)
        : formatClaudeCodeLogMessage(trimmed, source);
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

function isClaudeCodeLogStreamingDisabled(): boolean {
  const envValue = process.env.AGENTV_CLAUDE_CODE_STREAM_LOGS;
  if (!envValue) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

function buildLogFilename(request: ProviderRequest, targetName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalId = sanitizeForFilename(request.evalCaseId ?? 'claude-code');
  const attemptSuffix = request.attempt !== undefined ? `_attempt-${request.attempt + 1}` : '';
  const target = sanitizeForFilename(targetName);
  return `${timestamp}_${target}_${evalId}${attemptSuffix}_${randomUUID().slice(0, 8)}.log`;
}

function sanitizeForFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_');
  return sanitized.length > 0 ? sanitized : 'claude-code';
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

function formatClaudeCodeLogMessage(rawLine: string, source: 'stdout' | 'stderr'): string {
  const parsed = tryParseJsonValue(rawLine);
  if (parsed) {
    const summary = summarizeClaudeCodeEvent(parsed);
    if (summary) {
      return summary;
    }
  }
  if (source === 'stderr') {
    return `stderr: ${rawLine}`;
  }
  return rawLine;
}

function formatClaudeCodeJsonLog(rawLine: string): string {
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

function summarizeClaudeCodeEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;

  if (!type) {
    return undefined;
  }

  // Handle specific Claude Code event types
  switch (type) {
    case 'system':
      return 'system: init';
    case 'assistant': {
      const message = record.message as Record<string, unknown> | undefined;
      if (message) {
        const content = message.content;
        if (Array.isArray(content) && content.length > 0) {
          const first = content[0] as Record<string, unknown> | undefined;
          if (first?.type === 'tool_use') {
            return `assistant: tool_use (${first.name})`;
          }
          if (first?.type === 'text') {
            const text = first.text;
            if (typeof text === 'string') {
              const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
              return `assistant: ${preview}`;
            }
          }
        }
      }
      return 'assistant';
    }
    case 'user': {
      const message = record.message as Record<string, unknown> | undefined;
      if (message) {
        const content = message.content;
        if (Array.isArray(content) && content.length > 0) {
          const first = content[0] as Record<string, unknown> | undefined;
          if (first?.type === 'tool_result') {
            return `user: tool_result (${first.tool_use_id})`;
          }
        }
      }
      return 'user';
    }
    case 'result': {
      const cost = record.cost_usd;
      const duration = record.duration_ms;
      if (typeof cost === 'number' && typeof duration === 'number') {
        return `result: $${cost.toFixed(4)}, ${Math.round(duration)}ms`;
      }
      return 'result';
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
 * Parse Claude Code JSONL output.
 * Returns an array of parsed JSON objects from each line.
 */
function parseClaudeCodeJsonl(output: string): unknown[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error('Claude Code CLI produced no output');
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
    throw new Error('Claude Code CLI produced no valid JSON output');
  }

  return parsed;
}

/**
 * Extract OutputMessage array from Claude Code JSONL events.
 * Claude Code emits messages with type: "assistant" and type: "user" (for tool results).
 */
function extractOutputMessages(events: unknown[]): readonly OutputMessage[] {
  const outputMessages: OutputMessage[] = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    const type = record.type;

    if (type === 'assistant' || type === 'user') {
      const message = record.message as Record<string, unknown> | undefined;
      if (message) {
        const converted = convertClaudeCodeMessage(message, type as string);
        if (converted) {
          outputMessages.push(converted);
        }
      }
    }
  }

  return outputMessages;
}

/**
 * Convert a Claude Code message to AgentV OutputMessage format.
 */
function convertClaudeCodeMessage(
  message: Record<string, unknown>,
  type: string,
): OutputMessage | undefined {
  const role = type === 'assistant' ? 'assistant' : 'user';
  const content = extractTextContent(message.content);
  const toolCalls = extractToolCalls(message.content);

  return {
    role,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Extract text content from Claude Code's content array format.
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
 * Extract tool calls from Claude Code's content array format.
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
    // Handle tool_result for output (from user messages)
    if (p.type === 'tool_result' && typeof p.tool_use_id === 'string') {
      toolCalls.push({
        tool: 'tool_result',
        output: p.content,
        id: p.tool_use_id,
      });
    }
  }

  return toolCalls;
}

/**
 * Extract usage metrics from Claude Code result event.
 */
function extractUsage(events: unknown[]): JsonObject | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type !== 'result') {
      continue;
    }

    const usage: Record<string, string | number | boolean | null> = {};
    if (typeof record.cost_usd === 'number') {
      usage.cost_usd = record.cost_usd;
    }
    if (typeof record.duration_ms === 'number') {
      usage.duration_ms = record.duration_ms;
    }
    if (typeof record.duration_api_ms === 'number') {
      usage.duration_api_ms = record.duration_api_ms;
    }
    if (typeof record.input_tokens === 'number') {
      usage.input_tokens = record.input_tokens;
    }
    if (typeof record.output_tokens === 'number') {
      usage.output_tokens = record.output_tokens;
    }
    if (typeof record.session_id === 'string') {
      usage.session_id = record.session_id;
    }

    return Object.keys(usage).length > 0 ? usage : undefined;
  }

  return undefined;
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

/**
 * Detect if the error is due to nested Claude Code session auth failure.
 * This happens when running AgentV inside a Claude Code session,
 * where the nested claude process detects nesting and requires API key auth.
 */
function isNestedClaudeCodeAuthError(stdout: string): boolean {
  try {
    // Look for the system init event with apiKeySource and authentication error
    const lines = stdout.split('\n');
    let hasApiKeySource = false;
    let hasAuthError = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        if (event.type === 'system' && event.apiKeySource === 'ANTHROPIC_API_KEY') {
          hasApiKeySource = true;
        }
        if (
          event.error === 'authentication_failed' ||
          (event.type === 'result' && event.is_error)
        ) {
          hasAuthError = true;
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    return hasApiKeySource && hasAuthError;
  } catch {
    return false;
  }
}

/**
 * Escape a string for safe use as a shell argument.
 * Uses single quotes and escapes any embedded single quotes.
 */
function escapeShellArg(arg: string): string {
  // Single quotes prevent all shell interpretation except for single quotes themselves
  // To include a single quote, we end the single-quoted string, add an escaped single quote, and restart
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function defaultClaudeCodeRunner(
  options: ClaudeCodeRunOptions,
): Promise<ClaudeCodeRunResult> {
  // Create temp files for stdout/stderr to allow fully detached process
  // This is necessary because piped stdio maintains a connection that
  // allows Claude Code to detect parent process nesting
  const tempId = randomUUID();
  const stdoutFile = path.join(tmpdir(), `agentv-cc-${tempId}-stdout`);
  const stderrFile = path.join(tmpdir(), `agentv-cc-${tempId}-stderr`);
  const exitFile = path.join(tmpdir(), `agentv-cc-${tempId}-exit`);
  const pidFile = path.join(tmpdir(), `agentv-cc-${tempId}-pid`);

  try {
    return await runClaudeCodeWithTempFiles(options, stdoutFile, stderrFile, exitFile, pidFile);
  } finally {
    // Cleanup temp files
    for (const file of [stdoutFile, stderrFile, exitFile, pidFile]) {
      try {
        await rm(file, { force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }
}

async function runClaudeCodeWithTempFiles(
  options: ClaudeCodeRunOptions,
  stdoutFile: string,
  stderrFile: string,
  exitFile: string,
  pidFile: string,
): Promise<ClaudeCodeRunResult> {
  // Parse executable - may be "node /path/to/script.js" or just "claude"
  const parts = options.executable.split(/\s+/);
  const executable = parts[0];
  const executableArgs = parts.slice(1);
  const allArgs = [...executableArgs, ...options.args];

  // Build command with proper escaping for shell execution
  // We use setsid to create a new session, breaking parent process detection
  // This is necessary because Claude Code detects nesting via process hierarchy
  // and falls back to API key auth when running inside another Claude Code session
  // Output is redirected to temp files to fully detach the process
  const escapedArgs = allArgs.map((arg) => escapeShellArg(arg));
  const fullCommand = [escapeShellArg(executable), ...escapedArgs].join(' ');

  // The bash script:
  // 1. Unsets CLAUDECODE env vars
  // 2. Writes the child PID to pidFile for potential kill
  // 3. Runs the command with output redirected to temp files
  // 4. Writes exit code to exitFile when done
  const bashScript = `
    unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null
    ${fullCommand} >${escapeShellArg(stdoutFile)} 2>${escapeShellArg(stderrFile)} &
    CHILD_PID=$!
    echo $CHILD_PID > ${escapeShellArg(pidFile)}
    wait $CHILD_PID
    echo $? > ${escapeShellArg(exitFile)}
  `;

  // Spawn detached process
  const child = spawn('setsid', ['bash', '-c', bashScript], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll for completion
  const pollInterval = 100; // ms
  const startTime = Date.now();
  let timedOut = false;
  let lastStdoutSize = 0;

  const readFileIfExists = async (filePath: string): Promise<string> => {
    try {
      const { readFile } = await import('node:fs/promises');
      return await readFile(filePath, 'utf8');
    } catch {
      return '';
    }
  };

  const fileExists = async (filePath: string): Promise<boolean> => {
    try {
      const { access } = await import('node:fs/promises');
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  };

  const killProcess = async (): Promise<void> => {
    try {
      const pid = await readFileIfExists(pidFile);
      if (pid.trim()) {
        process.kill(Number.parseInt(pid.trim(), 10), 'SIGTERM');
      }
    } catch {
      // Process may have already exited
    }
  };

  // Set up abort handler
  if (options.signal?.aborted) {
    await killProcess();
    return { stdout: '', stderr: 'Aborted', exitCode: -1, timedOut: false };
  }

  const abortHandler = (): void => {
    killProcess().catch(() => {});
  };
  options.signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    while (true) {
      // Check timeout
      if (options.timeoutMs && Date.now() - startTime > options.timeoutMs) {
        timedOut = true;
        await killProcess();
        break;
      }

      // Check abort
      if (options.signal?.aborted) {
        await killProcess();
        break;
      }

      // Stream stdout chunks to callback
      if (options.onStdoutChunk) {
        const currentStdout = await readFileIfExists(stdoutFile);
        if (currentStdout.length > lastStdoutSize) {
          options.onStdoutChunk(currentStdout.slice(lastStdoutSize));
          lastStdoutSize = currentStdout.length;
        }
      }

      // Check if process completed (exit file exists)
      if (await fileExists(exitFile)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Read final output
    const stdout = await readFileIfExists(stdoutFile);
    const stderr = await readFileIfExists(stderrFile);
    const exitCodeStr = await readFileIfExists(exitFile);
    const exitCode = exitCodeStr.trim() ? Number.parseInt(exitCodeStr.trim(), 10) : -1;

    // Send any remaining stdout
    if (options.onStdoutChunk && stdout.length > lastStdoutSize) {
      options.onStdoutChunk(stdout.slice(lastStdoutSize));
    }
    if (options.onStderrChunk && stderr) {
      options.onStderrChunk(stderr);
    }

    return { stdout, stderr, exitCode, timedOut };
  } finally {
    options.signal?.removeEventListener('abort', abortHandler);
  }
}
