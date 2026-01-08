/**
 * Local HTTP proxy server for target invocations from code_judge scripts.
 *
 * Security properties:
 * - Binds to loopback only (127.0.0.1)
 * - Requires bearer token authentication (unique per invocation)
 * - Enforces max_calls limit
 * - Automatically shut down after evaluator completes
 */

import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Provider } from '../evaluation/providers/types.js';

/**
 * Request body for /invoke endpoint
 */
export interface TargetProxyInvokeRequest {
  readonly evalCaseId: string;
  readonly attempt: number;
  readonly question: string;
  readonly systemPrompt?: string;
  /** Optional target override - use a different target for this invocation */
  readonly target?: string;
}

/**
 * Response body for /invoke endpoint
 */
export interface TargetProxyInvokeResponse {
  readonly outputMessages: readonly unknown[];
  readonly rawText?: string;
}

/**
 * Proxy usage metadata recorded after execution
 */
export interface TargetProxyUsageMetadata {
  readonly callCount: number;
  readonly maxCalls: number;
}

/**
 * Response body for /info endpoint
 */
export interface TargetProxyInfoResponse {
  readonly targetName: string;
  readonly maxCalls: number;
  readonly callCount: number;
  readonly availableTargets: readonly string[];
}

/**
 * Function to resolve a target name to a provider
 */
export type TargetResolver = (targetName: string) => Provider | undefined;

/**
 * Options for creating a target proxy
 */
export interface TargetProxyOptions {
  readonly defaultProvider: Provider;
  /** Optional resolver for target override - if not provided, only default target is available */
  readonly targetResolver?: TargetResolver;
  /** Names of all available targets (for /info endpoint) */
  readonly availableTargets?: readonly string[];
  readonly maxCalls: number;
}

/**
 * Active target proxy instance
 */
export interface TargetProxyInstance {
  readonly url: string;
  readonly token: string;
  readonly shutdown: () => Promise<void>;
  readonly getUsageMetadata: () => TargetProxyUsageMetadata;
}

/** Default max calls if not specified */
export const DEFAULT_MAX_CALLS = 50;

/**
 * Create and start a target proxy server.
 */
export async function createTargetProxy(options: TargetProxyOptions): Promise<TargetProxyInstance> {
  const { defaultProvider, targetResolver, availableTargets, maxCalls } = options;

  // Generate unique token for this invocation
  const token = randomBytes(32).toString('hex');

  let callCount = 0;
  let isShutdown = false;

  // Build available targets list - always includes default
  const targetsList: readonly string[] = availableTargets ?? [defaultProvider.targetName];

  /**
   * Resolve a target name to a provider.
   * Returns the default provider if targetName is undefined or matches default.
   * Returns undefined if targetName is unknown.
   */
  function resolveProvider(targetName: string | undefined): Provider | undefined {
    if (targetName === undefined || targetName === defaultProvider.targetName) {
      return defaultProvider;
    }
    if (targetResolver) {
      return targetResolver(targetName);
    }
    return undefined;
  }

  const server = createServer(async (req, res) => {
    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${token}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    // Check if shutdown
    if (isShutdown) {
      sendJson(res, 503, { error: 'Proxy is shutting down' });
      return;
    }

    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/info') {
      handleInfo(res);
      return;
    }

    if (req.method === 'POST' && url === '/invoke') {
      await handleInvoke(req, res);
      return;
    }

    if (req.method === 'POST' && url === '/invokeBatch') {
      await handleInvokeBatch(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  function handleInfo(res: ServerResponse): void {
    const response: TargetProxyInfoResponse = {
      targetName: defaultProvider.targetName,
      maxCalls,
      callCount,
      availableTargets: targetsList,
    };
    sendJson(res, 200, response);
  }

  async function handleInvoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Check call limit
    if (callCount >= maxCalls) {
      sendJson(res, 429, { error: `Max calls exceeded (limit: ${maxCalls})` });
      return;
    }

    try {
      const body = await readBody(req);
      const request = JSON.parse(body) as TargetProxyInvokeRequest;

      // Validate required fields
      if (!request.question || typeof request.question !== 'string') {
        sendJson(res, 400, { error: 'Missing required field: question' });
        return;
      }

      // Resolve target provider
      const provider = resolveProvider(request.target);
      if (!provider) {
        sendJson(res, 400, {
          error: `Unknown target '${request.target}'. Available: ${targetsList.join(', ')}`,
        });
        return;
      }

      callCount++;

      const response = await provider.invoke({
        question: request.question,
        systemPrompt: request.systemPrompt,
        evalCaseId: request.evalCaseId ?? 'proxy',
        attempt: request.attempt ?? 1,
      });

      // Extract output messages and rawText
      const outputMessages = response.outputMessages ?? [];
      const rawText = extractLastAssistantContent(outputMessages);

      const result: TargetProxyInvokeResponse = {
        outputMessages,
        rawText,
      };

      sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  }

  async function handleInvokeBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const { requests } = JSON.parse(body) as { requests: TargetProxyInvokeRequest[] };

      if (!Array.isArray(requests)) {
        sendJson(res, 400, { error: 'Missing required field: requests (array)' });
        return;
      }

      // Check if batch would exceed limit
      if (callCount + requests.length > maxCalls) {
        sendJson(res, 429, {
          error: `Batch would exceed max calls (current: ${callCount}, batch: ${requests.length}, limit: ${maxCalls})`,
        });
        return;
      }

      const responses: TargetProxyInvokeResponse[] = [];

      for (const request of requests) {
        if (!request.question || typeof request.question !== 'string') {
          responses.push({
            outputMessages: [],
            rawText: 'Error: Missing required field: question',
          });
          continue;
        }

        // Resolve target provider
        const provider = resolveProvider(request.target);
        if (!provider) {
          responses.push({
            outputMessages: [],
            rawText: `Error: Unknown target '${request.target}'. Available: ${targetsList.join(', ')}`,
          });
          continue;
        }

        callCount++;

        try {
          const response = await provider.invoke({
            question: request.question,
            systemPrompt: request.systemPrompt,
            evalCaseId: request.evalCaseId ?? 'proxy',
            attempt: request.attempt ?? 1,
          });

          const outputMessages = response.outputMessages ?? [];
          responses.push({
            outputMessages,
            rawText: extractLastAssistantContent(outputMessages),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          responses.push({
            outputMessages: [],
            rawText: `Error: ${message}`,
          });
        }
      }

      sendJson(res, 200, { responses });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  }

  // Bind to loopback only (security requirement)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    token,
    shutdown: async () => {
      isShutdown = true;
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    getUsageMetadata: () => ({
      callCount,
      maxCalls,
    }),
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Extract the text content from the last assistant message.
 */
function extractLastAssistantContent(
  messages: readonly { role: string; content?: unknown }[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content !== undefined) {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        // Handle content array format
        for (const part of msg.content) {
          if (typeof part === 'object' && part !== null && 'text' in part) {
            return String((part as { text: unknown }).text);
          }
        }
      }
    }
  }
  return undefined;
}
