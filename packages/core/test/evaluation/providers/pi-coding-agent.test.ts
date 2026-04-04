import { describe, expect, it } from 'bun:test';

import { PiCodingAgentProvider } from '../../../src/evaluation/providers/pi-coding-agent.js';

describe('PiCodingAgentProvider', () => {
  it('has the correct kind and id', () => {
    const provider = new PiCodingAgentProvider('test-target', {});
    expect(provider.kind).toBe('pi-coding-agent');
    expect(provider.id).toBe('pi-coding-agent:test-target');
    expect(provider.targetName).toBe('test-target');
    expect(provider.supportsBatch).toBe(false);
  });

  it('rejects when signal is already aborted', async () => {
    const provider = new PiCodingAgentProvider('test-target', {});
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ question: 'Hello', signal: controller.signal })).rejects.toThrow(
      'aborted before execution',
    );
  });

  it('normalizes a bare Azure resource name before setting OPENAI_BASE_URL for the SDK path', () => {
    const original = process.env.OPENAI_BASE_URL;
    const provider = new PiCodingAgentProvider('test-target', {
      subprovider: 'azure',
      baseUrl: 'leos-m6pmw8kz-eastus2',
    });

    (
      provider as unknown as {
        setBaseUrlEnv(providerName: string, baseUrl?: string, hasBaseUrl?: boolean): void;
      }
    ).setBaseUrlEnv('azure', 'leos-m6pmw8kz-eastus2', true);

    expect(process.env.OPENAI_BASE_URL).toBe(
      'https://leos-m6pmw8kz-eastus2.openai.azure.com/openai/v1',
    );

    if (original === undefined) {
      process.env.OPENAI_BASE_URL = undefined;
    } else {
      process.env.OPENAI_BASE_URL = original;
    }
  });
});
