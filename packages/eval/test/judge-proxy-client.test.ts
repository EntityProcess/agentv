import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  JudgeInvocationError,
  JudgeProxyNotAvailableError,
  createJudgeProxyClient,
  createJudgeProxyClientFromEnv,
} from '../src/judge-proxy-client.js';

describe('createJudgeProxyClientFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    process.env.AGENTV_JUDGE_PROXY_URL = undefined;
    process.env.AGENTV_JUDGE_PROXY_TOKEN = undefined;
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('returns undefined when no env vars are set', () => {
    const client = createJudgeProxyClientFromEnv();
    expect(client).toBeUndefined();
  });

  it('throws JudgeProxyNotAvailableError when URL is set but token is missing', () => {
    process.env.AGENTV_JUDGE_PROXY_URL = 'http://127.0.0.1:3000';

    expect(() => createJudgeProxyClientFromEnv()).toThrow(JudgeProxyNotAvailableError);
    expect(() => createJudgeProxyClientFromEnv()).toThrow(
      'AGENTV_JUDGE_PROXY_URL is set but AGENTV_JUDGE_PROXY_TOKEN is missing',
    );
  });

  it('returns client when both env vars are set', () => {
    process.env.AGENTV_JUDGE_PROXY_URL = 'http://127.0.0.1:3000';
    process.env.AGENTV_JUDGE_PROXY_TOKEN = 'test-token-123';

    const client = createJudgeProxyClientFromEnv();
    expect(client).toBeDefined();
    expect(typeof client?.invoke).toBe('function');
    expect(typeof client?.invokeBatch).toBe('function');
  });
});

describe('createJudgeProxyClient', () => {
  it('creates client with invoke method', () => {
    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');
    expect(typeof client.invoke).toBe('function');
  });

  it('creates client with invokeBatch method', () => {
    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');
    expect(typeof client.invokeBatch).toBe('function');
  });
});

describe('JudgeProxyClient.invoke', () => {
  it('makes POST request with correct headers', async () => {
    const mockResponse = {
      outputMessages: [{ role: 'assistant', content: 'test response' }],
      rawText: 'test response',
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'secret-token');
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

  it('returns response with outputMessages and rawText', async () => {
    const mockResponse = {
      outputMessages: [{ role: 'assistant', content: 'test' }],
      rawText: 'test',
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');
    const response = await client.invoke({ question: 'test' });

    expect(response.outputMessages).toEqual([{ role: 'assistant', content: 'test' }]);
    expect(response.rawText).toBe('test');

    fetchSpy.mockRestore();
  });

  it('throws JudgeInvocationError on non-ok response', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('{"error":"Max calls exceeded"}'),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');

    let error: JudgeInvocationError | undefined;
    try {
      await client.invoke({ question: 'test' });
    } catch (e) {
      error = e as JudgeInvocationError;
    }

    expect(error).toBeInstanceOf(JudgeInvocationError);
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

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');

    let error: JudgeInvocationError | undefined;
    try {
      await client.invoke({ question: 'test' });
    } catch (e) {
      error = e as JudgeInvocationError;
    }

    expect(error).toBeInstanceOf(JudgeInvocationError);
    expect(error?.message).toBe('Internal Server Error');
    expect(error?.statusCode).toBe(500);

    fetchSpy.mockRestore();
  });
});

describe('JudgeProxyClient.invokeBatch', () => {
  it('makes POST request to /invokeBatch endpoint', async () => {
    const mockResponse = {
      responses: [
        { outputMessages: [], rawText: 'response 1' },
        { outputMessages: [], rawText: 'response 2' },
      ],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');
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
        { outputMessages: [], rawText: 'response 1' },
        { outputMessages: [], rawText: 'response 2' },
      ],
    };

    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');
    const responses = await client.invokeBatch([{ question: 'q1' }, { question: 'q2' }]);

    expect(responses).toHaveLength(2);
    expect(responses[0].rawText).toBe('response 1');
    expect(responses[1].rawText).toBe('response 2');

    fetchSpy.mockRestore();
  });

  it('throws JudgeInvocationError on batch limit exceeded', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(
          '{"error":"Batch would exceed max calls (current: 45, batch: 10, limit: 50)"}',
        ),
    } as Response);

    const client = createJudgeProxyClient('http://127.0.0.1:3000', 'token');

    let error: JudgeInvocationError | undefined;
    try {
      await client.invokeBatch([{ question: 'q1' }]);
    } catch (e) {
      error = e as JudgeInvocationError;
    }

    expect(error).toBeInstanceOf(JudgeInvocationError);
    expect(error?.message).toContain('Batch would exceed max calls');
    expect(error?.statusCode).toBe(429);

    fetchSpy.mockRestore();
  });
});

describe('Error classes', () => {
  it('JudgeProxyNotAvailableError has correct name', () => {
    const error = new JudgeProxyNotAvailableError('test');
    expect(error.name).toBe('JudgeProxyNotAvailableError');
    expect(error.message).toBe('test');
  });

  it('JudgeInvocationError has correct name and statusCode', () => {
    const error = new JudgeInvocationError('test', 429);
    expect(error.name).toBe('JudgeInvocationError');
    expect(error.message).toBe('test');
    expect(error.statusCode).toBe(429);
  });

  it('JudgeInvocationError works without statusCode', () => {
    const error = new JudgeInvocationError('test');
    expect(error.statusCode).toBeUndefined();
  });
});
