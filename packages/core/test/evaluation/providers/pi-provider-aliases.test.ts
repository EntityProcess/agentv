import { describe, expect, it } from 'bun:test';

import {
  ENV_BASE_URL_MAP,
  ENV_KEY_MAP,
  resolveCliProvider,
  resolveEnvBaseUrlName,
  resolveEnvKeyName,
  resolveSubprovider,
} from '../../../src/evaluation/providers/pi-provider-aliases.js';

describe('resolveSubprovider', () => {
  it('resolves "azure" without base_url to azure-openai-responses', () => {
    expect(resolveSubprovider('azure')).toBe('azure-openai-responses');
  });

  it('resolves "azure" with base_url to openai-responses (v1 compatible)', () => {
    expect(resolveSubprovider('azure', true)).toBe('openai-responses');
  });

  it('is case-insensitive', () => {
    expect(resolveSubprovider('Azure')).toBe('azure-openai-responses');
    expect(resolveSubprovider('Azure', true)).toBe('openai-responses');
  });

  it('passes through unknown provider names unchanged', () => {
    expect(resolveSubprovider('openrouter')).toBe('openrouter');
    expect(resolveSubprovider('google')).toBe('google');
  });

  it('passes through the full SDK name unchanged', () => {
    expect(resolveSubprovider('azure-openai-responses')).toBe('azure-openai-responses');
  });
});

describe('resolveCliProvider', () => {
  it('resolves "azure" without base_url to azure-openai-responses', () => {
    expect(resolveCliProvider('azure')).toBe('azure-openai-responses');
  });

  it('resolves "azure" with base_url to openai', () => {
    expect(resolveCliProvider('azure', true)).toBe('openai');
  });

  it('passes through unknown providers unchanged', () => {
    expect(resolveCliProvider('openrouter')).toBe('openrouter');
  });
});

describe('resolveEnvKeyName', () => {
  it('maps azure without base_url to AZURE_OPENAI_API_KEY', () => {
    expect(resolveEnvKeyName('azure')).toBe('AZURE_OPENAI_API_KEY');
  });

  it('maps azure with base_url to OPENAI_API_KEY', () => {
    expect(resolveEnvKeyName('azure', true)).toBe('OPENAI_API_KEY');
  });

  it('maps standard providers', () => {
    expect(resolveEnvKeyName('openai')).toBe('OPENAI_API_KEY');
    expect(resolveEnvKeyName('openrouter')).toBe('OPENROUTER_API_KEY');
  });
});

describe('resolveEnvBaseUrlName', () => {
  it('maps azure without base_url to AZURE_OPENAI_BASE_URL', () => {
    expect(resolveEnvBaseUrlName('azure')).toBe('AZURE_OPENAI_BASE_URL');
  });

  it('maps azure with base_url to OPENAI_BASE_URL', () => {
    expect(resolveEnvBaseUrlName('azure', true)).toBe('OPENAI_BASE_URL');
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
