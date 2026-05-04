import { invokePiAi, resolvePiModel } from './llm-providers.js';
import type { AgentVResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

/**
 * AgentV built-in grader provider.
 *
 * Resolves a `provider:model` string (e.g. `openai:gpt-5-mini`,
 * `anthropic:claude-sonnet-4-20250514`) into a pi-ai Model and runs the call
 * through the shared invokePiAi adapter. API keys are read from the
 * provider-specific env var (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...) by pi-ai;
 * we don't carry credentials in this provider's config.
 *
 * Used as `--grader-target agentv --model openai:gpt-5-mini`.
 */
export class AgentvProvider implements Provider {
  readonly id: string;
  readonly kind = 'agentv' as const;
  readonly targetName: string;

  private readonly piModel: ReturnType<typeof resolvePiModel>;
  private readonly defaults: { temperature: number };

  constructor(targetName: string, config: AgentVResolvedConfig) {
    this.id = `agentv:${targetName}`;
    this.targetName = targetName;
    const { providerName, apiId, modelId } = parseAgentvModel(config.model);
    this.piModel = resolvePiModel({ providerName, apiId, modelId });
    this.defaults = { temperature: config.temperature };
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    return invokePiAi({
      model: this.piModel,
      request,
      defaults: this.defaults,
    });
  }
}

/**
 * Parse `provider:model` into the pi-ai routing fields. Each provider
 * shorthand maps to a pi-ai (providerName, apiId) pair:
 *
 *   openai:<id>    → ('openai', 'openai-completions')
 *   anthropic:<id> → ('anthropic', 'anthropic-messages')
 *   azure:<id>     → ('azure-openai-responses', 'azure-openai-responses')
 *   google:<id>    → ('google', 'google-generative-ai')
 */
function parseAgentvModel(model: string): {
  providerName: string;
  apiId: string;
  modelId: string;
} {
  const colonIndex = model.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid agentv model "${model}". Expected "provider:model" (e.g., "openai:gpt-5-mini").`,
    );
  }
  const provider = model.slice(0, colonIndex);
  const modelId = model.slice(colonIndex + 1);

  switch (provider) {
    case 'openai':
      return { providerName: 'openai', apiId: 'openai-completions', modelId };
    case 'anthropic':
      return { providerName: 'anthropic', apiId: 'anthropic-messages', modelId };
    case 'azure':
      return {
        providerName: 'azure-openai-responses',
        apiId: 'azure-openai-responses',
        modelId,
      };
    case 'google':
      return { providerName: 'google', apiId: 'google-generative-ai', modelId };
    default:
      throw new Error(
        `Unsupported agentv provider "${provider}" in "${model}". Supported: openai, anthropic, azure, google.`,
      );
  }
}
