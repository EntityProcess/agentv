import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { recordCopilotSdkLogEntry } from './copilot-sdk-log-tracker.js';
import {
  CopilotStreamLogger,
  buildLogFilename,
  isLogStreamingDisabled,
  resolvePlatformCliPath,
} from './copilot-utils.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CopilotSdkResolvedConfig } from './targets.js';
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
let copilotSdkModule: any = null;

async function loadCopilotSdk(): Promise<typeof import('@github/copilot-sdk')> {
  if (!copilotSdkModule) {
    try {
      copilotSdkModule = await import('@github/copilot-sdk');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('vscode-jsonrpc')) {
        throw new Error(
          `Failed to load @github/copilot-sdk due to a known ESM compatibility issue with vscode-jsonrpc (https://github.com/github/copilot-sdk/issues/710).\n\nWorkarounds:\n  - Use the copilot-cli target instead (recommended): set target type to "copilot-cli" in your eval YAML\n  - If running under Node.js 24+: set NODE_OPTIONS="--experimental-specifier-resolution=node"\n  - Wait for vscode-jsonrpc@9.0.0 stable to be released upstream`,
        );
      }
      throw new Error(
        `Failed to load @github/copilot-sdk. Please install it:\n  npm install @github/copilot-sdk\n\nOriginal error: ${message}`,
      );
    }
  }
  return copilotSdkModule;
}

interface ToolCallInProgress {
  readonly tool: string;
  readonly input?: unknown;
  readonly id?: string;
  readonly startTime: string;
  readonly startMs: number;
}

/**
 * Copilot SDK provider using the @github/copilot-sdk library directly.
 * This provides typed event access for structured tool calls, token usage, and clean session lifecycle.
 *
 * Note: The SDK is loaded lazily on first use to avoid bundling issues.
 * Users must install @github/copilot-sdk separately.
 */
export class CopilotSdkProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-sdk' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: CopilotSdkResolvedConfig;
  // biome-ignore lint/suspicious/noExplicitAny: SDK client type is dynamically loaded
  private client: any = null;

  constructor(targetName: string, config: CopilotSdkResolvedConfig) {
    this.id = `copilot-sdk:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Copilot SDK request was aborted before execution');
    }

    const sdk = await loadCopilotSdk();
    const client = await this.getOrCreateClient(sdk);

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Create a fresh session for this invocation
    // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
    const sessionOptions: any = {
      onPermissionRequest: () => ({ kind: 'approved' }),
    };

    if (this.config.model) {
      sessionOptions.model = this.config.model;
    }

    const cwd = this.resolveCwd(request.cwd);
    if (cwd) {
      sessionOptions.workingDirectory = cwd;
      // Auto-discover skill directories from the workspace so the SDK loads
      // SKILL.md files into the session context (see copilot-sdk docs/features/skills.md).
      sessionOptions.skillDirectories = resolveSkillDirectories(cwd);
    }

    const systemPrompt = this.config.systemPrompt;

    if (systemPrompt) {
      sessionOptions.systemMessage = {
        mode: 'append',
        content: systemPrompt,
      };
    }

    // BYOK — pass a provider block to route requests through a user-provided endpoint
    // instead of GitHub's Copilot infrastructure. See copilot-sdk docs/auth/byok.md.
    if (this.config.byokBaseUrl) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK provider config shape is dynamic
      const provider: any = {
        type: this.config.byokType ?? 'openai',
        baseUrl: this.config.byokBaseUrl,
      };
      if (this.config.byokBearerToken) {
        provider.bearerToken = this.config.byokBearerToken;
      } else if (this.config.byokApiKey) {
        provider.apiKey = this.config.byokApiKey;
      }
      if (this.config.byokWireApi) {
        provider.wireApi = this.config.byokWireApi;
      }
      if (this.config.byokType === 'azure' && this.config.byokApiVersion) {
        provider.azure = { apiVersion: this.config.byokApiVersion };
      }
      sessionOptions.provider = provider;
    }

    // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
    let session: any;
    try {
      session = await client.createSession(sessionOptions);
    } catch (error) {
      throw new Error(
        `Failed to create Copilot SDK session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Track events
    const toolCallsInProgress = new Map<string, ToolCallInProgress>();
    const completedToolCalls: ToolCall[] = [];
    let finalContent = '';
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;

    // Subscribe to events via catch-all handler
    const unsubscribe = session.on(
      // biome-ignore lint/suspicious/noExplicitAny: SDK event type is dynamically loaded
      (event: any) => {
        const eventType = event.type as string;
        const data = event.data;

        logger?.handleEvent(eventType, data);

        if (eventType === 'tool.execution_start') {
          const callId = data?.toolCallId ?? data?.id ?? randomUUID();
          toolCallsInProgress.set(callId, {
            tool: data?.toolName ?? data?.name ?? 'unknown',
            input: data?.input ?? data?.arguments,
            id: callId,
            startTime: new Date().toISOString(),
            startMs: Date.now(),
          });
        }

        if (eventType === 'tool.execution_end' || eventType === 'tool.execution_complete') {
          const callId = data?.toolCallId ?? data?.id;
          const inProgress = callId ? toolCallsInProgress.get(callId) : undefined;
          if (inProgress) {
            toolCallsInProgress.delete(callId);
            const endMs = Date.now();
            completedToolCalls.push({
              tool: inProgress.tool,
              input: inProgress.input,
              output: data?.output ?? data?.result,
              id: inProgress.id,
              startTime: inProgress.startTime,
              endTime: new Date().toISOString(),
              durationMs: endMs - inProgress.startMs,
            });
          }
        }

        if (eventType === 'assistant.message') {
          const content = data?.content;
          if (typeof content === 'string') {
            finalContent = content;
          }
        }

        if (eventType === 'assistant.usage') {
          const inputTokens = data?.inputTokens ?? data?.input ?? 0;
          const outputTokens = data?.outputTokens ?? data?.output ?? 0;
          // Aggregate usage across multiple events
          if (tokenUsage) {
            tokenUsage = {
              input: tokenUsage.input + inputTokens,
              output: tokenUsage.output + outputTokens,
            };
          } else {
            tokenUsage = {
              input: inputTokens,
              output: outputTokens,
            };
          }
          if (typeof data?.costUsd === 'number') {
            costUsd = (costUsd ?? 0) + data.costUsd;
          }
        }
      },
    );

    try {
      // Build the prompt
      const inputFiles = normalizeInputFiles(request.inputFiles);
      const prompt = buildPromptDocument(request, inputFiles);

      // Send and wait with optional timeout
      if (request.signal) {
        // Handle abort signal
        const abortHandler = () => {
          session.destroy().catch(() => {});
        };
        request.signal.addEventListener('abort', abortHandler, { once: true });
        try {
          await this.sendWithTimeout(session, prompt, this.config.timeoutMs);
        } finally {
          request.signal.removeEventListener('abort', abortHandler);
        }
      } else {
        await this.sendWithTimeout(session, prompt, this.config.timeoutMs);
      }

      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Build output messages
      const output: Message[] = [];

      if (completedToolCalls.length > 0) {
        output.push({
          role: 'assistant',
          content: finalContent || undefined,
          toolCalls: completedToolCalls,
        });
      } else if (finalContent) {
        output.push({
          role: 'assistant',
          content: finalContent,
        });
      }

      return {
        raw: {
          model: this.config.model,
          cliUrl: this.config.cliUrl,
          logFile: logger?.filePath,
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
      await logger?.close();
      await session.destroy().catch(() => {});
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK client type is dynamically loaded
  private async getOrCreateClient(sdk: any): Promise<any> {
    if (!this.client) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK constructor options are dynamic
      const clientOptions: any = {};
      if (this.config.cliUrl) {
        clientOptions.cliUrl = this.config.cliUrl;
      }
      if (this.config.cliPath) {
        clientOptions.cliPath = this.config.cliPath;
      } else {
        // The SDK default getBundledCliPath() resolves to a JS entry that requires
        // node:sqlite (unavailable in Bun). Auto-resolve the platform-specific native
        // binary from @github/copilot-{platform}-{arch} when available.
        const nativePath = resolvePlatformCliPath();
        if (nativePath) {
          clientOptions.cliPath = nativePath;
        }
      }
      if (this.config.githubToken) {
        clientOptions.githubToken = this.config.githubToken;
      }
      this.client = new sdk.CopilotClient(clientOptions);
      await this.client.start();
    }
    return this.client;
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
  private async sendWithTimeout(session: any, prompt: string, timeoutMs?: number): Promise<void> {
    if (!timeoutMs) {
      await session.sendAndWait({ prompt });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Copilot SDK timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      await Promise.race([session.sendAndWait({ prompt }), timeoutPromise]);
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

  private resolveLogDirectory(): string | undefined {
    if (isLogStreamingDisabled('AGENTV_COPILOT_SDK_STREAM_LOGS')) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return path.join(process.cwd(), '.agentv', 'logs', 'copilot-sdk');
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
      console.warn(`Skipping Copilot SDK stream logging (could not create ${logDir}): ${message}`);
      return undefined;
    }

    const filePath = path.join(logDir, buildLogFilename(request, this.targetName, 'copilot-sdk'));

    try {
      const logger = await CopilotStreamLogger.create(
        {
          filePath,
          targetName: this.targetName,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
          format: this.config.logFormat ?? 'summary',
          headerLabel: 'Copilot SDK',
        },
        summarizeSdkEvent,
      );
      recordCopilotSdkLogEntry({
        filePath,
        targetName: this.targetName,
        evalCaseId: request.evalCaseId,
        attempt: request.attempt,
      });
      return logger;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping Copilot SDK stream logging for ${filePath}: ${message}`);
      return undefined;
    }
  }
}

/**
 * Auto-discover skill directories from a workspace.
 * Checks standard skill directory locations and returns any that exist.
 */
function resolveSkillDirectories(cwd: string): string[] {
  const candidates = [
    path.join(cwd, '.claude', 'skills'),
    path.join(cwd, '.agents', 'skills'),
    path.join(cwd, '.codex', 'skills'),
  ];
  return candidates.filter((dir) => existsSync(dir));
}

function summarizeSdkEvent(eventType: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return eventType;
  }
  const d = data as Record<string, unknown>;
  switch (eventType) {
    case 'assistant.message':
      return typeof d.content === 'string'
        ? `${d.content.slice(0, 200)}${d.content.length > 200 ? '...' : ''}`
        : 'message';
    case 'assistant.message_delta':
      return typeof d.deltaContent === 'string' ? d.deltaContent.slice(0, 100) : undefined;
    case 'tool.execution_start':
      return `${d.toolName ?? d.name ?? 'unknown'}`;
    case 'tool.execution_end':
    case 'tool.execution_complete':
      return `${d.toolName ?? d.name ?? 'unknown'} completed`;
    case 'assistant.usage':
      return `input=${d.inputTokens ?? d.input ?? 0} output=${d.outputTokens ?? d.output ?? 0}`;
    case 'session.error':
      return typeof d.message === 'string' ? d.message : 'error';
    default:
      return undefined;
  }
}
