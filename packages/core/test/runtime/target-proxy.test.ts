import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import {
  type TargetProxyInfoResponse,
  type TargetProxyInvokeResponse,
  createTargetProxy,
} from '../../src/runtime/target-proxy.js';

function createMockProvider(targetName: string): Provider {
  return {
    id: targetName,
    kind: 'mock',
    targetName,
    invoke: async (request: ProviderRequest): Promise<ProviderResponse> => ({
      output: [{ role: 'assistant', content: `Response from ${targetName}: ${request.question}` }],
    }),
  };
}

describe('createTargetProxy', () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (shutdown) {
      await shutdown();
      shutdown = undefined;
    }
  });

  describe('/info endpoint', () => {
    it('returns proxy info with default target', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`, {
        headers: { Authorization: `Bearer ${proxy.token}` },
      });

      expect(response.ok).toBe(true);
      const info = (await response.json()) as TargetProxyInfoResponse;
      expect(info.targetName).toBe('default-target');
      expect(info.maxCalls).toBe(50);
      expect(info.callCount).toBe(0);
      expect(info.availableTargets).toEqual(['default-target']);
    });

    it('returns all available targets when targetResolver is provided', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        targetResolver: (name) =>
          name === 'alt-target' ? createMockProvider('alt-target') : undefined,
        availableTargets: ['default-target', 'alt-target'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`, {
        headers: { Authorization: `Bearer ${proxy.token}` },
      });

      expect(response.ok).toBe(true);
      const info = (await response.json()) as TargetProxyInfoResponse;
      expect(info.availableTargets).toEqual(['default-target', 'alt-target']);
    });

    it('updates callCount after invocations', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      // Make an invoke call
      await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test' }),
      });

      const response = await fetch(`${proxy.url}/info`, {
        headers: { Authorization: `Bearer ${proxy.token}` },
      });

      const info = (await response.json()) as TargetProxyInfoResponse;
      expect(info.callCount).toBe(1);
    });

    it('requires authentication', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`);
      expect(response.status).toBe(401);
    });
  });

  describe('target override', () => {
    it('uses default target when no target specified', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test' }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as TargetProxyInvokeResponse;
      expect(result.rawText).toContain('default-target');
    });

    it('uses specified target when target is provided', async () => {
      const defaultProvider = createMockProvider('default-target');
      const altProvider = createMockProvider('alt-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        targetResolver: (name) => (name === 'alt-target' ? altProvider : undefined),
        availableTargets: ['default-target', 'alt-target'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test', target: 'alt-target' }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as TargetProxyInvokeResponse;
      expect(result.rawText).toContain('alt-target');
    });

    it('returns 400 for unknown target', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        availableTargets: ['default-target'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test', target: 'unknown-target' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('Unknown target');
      expect(body.error).toContain('default-target');
    });

    it('supports target override in batch requests', async () => {
      const defaultProvider = createMockProvider('default-target');
      const altProvider = createMockProvider('alt-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        targetResolver: (name) => (name === 'alt-target' ? altProvider : undefined),
        availableTargets: ['default-target', 'alt-target'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invokeBatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({
          requests: [{ question: 'q1' }, { question: 'q2', target: 'alt-target' }],
        }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as { responses: TargetProxyInvokeResponse[] };
      expect(result.responses[0].rawText).toContain('default-target');
      expect(result.responses[1].rawText).toContain('alt-target');
    });

    it('handles unknown target in batch gracefully', async () => {
      const defaultProvider = createMockProvider('default-target');
      const proxy = await createTargetProxy({
        defaultProvider,
        availableTargets: ['default-target'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invokeBatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({
          requests: [{ question: 'q1' }, { question: 'q2', target: 'unknown-target' }],
        }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as { responses: TargetProxyInvokeResponse[] };
      expect(result.responses[0].rawText).toContain('default-target');
      expect(result.responses[1].rawText).toContain('Unknown target');
    });
  });
});
