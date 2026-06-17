import { describe, expect, test } from 'bun:test';

import { phoenixOtelBackend } from '../src/otel-backend.js';

describe('phoenixOtelBackend', () => {
  test('resolves default local Phoenix endpoint and project resource attribute', () => {
    const resolved = phoenixOtelBackend.resolve({ cwd: process.cwd(), env: {} });

    expect(resolved).toEqual({
      endpoint: 'http://localhost:6006/v1/traces',
      headers: {},
      resourceAttributes: {
        'openinference.project.name': 'default',
      },
      warnings: [],
    });
  });

  test('normalizes Phoenix endpoint, API key, client headers, and project name', () => {
    const resolved = phoenixOtelBackend.resolve({
      cwd: process.cwd(),
      env: {
        PHOENIX_COLLECTOR_ENDPOINT: 'https://app.phoenix.arize.com/s/my-space/',
        PHOENIX_API_KEY: 'px-key',
        PHOENIX_PROJECT_NAME: 'agentv-evals',
        PHOENIX_CLIENT_HEADERS: 'x-custom=one%20two',
      },
    });

    expect(resolved).toEqual({
      endpoint: 'https://app.phoenix.arize.com/s/my-space/v1/traces',
      headers: {
        'x-custom': 'one two',
        authorization: 'Bearer px-key',
      },
      resourceAttributes: {
        'openinference.project.name': 'agentv-evals',
      },
      warnings: [],
    });
  });

  test('does not append duplicate traces path or override explicit auth header', () => {
    const resolved = phoenixOtelBackend.resolve({
      cwd: process.cwd(),
      env: {
        PHOENIX_COLLECTOR_ENDPOINT: 'http://phoenix.example.com/v1/traces',
        PHOENIX_API_KEY: 'px-key',
        PHOENIX_CLIENT_HEADERS: 'authorization=Bearer%20override',
      },
    });

    expect(resolved.endpoint).toBe('http://phoenix.example.com/v1/traces');
    expect(resolved.headers).toEqual({ authorization: 'Bearer override' });
  });

  test('reports invalid client header entries as warnings', () => {
    const resolved = phoenixOtelBackend.resolve({
      cwd: process.cwd(),
      env: {
        PHOENIX_CLIENT_HEADERS: 'valid=value,not-a-header',
      },
    });

    expect(resolved.headers).toEqual({ valid: 'value' });
    expect(resolved.warnings).toEqual([
      'Ignoring invalid PHOENIX_CLIENT_HEADERS entry: not-a-header',
    ]);
  });
});
