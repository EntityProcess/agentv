import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  TargetInvocationError,
  TargetNotAvailableError,
  createTargetClient,
  createTargetClientInternal,
} from '../src/target-client.js';

describe('createTargetClient', () => {
  const originalUrl = process.env.AGENTV_TARGET_PROXY_URL;
  const originalToken = process.env.AGENTV_TARGET_PROXY_TOKEN;

  beforeEach(() => {
    process.env.AGENTV_TARGET_PROXY_URL = '';
    process.env.AGENTV_TARGET_PROXY_TOKEN = '';
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      process.env.AGENTV_TARGET_PROXY_URL = '';
    } else {
      process.env.AGENTV_TARGET_PROXY_URL = originalUrl;
    }

    if (originalToken === undefined) {
      process.env.AGENTV_TARGET_PROXY_TOKEN = '';
    } else {
      process.env.AGENTV_TARGET_PROXY_TOKEN = originalToken;
    }
  });

  it('returns undefined when no env vars are set', () => {
    const client = createTargetClient();
    expect(client).toBeUndefined();
  });

  it('throws TargetNotAvailableError when URL is set but token is missing', () => {
    process.env.AGENTV_TARGET_PROXY_URL = 'http://127.0.0.1:3000';

    expect(() => createTargetClient()).toThrow(TargetNotAvailableError);
    expect(() => createTargetClient()).toThrow(
      'AGENTV_TARGET_PROXY_URL is set but AGENTV_TARGET_PROXY_TOKEN is missing',
    );
  });

  it('returns client when both env vars are set', () => {
    process.env.AGENTV_TARGET_PROXY_URL = 'http://127.0.0.1:3000';
    process.env.AGENTV_TARGET_PROXY_TOKEN = 'test-token-123';

    const client = createTargetClient();
    expect(client).toBeDefined();
    expect(typeof client?.invoke).toBe('function');
    expect(typeof client?.invokeBatch).toBe('function');
    expect(typeof client?.getInfo).toBe('function');
  });
});

describe('createTargetClientInternal', () => {
  it('creates client with invoke method', () => {
    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    expect(typeof client.invoke).toBe('function');
  });

  it('creates client with invokeBatch method', () => {
    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    expect(typeof client.invokeBatch).toBe('function');
  });

  it('creates client with getInfo method', () => {
    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    expect(typeof client.getInfo).toBe('function');
  });
});

describe('TargetClient.invoke', () => {
  it('makes POST request with correct headers', async () => {
    const mockResponse = {
      output: [{ role: 'assistant', content: 'test response' }],
      rawText: 'test response',
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'secret-token');
    await client.invoke({ question: 'test question' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        },
      }),
    );

    fetchSpy.mockRestore();
  });

  it('returns response with output and rawText', async () => {
    const mockResponse = {
      output: [{ role: 'assistant', content: 'test' }],
      rawText: 'test',
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    const response = await client.invoke({ question: 'test' });

    expect(response.output).toEqual([{ role: 'assistant', content: 'test' }]);
    expect(response.rawText).toBe('test');

    fetchSpy.mockRestore();
  });

  it('throws TargetInvocationError on non-ok response', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('{"error":"Max calls exceeded"}'),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');

    let error: TargetInvocationError | undefined;
    try {
      await client.invoke({ question: 'test' });
    } catch (e) {
      error = e as TargetInvocationError;
    }

    expect(error).toBeInstanceOf(TargetInvocationError);
    expect(error?.message).toBe('Max calls exceeded');
    expect(error?.statusCode).toBe(429);

    fetchSpy.mockRestore();
  });

  it('handles non-JSON error responses', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');

    let error: TargetInvocationError | undefined;
    try {
      await client.invoke({ question: 'test' });
    } catch (e) {
      error = e as TargetInvocationError;
    }

    expect(error).toBeInstanceOf(TargetInvocationError);
    expect(error?.message).toBe('Internal Server Error');
    expect(error?.statusCode).toBe(500);

    fetchSpy.mockRestore();
  });
});

describe('TargetClient.invokeBatch', () => {
  it('makes POST request to /invokeBatch endpoint', async () => {
    const mockResponse = {
      responses: [
        { output: [], rawText: 'response 1' },
        { output: [], rawText: 'response 2' },
      ],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    await client.invokeBatch([{ question: 'q1' }, { question: 'q2' }]);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/invokeBatch',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    fetchSpy.mockRestore();
  });

  it('returns array of responses', async () => {
    const mockResponse = {
      responses: [
        { output: [], rawText: 'response 1' },
        { output: [], rawText: 'response 2' },
      ],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    const responses = await client.invokeBatch([{ question: 'q1' }, { question: 'q2' }]);

    expect(responses).toHaveLength(2);
    expect(responses[0].rawText).toBe('response 1');
    expect(responses[1].rawText).toBe('response 2');

    fetchSpy.mockRestore();
  });

  it('throws TargetInvocationError on batch limit exceeded', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(
          '{"error":"Batch would exceed max calls (current: 45, batch: 10, limit: 50)"}',
        ),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');

    let error: TargetInvocationError | undefined;
    try {
      await client.invokeBatch([{ question: 'q1' }]);
    } catch (e) {
      error = e as TargetInvocationError;
    }

    expect(error).toBeInstanceOf(TargetInvocationError);
    expect(error?.message).toContain('Batch would exceed max calls');
    expect(error?.statusCode).toBe(429);

    fetchSpy.mockRestore();
  });
});

describe('TargetClient.getInfo', () => {
  it('makes GET request to /info endpoint', async () => {
    const mockResponse = {
      targetName: 'default-target',
      maxCalls: 50,
      callCount: 5,
      availableTargets: ['default-target', 'alt-target'],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'secret-token');
    await client.getInfo();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/info',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        },
      }),
    );

    fetchSpy.mockRestore();
  });

  it('returns target info', async () => {
    const mockResponse = {
      targetName: 'default-target',
      maxCalls: 50,
      callCount: 5,
      availableTargets: ['default-target', 'alt-target'],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    const info = await client.getInfo();

    expect(info.targetName).toBe('default-target');
    expect(info.maxCalls).toBe(50);
    expect(info.callCount).toBe(5);
    expect(info.availableTargets).toEqual(['default-target', 'alt-target']);

    fetchSpy.mockRestore();
  });

  it('throws TargetInvocationError on non-ok response', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"Unauthorized"}'),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');

    let error: TargetInvocationError | undefined;
    try {
      await client.getInfo();
    } catch (e) {
      error = e as TargetInvocationError;
    }

    expect(error).toBeInstanceOf(TargetInvocationError);
    expect(error?.message).toBe('Unauthorized');
    expect(error?.statusCode).toBe(401);

    fetchSpy.mockRestore();
  });
});

describe('TargetClient.invoke with target override', () => {
  it('includes target in request body when specified', async () => {
    const mockResponse = {
      output: [{ role: 'assistant', content: 'test response' }],
      rawText: 'test response',
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    await client.invoke({ question: 'test', target: 'alt-target' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          question: 'test',
          systemPrompt: undefined,
          evalCaseId: undefined,
          attempt: undefined,
          target: 'alt-target',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });
});

describe('TargetClient.invokeBatch with target override', () => {
  it('includes target in each request when specified', async () => {
    const mockResponse = {
      responses: [
        { output: [], rawText: 'response 1' },
        { output: [], rawText: 'response 2' },
      ],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createTargetClientInternal('http://127.0.0.1:3000', 'token');
    await client.invokeBatch([{ question: 'q1' }, { question: 'q2', target: 'alt-target' }]);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/invokeBatch',
      expect.objectContaining({
        body: JSON.stringify({
          requests: [
            {
              question: 'q1',
              systemPrompt: undefined,
              evalCaseId: undefined,
              attempt: undefined,
              target: undefined,
            },
            {
              question: 'q2',
              systemPrompt: undefined,
              evalCaseId: undefined,
              attempt: undefined,
              target: 'alt-target',
            },
          ],
        }),
      }),
    );

    fetchSpy.mockRestore();
  });
});

describe('Error classes', () => {
  it('TargetNotAvailableError has correct name', () => {
    const error = new TargetNotAvailableError('test');
    expect(error.name).toBe('TargetNotAvailableError');
    expect(error.message).toBe('test');
  });

  it('TargetInvocationError has correct name and statusCode', () => {
    const error = new TargetInvocationError('test', 429);
    expect(error.name).toBe('TargetInvocationError');
    expect(error.message).toBe('test');
    expect(error.statusCode).toBe(429);
  });

  it('TargetInvocationError works without statusCode', () => {
    const error = new TargetInvocationError('test');
    expect(error.statusCode).toBeUndefined();
  });
});
