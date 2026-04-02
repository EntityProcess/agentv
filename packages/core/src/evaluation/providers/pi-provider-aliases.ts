/**
 * Shared alias map for pi-ai subprovider names.
 *
 * Target configs use `subprovider: azure` for Azure OpenAI. The behavior
 * differs between the SDK and CLI:
 *
 * **pi-coding-agent SDK:** When a `base_url` is provided (Azure v1 endpoints
 * like .services.ai.azure.com/…/openai/v1), uses the standard OpenAI client
 * (openai-responses) since v1 endpoints don't accept api-version params.
 * Without base_url, uses the native azure-openai-responses provider.
 *
 * **pi CLI:** Always uses azure-openai-responses with AZURE_OPENAI_RESOURCE_NAME.
 * The CLI's azure provider builds the correct URL internally.
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

/**
 * Resolve a subprovider config value for the pi CLI --provider flag.
 * For azure, always uses azure-openai-responses — the CLI handles URL
 * construction via AZURE_OPENAI_RESOURCE_NAME.
 */
export function resolveCliProvider(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'azure') return 'azure-openai-responses';
  return name;
}

/**
 * Resolve the environment variable name for the API key.
 * When azure + base_url (SDK path), the key goes to OPENAI_API_KEY.
 * For CLI path, always AZURE_OPENAI_API_KEY.
 */
export function resolveEnvKeyName(provider: string, hasBaseUrl = false): string | undefined {
  const lower = provider.toLowerCase();
  if (hasBaseUrl && lower === 'azure') return 'OPENAI_API_KEY';
  return ENV_KEY_MAP[lower];
}

/**
 * Resolve the environment variable name for the base URL.
 * When azure + base_url (SDK path), goes to OPENAI_BASE_URL.
 * For CLI path, goes to AZURE_OPENAI_RESOURCE_NAME.
 */
export function resolveEnvBaseUrlName(provider: string, hasBaseUrl = false): string | undefined {
  const lower = provider.toLowerCase();
  if (hasBaseUrl && lower === 'azure') return 'OPENAI_BASE_URL';
  return ENV_BASE_URL_MAP[lower];
}

/**
 * For pi-cli azure, extract resource name from base_url and set
 * AZURE_OPENAI_RESOURCE_NAME. The pi CLI builds the full URL internally.
 */
export function extractAzureResourceName(baseUrl: string): string {
  // Handle full URL: https://resource.openai.azure.com/... or https://resource.services.ai.azure.com/...
  const urlMatch = baseUrl.match(/^https?:\/\/([^./]+)/);
  if (urlMatch) return urlMatch[1];
  // Already a resource name
  return baseUrl;
}
