/**
 * Pi CLI provider — shells out to the `pi` binary as a subprocess.
 *
 * Use this when you have the Pi CLI installed globally or want to point to
 * a specific binary via the `executable` config field (defaults to `pi` on PATH).
 * Output is captured as JSONL from stdout and parsed into AgentV messages.
 *
 * For the SDK-based approach (no subprocess), use the `pi-coding-agent` provider instead.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, createWriteStream, readFileSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { recordPiLogEntry } from './pi-log-tracker.js';
import {
  extractAzureResourceName,
  resolveCliProvider,
  resolveEnvKeyName,
} from './pi-provider-aliases.js';
import { extractPiTextContent, toFiniteNumber } from './pi-utils.js';
import { normalizeInputFiles } from './preread.js';
import type { PiCliResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

const WORKSPACE_PREFIX = 'agentv-pi-';
const PROMPT_FILENAME = 'prompt.md';

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

export class PiCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'pi-cli' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: PiCliResolvedConfig;
  private readonly runPi: PiRunner;

  constructor(targetName: string, config: PiCliResolvedConfig, runner: PiRunner = defaultPiRunner) {
    this.id = `pi-cli:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runPi = runner;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Pi CLI request was aborted before execution');
    }

    const inputFiles = normalizeInputFiles(request.inputFiles);

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    // Use eval-materialized workspace (request.cwd) when available, consistent with copilot-cli.
    // Only create a temp workspace when no cwd is provided.
    const hasExternalCwd = !!(request.cwd || this.config.cwd);
    const workspaceRoot = hasExternalCwd ? undefined : await this.createWorkspace();
    const cwd = this.resolveCwd(workspaceRoot, request.cwd);
    const logger = await this.createStreamLogger(request).catch(() => undefined);
    try {
      // Save prompt to file for debugging/logging
      const promptFile = path.join(cwd, PROMPT_FILENAME);
      await writeFile(promptFile, request.question, 'utf8');

      const args = this.buildPiArgs(request.question, inputFiles);

      const result = await this.executePi(args, cwd, request.signal, logger);

      if (result.timedOut) {
        throw new Error(
          `Pi CLI timed out${formatTimeoutSuffix(this.config.timeoutMs ?? undefined)}`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickDetail(result.stderr, result.stdout);
        const prefix = `Pi CLI exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const parsed = parsePiJsonl(result.stdout);
      const output = extractMessages(parsed);
      const tokenUsage = extractTokenUsage(parsed);

      // Emit stream callbacks for OTEL trace export (post-hoc from parsed output)
      if (request.streamCallbacks) {
        for (const msg of output) {
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
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
        request.streamCallbacks.onLlmCallEnd?.(this.config.model ?? 'pi', tokenUsage);
      }

      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      return {
        raw: {
          response: parsed,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          args,
          executable: this.config.executable,
          promptFile,
          workspace: workspaceRoot ?? cwd,
          inputFiles,
          logFile: logger?.filePath,
        },
        output,
        tokenUsage,
        durationMs,
        startTime,
        endTime,
      };
    } finally {
      await logger?.close();
      if (workspaceRoot) {
        await this.cleanupWorkspace(workspaceRoot);
      }
    }
  }

  private resolveCwd(workspaceRoot: string | undefined, cwdOverride?: string): string {
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (this.config.cwd) {
      return path.resolve(this.config.cwd);
    }
    if (workspaceRoot) {
      return workspaceRoot;
    }
    return process.cwd();
  }

  private buildPiArgs(prompt: string, inputFiles: readonly string[] | undefined): string[] {
    const args: string[] = [];

    if (this.config.subprovider) {
      args.push('--provider', resolveCliProvider(this.config.subprovider));
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.apiKey) {
      args.push('--api-key', this.config.apiKey);
    }

    args.push('--mode', 'json');
    args.push('--print');
    args.push('--no-session');

    if (this.config.tools) {
      args.push('--tools', this.config.tools);
    }
    if (this.config.thinking) {
      args.push('--thinking', this.config.thinking);
    }
    if (this.config.args && this.config.args.length > 0) {
      args.push(...this.config.args);
    }

    if (inputFiles && inputFiles.length > 0) {
      for (const file of inputFiles) {
        args.push(`@${file}`);
      }
    }

    const systemPrompt = this.config.systemPrompt;
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const escapedPrompt = escapeAtSymbols(fullPrompt);
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
          `Pi CLI executable '${this.config.executable}' was not found. Update the target executable or add it to PATH.`,
        );
      }
      throw error;
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    const provider = this.config.subprovider?.toLowerCase() ?? 'google';

    if (provider === 'azure') {
      // Pi CLI uses azure-openai-responses with AZURE_OPENAI_RESOURCE_NAME.
      // Extract the resource name from base_url (or use it as-is if already a name).
      if (this.config.apiKey) {
        env.AZURE_OPENAI_API_KEY = this.config.apiKey;
      }
      if (this.config.baseUrl) {
        env.AZURE_OPENAI_RESOURCE_NAME = extractAzureResourceName(this.config.baseUrl);
      }
    } else {
      if (this.config.apiKey) {
        const envKey = resolveEnvKeyName(provider);
        if (envKey) {
          env[envKey] = this.config.apiKey;
        }
      }
    }

    // When a subprovider is explicitly configured, remove ambient env vars from
    // other providers that pi-cli auto-detects (e.g., AZURE_OPENAI_* vars override
    // --provider flags). This ensures the configured subprovider is actually used.
    //
    // To add a new provider: add an entry to PROVIDER_OWN_PREFIXES with the env
    // var prefixes that provider uses. All other providers' vars are stripped
    // automatically when that provider is selected.
    if (this.config.subprovider) {
      const resolvedProvider = resolveCliProvider(this.config.subprovider);
      const PROVIDER_OWN_PREFIXES: Record<string, readonly string[]> = {
        openrouter: ['OPENROUTER_'],
        anthropic: ['ANTHROPIC_'],
        openai: ['OPENAI_'],
        'azure-openai-responses': ['AZURE_OPENAI_'],
        google: ['GEMINI_', 'GOOGLE_GENERATIVE_AI_'],
        gemini: ['GEMINI_', 'GOOGLE_GENERATIVE_AI_'],
        groq: ['GROQ_'],
        xai: ['XAI_'],
      };
      const ownPrefixes = PROVIDER_OWN_PREFIXES[resolvedProvider] ?? [];
      const allOtherPrefixes = Object.entries(PROVIDER_OWN_PREFIXES)
        .filter(([key]) => key !== provider)
        .flatMap(([, prefixes]) => prefixes);
      for (const key of Object.keys(env)) {
        if (
          allOtherPrefixes.some((prefix) => key.startsWith(prefix)) &&
          !ownPrefixes.some((prefix) => key.startsWith(prefix))
        ) {
          delete env[key];
        }
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
    return path.join(process.cwd(), '.agentv', 'logs', 'pi-cli');
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
      '# Pi CLI stream log',
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
      const evt = record.assistantMessageEvent as Record<string, unknown> | undefined;
      const eventType = evt?.type;
      if (eventType === 'text_delta') {
        const delta = evt?.delta;
        if (typeof delta === 'string') {
          const preview = delta.length > 50 ? `${delta.slice(0, 50)}...` : delta;
          return `text_delta: ${preview}`;
        }
      }
      return `message_update: ${eventType}`;
    }
    case 'tool_execution_start':
      return `tool_start: ${record.toolName}`;
    case 'tool_execution_end':
      return `tool_end: ${record.toolName}`;
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

function parsePiJsonl(output: string): unknown[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error('Pi CLI produced no output');
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
      // Skip non-JSON lines
    }
  }

  if (parsed.length === 0) {
    throw new Error('Pi CLI produced no valid JSON output');
  }

  return parsed;
}

function extractMessages(events: unknown[]): readonly Message[] {
  let messages: Message[] | undefined;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== 'object') continue;
    const record = event as Record<string, unknown>;
    if (record.type !== 'agent_end') continue;

    const msgs = record.messages;
    if (!Array.isArray(msgs)) continue;

    messages = msgs.map(convertPiMessage).filter((m): m is Message => m !== undefined);
    break;
  }

  if (!messages) {
    messages = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const record = event as Record<string, unknown>;
      if (record.type === 'turn_end') {
        const converted = convertPiMessage(record.message);
        if (converted) messages.push(converted);
      }
    }
  }

  // Pi CLI may emit tool_execution_start/tool_execution_end events whose tool
  // calls are absent from the final agent_end messages. Reconstruct them and
  // inject into the last assistant message so evaluators (e.g. skill-trigger)
  // can detect them.
  const eventToolCalls = extractToolCallsFromEvents(events);
  if (eventToolCalls.length > 0) {
    injectEventToolCalls(messages, eventToolCalls);
  }

  return messages;
}

/**
 * Scan JSONL events for tool_execution_start / tool_execution_end pairs and
 * reconstruct ToolCall objects from them.
 */
function extractToolCallsFromEvents(events: unknown[]): ToolCall[] {
  const starts = new Map<string, { tool: string; input: unknown }>();
  const results = new Map<string, unknown>();

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const r = event as Record<string, unknown>;
    const type = r.type;
    if (type === 'tool_execution_start' && typeof r.toolName === 'string') {
      const id = typeof r.toolCallId === 'string' ? r.toolCallId : undefined;
      starts.set(id ?? `anon-${starts.size}`, { tool: r.toolName, input: r.args });
    } else if (type === 'tool_execution_end') {
      const id = typeof r.toolCallId === 'string' ? r.toolCallId : undefined;
      if (id) results.set(id, r.result);
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const [id, { tool, input }] of starts) {
    toolCalls.push({
      tool,
      input: input as Record<string, unknown> | undefined,
      id: id.startsWith('anon-') ? undefined : id,
      output: results.get(id),
    });
  }
  return toolCalls;
}

/**
 * Merge event-sourced tool calls into messages. For each tool call, if it
 * already exists (by id) in some message, skip it. Otherwise, append it to
 * the last assistant message (creating one if needed).
 */
function injectEventToolCalls(messages: Message[], eventToolCalls: ToolCall[]): void {
  const existingIds = new Set<string>();
  const existingTools = new Set<string>();
  for (const msg of messages) {
    if (!msg.toolCalls) continue;
    for (const tc of msg.toolCalls) {
      if (tc.id) existingIds.add(tc.id);
      // Track tool+input combos to avoid duplicates when there's no id
      existingTools.add(`${tc.tool}:${JSON.stringify(tc.input)}`);
    }
  }

  const missing = eventToolCalls.filter((tc) => {
    if (tc.id && existingIds.has(tc.id)) return false;
    if (existingTools.has(`${tc.tool}:${JSON.stringify(tc.input)}`)) return false;
    return true;
  });

  if (missing.length === 0) return;

  // Find the last assistant message and replace it with an enriched copy
  let targetIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx >= 0) {
    const target = messages[targetIdx];
    messages[targetIdx] = { ...target, toolCalls: [...(target.toolCalls ?? []), ...missing] };
  } else {
    // No assistant message — create a synthetic one
    messages.push({ role: 'assistant', content: '', toolCalls: missing });
  }
}

function extractTokenUsage(events: unknown[]): ProviderTokenUsage | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== 'object') continue;
    const record = event as Record<string, unknown>;
    if (record.type !== 'agent_end') continue;

    const usage = record.usage;
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      const input = toFiniteNumber(u.input_tokens ?? u.inputTokens ?? u.input);
      const output = toFiniteNumber(u.output_tokens ?? u.outputTokens ?? u.output);
      if (input !== undefined || output !== undefined) {
        const result: ProviderTokenUsage = { input: input ?? 0, output: output ?? 0 };
        const cached = toFiniteNumber(u.cache_read_input_tokens ?? u.cached ?? u.cachedTokens);
        const reasoning = toFiniteNumber(u.reasoning_tokens ?? u.reasoningTokens ?? u.reasoning);
        return {
          ...result,
          ...(cached !== undefined ? { cached } : {}),
          ...(reasoning !== undefined ? { reasoning } : {}),
        };
      }
    }

    const messages = record.messages;
    if (Array.isArray(messages)) {
      return aggregateUsageFromMessages(messages);
    }
  }

  return undefined;
}

function aggregateUsageFromMessages(messages: unknown[]): ProviderTokenUsage | undefined {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCached: number | undefined;
  let found = false;

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    const usage = m.usage;
    if (!usage || typeof usage !== 'object') continue;

    const u = usage as Record<string, unknown>;
    const input = toFiniteNumber(u.input_tokens ?? u.inputTokens ?? u.input);
    const output = toFiniteNumber(u.output_tokens ?? u.outputTokens ?? u.output);

    if (input !== undefined || output !== undefined) {
      found = true;
      totalInput += input ?? 0;
      totalOutput += output ?? 0;
      const cached = toFiniteNumber(u.cache_read_input_tokens ?? u.cached ?? u.cachedTokens);
      if (cached !== undefined) {
        totalCached = (totalCached ?? 0) + cached;
      }
    }
  }

  if (!found) return undefined;

  const result: ProviderTokenUsage = { input: totalInput, output: totalOutput };
  if (totalCached !== undefined) {
    return { ...result, cached: totalCached };
  }
  return result;
}

function convertPiMessage(message: unknown): Message | undefined {
  if (!message || typeof message !== 'object') return undefined;

  const msg = message as Record<string, unknown>;
  const role = msg.role;
  if (typeof role !== 'string') return undefined;

  const content = extractPiTextContent(msg.content);
  const toolCalls = extractToolCalls(msg.content);

  const startTime =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.timestamp === 'string'
        ? msg.timestamp
        : undefined;

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
    startTime,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function extractToolCalls(content: unknown): readonly ToolCall[] {
  if (!Array.isArray(content)) return [];

  const toolCalls: ToolCall[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'tool_use' && typeof p.name === 'string') {
      toolCalls.push({
        tool: p.name,
        input: p.input,
        id: typeof p.id === 'string' ? p.id : undefined,
      });
    } else if ((p.type === 'toolCall' || p.type === 'tool_call') && typeof p.name === 'string') {
      toolCalls.push({
        tool: p.name,
        input: p.arguments ?? p.input,
        id: typeof p.id === 'string' ? p.id : undefined,
      });
    } else if (p.type === 'tool_result' && typeof p.tool_use_id === 'string') {
      const existing = toolCalls.find((tc) => tc.id === p.tool_use_id);
      if (existing) {
        const idx = toolCalls.indexOf(existing);
        toolCalls[idx] = { ...existing, output: p.content };
      }
    }
  }

  return toolCalls;
}

function escapeAtSymbols(prompt: string): string {
  return prompt.replace(/@\[([^\]]+)\]:/g, '[[$1]]:');
}

function pickDetail(stderr: string, stdout: string): string | undefined {
  const errorText = stderr.trim();
  if (errorText.length > 0) return errorText;
  const stdoutText = stdout.trim();
  return stdoutText.length > 0 ? stdoutText : undefined;
}

function formatTimeoutSuffix(timeoutMs: number | undefined): string {
  if (!timeoutMs || timeoutMs <= 0) return '';
  return ` after ${Math.ceil(timeoutMs / 1000)}s`;
}

/**
 * On Windows, npm/bun global installs create `.cmd` wrappers that can't be
 * spawned directly without a shell. Resolve the wrapper to the underlying
 * node script so we can spawn without shell (avoiding PowerShell/cmd
 * escaping issues with prompt content).
 */
function resolveWindowsCmd(executable: string): [string, string[]] {
  if (process.platform !== 'win32') return [executable, []];

  // If already pointing at node/bun or a .js file, no resolution needed
  const lower = executable.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.exe')) return [executable, []];

  // Check for .cmd wrapper next to the executable
  const cmdPath = `${executable}.cmd`;
  try {
    accessSync(cmdPath);
  } catch {
    return [executable, []]; // No .cmd wrapper, try as-is
  }

  // Parse the .cmd to extract the node script path.
  // npm .cmd wrappers end with: "%_prog%" "%dp0%\path\to\script.js" %*
  const content = readFileSync(cmdPath, 'utf-8');
  const match = content.match(/"?%_prog%"?\s+"([^"]+\.js)"/);
  if (!match) return [executable, []];

  // %dp0% refers to the directory containing the .cmd file
  const dp0 = path.dirname(cmdPath.includes(path.sep) ? path.resolve(cmdPath) : cmdPath);
  const scriptPath = match[1].replace(/%dp0%[/\\]?/gi, `${dp0}${path.sep}`);

  try {
    accessSync(scriptPath);
    return ['node', [scriptPath]];
  } catch {
    return [executable, []];
  }
}

async function defaultPiRunner(options: PiRunOptions): Promise<PiRunResult> {
  return await new Promise<PiRunResult>((resolve, reject) => {
    const parts = options.executable.split(/\s+/);
    const [resolvedExe, prefixArgs] = resolveWindowsCmd(parts[0]);
    const executableArgs = [...prefixArgs, ...parts.slice(1)];
    const allArgs = [...executableArgs, ...options.args];

    const child = spawn(resolvedExe, allArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.stdin.end();

    const cleanup = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
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

/** @internal Exported for testing only. */
export const _internal = {
  extractMessages,
  extractToolCallsFromEvents,
  parsePiJsonl,
};
