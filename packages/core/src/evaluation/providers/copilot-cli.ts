import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import * as acp from '@agentclientprotocol/sdk';

import { trackChild } from '../../runtime/child-tracker.js';
import { captureSessionArtifacts } from '../workspace/file-changes.js';
import { recordCopilotCliLogEntry } from './copilot-cli-log-tracker.js';
import {
  CopilotStreamLogger,
  buildLogFilename,
  isLogStreamingDisabled,
  killProcess,
  resolveCopilotTimeoutMs,
  resolvePlatformCliPath,
} from './copilot-utils.js';
import { resolveDefaultProviderLogDir } from './log-directory.js';
import { normalizeToolCall } from './normalize-tool-call.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CopilotCliResolvedConfig, CopilotCustomProviderConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

interface ToolCallInProgress {
  readonly tool: string;
  readonly input?: unknown;
  readonly id?: string;
  readonly startTime: string;
  readonly startMs: number;
}

interface CopilotCliPromptRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

interface CopilotCliPromptRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

type CopilotCliPromptRunner = (
  options: CopilotCliPromptRunOptions,
) => Promise<CopilotCliPromptRunResult>;
type CopilotCliSpawn = typeof spawn;

/**
 * Copilot CLI provider using the Agent Client Protocol (ACP).
 *
 * Spawns `copilot --acp --stdio` and communicates via NDJSON using
 * @agentclientprotocol/sdk. This bypasses the @github/copilot-sdk's
 * 60s session.idle timeout, enabling long-running agent tasks.
 *
 * Token usage: Copilot CLI does not currently emit token usage data via
 * ACP — usage events are tracked internally but marked ephemeral and not
 * sent to clients (see github/copilot-cli#1152). The provider is wired to
 * consume PromptResponse.usage and usage_update events when they become
 * available, but until then token_usage will be undefined. See #683.
 */
export class CopilotCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-cli' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CopilotCliResolvedConfig;
  private readonly runPromptMode: CopilotCliPromptRunner;
  private readonly spawnAcpProcess: CopilotCliSpawn;

  constructor(
    targetName: string,
    config: CopilotCliResolvedConfig,
    promptRunner: CopilotCliPromptRunner = defaultCopilotCliPromptRunner,
    spawnAcpProcess: CopilotCliSpawn = spawn,
  ) {
    this.id = `copilot-cli:${targetName}`;
    this.targetName = targetName;
    this.config = config;
    this.runPromptMode = promptRunner;
    this.spawnAcpProcess = spawnAcpProcess;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Copilot CLI request was aborted before execution');
    }

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request, 'acp').catch(() => undefined);

    // Build command args
    const executable = this.resolveExecutable();
    const args = this.buildCliArgs();

    // Spawn the CLI process
    const agentProcess = this.spawnAcpProcess(executable, args, {
      env: buildCopilotCliProviderEnv(process.env, this.config.customProvider),
      cwd: this.resolveCwd(request.cwd) ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    trackChild(agentProcess);

    await waitForProcessSpawn(agentProcess, executable, this.targetName);

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
    const customProvider = this.config.customProvider;

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

        logger?.handleEvent(sessionUpdate, sanitizeSensitiveValue(update, customProvider));

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
            const toolName = update.title ?? update.kind ?? 'unknown';
            completedToolCalls.push(
              normalizeToolCall('copilot-cli', {
                tool: toolName,
                input: update.rawInput,
                output: update.rawOutput,
                id: callId,
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                durationMs: 0,
              }),
            );
            request.streamCallbacks?.onToolCallEnd?.(
              toolName,
              update.rawInput,
              update.rawOutput,
              0,
              callId,
            );
          }
        }

        if (sessionUpdate === 'tool_call_update') {
          const callId = update.toolCallId;
          if (callId && (update.status === 'completed' || update.status === 'failed')) {
            const inProgress = toolCallsInProgress.get(callId);
            if (inProgress) {
              toolCallsInProgress.delete(callId);
              const duration = Date.now() - inProgress.startMs;
              completedToolCalls.push(
                normalizeToolCall('copilot-cli', {
                  tool: inProgress.tool,
                  input: inProgress.input,
                  output: update.rawOutput,
                  id: inProgress.id,
                  startTime: inProgress.startTime,
                  endTime: new Date().toISOString(),
                  durationMs: duration,
                }),
              );
              request.streamCallbacks?.onToolCallEnd?.(
                inProgress.tool,
                inProgress.input,
                update.rawOutput,
                duration,
                inProgress.id,
              );
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
          // ACP UsageUpdate provides { size, used, cost? } where `used` is
          // cumulative context window tokens. This does NOT separate input vs
          // output tokens, so we report `used` as input with output 0.
          // Copilot CLI does not currently emit this event via ACP (events are
          // marked ephemeral internally — see github/copilot-cli#1152), but
          // this handler is ready for when it does. See #683.
          tokenUsage = { input: update.used, output: 0 };
          // Cost may arrive across multiple events — accumulate
          if (update.cost && update.cost.currency === 'USD') {
            costUsd = (costUsd ?? 0) + update.cost.amount;
          }
          // Stream callback for LLM usage
          request.streamCallbacks?.onLlmCallEnd?.('copilot', tokenUsage);
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

      // Build the prompt with optional system instructions prepended
      const inputFiles = normalizeInputFiles(request.inputFiles);
      const prompt = buildPromptDocument(request, inputFiles);
      const systemPrompt = this.resolveSystemPrompt(request);
      const promptMessages: Array<{ type: 'text'; text: string }> = [];
      if (systemPrompt) {
        promptMessages.push({ type: 'text', text: systemPrompt });
      }
      promptMessages.push({ type: 'text', text: prompt });

      // Send and wait with timeout
      const sendPromise = connection.prompt({
        sessionId: session.sessionId,
        prompt: promptMessages,
      });

      let promptResponse: acp.PromptResponse;
      if (request.signal) {
        const abortHandler = () => {
          killProcess(agentProcess);
        };
        request.signal.addEventListener('abort', abortHandler, { once: true });
        try {
          promptResponse = await this.raceWithTimeout(sendPromise, agentProcess);
        } finally {
          request.signal.removeEventListener('abort', abortHandler);
        }
      } else {
        promptResponse = await this.raceWithTimeout(sendPromise, agentProcess);
      }

      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Prefer accurate token usage from PromptResponse.usage (ACP spec
      // includes per-turn Usage with inputTokens/outputTokens — marked
      // @experimental/UNSTABLE). Copilot CLI v1.0.9 does not populate this
      // yet, but this is ready for when it does. Falls back to usage_update
      // data if that was received. See #683.
      const responseUsage = promptResponse.usage;
      if (responseUsage && responseUsage.totalTokens > 0) {
        tokenUsage = {
          input: responseUsage.inputTokens,
          output: responseUsage.outputTokens,
          ...(responseUsage.thoughtTokens != null
            ? { reasoning: responseUsage.thoughtTokens }
            : {}),
          ...(responseUsage.cachedReadTokens != null
            ? { cached: responseUsage.cachedReadTokens }
            : {}),
        };
        request.streamCallbacks?.onLlmCallEnd?.('copilot', tokenUsage);
      }

      // Detect rejected tool calls — copilot's permission system blocked a tool
      const rejectedCalls = completedToolCalls.filter((tc) => {
        const out = tc.output as Record<string, unknown> | undefined;
        return out && (out.code === 'rejected' || out.code === 'denied');
      });
      if (rejectedCalls.length > 0) {
        const tools = rejectedCalls.map((tc) => tc.tool).join(', ');
        throw new Error(
          `Copilot rejected ${rejectedCalls.length} tool call(s): ${tools}. Add args: ["--yolo"] to your target config or re-run with --yolo to bypass permission checks.`,
        );
      }

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

      // Capture session artifacts from session-state `files/` directory.
      // Copilot may write generated files (e.g. CSV reports) there instead of
      // the session cwd, so they wouldn't be captured by workspace git diff.
      // ACP session.sessionId is the UUID Copilot assigns at session creation
      // and is expected to match the ~/.copilot/session-state/<uuid>/ directory
      // name. If the directory doesn't exist the call silently returns undefined.
      const sessionId = session.sessionId as string | undefined;
      const fileChanges = sessionId
        ? await captureSessionArtifacts(
            path.join(homedir(), '.copilot', 'session-state', sessionId, 'files'),
          ).catch(() => undefined)
        : undefined;

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
        ...(fileChanges ? { fileChanges } : {}),
      };
    } finally {
      await logger?.close();
      killProcess(agentProcess);
    }
  }

  private buildCliArgs(): string[] {
    // --yolo bypasses copilot's permission system so file reads and tool calls
    // are not rejected during eval runs (see #421).
    const args = ['--acp', '--stdio', '--allow-all-tools', '--yolo'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Append user-provided extra args
    if (this.config.args) {
      args.push(...this.config.args);
    }

    return args;
  }

  private async invokePromptMode(
    request: ProviderRequest,
    startTime: string,
    startMs: number,
  ): Promise<ProviderResponse> {
    const logger = await this.createStreamLogger(request, 'prompt').catch(() => undefined);
    const executable = this.resolveExecutable();
    const inputFiles = normalizeInputFiles(request.inputFiles);
    const prompt = buildPromptDocument(request, inputFiles);
    const systemPrompt = this.resolveSystemPrompt(request);
    const promptText = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const args = this.buildPromptModeArgs(promptText);
    const cwd = this.resolveCwd(request.cwd) ?? process.cwd();
    const env = buildCopilotCliProviderEnv(process.env, this.config.customProvider);

    try {
      const result = await this.runPromptMode({
        executable,
        args,
        cwd,
        timeoutMs: resolveCopilotTimeoutMs(this.config.timeoutMs),
        env,
        signal: request.signal,
        onStdoutChunk: logger
          ? (chunk) =>
              logger.handleEvent('stdout', {
                chunk: sanitizeSensitiveText(chunk, this.config.customProvider),
              })
          : undefined,
        onStderrChunk: logger
          ? (chunk) =>
              logger.handleEvent('stderr', {
                chunk: sanitizeSensitiveText(chunk, this.config.customProvider),
              })
          : undefined,
      });

      const sanitizedStderr = sanitizeSensitiveText(result.stderr, this.config.customProvider);
      if (result.timedOut) {
        throw new Error(
          `Copilot CLI timed out after ${Math.ceil(resolveCopilotTimeoutMs(this.config.timeoutMs) / 1000)}s`,
        );
      }

      if (result.exitCode !== 0) {
        const detail = pickPromptModeDetail(
          sanitizeSensitiveText(result.stderr, this.config.customProvider),
          sanitizeSensitiveText(result.stdout, this.config.customProvider),
        );
        const prefix = `Copilot CLI exited with code ${result.exitCode}`;
        throw new Error(detail ? `${prefix}: ${detail}` : prefix);
      }

      const assistantText = extractCopilotPromptResponse(result.stdout);
      const endTime = new Date().toISOString();

      return {
        raw: {
          model: this.config.model,
          executable,
          args,
          stdout: result.stdout,
          stderr: sanitizedStderr,
          exitCode: result.exitCode,
          logFile: logger?.filePath,
        },
        output: [{ role: 'assistant', content: assistantText }],
        durationMs: Date.now() - startMs,
        startTime,
        endTime,
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT' || err.code === 'EINVAL') {
        throw new Error(formatCopilotSpawnError(err, executable, this.targetName));
      }
      throw error;
    } finally {
      await logger?.close();
    }
  }

  private buildPromptModeArgs(prompt: string): string[] {
    const args = ['-s', '--allow-all-tools', '--no-color'];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.args) {
      args.push(...this.config.args);
    }

    args.push('-p', prompt);

    return args;
  }

  private resolveSystemPrompt(_request: ProviderRequest): string | undefined {
    return this.config.systemPrompt;
  }

  private async raceWithTimeout<T>(
    sendPromise: Promise<T>,
    agentProcess: ChildProcess,
  ): Promise<T> {
    const timeoutMs = resolveCopilotTimeoutMs(this.config.timeoutMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        killProcess(agentProcess);
        reject(new Error(`Copilot CLI timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([sendPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
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

  private resolveLogDirectory(request: ProviderRequest): string | undefined {
    if (isLogStreamingDisabled('AGENTV_COPILOT_CLI_STREAM_LOGS')) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return resolveDefaultProviderLogDir('copilot-cli', request);
  }

  private async createStreamLogger(
    request: ProviderRequest,
    mode: 'acp' | 'prompt',
  ): Promise<CopilotStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory(request);
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

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName, 'copilot-cli'));

    try {
      const logger = await CopilotStreamLogger.create(
        {
          filePath,
          targetName: this.targetName,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
          format: this.config.logFormat ?? 'summary',
          headerLabel: mode === 'acp' ? 'Copilot CLI (ACP)' : 'Copilot CLI (prompt)',
          chunkExtractor: mode === 'acp' ? extractAcpChunk : undefined,
        },
        mode === 'acp' ? summarizeAcpEvent : summarizePromptModeEvent,
      );
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

export function buildCopilotCliProviderEnv(
  baseEnv: NodeJS.ProcessEnv,
  customProvider: CopilotCustomProviderConfig | undefined,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  if (!customProvider) {
    return env;
  }
  if (customProvider.type) {
    env.COPILOT_PROVIDER_TYPE = customProvider.type;
  }
  env.COPILOT_PROVIDER_BASE_URL = customProvider.baseUrl;
  if (customProvider.bearerToken) {
    env.COPILOT_PROVIDER_BEARER_TOKEN = customProvider.bearerToken;
  } else if (customProvider.apiKey) {
    env.COPILOT_PROVIDER_API_KEY = customProvider.apiKey;
  }
  if (customProvider.wireApi) {
    env.COPILOT_PROVIDER_WIRE_API = customProvider.wireApi;
  }
  if (customProvider.apiVersion) {
    env.COPILOT_PROVIDER_AZURE_API_VERSION = customProvider.apiVersion;
  }
  return env;
}

async function waitForProcessSpawn(
  proc: ChildProcess,
  executable: string,
  targetName: string,
): Promise<void> {
  if (proc.pid) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error & { code?: string }) => {
      cleanup();
      reject(new Error(formatCopilotSpawnError(error, executable, targetName)));
    };

    const cleanup = () => {
      proc.off('spawn', onSpawn);
      proc.off('error', onError);
    };

    proc.once('spawn', onSpawn);
    proc.once('error', onError);
  });
}

function formatCopilotSpawnError(
  error: Error & { code?: string },
  executable: string,
  targetName: string,
): string {
  const code = error.code;
  const base =
    `Failed to start Copilot CLI executable '${executable}' for target '${targetName}'.` +
    ` ${error.message}`;

  if (process.platform !== 'win32') {
    return base;
  }

  if (code !== 'ENOENT' && code !== 'EINVAL') {
    return base;
  }

  return `${base}

On Windows, shell commands like 'copilot -h' can work via .ps1/.bat shims, but AgentV launches a subprocess that needs a directly spawnable executable path.

Fix options:
1) Install native Copilot binary package:
   npm install -g @github/copilot-win32-x64
2) Set explicit executable for Copilot targets:
   - In .env: COPILOT_EXE=C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot-win32-x64\\copilot.exe
  - In .agentv/targets.yaml: executable: \${{ COPILOT_EXE }}`;
}

/**
 * Extracts bufferable text from ACP streaming events.
 *
 * Return values control CopilotStreamLogger buffering:
 *   string    — accumulate this text into the pending buffer
 *   null      — reset (discard) the pending buffer without emitting it
 *   undefined — not a chunk event; process normally
 *
 * Copilot ACP sends agent_message_chunk events in two passes:
 *   1. A streaming preview batch (before extended thinking)
 *   2. agent_thought_chunk events (extended reasoning)
 *   3. A final response batch (after extended thinking)
 *
 * Returning null for agent_thought_chunk discards the preview batch so that
 * only the final post-thinking response is emitted as [assistant_message].
 */
function extractAcpChunk(eventType: string, data: unknown): string | null | undefined {
  if (eventType === 'agent_thought_chunk') return null;
  if (eventType !== 'agent_message_chunk') return undefined;
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const content = d.content as Record<string, unknown> | undefined;
  return content?.type === 'text' && typeof content.text === 'string' ? content.text : undefined;
}

function summarizeAcpEvent(eventType: string, data: unknown): string | undefined {
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
    case 'usage_update':
      return `used=${d.used ?? 0} size=${d.size ?? 0}`;
    default:
      return undefined;
  }
}

function summarizePromptModeEvent(eventType: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return eventType;
  }
  const chunk = (data as Record<string, unknown>).chunk;
  if (typeof chunk !== 'string') {
    return undefined;
  }
  const trimmed = chunk.trim();
  if (!trimmed) {
    return undefined;
  }
  return `${trimmed.slice(0, 200)}${trimmed.length > 200 ? '...' : ''}`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control characters
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequence stripping requires matching control characters
const ANSI_OSC_RE = /\x1B\][^\x07]*\x07/g;

function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '').replace(ANSI_OSC_RE, '');
}

function extractCopilotPromptResponse(stdout: string): string {
  const cleaned = stripAnsiEscapes(stdout).trim();
  if (cleaned.length === 0) {
    throw new Error('Copilot CLI produced no output');
  }
  return cleaned;
}

function pickPromptModeDetail(stderr: string, stdout: string): string | undefined {
  const errorText = stderr.trim();
  if (errorText.length > 0) {
    return errorText;
  }
  const stdoutText = stdout.trim();
  return stdoutText.length > 0 ? stdoutText : undefined;
}

function sanitizeSensitiveText(
  text: string,
  customProvider: CopilotCustomProviderConfig | undefined,
): string {
  if (!customProvider) {
    return text;
  }
  const secrets = [customProvider.apiKey, customProvider.bearerToken].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  let sanitized = text;
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join('[redacted]');
  }
  return sanitized;
}

function sanitizeSensitiveValue(
  value: unknown,
  customProvider: CopilotCustomProviderConfig | undefined,
): unknown {
  if (!customProvider) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeSensitiveText(value, customProvider);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveValue(item, customProvider));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeSensitiveValue(entry, customProvider),
      ]),
    );
  }
  return value;
}

async function defaultCopilotCliPromptRunner(
  options: CopilotCliPromptRunOptions,
): Promise<CopilotCliPromptRunResult> {
  return await new Promise<CopilotCliPromptRunResult>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    trackChild(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const onAbort = (): void => {
      killProcess(child);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, options.timeoutMs);
    timeoutHandle.unref?.();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    child.stdin?.end();

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
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
