import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { captureSessionArtifacts } from '../workspace/file-changes.js';
import { recordCopilotSdkLogEntry } from './copilot-sdk-log-tracker.js';
import {
  CopilotStreamLogger,
  buildLogFilename,
  isLogStreamingDisabled,
  resolveCopilotTimeoutMs,
  resolvePlatformCliPath,
} from './copilot-utils.js';
import { resolveDefaultProviderLogDir } from './log-directory.js';
import { normalizeToolCall } from './normalize-tool-call.js';
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
          '@github/copilot-sdk failed to load: vscode-jsonrpc ESM import specifier mismatch.\n' +
            "The package imports 'vscode-jsonrpc/node' but the installed version exposes 'node.js'.\n\n" +
            'Repair (run once in your project root):\n' +
            "  node -e \"const p=require.resolve('vscode-jsonrpc/package.json').replace('/package.json',''); require('fs').symlinkSync(p+'/node.js',p+'/node','file')\" 2>/dev/null || true\n\n" +
            'Or switch to the copilot-cli target (no SDK dependency):\n' +
            '  Set provider: copilot-cli in your eval YAML',
        );
      }
      throw new Error(
        `Failed to load @github/copilot-sdk. Please install it:\n  npm install @github/copilot-sdk\n\nOriginal error: ${message}`,
      );
    }
  }
  return copilotSdkModule;
}

// biome-ignore lint/suspicious/noExplicitAny: SDK session type changes across versions
async function abortCopilotSession(session: any): Promise<void> {
  try {
    if (typeof session?.abort === 'function') {
      await session.abort();
      return;
    }
    await cleanupCopilotSession(session);
  } catch {
    // Best-effort cancellation; preserve the original provider error/abort path.
  }
}

// biome-ignore lint/suspicious/noExplicitAny: SDK session type changes across versions
async function cleanupCopilotSession(session: any): Promise<void> {
  try {
    if (typeof session?.disconnect === 'function') {
      await session.disconnect();
      return;
    }
    if (typeof session?.destroy === 'function') {
      await session.destroy();
      return;
    }
    if (typeof session?.[Symbol.asyncDispose] === 'function') {
      await session[Symbol.asyncDispose]();
    }
  } catch {
    // Cleanup should not mask the provider result or the primary failure.
  }
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
    const evalCwd = this.resolveCwd(request.cwd);
    const client = await this.getOrCreateClient(sdk, evalCwd ?? undefined);

    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const logger = await this.createStreamLogger(request).catch(() => undefined);

    // Create a fresh session for this invocation
    // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
    const sessionOptions: any = {
      onPermissionRequest: sdk.approveAll ?? (() => ({ kind: 'approved' })),
    };

    if (this.config.model) {
      sessionOptions.model = this.config.model;
    }

    if (evalCwd) {
      sessionOptions.workingDirectory = evalCwd;
      // Auto-discover skill directories from the workspace so the SDK loads
      // SKILL.md files into the session context (see copilot-sdk docs/features/skills.md).
      sessionOptions.skillDirectories = resolveSkillDirectories(evalCwd);
    }

    const systemPrompt = this.config.systemPrompt;

    if (systemPrompt) {
      sessionOptions.systemMessage = {
        mode: 'append',
        content: systemPrompt,
      };
    }

    const customProvider = this.config.customProvider;
    if (customProvider) {
      const providerType = customProvider.type ?? 'openai';
      // biome-ignore lint/suspicious/noExplicitAny: SDK provider config shape is dynamic
      const provider: any = {
        type: providerType,
        baseUrl: normalizeProviderBaseUrl(customProvider.baseUrl, providerType),
      };
      if (customProvider.bearerToken) {
        provider.bearerToken = customProvider.bearerToken;
      } else if (customProvider.apiKey) {
        provider.apiKey = customProvider.apiKey;
      }
      if (customProvider.wireApi) {
        provider.wireApi = customProvider.wireApi;
      }
      if (customProvider.modelId) {
        provider.modelId = customProvider.modelId;
      }
      if (customProvider.wireModel) {
        provider.wireModel = customProvider.wireModel;
      }
      if (providerType === 'azure' && customProvider.apiVersion) {
        provider.azure = { apiVersion: customProvider.apiVersion };
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
            completedToolCalls.push(
              normalizeToolCall('copilot-sdk', {
                tool: inProgress.tool,
                input: inProgress.input,
                output: data?.output ?? data?.result,
                id: inProgress.id,
                startTime: inProgress.startTime,
                endTime: new Date().toISOString(),
                durationMs: endMs - inProgress.startMs,
              }),
            );
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
          void abortCopilotSession(session);
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

      // Capture session artifacts from session-state `files/` directory.
      // The SDK's session.workspacePath is the authoritative path to the
      // session state directory (contains files/, checkpoints/, plan.md).
      // Only populated when infinite sessions are enabled on the server.
      const sessionWorkspacePath = session.workspacePath;
      const fileChanges = sessionWorkspacePath
        ? await captureSessionArtifacts(path.join(sessionWorkspacePath, 'files')).catch(
            () => undefined,
          )
        : undefined;

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
        ...(fileChanges ? { fileChanges } : {}),
      };
    } finally {
      unsubscribe();
      await logger?.close();
      await cleanupCopilotSession(session);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK client type is dynamically loaded
  private async getOrCreateClient(sdk: any, evalCwd?: string): Promise<any> {
    if (!this.client) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK constructor options are dynamic
      const clientOptions: any = {};
      if (this.config.cliUrl) {
        if (sdk.RuntimeConnection?.forUri) {
          clientOptions.connection = sdk.RuntimeConnection.forUri(this.config.cliUrl);
        } else {
          clientOptions.cliUrl = this.config.cliUrl;
        }
      }

      if (!clientOptions.connection && (this.config.cliPath || this.config.args?.length)) {
        if (sdk.RuntimeConnection?.forStdio) {
          clientOptions.connection = sdk.RuntimeConnection.forStdio({
            ...(this.config.cliPath ? { path: this.config.cliPath } : {}),
            ...(this.config.args?.length ? { args: this.config.args } : {}),
          });
        } else if (this.config.cliPath) {
          clientOptions.cliPath = this.config.cliPath;
        }
      } else {
        // The SDK default getBundledCliPath() resolves to a JS entry that requires
        // node:sqlite (unavailable in Bun). Auto-resolve the platform-specific native
        // binary from @github/copilot-{platform}-{arch} when available.
        const nativePath = resolvePlatformCliPath();
        if (nativePath && sdk.RuntimeConnection?.forStdio && !clientOptions.connection) {
          clientOptions.connection = sdk.RuntimeConnection.forStdio({
            path: nativePath,
            ...(this.config.args?.length ? { args: this.config.args } : {}),
          });
        } else if (nativePath) {
          clientOptions.cliPath = nativePath;
        }
      }
      // Set the subprocess cwd so --plugin-dir ./relative resolves from the eval workspace.
      const resolvedCwd = evalCwd ?? process.cwd();
      clientOptions.workingDirectory = resolvedCwd;
      // Backward compatibility for older @github/copilot-sdk releases.
      clientOptions.cwd = resolvedCwd;

      if (this.config.args && this.config.args.length > 0) {
        // Pass args through unchanged; the subprocess resolves relative paths against clientOptions.cwd above.
        clientOptions.cliArgs = [...this.config.args];
      }
      if (this.config.githubToken) {
        clientOptions.gitHubToken = this.config.githubToken;
        // Backward compatibility for older @github/copilot-sdk releases.
        clientOptions.githubToken = this.config.githubToken;
      }
      this.client = new sdk.CopilotClient(clientOptions);
      await this.client.start();
    }
    return this.client;
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK session type is dynamically loaded
  private async sendWithTimeout(session: any, prompt: string, timeoutMs?: number): Promise<void> {
    const effectiveTimeoutMs = resolveCopilotTimeoutMs(timeoutMs);
    const sendPromise = session.sendAndWait({ prompt }, effectiveTimeoutMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Copilot SDK timed out after ${Math.ceil(effectiveTimeoutMs / 1000)}s`));
      }, effectiveTimeoutMs);
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

  private resolveLogDirectory(request: ProviderRequest): string | undefined {
    if (isLogStreamingDisabled('AGENTV_COPILOT_SDK_STREAM_LOGS')) {
      return undefined;
    }
    if (this.config.logDir) {
      return path.resolve(this.config.logDir);
    }
    return resolveDefaultProviderLogDir('copilot-sdk', request);
  }

  private async createStreamLogger(
    request: ProviderRequest,
  ): Promise<CopilotStreamLogger | undefined> {
    const logDir = this.resolveLogDirectory(request);
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
          chunkExtractor: extractSdkChunk,
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

/**
 * Normalize a provider base URL for the Copilot SDK.
 * For Azure type, if the value is a bare resource name (no https:// prefix),
 * construct the full URL: https://{resourceName}.openai.azure.com
 * This lets users reuse AZURE_OPENAI_ENDPOINT without a separate env var.
 */
function normalizeProviderBaseUrl(baseUrl: string, type: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (type === 'azure') {
    return `https://${trimmed}.openai.azure.com`;
  }
  return trimmed;
}

/**
 * Extracts bufferable text from SDK assistant.message_delta events.
 * Returning a string causes the logger to accumulate the text rather than
 * emit a line per delta. A single [assistant_message] line is written once
 * all deltas for a turn have arrived (on the next non-chunk event or close).
 */
function extractSdkChunk(eventType: string, data: unknown): string | undefined {
  if (eventType !== 'assistant.message_delta') return undefined;
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  return typeof d.deltaContent === 'string' ? d.deltaContent : undefined;
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
