import type { Message } from '@agentv/eval';

/**
 * Extract retrieval context from expectedMessages tool calls.
 * Looks for tool calls with an output.results array (common pattern for search tools).
 */
export function extractRetrievalContext(expectedMessages: Message[]): string[] {
  const results: string[] = [];

  for (const message of expectedMessages) {
    if (!message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      // Look for output.results array (common for search/retrieval tools)
      const output = toolCall.output as Record<string, unknown> | undefined;
      if (output && Array.isArray(output.results)) {
        for (const result of output.results) {
          if (typeof result === 'string') {
            results.push(result);
          }
        }
      }
    }
  }

  return results;
}
