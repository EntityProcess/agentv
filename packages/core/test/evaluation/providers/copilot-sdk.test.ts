import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type CopilotSdkLogEntry,
  consumeCopilotSdkLogEntries,
  subscribeToCopilotSdkLogEntries,
} from '../../../src/evaluation/providers/copilot-sdk-log-tracker.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

// biome-ignore lint/suspicious/noExplicitAny: test mocks need flexible typing
type EventHandler = (event: any) => void;

interface MockSession {
  on: ReturnType<typeof mock>;
  sendAndWait: ReturnType<typeof mock>;
  destroy: ReturnType<typeof mock>;
}

interface MockClient {
  start: ReturnType<typeof mock>;
  createSession: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
}

function createMockSession(options?: {
  events?: Array<{ type: string; data?: unknown }>;
  sendError?: Error;
}): MockSession {
  let eventHandler: EventHandler | null = null;

  const session: MockSession = {
    on: mock((handler: EventHandler) => {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    }),
    sendAndWait: mock(async () => {
      // Fire any configured events
      if (eventHandler && options?.events) {
        for (const event of options.events) {
          eventHandler(event);
        }
      }
      if (options?.sendError) {
        throw options.sendError;
      }
    }),
    destroy: mock(async () => {}),
  };

  return session;
}

function createMockClient(session: MockSession): MockClient {
  return {
    start: mock(async () => {}),
    createSession: mock(async () => session),
    stop: mock(async () => {}),
  };
}

// Mock the SDK module
function mockCopilotSdk(client: MockClient) {
  return {
    CopilotClient: mock(function CopilotClient() {
      return client;
    }),
  };
}

// We need to create the provider manually with injected mocks since
// the real module uses dynamic import. We'll test the provider class directly
// by importing it and using bun's mock.module to intercept the SDK import.

describe('CopilotSdkProvider', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = path.join(tmpdir(), `copilot-sdk-test-${Date.now()}`);
    consumeCopilotSdkLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('invokes SDK and extracts response text', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'Hello from Copilot SDK' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);

    // Re-import to pick up the mock
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    const request: ProviderRequest = {
      question: 'Write hello world',
    };

    const response = await provider.invoke(request);
    const content = extractLastAssistantContent(response.output);
    expect(content).toBe('Hello from Copilot SDK');
    expect(session.sendAndWait).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('passes model config to createSession', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      model: 'gpt-5',
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.model).toBe('gpt-5');
  });

  it('passes cliUrl to CopilotClient constructor', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      cliUrl: 'http://localhost:9999',
    });

    await provider.invoke({ question: 'Test' });

    const constructorArgs = CopilotClientMock.mock.calls[0][0];
    expect(constructorArgs.cliUrl).toBe('http://localhost:9999');
  });

  it('handles timeout', async () => {
    const session = createMockSession();
    // Override sendAndWait to be slow
    session.sendAndWait = mock(async () => new Promise((resolve) => setTimeout(resolve, 5000)));
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      timeoutMs: 100,
    });

    await expect(provider.invoke({ question: 'Slow' })).rejects.toThrow(/timed out/i);
  });

  it('handles abort signal', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ question: 'Abort', signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
  });

  it('reuses client across multiple invocations', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    await provider.invoke({ question: 'First' });
    await provider.invoke({ question: 'Second' });

    // Client constructor should only be called once
    expect(CopilotClientMock).toHaveBeenCalledTimes(1);
    // But createSession should be called twice (fresh session per invocation)
    expect(client.createSession).toHaveBeenCalledTimes(2);
  });

  it('creates fresh session per invocation', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    await provider.invoke({ question: 'First' });
    await provider.invoke({ question: 'Second' });

    // Session should be destroyed after each invocation
    expect(session.destroy).toHaveBeenCalledTimes(2);
    expect(client.createSession).toHaveBeenCalledTimes(2);
  });

  it('extracts token usage from assistant.usage events', async () => {
    const session = createMockSession({
      events: [
        { type: 'assistant.usage', data: { inputTokens: 100, outputTokens: 50 } },
        { type: 'assistant.usage', data: { inputTokens: 200, outputTokens: 75 } },
        { type: 'assistant.message', data: { content: 'response' } },
      ],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    const response = await provider.invoke({ question: 'Tokens' });

    // Token usage should be aggregated across events
    expect(response.tokenUsage).toBeDefined();
    expect(response.tokenUsage?.input).toBe(300);
    expect(response.tokenUsage?.output).toBe(125);
  });

  it('extracts tool calls from events', async () => {
    const session = createMockSession({
      events: [
        {
          type: 'tool.execution_start',
          data: { toolCallId: 'tc-1', toolName: 'Read', input: { path: '/foo.ts' } },
        },
        {
          type: 'tool.execution_end',
          data: { toolCallId: 'tc-1', toolName: 'Read', output: 'file content' },
        },
        { type: 'assistant.message', data: { content: 'Done reading file' } },
      ],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    const response = await provider.invoke({ question: 'Read file' });

    expect(response.output).toBeDefined();
    expect(response.output?.length).toBe(1);
    const msg = response.output?.[0];
    expect(msg?.toolCalls).toBeDefined();
    expect(msg?.toolCalls?.length).toBe(1);
    expect(msg?.toolCalls?.[0]?.tool).toBe('Read');
    expect(msg?.toolCalls?.[0]?.input).toEqual({ path: '/foo.ts' });
    expect(msg?.toolCalls?.[0]?.output).toBe('file content');
    expect(msg?.toolCalls?.[0]?.id).toBe('tc-1');
    expect(msg?.toolCalls?.[0]?.durationMs).toBeDefined();
  });

  it('auto-approves permission requests', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});
    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.onPermissionRequest).toBeDefined();
    const result = sessionOptions.onPermissionRequest({});
    expect(result.kind).toBe('approved');
  });

  it('includes timing information in response', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});
    const response = await provider.invoke({ question: 'Timing' });

    expect(response.startTime).toBeDefined();
    expect(response.endTime).toBeDefined();
    expect(response.durationMs).toBeDefined();
    expect(typeof response.durationMs).toBe('number');
  });
});
