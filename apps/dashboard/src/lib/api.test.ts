import { afterEach, describe, expect, it } from 'bun:test';

import { addProjectApi, browseFilesystemApi } from './api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubJsonResponse(body: unknown, status = 200) {
  const calls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return calls;
}

describe('dashboard API boundary mapping', () => {
  it('maps filesystem browse wire keys to camelCase UI data', async () => {
    const calls = stubJsonResponse({
      path: '/tmp',
      parent_path: '/',
      current: { name: 'tmp', path: '/tmp', has_agentv: false },
      entries: [{ name: 'demo', path: '/tmp/demo', has_agentv: true }],
    });

    const result = await browseFilesystemApi('/tmp');

    expect(calls[0].url).toBe('/api/filesystem/browse?path=%2Ftmp');
    expect(result).toEqual({
      path: '/tmp',
      parentPath: '/',
      current: { name: 'tmp', path: '/tmp', hasAgentv: false },
      entries: [{ name: 'demo', path: '/tmp/demo', hasAgentv: true }],
    });
  });

  it('maps add-project wire keys to camelCase UI data', async () => {
    const calls = stubJsonResponse({
      id: 'demo',
      name: 'demo',
      path: '/tmp/demo',
      added_at: '2026-06-19T05:00:00.000Z',
      last_opened_at: '2026-06-19T05:00:00.000Z',
    });

    const result = await addProjectApi('/tmp/demo');

    expect(calls[0]).toEqual({
      url: '/api/projects',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/demo' }),
      },
    });
    expect(result).toEqual({
      id: 'demo',
      name: 'demo',
      path: '/tmp/demo',
      addedAt: '2026-06-19T05:00:00.000Z',
      lastOpenedAt: '2026-06-19T05:00:00.000Z',
    });
  });
});
