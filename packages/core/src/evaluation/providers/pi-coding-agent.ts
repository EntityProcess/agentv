/**
 * Pi Coding Agent provider using the @mariozechner/pi-coding-agent SDK directly.
 *
 * Uses `createAgentSession` from the SDK instead of spawning the Pi CLI as a subprocess.
 * Events are consumed via `session.subscribe()` to extract messages, tool calls, and token usage.
 *
 * Dependencies are lazy-loaded on first use to avoid bundling issues.
 * The package `@mariozechner/pi-coding-agent` must be installed.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { recordPiLogEntry } from './pi-log-tracker.js';
import { extractPiTextContent, toFiniteNumber, toPiContentArray } from './pi-utils.js';
import { normalizeInputFiles } from './preread.js';
import type { PiCodingAgentResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

// Lazy-loaded SDK modules — guarded by a shared promise so concurrent workers
// all wait on a single load attempt (and at most one interactive prompt).
let piCodingAgentModule: typeof import('@mariozechner/pi-coding-agent') | null = null;
let piAiModule: typeof import('@mariozechner/pi-ai') | null = null;
let loadingPromise: Promise<void> | null = null;

async function promptInstall(): Promise<boolean> {
  if (!process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<boolean>((resolve) => {
      rl.question(
        '@mariozechner/pi-coding-agent is not installed. Install it now? (y/N) ',
        (answer) => resolve(answer.trim().toLowerCase() === 'y'),
      );
    });
  } finally {
    rl.close();
  }
}

/** Resolve agentv's own package root (where bun add should install peer deps). */
function findAgentvRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(thisFile);
  // Walk up until we find a package.json (covers both src and dist layouts)
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = path.join(dir, 'package.json');
      // existsSync-free check: if readFileSync throws, keep walking
      accessSync(pkg);
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // Fallback: current file's directory
  return path.dirname(thisFile);
}

async function doLoadSdkModules(): Promise<void> {
  try {
    [piCodingAgentModule, piAiModule] = await Promise.all([
      import('@mariozechner/pi-coding-agent'),
      import('@mariozechner/pi-ai'),
    ]);
  } catch {
    if (await promptInstall()) {
      const installDir = findAgentvRoot();
      console.error(`Installing @mariozechner/pi-coding-agent into ${installDir}...`);
      execSync('bun add @mariozechner/pi-coding-agent', {
        cwd: installDir,
        stdio: 'inherit',
      });
      [piCodingAgentModule, piAiModule] = await Promise.all([
        import('@mariozechner/pi-coding-agent'),
        import('@mariozechner/pi-ai'),
      ]);
    } else {
      throw new Error(
        'pi-coding-agent SDK is not installed. Install it with:\n  bun add @mariozechner/pi-coding-agent',
      );
    }
  }
}

async function loadSdkModules() {
  if (!piCodingAgentModule || !piAiModule) {
    if (!loadingPromise) {
      loadingPromise = doLoadSdkModules().catch((err) => {
        loadingPromise = null;
        throw err;
      });
    }
    await loadingPromise;
  }
  // After doLoadSdkModules resolves, both modules are guaranteed non-null.
  const piSdk = piCodingAgentModule as NonNullable<typeof piCodingAgentModule>;
  const piAi = piAiModule as NonNullable<typeof piAiModule>;
  const toolMap: Record<string, unknown> = {
    read: piSdk.readTool,
    bash: piSdk.bashTool,
    edit: piSdk.editTool,
    write: piSdk.writeTool,
    grep: piSdk.grepTool,
    find: piSdk.findTool,
    ls: piSdk.lsTool,
  };
  return {
    createAgentSession: piSdk.createAgentSession,
    codingTools: piSdk.codingTools,
    toolMap,
    SessionManager: piSdk.SessionManager,
    getModel: piAi.getModel,
  };
}

/** Tracks in-flight tool executions for timing. */
interface ToolExecTracker {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly startMs: number;
  readonly startTime: string;
}

export class PiCodingAgentProvider implements Provider {
  readonly id: string;
  readonly kind = 'pi-coding-agent' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: PiCodingAgentResolvedConfig;

  constructor(targetName: string, config: PiCodingAgentResolvedConfig) {
    this.id = `pi-coding-agent:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Pi coding agent request was aborted before execution');
    }

    const inputFiles = normalizeInputFiles(request.inputFiles);

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const sdk = await loadSdkModules();
    const logger = await this.createStreamLogger(request).catch(() => undefined);

    try {
      const cwd = this.resolveCwd(request.cwd);
      const providerName = this.config.subprovider ?? 'google';
      const modelId = this.config.model ?? 'gemini-2.5-flash';

      // Set provider-specific API key env var so the SDK can find it
      this.setApiKeyEnv(providerName);

      // Build model using pi-ai's getModel (requires type assertion for runtime strings).
      // getModel returns undefined when the provider+model combo isn't in the registry,
      // which causes the SDK to silently fall back to azure-openai-responses.
      // biome-ignore lint/suspicious/noExplicitAny: runtime string config requires any cast
      const model = (sdk.getModel as any)(providerName, modelId);
      if (!model) {
        throw new Error(
          `pi-coding-agent: getModel('${providerName}', '${modelId}') returned undefined. ` +
            `The model '${modelId}' is not registered for provider '${providerName}' in pi-ai. ` +
            `Check that subprovider and model are correct in your target config.`,
        );
      }

      // Select tools based on config
      const tools = this.resolveTools(sdk);

      // Create agent session using the SDK
      const { session } = await sdk.createAgentSession({
        cwd,
        model,
        tools,
        thinkingLevel: this.config.thinking as
          | 'off'
          | 'minimal'
          | 'low'
          | 'medium'
          | 'high'
          | 'xhigh'
          | undefined,
        sessionManager: sdk.SessionManager.inMemory(cwd),
      });

      // Track token usage, cost, and tool timing from events
      let tokenUsage: ProviderTokenUsage | undefined;
      let costUsd: number | undefined;
      const toolTrackers = new Map<string, ToolExecTracker>();
      const completedToolResults = new Map<string, { output: unknown; durationMs: number }>();

      const unsubscribe = session.subscribe((event) => {
        // Log events for stream logging
        logger?.handleEvent(event);

        switch (event.type) {
          case 'message_end': {
            const msg = event.message;
            if (
              msg &&
              typeof msg === 'object' &&
              'role' in msg &&
              msg.role === 'assistant' &&
              'usage' in msg
            ) {
              const usage = (msg as unknown as Record<string, unknown>).usage;
              if (usage && typeof usage === 'object') {
                const u = usage as Record<string, unknown>;
                const input = toFiniteNumber(u.input);
                const output = toFiniteNumber(u.output);
                const cached = toFiniteNumber(u.cacheRead);

                let callDelta: ProviderTokenUsage | undefined;
                if (input !== undefined || output !== undefined) {
                  callDelta = {
                    input: input ?? 0,
                    output: output ?? 0,
                    ...(cached !== undefined ? { cached } : {}),
                  };
                  tokenUsage = {
                    input: (tokenUsage?.input ?? 0) + callDelta.input,
                    output: (tokenUsage?.output ?? 0) + callDelta.output,
                    ...(cached !== undefined
                      ? { cached: (tokenUsage?.cached ?? 0) + cached }
                      : tokenUsage?.cached !== undefined
                        ? { cached: tokenUsage.cached }
                        : {}),
                  };
                }

                // Extract cost from usage.cost object
                const cost = (u as Record<string, unknown>).cost;
                if (cost && typeof cost === 'object') {
                  const total = toFiniteNumber((cost as Record<string, unknown>).total);
                  if (total !== undefined) {
                    costUsd = (costUsd ?? 0) + total;
                  }
                }

                // Emit per-call delta for OTel spans
                request.streamCallbacks?.onLlmCallEnd?.(modelId, callDelta);
              }
            }
            break;
          }

          case 'tool_execution_start': {
            toolTrackers.set(event.toolCallId, {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              startMs: Date.now(),
              startTime: new Date().toISOString(),
            });
            request.streamCallbacks?.onToolCallStart?.(event.toolName, event.toolCallId);
            break;
          }

          case 'tool_execution_end': {
            const tracker = toolTrackers.get(event.toolCallId);
            const durationMs = tracker ? Date.now() - tracker.startMs : 0;
            completedToolResults.set(event.toolCallId, {
              output: event.result,
              durationMs,
            });
            request.streamCallbacks?.onToolCallEnd?.(
              event.toolName,
              tracker?.args,
              event.result,
              durationMs,
              event.toolCallId,
            );
            toolTrackers.delete(event.toolCallId);
            break;
          }
        }
      });

      try {
        // Build prompt with optional system prompt and input files
        const systemPrompt = this.config.systemPrompt;
        let prompt = request.question;
        if (systemPrompt) {
          prompt = `${systemPrompt}\n\n${prompt}`;
        }
        if (inputFiles && inputFiles.length > 0) {
          const fileList = inputFiles.map((f) => `@${f}`).join('\n');
          prompt = `${prompt}\n\nFiles:\n${fileList}`;
        }

        // Run with timeout
        if (this.config.timeoutMs) {
          const timeoutMs = this.config.timeoutMs;
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () =>
                reject(
                  new Error(`Pi coding agent timed out after ${Math.ceil(timeoutMs / 1000)}s`),
                ),
              timeoutMs,
            );
          });
          try {
            await Promise.race([session.prompt(prompt), timeoutPromise]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        } else {
          await session.prompt(prompt);
        }

        // Extract messages from agent state
        const agentMessages = session.agent.state.messages;

        // Detect SDK errors: check if the last assistant message ended with stopReason "error".
        // Without this, the provider silently returns empty/echoed content as a quality failure
        // instead of reporting the actual execution error.
        const lastAssistant = [...agentMessages]
          .reverse()
          .find(
            (m): m is Record<string, unknown> =>
              !!m && typeof m === 'object' && (m as Record<string, unknown>).role === 'assistant',
          ) as Record<string, unknown> | undefined;
        if (lastAssistant?.stopReason === 'error') {
          const errorMsg =
            typeof lastAssistant.errorMessage === 'string'
              ? lastAssistant.errorMessage
              : 'unknown SDK error';
          throw new Error(
            `pi-coding-agent SDK error (provider: ${lastAssistant.provider ?? providerName}, ` +
              `model: ${lastAssistant.model ?? modelId}): ${errorMsg}`,
          );
        }

        const output: Message[] = [];
        for (const msg of agentMessages) {
          output.push(convertAgentMessage(msg, toolTrackers, completedToolResults));
        }

        const endTime = new Date().toISOString();
        const durationMs = Date.now() - startMs;

        return {
          raw: {
            messages: agentMessages,
            model: this.config.model,
            provider: this.config.subprovider,
          },
          output,
          tokenUsage,
          costUsd,
          durationMs,
          startTime,
          endTime,
        };
      } finally {
        unsubscribe();
        session.dispose();
      }
    } finally {
      await logger?.close();
    }
  }

  /** Maps config apiKey to the provider-specific env var the SDK reads. */
  private setApiKeyEnv(providerName: string): void {
    if (!this.config.apiKey) return;
    const ENV_KEY_MAP: Record<string, string> = {
      google: 'GEMINI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      groq: 'GROQ_API_KEY',
      xai: 'XAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    };
    const envKey = ENV_KEY_MAP[providerName.toLowerCase()];
    if (envKey) {
      process.env[envKey] = this.config.apiKey;
    }
  }

  private resolveCwd(cwdOverride?: string): string {
    if (cwdOverride) {
      return path.resolve(cwdOverride);
    }
    if (this.config.cwd) {
      return path.resolve(this.config.cwd);
    }
    return process.cwd();
  }

  private resolveTools(sdk: Awaited<ReturnType<typeof loadSdkModules>>) {
    if (!this.config.tools) {
      return sdk.codingTools;
    }

    const toolNames = this.config.tools.split(',').map((t) => t.trim().toLowerCase());
    const selected = [];
    for (const name of toolNames) {
      if (name in sdk.toolMap) {
        selected.push(sdk.toolMap[name]);
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: tools are typed dynamically from SDK
    return selected.length > 0 ? (selected as any[]) : sdk.codingTools;
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
    for (const line of header) {
      logger.stream.write(`${line}\n`);
    }
    return logger;
  }

  handleEvent(event: unknown): void {
    if (!event || typeof event !== 'object') return;
    const record = event as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    if (!type) return;

    const message =
      this.format === 'json' ? JSON.stringify(event, null, 2) : summarizeSdkEvent(event);
    if (message) {
      this.stream.write(`[+${formatElapsed(this.startedAt)}] ${message}\n`);
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });
  }
}

function summarizeSdkEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  if (!type) return undefined;

  switch (type) {
    case 'agent_start':
    case 'agent_end':
    case 'turn_start':
    case 'turn_end':
      return type;
    case 'message_start':
    case 'message_end': {
      const msg = record.message as Record<string, unknown> | undefined;
      return `${type}: ${msg?.role ?? 'unknown'}`;
    }
    case 'tool_execution_start':
      return `tool_start: ${record.toolName}`;
    case 'tool_execution_end':
      return `tool_end: ${record.toolName}`;
    default:
      return type;
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

/**
 * Convert a pi-agent message to AgentV Message format.
 * Enriches with token usage, metadata, and tool call timing from event trackers.
 */
function convertAgentMessage(
  message: unknown,
  toolTrackers: Map<string, ToolExecTracker>,
  completedToolResults: Map<string, { output: unknown; durationMs: number }>,
): Message {
  if (!message || typeof message !== 'object') {
    return { role: 'unknown', content: String(message) };
  }

  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role : 'unknown';
  const structuredContent = toPiContentArray(msg.content);
  const content = structuredContent ?? extractPiTextContent(msg.content);
  const toolCalls = extractToolCalls(msg.content, toolTrackers, completedToolResults);
  const startTimeVal =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.timestamp === 'string'
        ? msg.timestamp
        : undefined;

  // Extract per-message token usage from AssistantMessage.usage
  let msgTokenUsage: ProviderTokenUsage | undefined;
  if (msg.usage && typeof msg.usage === 'object') {
    const u = msg.usage as Record<string, unknown>;
    const input = toFiniteNumber(u.input);
    const output = toFiniteNumber(u.output);
    if (input !== undefined || output !== undefined) {
      msgTokenUsage = {
        input: input ?? 0,
        output: output ?? 0,
        ...(toFiniteNumber(u.cacheRead) !== undefined
          ? { cached: toFiniteNumber(u.cacheRead) }
          : {}),
      };
    }
  }

  const metadata: Record<string, unknown> = {};
  if (msg.api) metadata.api = msg.api;
  if (msg.provider) metadata.provider = msg.provider;
  if (msg.model) metadata.model = msg.model;
  if (msg.stopReason) metadata.stopReason = msg.stopReason;

  return {
    role,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    startTime: startTimeVal,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    tokenUsage: msgTokenUsage,
  };
}

/**
 * Extract tool calls from pi-agent content array format.
 * Enriches with output and timing from completed tool result trackers.
 */
function extractToolCalls(
  content: unknown,
  toolTrackers: Map<string, ToolExecTracker>,
  completedToolResults: Map<string, { output: unknown; durationMs: number }>,
): readonly ToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: ToolCall[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type === 'toolCall' && typeof p.name === 'string') {
      const id = typeof p.id === 'string' ? p.id : undefined;
      const tracker = id ? toolTrackers.get(id) : undefined;
      const completed = id ? completedToolResults.get(id) : undefined;
      toolCalls.push({
        tool: p.name,
        input: p.arguments,
        id,
        output: completed?.output,
        durationMs: completed?.durationMs,
        startTime: tracker?.startTime,
        endTime:
          tracker?.startTime && completed?.durationMs !== undefined
            ? new Date(new Date(tracker.startTime).getTime() + completed.durationMs).toISOString()
            : undefined,
      });
    }
  }

  return toolCalls;
}
