import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModel, createProviderRegistry } from 'ai';

import type { AgentVResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

/**
 * Lazily-created singleton provider registry for resolving AI SDK model strings.
 * Maps provider prefixes (e.g., "openai", "anthropic") to their AI SDK provider
 * implementations so that model strings like "openai:gpt-5-mini" can be resolved
 * to LanguageModel instances.
 */
let _registry: { languageModel: (id: string) => LanguageModel } | null = null;

function getAiSdkRegistry(): { languageModel: (id: string) => LanguageModel } {
  if (!_registry) {
    // Cast through unknown: the registry's languageModel signature uses narrowed
    // literal types, but we need to accept arbitrary model strings at runtime.
    _registry = createProviderRegistry({
      openai: createOpenAI(),
      anthropic: createAnthropic(),
      azure: createAzure(),
      google: createGoogleGenerativeAI(),
    }) as unknown as { languageModel: (id: string) => LanguageModel };
  }
  return _registry;
}

/**
 * AgentV built-in provider for LLM judge evaluation.
 *
 * Resolves an AI SDK model string (e.g., "openai:gpt-5-mini", "anthropic:claude-sonnet-4-20250514")
 * to a Vercel AI SDK LanguageModel using createProviderRegistry. This provider is used
 * exclusively for judge evaluation — it does not support direct agent invocation.
 *
 * Usage: `--judge-target agentv --model openai:gpt-5-mini`
 */
export class AgentvProvider implements Provider {
  readonly id: string;
  readonly kind = 'agentv' as const;
  readonly targetName: string;

  private readonly model: LanguageModel;
  private readonly config: AgentVResolvedConfig;

  constructor(targetName: string, config: AgentVResolvedConfig) {
    this.id = `agentv:${targetName}`;
    this.targetName = targetName;
    this.config = config;

    const registry = getAiSdkRegistry();
    this.model = registry.languageModel(config.model);
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
