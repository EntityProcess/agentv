import { createAnthropic } from '@ai-sdk/anthropic';
import { type AzureOpenAIProviderSettings, createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
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
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type LanguageModel, type ModelMessage, generateText } from 'ai';

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

type TextResult = Awaited<ReturnType<typeof generateText>>;
type GenerateTextOptions = Parameters<typeof generateText>[0];

interface ProviderDefaults {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingBudget?: number;
}

export class OpenAIProvider implements Provider {
  readonly id: string;
  readonly kind = 'openai' as const;
  readonly targetName: string;

  // Vercel LanguageModel kept only for asLanguageModel() callers (llm-grader,
  // composite, agentv-provider) until they migrate off it in #1205. Once gone,
  // delete this field and the createOpenAI build below.
  private readonly model: LanguageModel;
  // pi-ai's Model is plain data — what model, where it lives — with no auth.
  // We resolve once at construction (registry lookup + field merges) and pass
  // it on each invoke. apiKey stays a per-call StreamOptions field, mirroring
  // pi-ai's own API: model and credentials are orthogonal concerns.
  private readonly piModel: PiModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;

  constructor(
    targetName: string,
    private readonly config: OpenAIResolvedConfig,
  ) {
    this.id = `openai:${targetName}`;
    this.targetName = targetName;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;

    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model =
      config.apiFormat === 'responses' ? openai(config.model) : openai.chat(config.model);

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
      apiKey: this.config.apiKey,
      request,
      defaults: this.defaults,
      retryConfig: this.retryConfig,
    });
  }

  asLanguageModel(): LanguageModel {
    return this.model;
  }
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
    this.model =
      config.apiFormat === 'responses'
        ? azure(config.deploymentName)
        : azure.chat(config.deploymentName);
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

export class OpenRouterProvider implements Provider {
  readonly id: string;
  readonly kind = 'openrouter' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;
  private readonly defaults: ProviderDefaults;
  private readonly retryConfig?: RetryConfig;

  constructor(
    targetName: string,
    private readonly config: OpenRouterResolvedConfig,
  ) {
    this.id = `openrouter:${targetName}`;
    this.targetName = targetName;
    this.defaults = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
    this.retryConfig = config.retry;

    const openrouter = createOpenRouter({
      apiKey: config.apiKey,
    });
    this.model = openrouter(config.model);
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
    // Chat completions still use deployment-scoped Azure URLs for compatibility
    // with existing deployments. Responses API should use the SDK's v1 path.
    useDeploymentBasedUrls: config.apiFormat !== 'responses',
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

    const systemContent = resolveSystemContent(request);
    return [{ role: 'system', content: systemContent }, ...provided];
  }

  const systemContent = resolveSystemContent(request);
  const userContent = request.question.trim();

  const prompt: ChatPrompt = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  return prompt;
}

function resolveSystemContent(request: ProviderRequest): string {
  const systemSegments: string[] = [];

  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    systemSegments.push(request.systemPrompt.trim());
  } else {
    systemSegments.push(DEFAULT_SYSTEM_PROMPT);
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

  const startTime = new Date().toISOString();
  const startMs = Date.now();

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

  const endTime = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  return mapResponse(result, { durationMs, startTime, endTime });
}

function mapResponse(
  result: TextResult,
  timing?: { durationMs: number; startTime: string; endTime: string },
): ProviderResponse {
  const content = result.text ?? '';
  const rawUsage = result.totalUsage ?? result.usage;
  const reasoning = rawUsage?.outputTokenDetails?.reasoningTokens ?? undefined;
  const cached = rawUsage?.inputTokenDetails?.cacheReadTokens ?? undefined;
  const tokenUsage =
    rawUsage?.inputTokens != null && rawUsage?.outputTokens != null
      ? {
          input: rawUsage.inputTokens,
          output: rawUsage.outputTokens,
          ...(reasoning != null ? { reasoning } : {}),
          ...(cached != null ? { cached } : {}),
        }
      : undefined;

  return {
    raw: result,
    usage: toJsonObject(rawUsage),
    output: [{ role: 'assistant' as const, content }],
    tokenUsage,
    durationMs: timing?.durationMs,
    startTime: timing?.startTime,
    endTime: timing?.endTime,
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

// ---------------------------------------------------------------------------
// pi-ai migration (issue #1205)
// ---------------------------------------------------------------------------
//
// invokePiAi runs a single non-streaming, non-tool-using completion through
// @mariozechner/pi-ai. It is the new code path; the existing invokeModel
// (Vercel AI SDK) above is still in use for the four providers we have not
// ported yet (Azure, OpenRouter, Anthropic, Gemini).
//
// Types come through `@mariozechner/pi-ai` plus our local `pi-ai-shim.d.ts`
// ambient augmentation. Pi-ai's published d.ts re-exports do not surface at
// the package root under NodeNext, so the shim re-declares the small subset
// we use (Model, Message, complete, getModel, ...). See pi-ai-shim.d.ts.
//
// To port a provider:
//   1. Map its config to the invokePiAi options below (api id, baseUrl, key).
//   2. Replace the provider's invoke() to call invokePiAi.
//   3. Drop the createX() / this.model build from the constructor when
//      asLanguageModel() is no longer used by any consumer.

interface InvokePiAiOptions {
  /** Pre-resolved pi-ai model (built once in the provider constructor). */
  readonly model: PiModel;
  /** Per-call credential — pi-ai treats apiKey as a StreamOptions field. */
  readonly apiKey: string;
  readonly request: ProviderRequest;
  readonly defaults: ProviderDefaults;
  readonly retryConfig?: RetryConfig;
}

async function invokePiAi(options: InvokePiAiOptions): Promise<ProviderResponse> {
  const { model, apiKey, request, defaults, retryConfig } = options;
  const tools = request.tools && request.tools.length > 0 ? request.tools : undefined;
  const maxSteps = tools ? Math.max(1, request.maxSteps ?? 1) : 1;

  const { systemPrompt, messages } = chatPromptToPiContext(buildChatPrompt(request));
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
    apiKey,
    temperature,
    ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
    signal: request.signal,
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

function resolvePiModel(args: {
  providerName: string;
  apiId: string;
  modelId: string;
  baseUrl?: string;
}): PiModel {
  const { providerName, apiId, modelId, baseUrl } = args;

  // pi-ai's getModel returns a Model when the (provider, modelId) pair is in
  // its generated registry. For runtime-string configs or unknown model ids
  // we construct a minimal descriptor — every field is required by Model.
  // piGetModel's upstream signature is generic over a typed model registry; at
  // runtime the strings flow through and it returns a plain Model. The cast
  // converts the unresolved generic return type to the shim's Model.
  let model: PiModel | undefined;
  try {
    model = piGetModel(providerName, modelId) as PiModel;
  } catch {
    model = undefined;
  }

  if (!model) {
    // pi-ai's getModel didn't recognize this (provider, modelId) — typical when
    // the user is on a custom gateway, a brand-new model, or an Azure deployment
    // name. We must still hand pi-ai a non-empty baseUrl: pi-ai forwards it to
    // `new OpenAI({ baseURL })` which misbehaves on empty string.
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
  if (providerName === 'openai') {
    return 'https://api.openai.com/v1';
  }
  return undefined;
}

interface PiContext {
  readonly systemPrompt: string | undefined;
  readonly messages: PiMessage[];
}

function chatPromptToPiContext(chatPrompt: ChatPrompt): PiContext {
  // OpenAIProvider.invoke() is reached from the orchestrator's multi-turn
  // and single-turn paths, so the chatPrompt may legitimately contain
  // `assistant` (prior turn output) and `tool`/`function` (rare — most callers
  // remap these upstream in prompt-builder). We mirror the Vercel path's
  // toModelMessages: pass assistant through as-is; fold tool/function back
  // into assistant text with a `@[name]:` prefix so pi-ai sees a clean
  // user/assistant alternation.
  //
  // Pi-ai's AssistantMessage type carries api/provider/model/usage/stopReason
  // for round-trip continuity, but its OpenAI-completions converter only reads
  // role + content blocks for replayed history. We synthesize a minimal
  // assistant turn with placeholder metadata — pi-ai ignores those fields when
  // converting to the wire format.
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
  // costUsd undefined — matches the Vercel path, which never sets it.
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
