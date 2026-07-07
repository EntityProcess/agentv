import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import {
  type ProviderProxyInfoResponse,
  type ProviderProxyInvokeResponse,
  createProviderProxy,
} from '../../src/runtime/provider-proxy.js';

function createMockProvider(providerLabel: string): Provider {
  return {
    id: providerLabel,
    kind: 'mock',
    targetName: providerLabel,
    invoke: async (request: ProviderRequest): Promise<ProviderResponse> => ({
      output: [
        { role: 'assistant', content: `Response from ${providerLabel}: ${request.question}` },
      ],
    }),
  };
}

describe('createProviderProxy', () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (shutdown) {
      await shutdown();
      shutdown = undefined;
    }
  });

  describe('/info endpoint', () => {
    it('returns proxy info with default provider', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`, {
        headers: { Authorization: `Bearer ${proxy.token}` },
      });

      expect(response.ok).toBe(true);
      const info = (await response.json()) as ProviderProxyInfoResponse;
      expect(info.providerLabel).toBe('default-provider');
      expect(info.maxCalls).toBe(50);
      expect(info.callCount).toBe(0);
      expect(info.availableProviderLabels).toEqual(['default-provider']);
    });

    it('returns all available providers when providerResolver is provided', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        providerResolver: (name) =>
          name === 'alt-provider' ? createMockProvider('alt-provider') : undefined,
        availableProviderLabels: ['default-provider', 'alt-provider'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`, {
        headers: { Authorization: `Bearer ${proxy.token}` },
      });

      expect(response.ok).toBe(true);
      const info = (await response.json()) as ProviderProxyInfoResponse;
      expect(info.availableProviderLabels).toEqual(['default-provider', 'alt-provider']);
    });

    it('updates callCount after invocations', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
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

      const info = (await response.json()) as ProviderProxyInfoResponse;
      expect(info.callCount).toBe(1);
    });

    it('requires authentication', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/info`);
      expect(response.status).toBe(401);
    });
  });

  describe('provider override', () => {
    it('uses default provider when no provider is specified', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
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
      const result = (await response.json()) as ProviderProxyInvokeResponse;
      expect(result.rawText).toContain('default-provider');
    });

    it('uses specified provider when provider is provided', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const altProvider = createMockProvider('alt-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        providerResolver: (name) => (name === 'alt-provider' ? altProvider : undefined),
        availableProviderLabels: ['default-provider', 'alt-provider'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test', provider: 'alt-provider' }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as ProviderProxyInvokeResponse;
      expect(result.rawText).toContain('alt-provider');
    });

    it('returns 400 for unknown provider', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        availableProviderLabels: ['default-provider'],
        maxCalls: 50,
      });
      shutdown = proxy.shutdown;

      const response = await fetch(`${proxy.url}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${proxy.token}`,
        },
        body: JSON.stringify({ question: 'test', provider: 'unknown-provider' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('Unknown provider');
      expect(body.error).toContain('default-provider');
    });

    it('supports provider override in batch requests', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const altProvider = createMockProvider('alt-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        providerResolver: (name) => (name === 'alt-provider' ? altProvider : undefined),
        availableProviderLabels: ['default-provider', 'alt-provider'],
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
          requests: [{ question: 'q1' }, { question: 'q2', provider: 'alt-provider' }],
        }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as { responses: ProviderProxyInvokeResponse[] };
      expect(result.responses[0].rawText).toContain('default-provider');
      expect(result.responses[1].rawText).toContain('alt-provider');
    });

    it('handles unknown provider in batch gracefully', async () => {
      const defaultProvider = createMockProvider('default-provider');
      const proxy = await createProviderProxy({
        defaultProvider,
        availableProviderLabels: ['default-provider'],
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
          requests: [{ question: 'q1' }, { question: 'q2', provider: 'unknown-provider' }],
        }),
      });

      expect(response.ok).toBe(true);
      const result = (await response.json()) as { responses: ProviderProxyInvokeResponse[] };
      expect(result.responses[0].rawText).toContain('default-provider');
      expect(result.responses[1].rawText).toContain('Unknown provider');
    });
  });
});
