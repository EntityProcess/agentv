import { describe, expect, it, vi } from 'vitest';

// Mock AI SDK provider packages before importing the provider
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => {
    const provider = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'openai',
    });
    provider.languageModel = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'openai',
    });
    provider.chatModel = provider.languageModel;
    provider.textEmbeddingModel = () => ({});
    return provider;
  },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => {
    const provider = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'anthropic',
    });
    provider.languageModel = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'anthropic',
    });
    provider.chatModel = provider.languageModel;
    provider.textEmbeddingModel = () => ({});
    return provider;
  },
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: () => {
    const provider = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'azure',
    });
    provider.languageModel = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'azure',
    });
    provider.chatModel = provider.languageModel;
    provider.textEmbeddingModel = () => ({});
    return provider;
  },
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => {
    const provider = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'google',
    });
    provider.languageModel = (modelId: string) => ({
      modelId,
      specificationVersion: 'v2',
      provider: 'google',
    });
    provider.chatModel = provider.languageModel;
    provider.textEmbeddingModel = () => ({});
    return provider;
  },
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
