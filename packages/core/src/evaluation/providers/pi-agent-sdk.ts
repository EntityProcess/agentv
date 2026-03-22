import { extractPiTextContent, toFiniteNumber } from './pi-utils.js';
import type { PiAgentSdkResolvedConfig } from './targets.js';
import type {
  Message,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  ToolCall,
} from './types.js';

type PiProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'cerebras'
  | 'xai'
  | 'openrouter';

// Lazy-loaded modules to avoid bundling issues with dynamic requires
let piAgentModule: typeof import('@mariozechner/pi-agent-core') | null = null;
let piAiModule: typeof import('@mariozechner/pi-ai') | null = null;

async function loadPiModules(): Promise<{
  Agent: typeof import('@mariozechner/pi-agent-core').Agent;
  getModel: typeof import('@mariozechner/pi-ai').getModel;
  getEnvApiKey: typeof import('@mariozechner/pi-ai').getEnvApiKey;
}> {
  if (!piAgentModule || !piAiModule) {
    try {
      [piAgentModule, piAiModule] = await Promise.all([
        import('@mariozechner/pi-agent-core'),
        import('@mariozechner/pi-ai'),
      ]);
    } catch (error) {
      throw new Error(
        `Failed to load pi-agent-sdk dependencies. Please install them:\n  npm install @mariozechner/pi-agent-core @mariozechner/pi-ai\n\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    Agent: piAgentModule.Agent,
    getModel: piAiModule.getModel,
    getEnvApiKey: piAiModule.getEnvApiKey,
  };
}

/** Tracks in-flight tool executions for timing. */
interface ToolExecTracker {
  readonly toolCallId: string;
  readonly toolName: string;
  // biome-ignore lint/suspicious/noExplicitAny: agent SDK args are untyped
  readonly args: any;
  readonly startMs: number;
  readonly startTime: string;
}

/**
 * Pi Agent SDK provider using the @mariozechner/pi-agent-core library directly.
 * This avoids CLI argument-passing issues (especially on Windows) by using the SDK.
 *
 * Captures token usage, cost, tool call timing, and message-level metadata
 * for OTel trace parity with codex and copilot-sdk providers.
 *
 * Note: Dependencies are loaded lazily on first use to avoid bundling issues.
 * Users must install @mariozechner/pi-agent-core and @mariozechner/pi-ai separately.
 *
 * @deprecated Consider removing this provider. It initializes with tools: [] so it
 * cannot read files or invoke skills — making it a plain Q&A loop with no agentic
 * capability. The `pi-coding-agent` provider covers the same use cases and more
 * (full tool access, workspace isolation, skill discovery). For lightweight LLM
 * grading without a CLI dependency, use the `openrouter`, `openai`, or `gemini`
 * providers instead.
 */
export class PiAgentSdkProvider implements Provider {
  readonly id: string;
  readonly kind = 'pi-agent-sdk' as const;
  readonly targetName: string;
  readonly supportsBatch = false;

  private readonly config: PiAgentSdkResolvedConfig;

  constructor(targetName: string, config: PiAgentSdkResolvedConfig) {
    this.id = `pi-agent-sdk:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error('Pi agent SDK request was aborted before execution');
    }

    // Lazy load the pi-agent modules
    const { Agent, getModel, getEnvApiKey } = await loadPiModules();

    const startTimeIso = new Date().toISOString();
    const startMs = Date.now();
    const providerName = this.config.provider ?? 'anthropic';
    const modelId = this.config.model ?? 'claude-sonnet-4-20250514';
    // Use type assertion since getModel has strict generic constraints for compile-time known values
    // but we're working with runtime configuration strings
    // biome-ignore lint/suspicious/noExplicitAny: runtime string config requires any
    const model = (getModel as any)(providerName, modelId);

    // Build system prompt
    const systemPrompt = this.config.systemPrompt ?? 'Answer directly and concisely.';

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools: [], // No tools for simple Q&A
        messages: [],
      },
      getApiKey: async (provider) => {
        // Use config apiKey if provided, otherwise try environment
        return this.config.apiKey ?? getEnvApiKey(provider as PiProvider) ?? undefined;
      },
    });

    // Track token usage, cost, and tool timing from events
    let tokenUsage: ProviderTokenUsage | undefined;
    let costUsd: number | undefined;
    const toolTrackers = new Map<string, ToolExecTracker>();
    const completedToolResults = new Map<string, { output: unknown; durationMs: number }>();

    // Subscribe to events for rich tracing
    const unsubscribe = agent.subscribe((event) => {
      switch (event.type) {
        case 'message_end': {
          // Extract token usage and cost from AssistantMessage.usage
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

              // Build per-call delta for streamCallbacks (OTel expects per-call, not cumulative)
              let callDelta: ProviderTokenUsage | undefined;
              if (input !== undefined || output !== undefined) {
                callDelta = {
                  input: input ?? 0,
                  output: output ?? 0,
                  ...(cached !== undefined ? { cached } : {}),
                };
                // Accumulate into running total
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

              // Emit per-call delta (not cumulative total) for OTel spans
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
      // Run the prompt, with optional timeout
      if (this.config.timeoutMs) {
        const timeoutMs = this.config.timeoutMs;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Pi agent SDK timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        });
        await Promise.race([agent.prompt(request.question), timeoutPromise]);
      } else {
        await agent.prompt(request.question);
      }

      // Wait for agent to finish
      await agent.waitForIdle();

      // Extract messages from agent state with enriched data
      const agentMessages = agent.state.messages;
      const output: Message[] = [];
      for (const msg of agentMessages) {
        output.push(convertAgentMessage(msg, toolTrackers, completedToolResults));
      }

      const endTimeIso = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      return {
        raw: {
          messages: agentMessages,
          systemPrompt,
          model: this.config.model,
          provider: this.config.provider,
        },
        output,
        tokenUsage,
        costUsd,
        durationMs,
        startTime: startTimeIso,
        endTime: endTimeIso,
      };
    } finally {
      unsubscribe();
    }
  }
}

/**
 * Convert pi-agent message to AgentV Message format.
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
  const content = extractPiTextContent(msg.content);
  const toolCalls = extractToolCalls(msg.content, toolTrackers, completedToolResults);
  const startTime =
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

  // Build metadata from model/provider info
  const metadata: Record<string, unknown> = {};
  if (msg.api) metadata.api = msg.api;
  if (msg.provider) metadata.provider = msg.provider;
  if (msg.model) metadata.model = msg.model;
  if (msg.stopReason) metadata.stopReason = msg.stopReason;

  return {
    role,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    startTime,
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
