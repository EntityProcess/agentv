import { describe, expect, it, vi } from 'vitest';

// Mock pi-ai's runtime exports. AgentvProvider now resolves a pi-ai Model in
// the constructor and routes invoke() through the shared invokePiAi adapter.
const piGetModelMock = vi.fn((provider: string, modelId: string) => ({
  id: modelId,
  name: modelId,
  api: 'openai-completions',
  provider,
  baseUrl: 'https://example.test/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
}));
const piCompleteMock = vi.fn(async () => ({
  role: 'assistant' as const,
  content: [{ type: 'text', text: 'ok' }],
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  api: 'openai-completions',
  provider: 'openai',
  model: 'gpt-test',
  stopReason: 'stop' as const,
  timestamp: Date.now(),
}));

vi.mock('@earendil-works/pi-ai', () => ({
  complete: (...args: unknown[]) => piCompleteMock(...(args as [])),
  getModel: (provider: string, modelId: string) => piGetModelMock(provider, modelId),
  registerBuiltInApiProviders: () => undefined,
}));

import { AgentvProvider } from '../../../src/evaluation/providers/agentv-provider.js';

describe('AgentvProvider', () => {
  it('has kind "agentv"', () => {
    const provider = new AgentvProvider('test-grader', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.kind).toBe('agentv');
  });

  it('has correct targetName', () => {
    const provider = new AgentvProvider('my-grader', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.targetName).toBe('my-grader');
  });

  it('has correct id format', () => {
    const provider = new AgentvProvider('test-grader', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.id).toBe('agentv:test-grader');
  });

  it('resolves openai model strings via pi-ai', () => {
    piGetModelMock.mockClear();
    new AgentvProvider('test', { model: 'openai:gpt-5-mini', temperature: 0 });
    expect(piGetModelMock).toHaveBeenCalledWith('openai', 'gpt-5-mini');
  });

  it('resolves anthropic model strings via pi-ai', () => {
    piGetModelMock.mockClear();
    new AgentvProvider('test', { model: 'anthropic:claude-sonnet-4', temperature: 0 });
    expect(piGetModelMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4');
  });

  it('resolves google model strings via pi-ai', () => {
    piGetModelMock.mockClear();
    new AgentvProvider('test', { model: 'google:gemini-2.5-flash', temperature: 0 });
    expect(piGetModelMock).toHaveBeenCalledWith('google', 'gemini-2.5-flash');
  });

  it('resolves azure model strings via pi-ai (azure-openai-responses provider)', () => {
    piGetModelMock.mockClear();
    new AgentvProvider('test', { model: 'azure:gpt-4o-deployment', temperature: 0 });
    expect(piGetModelMock).toHaveBeenCalledWith('azure-openai-responses', 'gpt-4o-deployment');
  });

  it('throws for unsupported provider prefix', () => {
    expect(
      () =>
        new AgentvProvider('test', {
          model: 'unsupported:some-model',
          temperature: 0,
        }),
    ).toThrow('Unsupported agentv provider "unsupported"');
  });

  it('throws for model string without colon separator', () => {
    expect(
      () =>
        new AgentvProvider('test', {
          model: 'gpt-5-mini',
          temperature: 0,
        }),
    ).toThrow('Invalid agentv model "gpt-5-mini"');
  });

  it('invoke() routes through pi-ai complete()', async () => {
    piCompleteMock.mockClear();
    const provider = new AgentvProvider('test', { model: 'openai:gpt-5-mini', temperature: 0 });
    const response = await provider.invoke({ question: 'hello' });
    expect(piCompleteMock).toHaveBeenCalledTimes(1);
    expect(response.output?.[0]).toMatchObject({ role: 'assistant', content: 'ok' });
  });
});
