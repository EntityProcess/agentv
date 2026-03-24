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
});
