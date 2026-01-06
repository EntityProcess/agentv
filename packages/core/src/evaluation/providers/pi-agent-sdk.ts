import type { PiAgentSdkResolvedConfig } from './targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
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
let piAgentModule: typeof import('@mariozechner/pi-agent') | null = null;
let piAiModule: typeof import('@mariozechner/pi-ai') | null = null;

async function loadPiModules(): Promise<{
  Agent: typeof import('@mariozechner/pi-agent').Agent;
  ProviderTransport: typeof import('@mariozechner/pi-agent').ProviderTransport;
  getModel: typeof import('@mariozechner/pi-ai').getModel;
  getEnvApiKey: typeof import('@mariozechner/pi-ai').getEnvApiKey;
}> {
  if (!piAgentModule || !piAiModule) {
    try {
      [piAgentModule, piAiModule] = await Promise.all([
        import('@mariozechner/pi-agent'),
        import('@mariozechner/pi-ai'),
      ]);
    } catch (error) {
      throw new Error(
        `Failed to load pi-agent-sdk dependencies. Please install them:\n  npm install @mariozechner/pi-agent @mariozechner/pi-ai\n\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    Agent: piAgentModule.Agent,
    ProviderTransport: piAgentModule.ProviderTransport,
    getModel: piAiModule.getModel,
    getEnvApiKey: piAiModule.getEnvApiKey,
  };
}

/**
 * Pi Agent SDK provider using the @mariozechner/pi-agent library directly.
 * This avoids CLI argument-passing issues (especially on Windows) by using the SDK.
 *
 * Note: Dependencies are loaded lazily on first use to avoid bundling issues.
 * Users must install @mariozechner/pi-agent and @mariozechner/pi-ai separately.
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
    const { Agent, ProviderTransport, getModel, getEnvApiKey } = await loadPiModules();

    const startTime = Date.now();
    const providerName = this.config.provider ?? 'anthropic';
    const modelId = this.config.model ?? 'claude-sonnet-4-20250514';
    // Use type assertion since getModel has strict generic constraints for compile-time known values
    // but we're working with runtime configuration strings
    // biome-ignore lint/suspicious/noExplicitAny: runtime string config requires any
    const model = (getModel as any)(providerName, modelId);

    // Build system prompt
    const systemPrompt = this.config.systemPrompt ?? 'Answer directly and concisely.';

    // Create transport with API key getter
    const transport = new ProviderTransport({
      getApiKey: async (provider) => {
        // Use config apiKey if provided, otherwise try environment
        return this.config.apiKey ?? getEnvApiKey(provider as PiProvider) ?? undefined;
      },
    });

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools: [], // No tools for simple Q&A
        messages: [],
      },
      transport,
    });

    // Collect events for output messages
    const outputMessages: OutputMessage[] = [];
    let finalAssistantContent = '';

    // Subscribe to events
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_end') {
        const msg = event.message;
        if (msg.role === 'assistant') {
          const content = extractTextContent(msg.content);
          if (content) {
            finalAssistantContent = content;
          }
        }
      }
    });

    try {
      // Set up timeout if configured
      const timeoutMs = this.config.timeoutMs ?? 120000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Pi agent SDK timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      // Run the prompt with timeout
      await Promise.race([agent.prompt(request.question), timeoutPromise]);

      // Wait for agent to finish
      await agent.waitForIdle();

      // Extract messages from agent state
      const agentMessages = agent.state.messages;
      for (const msg of agentMessages) {
        outputMessages.push(convertAgentMessage(msg));
      }

      const durationMs = Date.now() - startTime;

      return {
        raw: {
          messages: agentMessages,
          systemPrompt,
          model: this.config.model,
          provider: this.config.provider,
        },
        outputMessages,
        durationMs,
      };
    } finally {
      unsubscribe();
    }
  }
}

/**
 * Extract text content from pi-agent message content format.
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
 * Convert pi-agent message to AgentV OutputMessage format.
 */
function convertAgentMessage(message: unknown): OutputMessage {
  if (!message || typeof message !== 'object') {
    return { role: 'unknown', content: String(message) };
  }

  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role : 'unknown';
  const content = extractTextContent(msg.content);
  const toolCalls = extractToolCalls(msg.content);
  const timestamp =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.timestamp === 'string'
        ? msg.timestamp
        : undefined;

  return {
    role,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    timestamp,
  };
}

/**
 * Extract tool calls from pi-agent content array format.
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
