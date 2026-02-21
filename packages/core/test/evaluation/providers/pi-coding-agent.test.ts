import { describe, expect, it } from 'bun:test';

import { PiCodingAgentProvider } from '../../../src/evaluation/providers/pi-coding-agent.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';

/**
 * Build a minimal JSONL stdout string from an array of event objects.
 */
function toJsonl(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

/**
 * Create a PiCodingAgentProvider with a fake runner that returns the given stdout.
 */
function createProviderWithStdout(stdout: string): PiCodingAgentProvider {
  return new PiCodingAgentProvider('test-target', { executable: 'pi' }, async () => ({
    stdout,
    stderr: '',
    exitCode: 0,
  }));
}

describe('PiCodingAgentProvider execution metrics', () => {
  const request: ProviderRequest = { question: 'Hello' };

  it('includes timing information in response', async () => {
    const events = [
      { type: 'agent_start' },
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.startTime).toBeDefined();
    expect(response.endTime).toBeDefined();
    expect(response.durationMs).toBeDefined();
    expect(typeof response.durationMs).toBe('number');
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    // startTime should be before or equal to endTime
    expect(new Date(response.startTime ?? '').getTime()).toBeLessThanOrEqual(
      new Date(response.endTime ?? '').getTime(),
    );
  });

  it('extracts token usage from agent_end top-level usage', async () => {
    const events = [
      { type: 'agent_start' },
      {
        type: 'agent_end',
        usage: { input_tokens: 1000, output_tokens: 500 },
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.tokenUsage).toBeDefined();
    expect(response.tokenUsage?.input).toBe(1000);
    expect(response.tokenUsage?.output).toBe(500);
  });

  it('extracts token usage with cached tokens', async () => {
    const events = [
      {
        type: 'agent_end',
        usage: { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 300 },
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.tokenUsage).toEqual({ input: 800, output: 200, cached: 300 });
  });

  it('aggregates token usage from messages when agent_end has no top-level usage', async () => {
    const events = [
      {
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            usage: { input_tokens: 400, output_tokens: 100 },
            content: [{ type: 'text', text: 'step 1' }],
          },
          {
            role: 'assistant',
            usage: { input_tokens: 600, output_tokens: 200 },
            content: [{ type: 'text', text: 'step 2' }],
          },
        ],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.tokenUsage).toBeDefined();
    expect(response.tokenUsage?.input).toBe(1000);
    expect(response.tokenUsage?.output).toBe(300);
  });

  it('handles camelCase usage field names', async () => {
    const events = [
      {
        type: 'agent_end',
        usage: { inputTokens: 500, outputTokens: 250 },
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.tokenUsage).toEqual({ input: 500, output: 250 });
  });

  it('returns undefined tokenUsage when no usage data is present', async () => {
    const events = [
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.tokenUsage).toBeUndefined();
  });

  it('still returns output alongside metrics', async () => {
    const events = [
      {
        type: 'agent_end',
        usage: { input_tokens: 100, output_tokens: 50 },
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
        ],
      },
    ];
    const provider = createProviderWithStdout(toJsonl(events));

    const response = await provider.invoke(request);

    expect(response.output).toBeDefined();
    expect(response.output?.length).toBe(2);
    expect(response.tokenUsage?.input).toBe(100);
    expect(response.durationMs).toBeDefined();
    expect(response.startTime).toBeDefined();
    expect(response.endTime).toBeDefined();
  });
});
