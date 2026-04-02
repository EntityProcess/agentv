import { describe, expect, it } from 'bun:test';

import {
  ENV_BASE_URL_MAP,
  ENV_KEY_MAP,
  resolveSubprovider,
} from '../../../src/evaluation/providers/pi-provider-aliases.js';

describe('resolveSubprovider', () => {
  it('resolves "azure" to the pi-ai SDK canonical name', () => {
    expect(resolveSubprovider('azure')).toBe('azure-openai-responses');
  });

  it('is case-insensitive', () => {
    expect(resolveSubprovider('Azure')).toBe('azure-openai-responses');
    expect(resolveSubprovider('AZURE')).toBe('azure-openai-responses');
  });

  it('passes through unknown provider names unchanged', () => {
    expect(resolveSubprovider('openrouter')).toBe('openrouter');
    expect(resolveSubprovider('google')).toBe('google');
    expect(resolveSubprovider('some-future-provider')).toBe('some-future-provider');
  });

  it('passes through the full SDK name unchanged', () => {
    expect(resolveSubprovider('azure-openai-responses')).toBe('azure-openai-responses');
  });

  it('resolves "azure-v1" to openai-responses for v1 endpoints', () => {
    expect(resolveSubprovider('azure-v1')).toBe('openai-responses');
  });
});

describe('ENV_KEY_MAP', () => {
  it('maps azure to AZURE_OPENAI_API_KEY', () => {
    expect(ENV_KEY_MAP.azure).toBe('AZURE_OPENAI_API_KEY');
  });

  it('maps all expected providers', () => {
    expect(ENV_KEY_MAP.google).toBe('GEMINI_API_KEY');
    expect(ENV_KEY_MAP.openai).toBe('OPENAI_API_KEY');
    expect(ENV_KEY_MAP.openrouter).toBe('OPENROUTER_API_KEY');
    expect(ENV_KEY_MAP.anthropic).toBe('ANTHROPIC_API_KEY');
  });
});

describe('ENV_BASE_URL_MAP', () => {
  it('maps azure to AZURE_OPENAI_BASE_URL', () => {
    expect(ENV_BASE_URL_MAP.azure).toBe('AZURE_OPENAI_BASE_URL');
  });

  it('maps openai to OPENAI_BASE_URL', () => {
    expect(ENV_BASE_URL_MAP.openai).toBe('OPENAI_BASE_URL');
  });
});
