import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { DEFAULT_COPILOT_TIMEOUT_MS } from '../../../src/evaluation/providers/copilot-utils.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

type CopilotCliModule = typeof import('../../../src/evaluation/providers/copilot-cli.js');

let CopilotCliProvider: CopilotCliModule['CopilotCliProvider'];
let buildCopilotCliProviderEnv: CopilotCliModule['buildCopilotCliProviderEnv'];
let originalLogEnv: string | undefined;
let spawnMock: ReturnType<typeof mock>;
let acpSessionUpdates: Array<{ update: { sessionUpdate: string; [key: string]: unknown } }>;
let acpPromptResponse: Record<string, unknown>;

function createMockChildProcess(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof mock>;
  };
  child.pid = 12345;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = mock(() => true);
  return child as unknown as ChildProcess;
}

beforeAll(async () => {
  spawnMock = mock(() => createMockChildProcess());
  mock.module('@agentclientprotocol/sdk', () => ({
    PROTOCOL_VERSION: 1,
    ndJsonStream: mock(() => ({})),
    ClientSideConnection: class MockClientSideConnection {
      private readonly client: {
        sessionUpdate?: (params: {
          update: { sessionUpdate: string; [key: string]: unknown };
        }) => Promise<void>;
      };

      constructor(
        createClient: (_agent: unknown) => {
          sessionUpdate?: (params: {
            update: { sessionUpdate: string; [key: string]: unknown };
          }) => Promise<void>;
        },
      ) {
        this.client = createClient({});
      }

      async initialize(): Promise<void> {}

      async newSession(): Promise<{ sessionId: string }> {
        return { sessionId: 'session-1' };
      }

      async prompt(): Promise<Record<string, unknown>> {
        for (const update of acpSessionUpdates) {
          await this.client.sessionUpdate?.(update);
        }
        return acpPromptResponse;
      }
    },
  }));
  const module = await import('../../../src/evaluation/providers/copilot-cli.js');
  CopilotCliProvider = module.CopilotCliProvider;
  buildCopilotCliProviderEnv = module.buildCopilotCliProviderEnv;
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  originalLogEnv = process.env.AGENTV_COPILOT_CLI_STREAM_LOGS;
  process.env.AGENTV_COPILOT_CLI_STREAM_LOGS = 'false';
  spawnMock.mockClear();
  acpSessionUpdates = [
    {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'agentv-copilot-gateway-ok' },
      },
    },
  ];
  acpPromptResponse = {};
});

afterEach(() => {
  if (originalLogEnv === undefined) {
    process.env.AGENTV_COPILOT_CLI_STREAM_LOGS = undefined;
  } else {
    process.env.AGENTV_COPILOT_CLI_STREAM_LOGS = originalLogEnv;
  }
});

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
        wireApi: 'responses',
        apiVersion: '2024-10-21',
      },
    );

    expect(env.PATH).toBe('/usr/bin');
    expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.openai.example/v1');
    expect(env.COPILOT_PROVIDER_API_KEY).toBe('new-key');
    expect(env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
    expect(env.COPILOT_PROVIDER_AZURE_API_VERSION).toBe('2024-10-21');
  });

  it('maps bearer token without overwriting ambient API key', () => {
    const env = buildCopilotCliProviderEnv(
      {
        COPILOT_PROVIDER_API_KEY: 'ambient-key',
      },
      {
        type: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        bearerToken: 'bearer-token',
      },
    );

    expect(env.COPILOT_PROVIDER_API_KEY).toBe('ambient-key');
    expect(env.COPILOT_PROVIDER_BEARER_TOKEN).toBe('bearer-token');
  });

  it('preserves ambient Copilot provider env vars without a target override', () => {
    const env = buildCopilotCliProviderEnv(
      {
        COPILOT_PROVIDER_TYPE: 'openai',
        COPILOT_PROVIDER_BASE_URL: 'https://ambient.example/v1',
        COPILOT_PROVIDER_API_KEY: 'ambient-key',
        COPILOT_PROVIDER_WIRE_API: 'responses',
        COPILOT_PROVIDER_AZURE_API_VERSION: '2024-10-21',
      },
      undefined,
    );

    expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://ambient.example/v1');
    expect(env.COPILOT_PROVIDER_API_KEY).toBe('ambient-key');
    expect(env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
    expect(env.COPILOT_PROVIDER_AZURE_API_VERSION).toBe('2024-10-21');
  });
});

describe('CopilotCliProvider custom provider ACP mode', () => {
  it('uses ACP mode with custom provider env vars when customProvider is resolved', async () => {
    const runner = mock(async () => {
      throw new Error('prompt mode should not be used');
    });
    const provider = new CopilotCliProvider(
      'copilot-cli-custom',
      {
        executable: '/usr/bin/copilot',
        model: 'gpt-5-mini',
        args: ['--plugin-dir', './plugins', '--extra-flag'],
        customProvider: {
          type: 'openai',
          baseUrl: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
          wireApi: 'responses',
        },
      },
      runner,
      spawnMock as unknown as typeof spawn,
    );

    const response = await provider.invoke({
      question: 'Return exactly agentv-copilot-gateway-ok',
      cwd: '/tmp/copilot-workspace',
    });

    expect(extractLastAssistantContent(response.output)).toBe('agentv-copilot-gateway-ok');
    expect(runner).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [executable, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      {
        cwd: string;
        env: NodeJS.ProcessEnv;
        stdio: string[];
      },
    ];
    expect(executable).toBe('/usr/bin/copilot');
    expect(args.slice(0, 6)).toEqual([
      '--acp',
      '--stdio',
      '--allow-all-tools',
      '--yolo',
      '--model',
      'gpt-5-mini',
    ]);
    expect(args).toContain('--plugin-dir');
    expect(args).toContain('./plugins');
    expect(args).not.toContain('-p');
    expect(options.cwd).toBe('/tmp/copilot-workspace');
    expect(options.stdio).toEqual(['pipe', 'pipe', 'inherit']);
    expect(options.env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(options.env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.openai.example/v1');
    expect(options.env.COPILOT_PROVIDER_API_KEY).toBe('secret-key');
    expect(options.env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
  });

  it('uses configured cwd for ACP spawn when request cwd is omitted', async () => {
    const provider = new CopilotCliProvider(
      'copilot-cli-custom',
      {
        executable: '/usr/bin/copilot',
        cwd: '/tmp/eval-workspace',
        customProvider: {
          type: 'openai',
          baseUrl: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
        },
      },
      undefined,
      spawnMock as unknown as typeof spawn,
    );

    await provider.invoke({ question: 'Return done' });

    const options = spawnMock.mock.calls[0][2] as { cwd: string };
    expect(options.cwd).toBe('/tmp/eval-workspace');
  });

  it('redacts custom provider credentials from ACP stream logs', async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), 'agentv-copilot-cli-logs-'));
    Reflect.deleteProperty(process.env, 'AGENTV_COPILOT_CLI_STREAM_LOGS');
    acpSessionUpdates = [
      {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'stdout included test-api-key' },
        },
      },
    ];

    try {
      const provider = new CopilotCliProvider(
        'copilot-cli-custom',
        {
          executable: '/usr/bin/copilot',
          logDir,
          customProvider: {
            type: 'openai',
            baseUrl: 'https://api.openai.example/v1',
            apiKey: 'test-api-key',
          },
        },
        undefined,
        spawnMock as unknown as typeof spawn,
      );

      const response = await provider.invoke({ question: 'Return done' });
      const logFile = (response.raw as Record<string, unknown>).logFile;
      expect(typeof logFile).toBe('string');

      const log = await readFile(logFile as string, 'utf8');
      expect(log).toContain('[redacted]');
      expect(log).not.toContain('test-api-key');
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});

describe('CopilotCliProvider ACP timeout guard', () => {
  it('uses the 90-minute default timeout when none is configured', async () => {
    const timeoutMs = await captureAcpTimeoutDelay(
      new CopilotCliProvider('copilot-cli-acp', { executable: 'copilot' }),
    );

    expect(timeoutMs).toBe(DEFAULT_COPILOT_TIMEOUT_MS);
  });

  it('uses explicit timeout for ACP when configured', async () => {
    const timeoutMs = await captureAcpTimeoutDelay(
      new CopilotCliProvider('copilot-cli-acp', {
        executable: 'copilot',
        timeoutMs: 45_000,
      }),
    );

    expect(timeoutMs).toBe(45_000);
  });
});

async function captureAcpTimeoutDelay(provider: CopilotCliProvider): Promise<number | undefined> {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let capturedDelay: number | undefined;

  globalThis.setTimeout = ((_handler: Parameters<typeof setTimeout>[0], delay?: number) => {
    capturedDelay = delay;
    return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const process = {
      exitCode: null,
      signalCode: null,
      kill: mock(() => true),
    } as unknown as ChildProcess;
    await (
      provider as unknown as {
        raceWithTimeout<T>(sendPromise: Promise<T>, agentProcess: ChildProcess): Promise<T>;
      }
    ).raceWithTimeout(Promise.resolve('ok'), process);
    return capturedDelay;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}
