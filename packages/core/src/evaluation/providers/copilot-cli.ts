import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import * as acp from '@agentclientprotocol/sdk';

import { recordCopilotCliLogEntry } from './copilot-cli-log-tracker.js';
import {
  CopilotStreamLogger,
  buildLogFilename,
  isLogStreamingDisabled,
  killProcess,
  resolvePlatformCliPath,
} from './copilot-utils.js';
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
          // ACP UsageUpdate has { size, used, cost? } — cost has { amount, currency }
          // `used` reports cumulative context window usage, so overwrite (not accumulate)
          if (tokenUsage) {
            tokenUsage = { input: update.used, output: tokenUsage.output };
          } else {
            tokenUsage = { input: update.used, output: 0 };
          }
          // Cost may arrive across multiple events — accumulate
          if (update.cost && update.cost.currency === 'USD') {
            costUsd = (costUsd ?? 0) + update.cost.amount;
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        killProcess(agentProcess);
        reject(new Error(`Copilot CLI timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      await Promise.race([sendPromise, timeoutPromise]);
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

  private resolveLogDirectory(): string | undefined {
    if (isLogStreamingDisabled('AGENTV_COPILOT_CLI_STREAM_LOGS')) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'copilot-cli');
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CopilotStreamLogger | undefined> {
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

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName, 'copilot-cli'));

    try {
      const logger = await CopilotStreamLogger.create(
        {
          filePath,
          targetName: this.targetName,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
          format: this.config.logFormat ?? 'summary',
          headerLabel: 'Copilot CLI (ACP)',
        },
        summarizeAcpEvent,
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
