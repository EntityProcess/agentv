import { describe, expect, it } from 'bun:test';

import {
  ENV_BASE_URL_MAP,
  ENV_KEY_MAP,
  extractAzureResourceName,
  normalizeAzureSdkBaseUrl,
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
});

describe('resolveCliProvider', () => {
  it('resolves "azure" to azure-openai-responses', () => {
    expect(resolveCliProvider('azure')).toBe('azure-openai-responses');
  });

  it('passes through unknown providers unchanged', () => {
    expect(resolveCliProvider('openrouter')).toBe('openrouter');
  });
});

describe('resolveEnvKeyName', () => {
  it('maps azure without base_url to AZURE_OPENAI_API_KEY', () => {
    expect(resolveEnvKeyName('azure')).toBe('AZURE_OPENAI_API_KEY');
  });

  it('maps azure with base_url to OPENAI_API_KEY (SDK path)', () => {
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

  it('maps azure with base_url to OPENAI_BASE_URL (SDK path)', () => {
    expect(resolveEnvBaseUrlName('azure', true)).toBe('OPENAI_BASE_URL');
  });
});

describe('extractAzureResourceName', () => {
  it('extracts resource name from .openai.azure.com URL', () => {
    expect(extractAzureResourceName('https://my-resource.openai.azure.com')).toBe('my-resource');
  });

  it('extracts resource name from .services.ai.azure.com URL', () => {
    expect(extractAzureResourceName('https://my-resource.services.ai.azure.com')).toBe(
      'my-resource',
    );
  });

  it('extracts resource name from URL with path', () => {
    expect(
      extractAzureResourceName(
        'https://my-resource.services.ai.azure.com/api/projects/foo/openai/v1',
      ),
    ).toBe('my-resource');
  });

  it('returns raw value if already a resource name', () => {
    expect(extractAzureResourceName('my-resource')).toBe('my-resource');
  });
});

describe('normalizeAzureSdkBaseUrl', () => {
  it('converts a bare resource name to an OpenAI-compatible Azure v1 URL', () => {
    expect(normalizeAzureSdkBaseUrl('my-resource')).toBe(
      'https://my-resource.openai.azure.com/openai/v1',
    );
  });

  it('appends /openai/v1 to a standard Azure endpoint URL', () => {
    expect(normalizeAzureSdkBaseUrl('https://my-resource.openai.azure.com')).toBe(
      'https://my-resource.openai.azure.com/openai/v1',
    );
  });

  it('preserves an Azure v1 URL that is already normalized', () => {
    expect(
      normalizeAzureSdkBaseUrl(
        'https://my-resource.services.ai.azure.com/api/projects/foo/openai/v1',
      ),
    ).toBe('https://my-resource.services.ai.azure.com/api/projects/foo/openai/v1');
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
