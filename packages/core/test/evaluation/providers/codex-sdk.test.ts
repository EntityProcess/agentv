import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type CodexLogEntry,
  consumeCodexLogEntries,
} from '../../../src/evaluation/providers/codex-log-tracker.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

interface MockThread {
  runStreamed: ReturnType<typeof mock>;
}

interface MockCodex {
  startThread: ReturnType<typeof mock>;
}

function createMockThread(options?: {
  events?: Array<Record<string, unknown>>;
  error?: Error;
}): MockThread {
  const events = options?.events ?? [];

  return {
    runStreamed: mock(async () => {
      if (options?.error) {
        throw options.error;
      }
      return {
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
      };
    }),
  };
}

function createMockCodex(thread: MockThread): MockCodex {
  return {
    startThread: mock(() => thread),
  };
}

function mockCodexSdk(codexInstance: MockCodex) {
  return {
    Codex: mock(function Codex() {
      return codexInstance;
    }),
  };
}

describe('CodexProvider (SDK)', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = path.join(tmpdir(), `codex-sdk-test-${Date.now()}`);
    consumeCodexLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('invokes SDK and extracts response text', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Hello from Codex SDK' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);

    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    const request: ProviderRequest = {
      question: 'Write hello world',
    };

    const response = await provider.invoke(request);
    const content = extractLastAssistantContent(response.outputMessages);
    expect(content).toBe('Hello from Codex SDK');
    expect(thread.runStreamed).toHaveBeenCalledTimes(1);
  });

  it('passes model config to Codex constructor', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);

    const CodexMock = mock(function Codex() {
      return codexInstance;
    });
    mock.module('@openai/codex-sdk', () => ({ Codex: CodexMock }));

    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', {
      executable: 'codex',
      model: 'o4-mini',
    });

    await provider.invoke({ question: 'Test' });

    const constructorArgs = CodexMock.mock.calls[0][0];
    expect(constructorArgs.config.model).toBe('o4-mini');
  });

  it('passes workingDirectory to startThread', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);

    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', {
      executable: 'codex',
      cwd: '/tmp/test-workspace',
    });

    await provider.invoke({ question: 'Test' });

    const threadOptions = codexInstance.startThread.mock.calls[0][0];
    expect(threadOptions.skipGitRepoCheck).toBe(true);
    expect(threadOptions.workingDirectory).toBe('/tmp/test-workspace');
  });

  it('handles timeout', async () => {
    const thread = createMockThread();
    // Override runStreamed to be slow
    thread.runStreamed = mock(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                events: (async function* () {})(),
              }),
            5000,
          ),
        ),
    );
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', {
      executable: 'codex',
      timeoutMs: 100,
    });

    await expect(provider.invoke({ question: 'Slow' })).rejects.toThrow(/timed out/i);
  });

  it('handles abort signal', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ question: 'Abort', signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
  });

  it('extracts token usage from turn.completed event', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    const response = await provider.invoke({ question: 'Tokens' });

    expect(response.tokenUsage).toBeDefined();
    expect(response.tokenUsage?.input).toBe(100);
    expect(response.tokenUsage?.output).toBe(50);
    expect(response.tokenUsage?.cached).toBe(20);
  });

  it('extracts command execution tool calls from events', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'ls -la',
            aggregated_output: 'file1.ts\nfile2.ts',
            exit_code: 0,
            status: 'completed',
          },
        },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Done listing files' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    const response = await provider.invoke({ question: 'List files' });

    expect(response.outputMessages).toBeDefined();
    expect(response.outputMessages?.length).toBe(1);
    const msg = response.outputMessages?.[0];
    expect(msg?.toolCalls).toBeDefined();
    expect(msg?.toolCalls?.length).toBe(1);
    expect(msg?.toolCalls?.[0]?.tool).toBe('command_execution');
    expect(msg?.toolCalls?.[0]?.input).toBe('ls -la');
    expect(msg?.toolCalls?.[0]?.output).toBe('file1.ts\nfile2.ts');
    expect(msg?.toolCalls?.[0]?.id).toBe('cmd-1');
  });

  it('extracts file change tool calls from events', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: {
            id: 'fc-1',
            type: 'file_change',
            changes: [{ path: 'src/index.ts', kind: 'update' }],
            status: 'completed',
          },
        },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Updated file' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    const response = await provider.invoke({ question: 'Update file' });

    const msg = response.outputMessages?.[0];
    expect(msg?.toolCalls?.length).toBe(1);
    expect(msg?.toolCalls?.[0]?.tool).toBe('file_change');
    expect(msg?.toolCalls?.[0]?.input).toEqual([{ path: 'src/index.ts', kind: 'update' }]);
  });

  it('includes timing information in response', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });
    const response = await provider.invoke({ question: 'Timing' });

    expect(response.startTime).toBeDefined();
    expect(response.endTime).toBeDefined();
    expect(response.durationMs).toBeDefined();
    expect(typeof response.durationMs).toBe('number');
  });

  it('handles turn.failed events', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'turn.failed',
          error: { message: 'Model overloaded' },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);
    const sdkMock = mockCodexSdk(codexInstance);

    mock.module('@openai/codex-sdk', () => sdkMock);
    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    await expect(provider.invoke({ question: 'Fail' })).rejects.toThrow(/turn failed/i);
  });

  it('creates fresh Codex instance per invocation', async () => {
    const thread = createMockThread({
      events: [
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'response' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        },
      ],
    });
    const codexInstance = createMockCodex(thread);

    const CodexMock = mock(function Codex() {
      return codexInstance;
    });
    mock.module('@openai/codex-sdk', () => ({ Codex: CodexMock }));

    const { CodexProvider } = await import('../../../src/evaluation/providers/codex.js');

    const provider = new CodexProvider('test-target', { executable: 'codex' });

    await provider.invoke({ question: 'First' });
    await provider.invoke({ question: 'Second' });

    // Each invocation creates a new Codex instance and thread
    expect(CodexMock).toHaveBeenCalledTimes(2);
    expect(codexInstance.startThread).toHaveBeenCalledTimes(2);
  });
});
