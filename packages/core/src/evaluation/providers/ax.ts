import { AxAI } from "@ax-llm/ax";
import type { AxChatRequest, AxChatResponse, AxModelConfig } from "@ax-llm/ax";

import type {
  AnthropicResolvedConfig,
  AzureResolvedConfig,
  GeminiResolvedConfig,
  RetryConfig,
} from "./targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";
import type { JsonObject } from "../types.js";

const DEFAULT_SYSTEM_PROMPT =
  "You are a careful assistant. Follow all provided instructions and do not fabricate results.";

type ChatPrompt = AxChatRequest["chatPrompt"];

type AxAiInstance = ReturnType<typeof AxAI.create>;

function buildChatPrompt(request: ProviderRequest): ChatPrompt {
  if (request.chatPrompt) {
    return request.chatPrompt;
  }

  const systemSegments: string[] = [];
  
  // Add metadata system prompt first (general instructions)
  const metadataSystemPrompt =
    typeof request.metadata?.systemPrompt === "string" ? request.metadata.systemPrompt : undefined;
  if (metadataSystemPrompt && metadataSystemPrompt.trim().length > 0) {
    systemSegments.push(metadataSystemPrompt.trim());
  } else {
    // Use default if no custom system prompt provided
    systemSegments.push(DEFAULT_SYSTEM_PROMPT);
  }
  
  // Add guidelines after system prompt (specific constraints for this eval)
  if (request.guidelines && request.guidelines.trim().length > 0) {
    systemSegments.push(`[[ ## Guidelines ## ]]\n\n${request.guidelines.trim()}`);
  }

  const systemContent = systemSegments.join("\n\n");
  const userContent = request.question.trim();

  const prompt: ChatPrompt = [
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: userContent,
    },
  ];

  return prompt;
}

function extractModelConfig(
  request: ProviderRequest,
  defaults: { temperature?: number; maxOutputTokens?: number },
): AxModelConfig | undefined {
  const temperature = request.temperature ?? defaults.temperature;
  const maxTokens = request.maxOutputTokens ?? defaults.maxOutputTokens;
  const config: AxModelConfig = {};
  if (temperature !== undefined) {
    config.temperature = temperature;
  }
  if (maxTokens !== undefined) {
    config.maxTokens = maxTokens;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function mapResponse(response: AxChatResponse): ProviderResponse {
  const primary = response.results[0];
  const text = typeof primary?.content === "string" ? primary.content : "";
  const reasoning = primary?.thought ?? primary?.thoughtBlock?.data;
  const usage = toJsonObject(response.modelUsage);

  return {
    text,
    reasoning,
    raw: response,
    usage,
  };
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return undefined;
  }
}

function ensureChatResponse(result: unknown): AxChatResponse {
  if (typeof ReadableStream !== "undefined" && result instanceof ReadableStream) {
    throw new Error("Streaming responses are not supported for this provider");
  }
  if (!result || typeof result !== "object" || !("results" in result)) {
    throw new Error("Unexpected response type from AxAI provider");
  }
  return result as AxChatResponse;
}

function isRetryableError(error: unknown, retryableStatusCodes: readonly number[]): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  // Check for status code in various error formats
  if ("status" in error && typeof error.status === "number") {
    return retryableStatusCodes.includes(error.status);
  }

  // Check for HTTP status in error message
  if ("message" in error && typeof error.message === "string") {
    const match = error.message.match(/HTTP (\d{3})/);
    if (match) {
      const status = Number.parseInt(match[1], 10);
      return retryableStatusCodes.includes(status);
    }
  }

  // Network errors are retryable
  if ("name" in error && error.name === "AxAIServiceNetworkError") {
    return true;
  }

  return false;
}

function calculateRetryDelay(attempt: number, config: Required<RetryConfig>): number {
  const delay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * config.backoffFactor ** attempt,
  );
  // Add jitter (0.75-1.25x of calculated delay)
  return delay * (0.75 + Math.random() * 0.5);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig?: RetryConfig,
  signal?: AbortSignal,
): Promise<T> {
  // Use default retry config if not provided
  const config: Required<RetryConfig> = {
    maxRetries: retryConfig?.maxRetries ?? 3,
    initialDelayMs: retryConfig?.initialDelayMs ?? 1000,
    maxDelayMs: retryConfig?.maxDelayMs ?? 60000,
    backoffFactor: retryConfig?.backoffFactor ?? 2,
    retryableStatusCodes: retryConfig?.retryableStatusCodes ?? [500, 408, 429, 502, 503, 504],
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Check if aborted before attempting
    if (signal?.aborted) {
      throw new Error(`Request aborted: ${signal.reason ?? "Unknown reason"}`);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt
      if (attempt >= config.maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error, config.retryableStatusCodes)) {
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateRetryDelay(attempt, config);
      await sleep(delay);

      // Check if aborted during sleep
      if (signal?.aborted) {
        throw new Error(`Request aborted: ${signal.reason ?? "Unknown reason"}`);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

export class AzureProvider implements Provider {
  readonly id: string;
  readonly kind = "azure" as const;
  readonly targetName: string;

  private readonly ai: AxAiInstance;
  private readonly defaults: { temperature?: number; maxOutputTokens?: number };
  private readonly retryConfig?: RetryConfig;

  constructor(
    targetName: string,
    private readonly config: AzureResolvedConfig,
  ) {
    this.id = `azure:${targetName}`;
    this.targetName = targetName;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;

    this.ai = AxAI.create({
      name: "azure-openai",
      apiKey: config.apiKey,
      resourceName: config.resourceName,
      deploymentName: config.deploymentName,
      version: config.version,
      config: {
        stream: false,
      },
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    const chatPrompt = buildChatPrompt(request);
    const modelConfig = extractModelConfig(request, this.defaults);

    const response = await withRetry(
      async () =>
        await this.ai.chat(
          {
            chatPrompt,
            model: this.config.deploymentName,
            ...(modelConfig ? { modelConfig } : {}),
          },
          request.signal ? { abortSignal: request.signal } : undefined,
        ),
      this.retryConfig,
      request.signal,
    );

    return mapResponse(ensureChatResponse(response));
  }

  getAxAI(): AxAiInstance {
    return this.ai;
  }
}

export class AnthropicProvider implements Provider {
  readonly id: string;
  readonly kind = "anthropic" as const;

  readonly targetName: string;
  private readonly ai: AxAiInstance;
  private readonly defaults: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
  };
  private readonly retryConfig?: RetryConfig;

  constructor(
    targetName: string,
    private readonly config: AnthropicResolvedConfig,
  ) {
    this.id = `anthropic:${targetName}`;
    this.targetName = targetName;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      thinkingBudget: config.thinkingBudget,
    };
    this.retryConfig = config.retry;

    this.ai = AxAI.create({
      name: "anthropic",
      apiKey: config.apiKey,
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    const chatPrompt = buildChatPrompt(request);
    const modelConfig = extractModelConfig(request, this.defaults);

    const response = await withRetry(
      async () =>
        await this.ai.chat(
          {
            chatPrompt,
            model: this.config.model,
            ...(modelConfig ? { modelConfig } : {}),
          },
          request.signal ? { abortSignal: request.signal } : undefined,
        ),
      this.retryConfig,
      request.signal,
    );

    return mapResponse(ensureChatResponse(response));
  }

  getAxAI(): AxAiInstance {
    return this.ai;
  }
}

export class GeminiProvider implements Provider {
  readonly id: string;
  readonly kind = "gemini" as const;

  readonly targetName: string;
  private readonly ai: AxAiInstance;
  private readonly defaults: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  private readonly retryConfig?: RetryConfig;

  constructor(
    targetName: string,
    private readonly config: GeminiResolvedConfig,
  ) {
    this.id = `gemini:${targetName}`;
    this.targetName = targetName;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;

    this.ai = AxAI.create({
      name: "google-gemini",
      apiKey: config.apiKey,
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    const chatPrompt = buildChatPrompt(request);
    const modelConfig = extractModelConfig(request, this.defaults);

    const response = await withRetry(
      async () =>
        await this.ai.chat(
          {
            chatPrompt,
            model: this.config.model,
            ...(modelConfig ? { modelConfig } : {}),
          },
          request.signal ? { abortSignal: request.signal } : undefined,
        ),
      this.retryConfig,
      request.signal,
    );

    return mapResponse(ensureChatResponse(response));
  }

  getAxAI(): AxAiInstance {
    return this.ai;
  }
}
