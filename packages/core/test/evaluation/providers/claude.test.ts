import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type ClaudeLogEntry,
  consumeClaudeLogEntries,
} from '../../../src/evaluation/providers/claude-log-tracker.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

function createMockQuery(options?: {
  messages?: Array<Record<string, unknown>>;
  error?: Error;
}) {
  const messages = options?.messages ?? [];
  const error = options?.error;

  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (error) {
            throw error;
          }
          if (index < messages.length) {
            return { value: messages[index++], done: false };
          }
          return { value: undefined, done: true };
        },
        async return() {
          return { value: undefined, done: true };
        },
        async throw(e: Error) {
          throw e;
        },
      };
    },
  };
}

describe('ClaudeProvider', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = path.join(tmpdir(), `claude-test-${Date.now()}`);
    consumeClaudeLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('invokes SDK and extracts response text', async () => {
    const queryMock = mock(() =>
      createMockQuery({
        messages: [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello from Claude SDK' }],
            },
          },
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.01,
            duration_ms: 500,
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});

    const request: ProviderRequest = {
      question: 'Write hello world',
    };

    const response = await provider.invoke(request);
    const content = extractLastAssistantContent(response.output);
    expect(content).toBe('Hello from Claude SDK');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('passes model config to query options', async () => {
    const queryMock = mock((_params: unknown) =>
      createMockQuery({
        messages: [
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0,
            duration_ms: 100,
            usage: {},
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {
      model: 'claude-sonnet-4-20250514',
    });

    await provider.invoke({ question: 'Test' });

    const params = queryMock.mock.calls[0][0] as { options?: { model?: string } };
    expect(params.options?.model).toBe('claude-sonnet-4-20250514');
  });

  it('handles abort signal', async () => {
    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: mock(() => createMockQuery({ messages: [] })),
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ question: 'Abort', signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
  });

  it('extracts token usage from result message', async () => {
    const queryMock = mock(() =>
      createMockQuery({
        messages: [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'response' }],
            },
          },
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.05,
            duration_ms: 1000,
            usage: {
              input_tokens: 200,
              output_tokens: 100,
              cache_read_input_tokens: 50,
            },
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});
    const response = await provider.invoke({ question: 'Tokens' });

    expect(response.tokenUsage).toBeDefined();
    expect(response.tokenUsage?.input).toBe(250); // 200 + 50 cached
    expect(response.tokenUsage?.output).toBe(100);
    expect(response.tokenUsage?.cached).toBe(50);
    expect(response.costUsd).toBe(0.05);
    expect(response.durationMs).toBe(1000);
  });

  it('extracts tool calls from assistant messages', async () => {
    const queryMock = mock(() =>
      createMockQuery({
        messages: [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  name: 'Read',
                  input: { path: '/foo.ts' },
                  id: 'tc-1',
                },
              ],
            },
          },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Done reading file' }],
            },
          },
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.01,
            duration_ms: 500,
            usage: {},
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});
    const response = await provider.invoke({ question: 'Read file' });

    expect(response.output).toBeDefined();
    expect(response.output?.length).toBe(2);
    const firstMsg = response.output?.[0];
    expect(firstMsg?.toolCalls).toBeDefined();
    expect(firstMsg?.toolCalls?.length).toBe(1);
    expect(firstMsg?.toolCalls?.[0]?.tool).toBe('Read');
    expect(firstMsg?.toolCalls?.[0]?.input).toEqual({ path: '/foo.ts' });
    expect(firstMsg?.toolCalls?.[0]?.id).toBe('tc-1');
  });

  it('sets bypassPermissions in query options', async () => {
    const queryMock = mock((_params: unknown) =>
      createMockQuery({
        messages: [
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0,
            duration_ms: 100,
            usage: {},
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});
    await provider.invoke({ question: 'Test' });

    const params = queryMock.mock.calls[0][0] as {
      options?: { permissionMode?: string; allowDangerouslySkipPermissions?: boolean };
    };
    expect(params.options?.permissionMode).toBe('bypassPermissions');
    expect(params.options?.allowDangerouslySkipPermissions).toBe(true);
  });

  it('strips CLAUDECODE env var to allow nested sessions', async () => {
    // Simulate running inside a Claude Code session
    const originalClaudeCode = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';

    try {
      const queryMock = mock((_params: unknown) =>
        createMockQuery({
          messages: [
            {
              type: 'result',
              subtype: 'success',
              total_cost_usd: 0,
              duration_ms: 100,
              usage: {},
            },
          ],
        }),
      );

      mock.module('@anthropic-ai/claude-agent-sdk', () => ({
        query: queryMock,
      }));

      const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

      const provider = new ClaudeProvider('test-target', {});
      await provider.invoke({ question: 'Test nested session' });

      const params = queryMock.mock.calls[0][0] as {
        options?: { env?: Record<string, string | undefined> };
      };
      expect(params.options?.env).toBeDefined();
      expect(params.options?.env?.CLAUDECODE).toBeUndefined();
    } finally {
      if (originalClaudeCode !== undefined) {
        process.env.CLAUDECODE = originalClaudeCode;
      } else {
        delete process.env.CLAUDECODE;
      }
    }
  });

  it('includes timing information in response', async () => {
    const queryMock = mock(() =>
      createMockQuery({
        messages: [
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0,
            duration_ms: 100,
            usage: {},
          },
        ],
      }),
    );

    mock.module('@anthropic-ai/claude-agent-sdk', () => ({
      query: queryMock,
    }));

    const { ClaudeProvider } = await import('../../../src/evaluation/providers/claude.js');

    const provider = new ClaudeProvider('test-target', {});
    const response = await provider.invoke({ question: 'Timing' });

    expect(response.startTime).toBeDefined();
    expect(response.endTime).toBeDefined();
    expect(response.durationMs).toBeDefined();
    expect(typeof response.durationMs).toBe('number');
  });
});
