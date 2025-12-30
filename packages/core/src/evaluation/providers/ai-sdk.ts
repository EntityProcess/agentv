import { createAnthropic } from '@ai-sdk/anthropic';
import { type AzureOpenAIProviderSettings, createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { type LanguageModel, type ModelMessage, generateText } from 'ai';

import type { JsonObject } from '../types.js';
import type {
  AnthropicResolvedConfig,
  AzureResolvedConfig,
  GeminiResolvedConfig,
  RetryConfig,
} from './targets.js';
import type { ChatPrompt, Provider, ProviderRequest, ProviderResponse } from './types.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are a careful assistant. Follow all provided instructions and do not fabricate results.';

type TextResult = Awaited<ReturnType<typeof generateText>>;
type GenerateTextOptions = Parameters<typeof generateText>[0];

interface ProviderDefaults {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingBudget?: number;
}

export class AzureProvider implements Provider {
  readonly id: string;
  readonly kind = 'azure' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;
  private readonly defaults: ProviderDefaults;
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

    const azure = createAzure(buildAzureOptions(config));
    this.model = azure(config.deploymentName);
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokeModel({
      model: this.model,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }

  asLanguageModel(): LanguageModel {
    return this.model;
  }
}

export class AnthropicProvider implements Provider {
  readonly id: string;
  readonly kind = 'anthropic' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;
  private readonly defaults: ProviderDefaults;
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

    const anthropic = createAnthropic({
      apiKey: config.apiKey,
    });
    this.model = anthropic(config.model);
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    const providerOptions = buildAnthropicProviderOptions(this.defaults);

    return invokeModel({
      model: this.model,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
      providerOptions,
    });
  }

  asLanguageModel(): LanguageModel {
    return this.model;
  }
}

export class GeminiProvider implements Provider {
  readonly id: string;
  readonly kind = 'gemini' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;
  private readonly defaults: ProviderDefaults;
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

    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
    });
    this.model = google(config.model);
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokeModel({
      model: this.model,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }

  asLanguageModel(): LanguageModel {
    return this.model;
  }
}

function buildAzureOptions(config: AzureResolvedConfig): AzureOpenAIProviderSettings {
  const options: AzureOpenAIProviderSettings = {
    apiKey: config.apiKey,
    apiVersion: config.version,
    useDeploymentBasedUrls: true,
  };

  const baseURL = normalizeAzureBaseUrl(config.resourceName);
  if (baseURL) {
    options.baseURL = baseURL;
  } else {
    options.resourceName = config.resourceName;
  }

  return options;
}

function normalizeAzureBaseUrl(resourceName: string): string | undefined {
  const trimmed = resourceName.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  const withoutSlash = trimmed.replace(/\/+$/, '');
  const normalized = withoutSlash.endsWith('/openai') ? withoutSlash : `${withoutSlash}/openai`;
  return normalized;
}

function buildAnthropicProviderOptions(
  defaults: ProviderDefaults,
): GenerateTextOptions['providerOptions'] | undefined {
  if (defaults.thinkingBudget === undefined) {
    return undefined;
  }

  return {
    anthropic: {
      thinking: {
        type: 'enabled',
        budgetTokens: defaults.thinkingBudget,
      },
    },
  };
}

function buildChatPrompt(request: ProviderRequest): ChatPrompt {
  const provided = request.chatPrompt?.length ? request.chatPrompt : undefined;
  if (provided) {
    const hasSystemMessage = provided.some((message) => message.role === 'system');
    if (hasSystemMessage) {
      return provided;
    }

    const systemContent = resolveSystemContent(request, false);
    return [{ role: 'system', content: systemContent }, ...provided];
  }

  const systemContent = resolveSystemContent(request, true);
  const userContent = request.question.trim();

  const prompt: ChatPrompt = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  return prompt;
}

function resolveSystemContent(request: ProviderRequest, includeGuidelines: boolean): string {
  const systemSegments: string[] = [];

  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    systemSegments.push(request.systemPrompt.trim());
  } else {
    systemSegments.push(DEFAULT_SYSTEM_PROMPT);
  }

  if (includeGuidelines && request.guidelines && request.guidelines.trim().length > 0) {
    systemSegments.push(`[[ ## Guidelines ## ]]\n\n${request.guidelines.trim()}`);
  }

  return systemSegments.join('\n\n');
}

function toModelMessages(chatPrompt: ChatPrompt): ModelMessage[] {
  return chatPrompt.map((message) => {
    if (message.role === 'tool' || message.role === 'function') {
      const prefix = message.name ? `@[${message.name}]: ` : '@[Tool]: ';
      return {
        role: 'assistant',
        content: `${prefix}${message.content}`,
      } satisfies ModelMessage;
    }

    if (message.role === 'assistant' || message.role === 'system' || message.role === 'user') {
      return {
        role: message.role,
        content: message.content,
      } satisfies ModelMessage;
    }

    return {
      role: 'user',
      content: message.content,
    } satisfies ModelMessage;
  });
}

function resolveModelSettings(
  request: ProviderRequest,
  defaults: ProviderDefaults,
): { temperature?: number; maxOutputTokens?: number } {
  const temperature = request.temperature ?? defaults.temperature;
  const maxOutputTokens = request.maxOutputTokens ?? defaults.maxOutputTokens;
  return {
    temperature,
    maxOutputTokens,
  };
}

async function invokeModel(options: {
  readonly model: LanguageModel;
  readonly request: ProviderRequest;
  readonly defaults: ProviderDefaults;
  readonly retryConfig?: RetryConfig;
  readonly providerOptions?: GenerateTextOptions['providerOptions'];
}): Promise<ProviderResponse> {
  const { model, request, defaults, retryConfig, providerOptions } = options;
  const chatPrompt = buildChatPrompt(request);
  const { temperature, maxOutputTokens } = resolveModelSettings(request, defaults);

  const result = await withRetry(
    () =>
      generateText({
        model,
        messages: toModelMessages(chatPrompt),
        temperature,
        maxOutputTokens,
        maxRetries: 0,
        abortSignal: request.signal,
        ...(providerOptions ? { providerOptions } : {}),
      }),
    retryConfig,
    request.signal,
  );

  return mapResponse(result);
}

function mapResponse(result: TextResult): ProviderResponse {
  const content = result.text ?? '';
  return {
    raw: result,
    usage: toJsonObject(result.totalUsage ?? result.usage),
    outputMessages: [{ role: 'assistant' as const, content }],
  };
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return undefined;
  }
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as Record<string, unknown>;
  const directStatus = candidate.status ?? candidate.statusCode;
  if (typeof directStatus === 'number' && Number.isFinite(directStatus)) {
    return directStatus;
  }

  const responseStatus =
    typeof candidate.response === 'object' && candidate.response
      ? (candidate.response as { status?: unknown }).status
      : undefined;
  if (typeof responseStatus === 'number' && Number.isFinite(responseStatus)) {
    return responseStatus;
  }

  const message = typeof candidate.message === 'string' ? candidate.message : undefined;
  if (message) {
    const match = message.match(/HTTP\s+(\d{3})/i);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  if (candidate.name === 'AbortError') {
    return false;
  }

  const code = candidate.code;
  if (typeof code === 'string' && /^E(AI|CONN|HOST|NET|PIPE|TIME|REFUSED|RESET)/i.test(code)) {
    return true;
  }

  const message = typeof candidate.message === 'string' ? candidate.message : undefined;
  if (
    message &&
    /(network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED)/i.test(message)
  ) {
    return true;
  }

  return false;
}

function isRetryableError(error: unknown, retryableStatusCodes: readonly number[]): boolean {
  const status = extractStatus(error);
  if (status === 401 || status === 403) {
    return false;
  }
  if (typeof status === 'number') {
    return retryableStatusCodes.includes(status);
  }

  return isNetworkError(error);
}

function calculateRetryDelay(attempt: number, config: Required<RetryConfig>): number {
  const delay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * config.backoffFactor ** attempt,
  );
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
  const config: Required<RetryConfig> = {
    maxRetries: retryConfig?.maxRetries ?? 3,
    initialDelayMs: retryConfig?.initialDelayMs ?? 1000,
    maxDelayMs: retryConfig?.maxDelayMs ?? 60000,
    backoffFactor: retryConfig?.backoffFactor ?? 2,
    retryableStatusCodes: retryConfig?.retryableStatusCodes ?? [500, 408, 429, 502, 503, 504],
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error(`Request aborted: ${signal.reason ?? 'Unknown reason'}`);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= config.maxRetries) {
        break;
      }

      if (!isRetryableError(error, config.retryableStatusCodes)) {
        throw error;
      }

      const delay = calculateRetryDelay(attempt, config);
      await sleep(delay);
    }
  }

  throw lastError;
}
