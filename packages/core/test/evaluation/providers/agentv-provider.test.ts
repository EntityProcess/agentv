import { describe, expect, it, vi } from 'vitest';

// Mock AI SDK provider packages before importing the provider.
// Each createXxx() returns a callable factory: createXxx()(modelName) => model stub.
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (modelId: string) => ({
    modelId,
    specificationVersion: 'v2',
    provider: 'openai',
  }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (modelId: string) => ({
    modelId,
    specificationVersion: 'v2',
    provider: 'anthropic',
  }),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: () => (modelId: string) => ({
    modelId,
    specificationVersion: 'v2',
    provider: 'azure',
  }),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => (modelId: string) => ({
    modelId,
    specificationVersion: 'v2',
    provider: 'google',
  }),
}));

import { AgentvProvider } from '../../../src/evaluation/providers/agentv-provider.js';

describe('AgentvProvider', () => {
  it('has kind "agentv"', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.kind).toBe('agentv');
  });

  it('has correct targetName', () => {
    const provider = new AgentvProvider('my-judge', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.targetName).toBe('my-judge');
  });

  it('has correct id format', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    expect(provider.id).toBe('agentv:test-judge');
  });

  it('asLanguageModel() returns a defined LanguageModel', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    const model = provider.asLanguageModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe('gpt-5-mini');
  });

  it('asLanguageModel() works with anthropic model strings', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'anthropic:claude-sonnet-4-20250514',
      temperature: 0,
    });
    const model = provider.asLanguageModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe('claude-sonnet-4-20250514');
  });

  it('asLanguageModel() works with google model strings', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'google:gemini-2.5-flash',
      temperature: 0,
    });
    const model = provider.asLanguageModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe('gemini-2.5-flash');
  });

  it('asLanguageModel() works with azure model strings', () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'azure:gpt-4o-deployment',
      temperature: 0,
    });
    const model = provider.asLanguageModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe('gpt-4o-deployment');
  });

  it('throws for unsupported provider prefix', () => {
    expect(
      () =>
        new AgentvProvider('test-judge', {
          model: 'unsupported:some-model',
          temperature: 0,
        }),
    ).toThrow('Unsupported AI SDK provider "unsupported"');
  });

  it('throws for model string without colon separator', () => {
    expect(
      () =>
        new AgentvProvider('test-judge', {
          model: 'gpt-5-mini',
          temperature: 0,
        }),
    ).toThrow('Invalid model string "gpt-5-mini"');
  });

  it('invoke() throws an error', async () => {
    const provider = new AgentvProvider('test-judge', {
      model: 'openai:gpt-5-mini',
      temperature: 0,
    });
    await expect(provider.invoke({ question: 'test' })).rejects.toThrow(
      'AgentvProvider does not support direct invoke()',
    );
  });
});
