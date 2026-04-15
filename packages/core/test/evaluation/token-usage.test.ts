/**
 * Tests for token usage tracking across the evaluation pipeline.
 * Covers: AI SDK mapResponse, target proxy accumulation, orchestrator passthrough.
 */
import { describe, expect, it } from 'bun:test';

import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { GraderResult } from '../../src/evaluation/types.js';

// ─── AI SDK mapResponse ────────────────────────────────────────────────
// The mapResponse function is private, but we can test the public invoke()
// method of AI SDK providers indirectly via the orchestrator flow.
// Instead, we verify the type contracts that mapResponse must satisfy.

describe('token usage type contracts', () => {
  it('GraderResult accepts tokenUsage', () => {
    const result: GraderResult = {
      name: 'test',
      type: 'llm-grader',
      score: 0.9,
      assertions: [{ text: 'good', passed: true }],
      tokenUsage: { input: 100, output: 50 },
    };
    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it('GraderResult tokenUsage is optional', () => {
    const result: GraderResult = {
      name: 'test',
      type: 'llm-grader',
      score: 0.9,
      assertions: [],
    };
    expect(result.tokenUsage).toBeUndefined();
  });

  it('nested scores carry tokenUsage', () => {
    const result: GraderResult = {
      name: 'composite',
      type: 'composite',
      score: 0.8,
      assertions: [],
      scores: [
        {
          name: 'child-grader',
          type: 'llm-grader',
          score: 0.8,
          assertions: [],
          tokenUsage: { input: 200, output: 100 },
        },
      ],
    };
    expect(result.scores?.[0].tokenUsage).toEqual({ input: 200, output: 100 });
  });
});

// ─── Target proxy token usage accumulation ─────────────────────────────
describe('target proxy token usage accumulation', () => {
  function createMockProviderWithUsage(
    targetName: string,
    tokenUsage: { input: number; output: number },
  ): Provider {
    return {
      id: targetName,
      kind: 'mock',
      targetName,
      invoke: async (_request: ProviderRequest): Promise<ProviderResponse> => ({
        output: [{ role: 'assistant', content: 'response' }],
        tokenUsage,
      }),
    };
  }

  it('accumulates tokenUsage across multiple invoke calls', async () => {
    const { createTargetProxy } = await import('../../src/runtime/target-proxy.js');

    const provider = createMockProviderWithUsage('test', { input: 100, output: 50 });
    const proxy = await createTargetProxy({ defaultProvider: provider, maxCalls: 10 });

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${proxy.token}`,
      };

      // Make 3 calls
      for (let i = 0; i < 3; i++) {
        await fetch(`${proxy.url}/invoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: `q${i}` }),
        });
      }

      const usage = proxy.getUsageMetadata();
      expect(usage.callCount).toBe(3);
      expect(usage.tokenUsage).toEqual({ input: 300, output: 150 });
    } finally {
      await proxy.shutdown();
    }
  });

  it('returns per-call tokenUsage in invoke response', async () => {
    const { createTargetProxy } = await import('../../src/runtime/target-proxy.js');

    const provider = createMockProviderWithUsage('test', { input: 42, output: 17 });
    const proxy = await createTargetProxy({ defaultProvider: provider, maxCalls: 10 });

    try {
      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test' }),
      });

      const result = (await response.json()) as { tokenUsage?: { input: number; output: number } };
      expect(result.tokenUsage).toEqual({ input: 42, output: 17 });
    } finally {
      await proxy.shutdown();
    }
  });

  it('returns undefined tokenUsage when provider reports none', async () => {
    const { createTargetProxy } = await import('../../src/runtime/target-proxy.js');

    const provider: Provider = {
      id: 'no-usage',
      kind: 'mock',
      targetName: 'no-usage',
      invoke: async (): Promise<ProviderResponse> => ({
        output: [{ role: 'assistant', content: 'response' }],
      }),
    };
    const proxy = await createTargetProxy({ defaultProvider: provider, maxCalls: 10 });

    try {
      await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test' }),
      });

      const usage = proxy.getUsageMetadata();
      expect(usage.callCount).toBe(1);
      expect(usage.tokenUsage).toBeUndefined();
    } finally {
      await proxy.shutdown();
    }
  });

  it('accumulates tokenUsage in batch requests', async () => {
    const { createTargetProxy } = await import('../../src/runtime/target-proxy.js');

    const provider = createMockProviderWithUsage('test', { input: 10, output: 5 });
    const proxy = await createTargetProxy({ defaultProvider: provider, maxCalls: 10 });

    try {
      const response = await fetch(`${proxy.url}/invokeBatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({
          requests: [{ question: 'q1' }, { question: 'q2' }],
        }),
      });

      expect(response.ok).toBe(true);

      const usage = proxy.getUsageMetadata();
      expect(usage.callCount).toBe(2);
      expect(usage.tokenUsage).toEqual({ input: 20, output: 10 });
    } finally {
      await proxy.shutdown();
    }
  });
});
