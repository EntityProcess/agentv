import type { Provider, ProviderKind, ProviderRequest, ProviderResponse } from './types.js';

/**
 * Wraps a user-provided task function as a Provider.
 * Used by Eval() when `task` is specified instead of `target`.
 */
export function createFunctionProvider(
  taskFn: (input: string) => string | Promise<string>,
): Provider {
  return {
    id: 'function-provider',
    kind: 'mock' as ProviderKind,
    targetName: 'custom-task',
    async invoke(request: ProviderRequest): Promise<ProviderResponse> {
      const startTime = new Date().toISOString();
      const start = Date.now();
      const result = await taskFn(request.question);
      const endTime = new Date().toISOString();
      return {
        output: [{ role: 'assistant', content: result }],
        durationMs: Date.now() - start,
        startTime,
        endTime,
      };
    },
  };
}
