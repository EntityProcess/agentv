/**
 * Runtime-only client for invoking configured providers from script-grader scripts
 * through AgentV's provider proxy.
 *
 * Environment variables (set automatically by AgentV when provider proxy access is enabled):
 * - AGENTV_PROVIDER_PROXY_URL: The URL of the local proxy server
 * - AGENTV_PROVIDER_PROXY_TOKEN: Bearer token for authentication
 */

import type { TokenUsage } from './schemas.js';

/**
 * Request to invoke the provider
 */
export interface ProviderInvokeRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly evalCaseId?: string;
  readonly attempt?: number;
  /** Optional provider override - use a different provider for this invocation */
  readonly provider?: string;
}

/**
 * Response from a provider invocation
 */
export interface ProviderInvokeResponse {
  readonly output: readonly unknown[];
  readonly rawText?: string;
  readonly tokenUsage?: TokenUsage;
}

/**
 * Information about the provider proxy configuration
 */
export interface ProviderInfo {
  /** Label of the default provider being used */
  readonly providerLabel: string;
  /** Maximum number of calls allowed */
  readonly maxCalls: number;
  /** Current number of calls made */
  readonly callCount: number;
  /** Labels of all available providers */
  readonly availableProviderLabels: readonly string[];
}

/**
 * Provider client for making provider invocations
 */
export interface ProviderClient {
  /**
   * Invoke the configured provider with a prompt.
   * @param request - The question and optional system prompt
   * @returns The provider's response with output messages and optional raw text
   */
  invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResponse>;

  /**
   * Invoke the provider with multiple requests in sequence.
   * Each request counts toward the max_calls limit.
   * @param requests - Array of provider requests
   * @returns Array of provider responses
   */
  invokeBatch(
    requests: readonly ProviderInvokeRequest[],
  ): Promise<readonly ProviderInvokeResponse[]>;

  /**
   * Get information about the provider proxy configuration.
   * Returns the default provider label, max calls, current call count, and available providers.
   */
  getInfo(): Promise<ProviderInfo>;
}

/**
 * Error thrown when provider proxy is not available
 */
export class ProviderNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotAvailableError';
  }
}

/**
 * Error thrown when provider invocation fails
 */
export class ProviderInvocationError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ProviderInvocationError';
    this.statusCode = statusCode;
  }
}

/**
 * Create a provider client from environment variables.
 *
 * This function reads the proxy URL and token from environment variables
 * that are automatically set by AgentV when provider access is enabled on a
 * `script` evaluator.
 *
 * @returns A provider client if environment variables are set, otherwise undefined
 * @throws ProviderNotAvailableError if token is missing when URL is present
 *
 * @example
 * ```typescript
 * import { createProviderClient, defineScriptGrader } from 'agentv';
 *
 * export default defineScriptGrader(async ({ input, criteria, output }) => {
 *   const provider = createProviderClient();
 *   const question = input
 *     .filter((message) => message.role === 'user')
 *     .map((message) => typeof message.content === 'string' ? message.content : '')
 *     .join('\n');
 *
 *   if (!provider) {
 *     return { pass: false, score: 0.5, reason: 'Provider proxy not available' };
 *   }
 *
 *   const response = await provider.invoke({
 *     question: `Is this answer correct? Question: ${question}, Expected: ${criteria}, Answer: ${output ?? ''}`,
 *     systemPrompt: 'You are an expert grader. Respond with JSON: { "correct": true/false }'
 *   });
 *
 *   const result = JSON.parse(response.rawText ?? '{}');
 *   return {
 *     pass: result.correct === true,
 *     score: result.correct === true ? 1.0 : 0.0,
 *     reason: result.correct === true ? 'Provider judged the answer correct' : 'Provider judged the answer incorrect',
 *   };
 * });
 * ```
 */
export function createProviderClient(): ProviderClient | undefined {
  const proxyUrl = process.env.AGENTV_PROVIDER_PROXY_URL;
  const proxyToken = process.env.AGENTV_PROVIDER_PROXY_TOKEN;

  if (!proxyUrl) {
    return undefined;
  }

  if (!proxyToken) {
    throw new ProviderNotAvailableError(
      'AGENTV_PROVIDER_PROXY_URL is set but AGENTV_PROVIDER_PROXY_TOKEN is missing',
    );
  }

  return createProviderClientInternal(proxyUrl, proxyToken);
}

/**
 * Internal: Create a provider client with explicit URL and token.
 * Exported for testing only - use createProviderClient() in production.
 */
export function createProviderClientInternal(url: string, token: string): ProviderClient {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResponse> {
      const response = await fetch(`${url}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: request.question,
          systemPrompt: request.systemPrompt,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
          provider: request.provider,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorBody) as { error?: string };
          errorMessage = errorJson.error ?? `HTTP ${response.status}`;
        } catch {
          errorMessage = errorBody || `HTTP ${response.status}`;
        }
        throw new ProviderInvocationError(errorMessage, response.status);
      }

      return (await response.json()) as ProviderInvokeResponse;
    },

    async invokeBatch(
      requests: readonly ProviderInvokeRequest[],
    ): Promise<readonly ProviderInvokeResponse[]> {
      const response = await fetch(`${url}/invokeBatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: requests.map((r) => ({
            question: r.question,
            systemPrompt: r.systemPrompt,
            evalCaseId: r.evalCaseId,
            attempt: r.attempt,
            provider: r.provider,
          })),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorBody) as { error?: string };
          errorMessage = errorJson.error ?? `HTTP ${response.status}`;
        } catch {
          errorMessage = errorBody || `HTTP ${response.status}`;
        }
        throw new ProviderInvocationError(errorMessage, response.status);
      }

      const result = (await response.json()) as { responses: ProviderInvokeResponse[] };
      return result.responses;
    },

    async getInfo(): Promise<ProviderInfo> {
      const response = await fetch(`${url}/info`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorBody) as { error?: string };
          errorMessage = errorJson.error ?? `HTTP ${response.status}`;
        } catch {
          errorMessage = errorBody || `HTTP ${response.status}`;
        }
        throw new ProviderInvocationError(errorMessage, response.status);
      }

      return (await response.json()) as ProviderInfo;
    },
  };
}
