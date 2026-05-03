/**
 * LLM provider classes for the five direct-API providers AgentV supports:
 * OpenAI, Azure OpenAI, OpenRouter, Anthropic, Google (Gemini).
 *
 * All five route through @mariozechner/pi-ai. Each provider class:
 *   1. Resolves a pi-ai Model in its constructor (registry lookup + field
 *      merges; one-time work).
 *   2. Implements invoke() by delegating to invokePiAi(), which runs the
 *      stateless single-shot path or the multi-step agent loop depending on
 *      whether the request carries `tools`.
 *
 * To add a new provider:
 *   1. Add a config interface in targets.ts.
 *   2. Add a class here that resolves a PiModel + maps config to invokePiAi
 *      options. Pi-ai's KnownProvider list (see types.d.ts) is the source of
 *      truth for `providerName`; pi-ai's KnownApi list is the source of
 *      truth for `apiId`.
 *   3. Register it in providers/index.ts.
 */

import {
  type AssistantMessage as PiAssistantMessage,
  type Message as PiMessage,
  type Model as PiModel,
  type Tool as PiTool,
  type ToolCall as PiToolCall,
  complete as piComplete,
  getModel as piGetModel,
  registerBuiltInApiProviders,
} from '@mariozechner/pi-ai';

// pi-ai routes complete()/stream() by Model.api; the built-in providers must be
// registered once at module load. Cheap; idempotent across repeated imports.
registerBuiltInApiProviders();

import type { JsonObject } from '../types.js';
import type {
  AnthropicResolvedConfig,
  AzureResolvedConfig,
  GeminiResolvedConfig,
  OpenAIResolvedConfig,
  OpenRouterResolvedConfig,
  RetryConfig,
} from './targets.js';
import type { ChatPrompt, Provider, ProviderRequest, ProviderResponse } from './types.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are a careful assistant. Follow all provided instructions and do not fabricate results.';

export interface ProviderDefaults {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingBudget?: number;
}

// ---------------------------------------------------------------------------
// Provider classes — model is resolved in the constructor, invoke() is thin.
// ---------------------------------------------------------------------------

export class OpenAIProvider implements Provider {
  readonly id: string;
  readonly kind = 'openai' as const;
  readonly targetName: string;

  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;
  private readonly apiKey: string;

  constructor(targetName: string, config: OpenAIResolvedConfig) {
    this.id = `openai:${targetName}`;
    this.targetName = targetName;
    this.apiKey = config.apiKey;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;
    this.piModel = resolvePiModel({
      providerName: 'openai',
      apiId: config.apiFormat === 'responses' ? 'openai-responses' : 'openai-completions',
      modelId: config.model,
      baseUrl: config.baseURL,
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokePiAi({
      model: this.piModel,
      apiKey: this.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }
}

export class OpenRouterProvider implements Provider {
  readonly id: string;
  readonly kind = 'openrouter' as const;
  readonly targetName: string;

  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;
  private readonly apiKey: string;

  constructor(targetName: string, config: OpenRouterResolvedConfig) {
    this.id = `openrouter:${targetName}`;
    this.targetName = targetName;
    this.apiKey = config.apiKey;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;
    // OpenRouter exposes an OpenAI-compatible endpoint; pi-ai routes it through
    // openai-completions with a fixed baseUrl.
    this.piModel = resolvePiModel({
      providerName: 'openrouter',
      apiId: 'openai-completions',
      modelId: config.model,
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokePiAi({
      model: this.piModel,
      apiKey: this.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }
}

export class AnthropicProvider implements Provider {
  readonly id: string;
  readonly kind = 'anthropic' as const;
  readonly targetName: string;

  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;
  private readonly apiKey: string;
  private readonly thinkingBudget?: number;

  constructor(targetName: string, config: AnthropicResolvedConfig) {
    this.id = `anthropic:${targetName}`;
    this.targetName = targetName;
    this.apiKey = config.apiKey;
    this.thinkingBudget = config.thinkingBudget;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      thinkingBudget: config.thinkingBudget,
    };
    this.retryConfig = config.retry;
    this.piModel = resolvePiModel({
      providerName: 'anthropic',
      apiId: 'anthropic-messages',
      modelId: config.model,
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    // Pi-ai's Anthropic provider takes the same numeric thinking budget as the
    // legacy Vercel path — no lossy bucket mapping needed for older models.
    // Newer models (Opus 4.6, Sonnet 4.6) ignore thinkingBudgetTokens in favor
    // of adaptive thinking; we still pass it for forward-compat.
    const providerOptions =
      this.thinkingBudget !== undefined
        ? { thinkingEnabled: true, thinkingBudgetTokens: this.thinkingBudget }
        : undefined;

    return invokePiAi({
      model: this.piModel,
      apiKey: this.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
      ...(providerOptions ? { providerOptions } : {}),
    });
  }
}

export class GeminiProvider implements Provider {
  readonly id: string;
  readonly kind = 'gemini' as const;
  readonly targetName: string;

  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;
  private readonly apiKey: string;

  constructor(targetName: string, config: GeminiResolvedConfig) {
    this.id = `gemini:${targetName}`;
    this.targetName = targetName;
    this.apiKey = config.apiKey;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;
    this.piModel = resolvePiModel({
      providerName: 'google',
      apiId: 'google-generative-ai',
      modelId: config.model,
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokePiAi({
      model: this.piModel,
      apiKey: this.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }
}

export class AzureProvider implements Provider {
  readonly id: string;
  readonly kind = 'azure' as const;
  readonly targetName: string;

  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;
  private readonly apiKey: string;
  private readonly providerOptions: Record<string, unknown>;

  constructor(targetName: string, config: AzureResolvedConfig) {
    this.id = `azure:${targetName}`;
    this.targetName = targetName;
    this.apiKey = config.apiKey;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;

    // Pi-ai's azure-openai-responses provider handles the Azure-specific URL
    // shape and api-version query param. We pass either a full base URL or a
    // resource name + apiVersion via providerOptions; pi-ai does the rest.
    //
    // apiFormat is intentionally not branched here: pi-ai uses Azure's
    // Responses API for both chat-style and responses-style calls. Users who
    // hit an Azure deployment that only exposes /chat/completions can route
    // through `provider: openai` with a deployment-scoped baseURL instead.
    const trimmed = config.resourceName.trim();
    const isFullUrl = /^https?:\/\//i.test(trimmed);
    const baseUrl = isFullUrl ? buildAzureBaseUrl(trimmed) : undefined;

    this.providerOptions = {
      ...(baseUrl ? { azureBaseUrl: baseUrl } : { azureResourceName: trimmed }),
      ...(config.version ? { azureApiVersion: config.version } : {}),
    };

    this.piModel = resolvePiModel({
      providerName: 'azure-openai-responses',
      apiId: 'azure-openai-responses',
      // The "model id" for Azure is the deployment name.
      modelId: config.deploymentName,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokePiAi({
      model: this.piModel,
      apiKey: this.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
      providerOptions: this.providerOptions,
    });
  }
}

/**
 * Normalize a user-supplied Azure URL to pi-ai's expected base.
 *
 * Pi-ai's azure-openai-responses appends `/responses?api-version=...` to the
 * baseUrl, so the URL we hand it should end at the `/openai/v1` segment.
 * Accept either:
 *   - https://<resource>.openai.azure.com         → add `/openai/v1`
 *   - https://<resource>.openai.azure.com/openai  → replace `/openai` with `/openai/v1`
 *   - https://<resource>.openai.azure.com/openai/v1 → keep as-is
 */
function buildAzureBaseUrl(input: string): string {
  const trimmed = input.replace(/\/+$/, '');
  if (trimmed.endsWith('/openai/v1')) return trimmed;
  if (trimmed.endsWith('/openai')) return `${trimmed}/v1`;
  return `${trimmed}/openai/v1`;
}

// ---------------------------------------------------------------------------
// Shared adapter — invokePiAi runs the model call (single-shot or agent loop)
// ---------------------------------------------------------------------------

export interface InvokePiAiOptions {
  /** Pre-resolved pi-ai model (built once in the provider constructor). */
  readonly model: PiModel;
  /**
   * Per-call credential — pi-ai treats apiKey as a StreamOptions field. When
   * omitted, pi-ai falls back to the provider-specific env var (OPENAI_API_KEY,
   * ANTHROPIC_API_KEY, ...). The agentv provider relies on that fallback.
   */
  readonly apiKey?: string;
  readonly request: ProviderRequest;
  readonly defaults: ProviderDefaults;
  readonly retryConfig?: RetryConfig;
  /**
   * Provider-specific options merged into pi-ai's call options. Pi-ai's
   * ProviderStreamOptions is `StreamOptions & Record<string, unknown>`, so
   * extra keys flow through to the underlying provider impl. Example:
   * Anthropic accepts `{ thinkingEnabled: true, thinkingBudgetTokens: 8000 }`.
   */
  readonly providerOptions?: Record<string, unknown>;
}

export async function invokePiAi(options: InvokePiAiOptions): Promise<ProviderResponse> {
  const { model, apiKey, request, defaults, retryConfig, providerOptions } = options;
  const tools = request.tools && request.tools.length > 0 ? request.tools : undefined;
  const maxSteps = tools ? Math.max(1, request.maxSteps ?? 1) : 1;

  const { systemPrompt, messages } = chatPromptToPiContext(buildChatPrompt(request));
  if (request.images && request.images.length > 0) {
    attachImagesToLastUserMessage(messages, request.images);
  }
  const piTools: PiTool[] | undefined = tools
    ? tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    : undefined;
  const ctx = { systemPrompt, messages, ...(piTools ? { tools: piTools } : {}) };
  const { temperature, maxOutputTokens } = resolveModelSettings(request, defaults);
  const callOptions = {
    ...(apiKey !== undefined ? { apiKey } : {}),
    temperature,
    ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
    signal: request.signal,
    ...(providerOptions ?? {}),
  };

  const startTime = new Date().toISOString();
  const startMs = Date.now();

  const aggregateUsage: AggregatedUsage = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  let stepCount = 0;
  let toolCallCount = 0;
  let result: PiAssistantMessage = await withRetry(
    () => piComplete(model, ctx, callOptions),
    retryConfig,
    request.signal,
  );
  ctx.messages.push(result);
  stepCount = 1;
  accumulateUsage(aggregateUsage, result.usage);

  // Agent loop: run tool calls and re-invoke until the model stops requesting
  // tools or we hit maxSteps. Single-shot calls (no tools) skip this entirely.
  while (tools) {
    const calls = result.content.filter(
      (b: PiAssistantMessage['content'][number]): b is PiToolCall => b.type === 'toolCall',
    );
    if (calls.length === 0) break;
    if (stepCount >= maxSteps) break;

    toolCallCount += calls.length;

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      let output: unknown;
      let isError = false;
      try {
        if (!tool) {
          throw new Error(`pi-ai adapter: model called unknown tool '${call.name}'`);
        }
        output = await tool.execute(call.arguments);
      } catch (err) {
        output = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      ctx.messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [
          { type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) },
        ],
        isError,
        timestamp: Date.now(),
      });
    }

    result = await withRetry(
      () => piComplete(model, ctx, callOptions),
      retryConfig,
      request.signal,
    );
    ctx.messages.push(result);
    stepCount += 1;
    accumulateUsage(aggregateUsage, result.usage);
  }

  const endTime = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  return mapPiResponse(result, {
    durationMs,
    startTime,
    endTime,
    aggregateUsage,
    steps: tools ? { count: stepCount, toolCallCount } : undefined,
  });
}

interface AggregatedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}

function accumulateUsage(agg: AggregatedUsage, u: PiAssistantMessage['usage']): void {
  agg.input += u.input;
  agg.output += u.output;
  agg.cacheRead += u.cacheRead;
  agg.cost += u.cost.total;
}

export function resolvePiModel(args: {
  providerName: string;
  apiId: string;
  modelId: string;
  baseUrl?: string;
}): PiModel {
  const { providerName, apiId, modelId, baseUrl } = args;

  // pi-ai's getModel returns a Model when (provider, modelId) is in its
  // registry; otherwise we synthesize a minimal descriptor — every field is
  // required by the Model interface.
  let model: PiModel | undefined;
  try {
    model = piGetModel(providerName, modelId) as PiModel;
  } catch {
    model = undefined;
  }

  if (!model) {
    const fallbackBaseUrl = baseUrl ?? defaultBaseUrlFor(providerName);
    if (!fallbackBaseUrl) {
      throw new Error(
        `pi-ai adapter cannot resolve a baseUrl for provider '${providerName}' / model '${modelId}'. Either set the target's baseUrl/endpoint or use a model id pi-ai recognizes.`,
      );
    }
    model = {
      id: modelId,
      name: modelId,
      api: apiId,
      provider: providerName,
      baseUrl: fallbackBaseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    };
  }

  if (model.api !== apiId) {
    model = { ...model, api: apiId };
  }
  if (baseUrl) {
    model = { ...model, baseUrl };
  }

  return model;
}

/**
 * Default baseUrl when `getModel` misses and the caller didn't supply one.
 * Returning `undefined` makes resolvePiModel throw — preferable to passing an
 * empty string into pi-ai's OpenAI client, which fails opaquely.
 */
function defaultBaseUrlFor(providerName: string): string | undefined {
  if (providerName === 'openai') return 'https://api.openai.com/v1';
  if (providerName === 'openrouter') return 'https://openrouter.ai/api/v1';
  return undefined;
}

interface PiContext {
  readonly systemPrompt: string | undefined;
  readonly messages: PiMessage[];
}

function chatPromptToPiContext(chatPrompt: ChatPrompt): PiContext {
  const systemSegments: string[] = [];
  const messages: PiMessage[] = [];
  const now = Date.now();

  for (const message of chatPrompt) {
    if (message.role === 'system') {
      systemSegments.push(message.content);
      continue;
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.content, timestamp: now });
      continue;
    }
    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: message.content }],
        api: '',
        provider: '',
        model: '',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
      continue;
    }
    if (message.role === 'tool' || message.role === 'function') {
      const prefix = message.name ? `@[${message.name}]: ` : '@[Tool]: ';
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: `${prefix}${message.content}` }],
        api: '',
        provider: '',
        model: '',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
      continue;
    }
    throw new Error(`pi-ai adapter received unsupported message role '${message.role}'.`);
  }

  return {
    systemPrompt: systemSegments.length > 0 ? systemSegments.join('\n\n') : undefined,
    messages,
  };
}

function attachImagesToLastUserMessage(
  messages: PiMessage[],
  images: ProviderRequest['images'],
): void {
  if (!images || images.length === 0) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : '';
    messages[i] = {
      ...m,
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...images.map((img) => ({
          type: 'image' as const,
          data: img.source,
          mimeType: img.media_type,
        })),
      ],
    };
    return;
  }
  // No user message to attach images to — synthesize one.
  messages.push({
    role: 'user',
    content: images.map((img) => ({
      type: 'image' as const,
      data: img.source,
      mimeType: img.media_type,
    })),
    timestamp: Date.now(),
  });
}

function mapPiResponse(
  result: PiAssistantMessage,
  timing: {
    durationMs: number;
    startTime: string;
    endTime: string;
    aggregateUsage: AggregatedUsage;
    steps?: { count: number; toolCallCount: number };
  },
): ProviderResponse {
  const text = result.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Token usage is aggregated across all model turns in the agent loop, not
  // just the final turn. Single-shot calls have aggregateUsage == lastTurnUsage.
  const cached = timing.aggregateUsage.cacheRead > 0 ? timing.aggregateUsage.cacheRead : undefined;
  const tokenUsage = {
    input: timing.aggregateUsage.input,
    output: timing.aggregateUsage.output,
    ...(cached !== undefined ? { cached } : {}),
  };

  // pi-ai always populates `cost.total`, but it computes 0 when the model
  // descriptor lacks pricing (fallback descriptor for unknown ids, or pi-ai's
  // registry simply not having rates yet). Surface 0 as "unknown" by leaving
  // costUsd undefined — keeps parity with consumers that previously saw it
  // unset.
  const costUsd = timing.aggregateUsage.cost > 0 ? timing.aggregateUsage.cost : undefined;

  return {
    raw: result,
    usage: toJsonObject(result.usage),
    output: [{ role: 'assistant' as const, content: text }],
    tokenUsage,
    ...(costUsd !== undefined ? { costUsd } : {}),
    durationMs: timing.durationMs,
    startTime: timing.startTime,
    endTime: timing.endTime,
    ...(timing.steps ? { steps: timing.steps } : {}),
  };
}

// ---------------------------------------------------------------------------
// Chat-prompt construction (shared with old paths; not pi-ai-specific)
// ---------------------------------------------------------------------------

function buildChatPrompt(request: ProviderRequest): ChatPrompt {
  const provided = request.chatPrompt?.length ? request.chatPrompt : undefined;
  if (provided) {
    const hasSystemMessage = provided.some((message) => message.role === 'system');
    if (hasSystemMessage) {
      return provided;
    }
    const systemContent = resolveSystemContent(request);
    return [{ role: 'system', content: systemContent }, ...provided];
  }

  const systemContent = resolveSystemContent(request);
  const userContent = request.question.trim();

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

function resolveSystemContent(request: ProviderRequest): string {
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    return request.systemPrompt.trim();
  }
  return DEFAULT_SYSTEM_PROMPT;
}

function resolveModelSettings(
  request: ProviderRequest,
  defaults: ProviderDefaults,
): { temperature?: number; maxOutputTokens?: number } {
  return {
    temperature: request.temperature ?? defaults.temperature,
    maxOutputTokens: request.maxOutputTokens ?? defaults.maxOutputTokens,
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

// ---------------------------------------------------------------------------
// Retry / backoff — library-agnostic; wraps any async fn that may transient-fail
// ---------------------------------------------------------------------------

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

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
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as Record<string, unknown>;
  if (candidate.name === 'AbortError') return false;

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
  if (status === 401 || status === 403) return false;
  if (typeof status === 'number') return retryableStatusCodes.includes(status);
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

      if (attempt >= config.maxRetries) break;
      if (!isRetryableError(error, config.retryableStatusCodes)) throw error;

      const delay = calculateRetryDelay(attempt, config);
      await sleep(delay);
    }
  }

  throw lastError;
}
