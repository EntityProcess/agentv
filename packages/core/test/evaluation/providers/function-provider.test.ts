import { describe, expect, it } from 'vitest';
import { createFunctionProvider } from '../../../src/evaluation/providers/function-provider.js';

describe('createFunctionProvider', () => {
  it('wraps a sync task function as a Provider', async () => {
    const provider = createFunctionProvider((input) => `Echo: ${input}`);

    expect(provider.id).toBe('function-provider');
    expect(provider.targetName).toBe('custom-task');

    const response = await provider.invoke({ question: 'hello' });
    expect(response.output).toHaveLength(1);
    expect(response.output?.[0].role).toBe('assistant');
    expect(response.output?.[0].content).toBe('Echo: hello');
  });

  it('wraps an async task function', async () => {
    const provider = createFunctionProvider(async (input) => {
      return `Async: ${input}`;
    });

    const response = await provider.invoke({ question: 'world' });
    expect(response.output?.[0].content).toBe('Async: world');
  });

  it('measures duration', async () => {
    const provider = createFunctionProvider(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    });

    const response = await provider.invoke({ question: 'test' });
    expect(response.durationMs).toBeGreaterThanOrEqual(40);
  });

  it('propagates errors from the task function', async () => {
    const provider = createFunctionProvider(() => {
      throw new Error('task failed');
    });

    await expect(provider.invoke({ question: 'test' })).rejects.toThrow('task failed');
  });
});
