import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type CopilotSdkLogEntry,
  consumeCopilotSdkLogEntries,
  subscribeToCopilotSdkLogEntries,
} from '../../../src/evaluation/providers/copilot-sdk-log-tracker.js';
import { DEFAULT_COPILOT_TIMEOUT_MS } from '../../../src/evaluation/providers/copilot-utils.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

// biome-ignore lint/suspicious/noExplicitAny: test mocks need flexible typing
type EventHandler = (event: any) => void;

interface MockSession {
  on: ReturnType<typeof mock>;
  sendAndWait: ReturnType<typeof mock>;
  disconnect?: ReturnType<typeof mock>;
  destroy?: ReturnType<typeof mock>;
  abort?: ReturnType<typeof mock>;
}

interface MockClient {
  start: ReturnType<typeof mock>;
  createSession: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
}

function createMockSession(options?: {
  events?: Array<{ type: string; data?: unknown }>;
  sendError?: Error;
  legacyDestroyOnly?: boolean;
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
    abort: mock(async () => {}),
  };

  if (options?.legacyDestroyOnly) {
    session.destroy = mock(async () => {});
  } else {
    session.disconnect = mock(async () => {});
  }

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
    RuntimeConnection: {
      forTcp: mock((options?: Record<string, unknown>) => ({
        kind: 'tcp',
        ...options,
      })),
      forStdio: mock((options?: Record<string, unknown>) => ({
        kind: 'stdio',
        ...options,
      })),
      forUri: mock((url: string) => ({
        kind: 'uri',
        url,
      })),
    },
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
    expect(session.disconnect).toHaveBeenCalledTimes(1);
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

  it('passes cliUrl through RuntimeConnection.forUri', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const forUri = mock((url: string) => ({ kind: 'uri', url }));

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
      RuntimeConnection: {
        forUri,
      },
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      cliUrl: 'http://localhost:9999',
    });

    await provider.invoke({ question: 'Test' });

    const constructorArgs = CopilotClientMock.mock.calls[0][0];
    expect(forUri).toHaveBeenCalledWith('http://localhost:9999');
    expect(constructorArgs.connection).toEqual({
      kind: 'uri',
      url: 'http://localhost:9999',
    });
    expect(session.disconnect).toHaveBeenCalledTimes(1);
  });

  it('passes args to the local TCP runtime and legacy cliArgs constructor option', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const forTcp = mock((options?: Record<string, unknown>) => ({ kind: 'tcp', ...options }));

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
      RuntimeConnection: {
        forTcp,
      },
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      args: ['--verbose', 'enabled'],
    });

    await provider.invoke({ question: 'Test' });

    const constructorArgs = CopilotClientMock.mock.calls[0][0];
    expect(forTcp).toHaveBeenCalledWith({ args: ['--verbose', 'enabled'] });
    expect(constructorArgs.connection).toEqual({
      kind: 'tcp',
      args: ['--verbose', 'enabled'],
    });
    expect(constructorArgs.cliArgs).toEqual(['--verbose', 'enabled']);
  });

  it('passes args through unchanged and sets cwd so the subprocess resolves relative paths itself', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const forTcp = mock((options?: Record<string, unknown>) => ({ kind: 'tcp', ...options }));

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
      RuntimeConnection: {
        forTcp,
      },
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      args: ['--plugin-dir', './plugins', '--shared-dir', '../shared', '--mode', 'agent'],
    });

    await provider.invoke({ question: 'Test', cwd: fixturesRoot });

    const constructorArgs = CopilotClientMock.mock.calls[0][0];
    // cwd is set so the subprocess resolves relative paths itself — args are NOT pre-resolved
    expect(constructorArgs.cwd).toBe(path.resolve(fixturesRoot));
    expect(constructorArgs.workingDirectory).toBe(path.resolve(fixturesRoot));
    expect(constructorArgs.connection).toEqual({
      kind: 'tcp',
      args: ['--plugin-dir', './plugins', '--shared-dir', '../shared', '--mode', 'agent'],
    });
    expect(constructorArgs.cliArgs).toEqual([
      '--plugin-dir',
      './plugins',
      '--shared-dir',
      '../shared',
      '--mode',
      'agent',
    ]);
  });

  it('handles timeout', async () => {
    const session = createMockSession();
    // Override sendAndWait to be slow
    session.sendAndWait = mock(async () => new Promise(() => {}));
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      timeoutMs: 100,
    });

    await expect(provider.invoke({ question: 'Slow' })).rejects.toThrow(/timed out/i);
    expect(session.sendAndWait.mock.calls[0][1]).toBe(100);
  });

  it('passes the 90-minute default timeout to sendAndWait when none is configured', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    await provider.invoke({ question: 'Test' });

    expect(session.sendAndWait.mock.calls[0][1]).toBe(DEFAULT_COPILOT_TIMEOUT_MS);
  });

  it('passes configured timeout to sendAndWait', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      timeoutMs: 1_800_000,
    });

    await provider.invoke({ question: 'Test' });

    expect(session.sendAndWait.mock.calls[0][1]).toBe(1_800_000);
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

  it('reuses external client across multiple invocations', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const forUri = mock((url: string) => ({ kind: 'uri', url }));

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
      RuntimeConnection: {
        forUri,
      },
    }));

    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      cliUrl: 'http://localhost:9999',
    });

    await provider.invoke({ question: 'First' });
    await provider.invoke({ question: 'Second' });

    // Client constructor should only be called once
    expect(CopilotClientMock).toHaveBeenCalledTimes(1);
    // But createSession should be called twice (fresh session per invocation)
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(session.disconnect).toHaveBeenCalledTimes(2);
    expect(forUri).toHaveBeenCalledTimes(1);
  });

  it('reuses local TCP client across multiple invocations', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const forTcp = mock((options?: Record<string, unknown>) => ({ kind: 'tcp', ...options }));

    const CopilotClientMock = mock(function CopilotClient() {
      return client;
    });
    mock.module('@github/copilot-sdk', () => ({
      CopilotClient: CopilotClientMock,
      RuntimeConnection: {
        forTcp,
      },
    }));
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {});

    await provider.invoke({ question: 'First' });
    await provider.invoke({ question: 'Second' });

    expect(CopilotClientMock).toHaveBeenCalledTimes(1);
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(session.disconnect).toHaveBeenCalledTimes(2);
    expect(forTcp).toHaveBeenCalledTimes(1);
    expect(CopilotClientMock.mock.calls[0][0].connection.kind).toBe('tcp');
  });

  it('falls back to destroy for older external SDK sessions', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
      legacyDestroyOnly: true,
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      cliUrl: 'http://localhost:9999',
    });

    await provider.invoke({ question: 'Test' });

    expect(session.destroy).toHaveBeenCalledTimes(1);
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
    expect(msg?.toolCalls?.[0]?.input).toEqual({ path: '/foo.ts', file_path: '/foo.ts' });
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

  it('passes resolved custom provider config to createSession for azure', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      model: 'gpt-4o',
      customProvider: {
        type: 'azure',
        baseUrl: 'https://my-resource.openai.azure.com',
        apiKey: 'azure-secret',
        apiVersion: '2024-10-21',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider).toBeDefined();
    expect(sessionOptions.provider.type).toBe('azure');
    expect(sessionOptions.provider.baseUrl).toBe('https://my-resource.openai.azure.com');
    expect(sessionOptions.provider.apiKey).toBe('azure-secret');
    expect(sessionOptions.provider.azure).toEqual({ apiVersion: '2024-10-21' });
  });

  it('passes custom provider model identity overrides to createSession', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      model: 'gpt-5',
      customProvider: {
        type: 'openai',
        baseUrl: 'http://127.0.0.1:10531/v1',
        apiKey: 'dummy',
        wireApi: 'responses',
        modelId: 'gpt-5',
        wireModel: 'gpt-5.3-codex-spark',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.model).toBe('gpt-5');
    expect(sessionOptions.provider).toMatchObject({
      type: 'openai',
      baseUrl: 'http://127.0.0.1:10531/v1',
      apiKey: 'dummy',
      wireApi: 'responses',
      modelId: 'gpt-5',
      wireModel: 'gpt-5.3-codex-spark',
    });
  });

  it('normalizes bare azure resource name to full URL', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'azure',
        baseUrl: 'my-resource-eastus2',
        apiKey: 'key',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider.baseUrl).toBe('https://my-resource-eastus2.openai.azure.com');
  });

  it('passes full URL through unchanged for azure custom provider', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'azure',
        baseUrl: 'https://my-resource.openai.azure.com',
        apiKey: 'key',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider.baseUrl).toBe('https://my-resource.openai.azure.com');
  });

  it('passes resolved custom provider config with bearer token', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'openai',
        baseUrl: 'https://custom-endpoint.example.com/v1',
        bearerToken: 'bearer-secret',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider).toBeDefined();
    expect(sessionOptions.provider.bearerToken).toBe('bearer-secret');
    expect(sessionOptions.provider.apiKey).toBeUndefined();
  });

  it('passes resolved custom provider config with wireApi', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'openai',
        baseUrl: 'https://resource.openai.azure.com/openai/v1/',
        apiKey: 'key',
        wireApi: 'responses',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider.wireApi).toBe('responses');
  });

  it('passes resolved custom provider config to createSession for openai-compatible endpoints', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: 'key',
        wireApi: 'responses',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider).toEqual({
      type: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'key',
      wireApi: 'responses',
    });
  });

  it('does not set provider when custom provider is not configured', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      model: 'gpt-4o',
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider).toBeUndefined();
  });

  it('defaults custom provider type to openai when not specified', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider.type).toBe('openai');
  });

  it('does not set azure block for non-azure custom provider type', async () => {
    const session = createMockSession({
      events: [{ type: 'assistant.message', data: { content: 'response' } }],
    });
    const client = createMockClient(session);
    const sdkMock = mockCopilotSdk(client);

    mock.module('@github/copilot-sdk', () => sdkMock);
    const { CopilotSdkProvider } = await import('../../../src/evaluation/providers/copilot-sdk.js');

    const provider = new CopilotSdkProvider('test-target', {
      customProvider: {
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        apiVersion: '2024-10-21', // should be ignored for non-azure
      },
    });

    await provider.invoke({ question: 'Test' });

    const sessionOptions = client.createSession.mock.calls[0][0];
    expect(sessionOptions.provider.azure).toBeUndefined();
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
