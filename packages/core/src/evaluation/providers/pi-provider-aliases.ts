/**
 * Shared alias map for pi-ai subprovider names.
 *
 * Target configs can use short names (e.g. "azure") which are resolved to
 * the SDK's canonical provider names (e.g. "azure-openai-responses").
 * The ENV_KEY_MAP uses the short names so it stays consistent with other entries.
 */

/** Short alias → pi-ai SDK provider name. */
const SUBPROVIDER_ALIASES: Record<string, string> = {
  azure: 'azure-openai-responses',
  // Azure v1 endpoints (e.g. .services.ai.azure.com) don't accept api-version
  // query params, so use the standard OpenAI client via openai-responses instead.
  'azure-v1': 'openai-responses',
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
  'azure-v1': 'OPENAI_API_KEY',
};

/** Short alias → environment variable for base URL / endpoint. */
export const ENV_BASE_URL_MAP: Record<string, string> = {
  openai: 'OPENAI_BASE_URL',
  azure: 'AZURE_OPENAI_BASE_URL',
  'azure-v1': 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
};

/**
 * Resolve a subprovider config value to the SDK's canonical name.
 * Returns the input unchanged if no alias matches.
 */
export function resolveSubprovider(name: string): string {
  return SUBPROVIDER_ALIASES[name.toLowerCase()] ?? name;
}
