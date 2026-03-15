import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import type { AgentVResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

/**
 * Parse a model string like "openai:gpt-5-mini" into provider prefix and model name.
 */
function parseModelString(model: string): { provider: string; modelName: string } {
  const colonIndex = model.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model string "${model}". Expected format "provider:model" (e.g., "openai:gpt-5-mini")`,
    );
  }
  return {
    provider: model.slice(0, colonIndex),
    modelName: model.slice(colonIndex + 1),
  };
}

/**
 * Create a LanguageModel from a model string using the appropriate AI SDK provider.
 */
function createLanguageModel(modelString: string): LanguageModel {
  const { provider, modelName } = parseModelString(modelString);

  switch (provider) {
    case 'openai':
      // Cast: @ai-sdk/openai may return LanguageModelV3 while the rest of the
      // codebase uses LanguageModelV2. The runtime API is compatible.
      return createOpenAI()(modelName) as unknown as LanguageModel;
    case 'anthropic':
      return createAnthropic()(modelName);
    case 'azure':
      return createAzure()(modelName);
    case 'google':
      return createGoogleGenerativeAI()(modelName);
    default:
      throw new Error(
        `Unsupported AI SDK provider "${provider}" in model string "${modelString}". Supported providers: openai, anthropic, azure, google`,
      );
  }
}

/**
 * AgentV built-in provider for LLM judge evaluation.
 *
 * Resolves an AI SDK model string (e.g., "openai:gpt-5-mini", "anthropic:claude-sonnet-4-20250514")
 * to a Vercel AI SDK LanguageModel by parsing the provider prefix and creating the appropriate
 * AI SDK provider directly. This provider is used exclusively for judge evaluation — it does not
 * support direct agent invocation.
 *
 * Usage: `--judge-target agentv --model openai:gpt-5-mini`
 */
export class AgentvProvider implements Provider {
  readonly id: string;
  readonly kind = 'agentv' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;

  constructor(targetName: string, config: AgentVResolvedConfig) {
    this.id = `agentv:${targetName}`;
    this.targetName = targetName;
    this.model = createLanguageModel(config.model);
  }

  /**
   * Direct invoke is not supported for the agentv provider.
   * Use asLanguageModel() with generateText() instead.
   */
  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    throw new Error(
      'AgentvProvider does not support direct invoke(). Use asLanguageModel() with generateText() instead.',
    );
  }

  /**
   * Returns the resolved AI SDK LanguageModel for use with generateText/generateObject.
   */
  asLanguageModel(): LanguageModel {
    return this.model;
  }
}
