/**
 * Shared alias map for pi-ai subprovider names.
 *
 * Target configs use `subprovider: azure` for Azure OpenAI. When a `base_url`
 * is provided (e.g. Azure v1 endpoints like .services.ai.azure.com/…/openai/v1),
 * we use the standard OpenAI client instead of AzureOpenAI — the v1 endpoint is
 * OpenAI-compatible and doesn't accept api-version query params.
 *
 * When no base_url is provided, we use the native azure-openai-responses provider
 * which builds the URL from AZURE_OPENAI_RESOURCE_NAME.
 */

/** Short alias → pi-ai SDK provider name (when no base_url override). */
const SUBPROVIDER_ALIASES: Record<string, string> = {
  azure: 'azure-openai-responses',
};

/** Short alias → pi-ai SDK provider name (when base_url is set). */
const SUBPROVIDER_ALIASES_WITH_BASE_URL: Record<string, string> = {
  // Azure v1 endpoints are OpenAI-compatible; use the standard client
  // to avoid AzureOpenAI adding api-version query params.
  azure: 'openai-responses',
};

/** Short alias → environment variable for API key. */
export const ENV_KEY_MAP: Record<string, string> = {
  google: 'GEMINI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
};

/** Short alias → environment variable for base URL / endpoint. */
export const ENV_BASE_URL_MAP: Record<string, string> = {
  openai: 'OPENAI_BASE_URL',
  azure: 'AZURE_OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
};

/**
 * Resolve a subprovider config value to the SDK's canonical name.
 * When `hasBaseUrl` is true and the provider is "azure", uses the standard
 * OpenAI client (openai-responses) instead of AzureOpenAI to avoid
 * api-version conflicts with /v1 endpoints.
 */
export function resolveSubprovider(name: string, hasBaseUrl = false): string {
  const lower = name.toLowerCase();
  if (hasBaseUrl) {
    const alias = SUBPROVIDER_ALIASES_WITH_BASE_URL[lower];
    if (alias) return alias;
  }
  return SUBPROVIDER_ALIASES[lower] ?? name;
}

/** Short alias → pi CLI --provider flag value. */
const CLI_PROVIDER_ALIASES: Record<string, string> = {
  azure: 'azure-openai-responses',
};

const CLI_PROVIDER_ALIASES_WITH_BASE_URL: Record<string, string> = {
  azure: 'openai',
};

/**
 * Resolve a subprovider config value for the pi CLI --provider flag.
 * When `hasBaseUrl` is true and the provider is "azure", uses "openai"
 * (standard OpenAI client) which works with Azure /v1 endpoints.
 */
export function resolveCliProvider(name: string, hasBaseUrl = false): string {
  const lower = name.toLowerCase();
  if (hasBaseUrl) {
    const alias = CLI_PROVIDER_ALIASES_WITH_BASE_URL[lower];
    if (alias) return alias;
  }
  return CLI_PROVIDER_ALIASES[lower] ?? name;
}

/**
 * Resolve the environment variable name for the API key.
 * When azure + base_url, the key goes to OPENAI_API_KEY (standard client).
 */
export function resolveEnvKeyName(provider: string, hasBaseUrl = false): string | undefined {
  const lower = provider.toLowerCase();
  if (hasBaseUrl && lower === 'azure') return 'OPENAI_API_KEY';
  return ENV_KEY_MAP[lower];
}

/**
 * Resolve the environment variable name for the base URL.
 * When azure + base_url, the URL goes to OPENAI_BASE_URL (standard client).
 */
export function resolveEnvBaseUrlName(provider: string, hasBaseUrl = false): string | undefined {
  const lower = provider.toLowerCase();
  if (hasBaseUrl && lower === 'azure') return 'OPENAI_BASE_URL';
  return ENV_BASE_URL_MAP[lower];
}
