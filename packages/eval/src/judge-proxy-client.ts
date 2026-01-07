/**
 * Client for invoking the AgentV judge proxy from code_judge scripts.
 *
 * Environment variables (set automatically by AgentV when `judge` config is present):
 * - AGENTV_JUDGE_PROXY_URL: The URL of the local proxy server
 * - AGENTV_JUDGE_PROXY_TOKEN: Bearer token for authentication
 */

/**
 * Request to invoke the judge
 */
export interface JudgeInvokeRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly evalCaseId?: string;
  readonly attempt?: number;
}

/**
 * Response from a judge invocation
 */
export interface JudgeInvokeResponse {
  readonly outputMessages: readonly unknown[];
  readonly rawText?: string;
}

/**
 * Judge proxy client for making judge invocations
 */
export interface JudgeProxyClient {
  /**
   * Invoke the configured judge target with a prompt.
   * @param request - The question and optional system prompt
   * @returns The judge's response with output messages and optional raw text
   */
  invoke(request: JudgeInvokeRequest): Promise<JudgeInvokeResponse>;

  /**
   * Invoke the judge with multiple requests in sequence.
   * Each request counts toward the max_calls limit.
   * @param requests - Array of judge requests
   * @returns Array of judge responses
   */
  invokeBatch(requests: readonly JudgeInvokeRequest[]): Promise<readonly JudgeInvokeResponse[]>;
}

/**
 * Error thrown when judge proxy is not available
 */
export class JudgeProxyNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeProxyNotAvailableError';
  }
}

/**
 * Error thrown when judge invocation fails
 */
export class JudgeInvocationError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'JudgeInvocationError';
    this.statusCode = statusCode;
  }
}

/**
 * Create a judge proxy client from environment variables.
 *
 * This function reads the proxy URL and token from environment variables
 * that are automatically set by AgentV when a `judge` config block is present
 * on a `code_judge` evaluator.
 *
 * @returns A judge proxy client if environment variables are set, otherwise undefined
 * @throws JudgeProxyNotAvailableError if token is missing when URL is present
 *
 * @example
 * ```typescript
 * import { createJudgeProxyClient, defineCodeJudge } from '@agentv/eval';
 *
 * export default defineCodeJudge(async ({ question, expectedOutcome }) => {
 *   const judge = createJudgeProxyClient();
 *
 *   if (!judge) {
 *     // Judge proxy not available - no judge config on this evaluator
 *     return { score: 0.5, reasoning: 'Judge not available' };
 *   }
 *
 *   const response = await judge.invoke({
 *     question: `Is this answer correct? Question: ${question}, Expected: ${expectedOutcome}`,
 *     systemPrompt: 'You are an expert evaluator. Respond with JSON: { "correct": true/false }'
 *   });
 *
 *   const result = JSON.parse(response.rawText ?? '{}');
 *   return { score: result.correct ? 1.0 : 0.0 };
 * });
 * ```
 */
export function createJudgeProxyClient(): JudgeProxyClient | undefined {
  const proxyUrl = process.env.AGENTV_JUDGE_PROXY_URL;
  const proxyToken = process.env.AGENTV_JUDGE_PROXY_TOKEN;

  if (!proxyUrl) {
    return undefined;
  }

  if (!proxyToken) {
    throw new JudgeProxyNotAvailableError(
      'AGENTV_JUDGE_PROXY_URL is set but AGENTV_JUDGE_PROXY_TOKEN is missing',
    );
  }

  return createJudgeProxyClientInternal(proxyUrl, proxyToken);
}

/**
 * Internal: Create a judge proxy client with explicit URL and token.
 * Exported for testing only - use createJudgeProxyClient() in production.
 */
export function createJudgeProxyClientInternal(url: string, token: string): JudgeProxyClient {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    async invoke(request: JudgeInvokeRequest): Promise<JudgeInvokeResponse> {
      const response = await fetch(`${url}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: request.question,
          systemPrompt: request.systemPrompt,
          evalCaseId: request.evalCaseId,
          attempt: request.attempt,
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
        throw new JudgeInvocationError(errorMessage, response.status);
      }

      return (await response.json()) as JudgeInvokeResponse;
    },

    async invokeBatch(
      requests: readonly JudgeInvokeRequest[],
    ): Promise<readonly JudgeInvokeResponse[]> {
      const response = await fetch(`${url}/invokeBatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: requests.map((r) => ({
            question: r.question,
            systemPrompt: r.systemPrompt,
            evalCaseId: r.evalCaseId,
            attempt: r.attempt,
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
        throw new JudgeInvocationError(errorMessage, response.status);
      }

      const result = (await response.json()) as { responses: JudgeInvokeResponse[] };
      return result.responses;
    },
  };
}
