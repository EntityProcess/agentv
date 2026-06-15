import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_COPILOT_TIMEOUT_MS } from '../../../src/evaluation/providers/copilot-utils.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

type CopilotCliModule = typeof import('../../../src/evaluation/providers/copilot-cli.js');

let CopilotCliProvider: CopilotCliModule['CopilotCliProvider'];
let buildCopilotCliProviderEnv: CopilotCliModule['buildCopilotCliProviderEnv'];
let originalLogEnv: string | undefined;

beforeAll(async () => {
  mock.module('@agentclientprotocol/sdk', () => ({
    PROTOCOL_VERSION: 1,
    ndJsonStream: mock(() => ({})),
    ClientSideConnection: class MockClientSideConnection {},
  }));
  const module = await import('../../../src/evaluation/providers/copilot-cli.js');
  CopilotCliProvider = module.CopilotCliProvider;
  buildCopilotCliProviderEnv = module.buildCopilotCliProviderEnv;
});

beforeEach(() => {
  originalLogEnv = process.env.AGENTV_COPILOT_CLI_STREAM_LOGS;
  process.env.AGENTV_COPILOT_CLI_STREAM_LOGS = 'false';
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

describe('CopilotCliProvider custom provider prompt mode', () => {
  it('uses non-ACP prompt mode with custom provider env and default long timeout', async () => {
    const runner = mock(async () => ({
      stdout: '\u001b[32magentv-copilot-gateway-ok\u001b[0m\n',
      stderr: 'warning secret-key',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-cli-custom',
      {
        executable: '/usr/bin/copilot',
        model: 'gpt-5-mini',
        args: ['--extra-flag'],
        customProvider: {
          type: 'openai',
          baseUrl: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
          wireApi: 'responses',
        },
      },
      runner,
    );

    const response = await provider.invoke({
      question: 'Return exactly agentv-copilot-gateway-ok',
      cwd: '/tmp/copilot-workspace',
    });

    expect(extractLastAssistantContent(response.output)).toBe('agentv-copilot-gateway-ok');
    expect(runner).toHaveBeenCalledTimes(1);
    const invocation = runner.mock.calls[0][0];
    expect(invocation.executable).toBe('/usr/bin/copilot');
    expect(invocation.cwd).toBe('/tmp/copilot-workspace');
    expect(invocation.timeoutMs).toBe(DEFAULT_COPILOT_TIMEOUT_MS);
    expect(invocation.env.COPILOT_PROVIDER_TYPE).toBe('openai');
    expect(invocation.env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.openai.example/v1');
    expect(invocation.env.COPILOT_PROVIDER_API_KEY).toBe('secret-key');
    expect(invocation.env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
    expect(invocation.args.slice(0, 6)).toEqual([
      '-s',
      '--allow-all-tools',
      '--no-color',
      '--model',
      'gpt-5-mini',
      '--extra-flag',
    ]);
    expect(invocation.args).not.toContain('--acp');
    expect(invocation.args).not.toContain('--stdio');
    expect(invocation.args.at(-2)).toBe('-p');
    expect(invocation.args.at(-1)).toContain('agentv-copilot-gateway-ok');

    const raw = response.raw as Record<string, unknown>;
    expect(raw.stderr).toBe('warning [redacted]');
  });

  it('uses explicit timeout for custom provider prompt mode when configured', async () => {
    const runner = mock(async () => ({
      stdout: 'done',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-cli-custom',
      {
        executable: '/usr/bin/copilot',
        timeoutMs: 30_000,
        customProvider: {
          type: 'openai',
          baseUrl: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
        },
      },
      runner,
    );

    await provider.invoke({ question: 'Return done' });

    expect(runner.mock.calls[0][0].timeoutMs).toBe(30_000);
  });

  it('redacts custom provider credentials from prompt-mode errors', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: 'upstream rejected secret-key',
      exitCode: 1,
    }));
    const provider = new CopilotCliProvider(
      'copilot-cli-custom',
      {
        executable: '/usr/bin/copilot',
        customProvider: {
          type: 'openai',
          baseUrl: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
        },
      },
      runner,
    );

    let message = '';
    try {
      await provider.invoke({ question: 'Return done' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('[redacted]');
    expect(message).not.toContain('secret-key');
  });

  it('redacts custom provider credentials from prompt-mode stream logs', async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), 'agentv-copilot-cli-logs-'));
    Reflect.deleteProperty(process.env, 'AGENTV_COPILOT_CLI_STREAM_LOGS');

    try {
      const runner = mock(
        async (options: {
          readonly onStdoutChunk?: (chunk: string) => void;
          readonly onStderrChunk?: (chunk: string) => void;
        }) => {
          options.onStdoutChunk?.('stdout included test-api-key');
          options.onStderrChunk?.('stderr included test-api-key');
          return {
            stdout: 'done',
            stderr: '',
            exitCode: 0,
          };
        },
      );
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
        runner,
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
