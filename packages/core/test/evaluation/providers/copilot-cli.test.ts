import { describe, expect, it } from 'bun:test';

import { buildCopilotCliProviderEnv } from '../../../src/evaluation/providers/copilot-cli.js';

describe('buildCopilotCliProviderEnv', () => {
  it('maps custom provider config to known Copilot CLI env vars', () => {
    const env = buildCopilotCliProviderEnv(
      {
        PATH: '/usr/bin',
        COPILOT_PROVIDER_TYPE: 'azure',
        COPILOT_PROVIDER_BASE_URL: 'https://old.example',
        COPILOT_PROVIDER_API_KEY: 'old-key',
        COPILOT_PROVIDER_WIRE_API: 'ambient-wire-api',
      },
      {
        type: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: 'new-key',
        bearerToken: 'bearer-token',
        wireApi: 'responses',
        apiVersion: '2024-10-21',
      },
    );

    expect(env.PATH).toBe('/usr/bin');
    expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.openai.example/v1');
    expect(env.COPILOT_PROVIDER_API_KEY).toBe('new-key');
    expect(env.COPILOT_PROVIDER_WIRE_API).toBe('ambient-wire-api');
    expect(env.COPILOT_PROVIDER_BEARER_TOKEN).toBeUndefined();
    expect(env.COPILOT_PROVIDER_API_VERSION).toBeUndefined();
  });

  it('preserves ambient Copilot provider env vars without a target override', () => {
    const env = buildCopilotCliProviderEnv(
      {
        COPILOT_PROVIDER_TYPE: 'openai',
        COPILOT_PROVIDER_BASE_URL: 'https://ambient.example/v1',
        COPILOT_PROVIDER_API_KEY: 'ambient-key',
      },
      undefined,
    );

    expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://ambient.example/v1');
    expect(env.COPILOT_PROVIDER_API_KEY).toBe('ambient-key');
  });
});
