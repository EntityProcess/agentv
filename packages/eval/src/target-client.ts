/**
 * Client for invoking configured targets from code_judge scripts.
 *
 * Environment variables (set automatically by AgentV when `target` config is present):
 * - AGENTV_TARGET_PROXY_URL: The URL of the local proxy server
 * - AGENTV_TARGET_PROXY_TOKEN: Bearer token for authentication
 */

/**
 * Request to invoke the target
 */
export interface TargetInvokeRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly evalCaseId?: string;
  readonly attempt?: number;
  /** Optional target override - use a different target for this invocation */
  readonly target?: string;
}

/**
 * Response from a target invocation
 */
export interface TargetInvokeResponse {
  readonly output: readonly unknown[];
  readonly rawText?: string;
}

/**
 * Information about the target proxy configuration
 */
export interface TargetInfo {
  /** Name of the default target being used */
  readonly targetName: string;
  /** Maximum number of calls allowed */
  readonly maxCalls: number;
  /** Current number of calls made */
  readonly callCount: number;
  /** List of all available target names */
  readonly availableTargets: readonly string[];
}

/**
 * Target client for making target invocations
 */
export interface TargetClient {
  /**
   * Invoke the configured target with a prompt.
   * @param request - The question and optional system prompt
   * @returns The target's response with output messages and optional raw text
   */
  invoke(request: TargetInvokeRequest): Promise<TargetInvokeResponse>;

  /**
   * Invoke the target with multiple requests in sequence.
   * Each request counts toward the max_calls limit.
   * @param requests - Array of target requests
   * @returns Array of target responses
   */
  invokeBatch(requests: readonly TargetInvokeRequest[]): Promise<readonly TargetInvokeResponse[]>;

  /**
   * Get information about the target proxy configuration.
   * Returns the default target name, max calls, current call count, and available targets.
   */
  getInfo(): Promise<TargetInfo>;
}

/**
 * Error thrown when target proxy is not available
 */
export class TargetNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetNotAvailableError';
  }
}

/**
 * Error thrown when target invocation fails
 */
export class TargetInvocationError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'TargetInvocationError';
    this.statusCode = statusCode;
  }
}

/**
 * Create a target client from environment variables.
 *
 * This function reads the proxy URL and token from environment variables
 * that are automatically set by AgentV when a `target` config block is present
 * on a `code_judge` evaluator.
 *
 * @returns A target client if environment variables are set, otherwise undefined
 * @throws TargetNotAvailableError if token is missing when URL is present
 *
 * @example
 * ```typescript
 * import { createTargetClient, defineCodeJudge } from '@agentv/eval';
 *
 * export default defineCodeJudge(async ({ question, criteria }) => {
 *   const target = createTargetClient();
 *
 *   if (!target) {
 *     // Target not available - no target config on this evaluator
 *     return { score: 0.5, reasoning: 'Target not available' };
 *   }
 *
 *   const response = await target.invoke({
 *     question: `Is this answer correct? Question: ${question}, Expected: ${criteria}`,
 *     systemPrompt: 'You are an expert evaluator. Respond with JSON: { "correct": true/false }'
 *   });
 *
 *   const result = JSON.parse(response.rawText ?? '{}');
 *   return { score: result.correct ? 1.0 : 0.0 };
 * });
 * ```
 */
export function createTargetClient(): TargetClient | undefined {
  const proxyUrl = process.env.AGENTV_TARGET_PROXY_URL;
  const proxyToken = process.env.AGENTV_TARGET_PROXY_TOKEN;

  if (!proxyUrl) {
    return undefined;
  }

  if (!proxyToken) {
    throw new TargetNotAvailableError(
      'AGENTV_TARGET_PROXY_URL is set but AGENTV_TARGET_PROXY_TOKEN is missing',
    );
  }

  return createTargetClientInternal(proxyUrl, proxyToken);
}

/**
 * Internal: Create a target client with explicit URL and token.
 * Exported for testing only - use createTargetClient() in production.
 */
export function createTargetClientInternal(url: string, token: string): TargetClient {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    async invoke(request: TargetInvokeRequest): Promise<TargetInvokeResponse> {
      const response = await fetch(`${url}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: request.question,
          systemPrompt: request.systemPrompt,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
          target: request.target,
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
        throw new TargetInvocationError(errorMessage, response.status);
      }

      return (await response.json()) as TargetInvokeResponse;
    },

    async invokeBatch(
      requests: readonly TargetInvokeRequest[],
    ): Promise<readonly TargetInvokeResponse[]> {
      const response = await fetch(`${url}/invokeBatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: requests.map((r) => ({
            question: r.question,
            systemPrompt: r.systemPrompt,
            evalCaseId: r.evalCaseId,
            attempt: r.attempt,
            target: r.target,
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
        throw new TargetInvocationError(errorMessage, response.status);
      }

      const result = (await response.json()) as { responses: TargetInvokeResponse[] };
      return result.responses;
    },

    async getInfo(): Promise<TargetInfo> {
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
        throw new TargetInvocationError(errorMessage, response.status);
      }

      return (await response.json()) as TargetInfo;
    },
  };
}
