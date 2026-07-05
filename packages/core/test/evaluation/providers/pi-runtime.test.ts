import { describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createProvider,
  resolveTargetDefinition,
} from '../../../src/evaluation/providers/index.js';
import { PiCliProvider } from '../../../src/evaluation/providers/pi-cli.js';
import type { PiProcessRunOptions } from '../../../src/evaluation/providers/pi-process.js';
import { PiRpcProvider, _internal } from '../../../src/evaluation/providers/pi-rpc.js';
import type {
  PiCliResolvedConfig,
  PiRpcResolvedConfig,
} from '../../../src/evaluation/providers/targets.js';
import { extractLastAssistantContent } from '../../../src/evaluation/providers/types.js';

describe('Pi coding-agent runtime providers', () => {
  it('passes config.command argv and profile runtime env to pi-cli subprocesses', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-pi-cli-test-'));
    let captured: PiProcessRunOptions | undefined;
    const runner = mock(async (options: PiProcessRunOptions) => {
      captured = options;
      return {
        stdout: `${JSON.stringify({
          type: 'agent_end',
          messages: [{ role: 'assistant', content: [{ type: 'text', text: 'cli ok' }] }],
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    });
    const provider = new PiCliProvider('pi-cli-target', baseCliConfig(), runner);

    try {
      const response = await provider.invoke({ question: 'hello', cwd: workspace });

      expect(extractLastAssistantContent(response.output)).toBe('cli ok');
      expect(captured?.command.slice(0, 3)).toEqual(['pi-shim', '--profile', 'clean']);
      expect(captured?.command).toContain('--mode');
      expect(captured?.command).toContain('json');
      expect(captured?.env.HOME).toBe('/tmp/pi-profile');
      expect(captured?.env.PI_TEST_FLAG).toBe('enabled');
      expect(response.targetExecution?.status).toBe('success');
      expect(response.targetExecution?.runtimeMode).toBe('profile');
      expect(response.targetExecution?.command?.argv?.slice(0, 3)).toEqual([
        'pi-shim',
        '--profile',
        'clean',
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns structured pi-cli malformed-output errors', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-pi-cli-test-'));
    const provider = new PiCliProvider('pi-cli-target', baseCliConfig(), async () => ({
      stdout: 'not json\n',
      stderr: '',
      exitCode: 0,
    }));

    try {
      const response = await provider.invoke({ question: 'hello', cwd: workspace });

      expect(response.targetExecution?.status).toBe('error');
      expect(response.targetExecution?.errorKind).toBe('malformed_output');
      expect(extractLastAssistantContent(response.output)).toMatch(/malformed output/i);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('runs pi-rpc over process stdio and returns fake RPC success', async () => {
    let captured: PiProcessRunOptions | undefined;
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async (options) => {
      captured = options;
      const request = JSON.parse(options.stdin?.trim() ?? '{}') as { id: string };
      return {
        stdout: `${JSON.stringify({ type: 'extension_ui_request', id: 'widget-1' })}\n${JSON.stringify(
          {
            type: 'response',
            id: request.id,
            command: 'prompt',
            success: true,
          },
        )}\n${JSON.stringify({
          type: 'agent_end',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'hello rpc' }] },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'rpc ok' }],
              usage: { input: 2, output: 3 },
            },
          ],
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    });

    const response = await provider.invoke({
      question: 'hello rpc',
      systemPrompt: 'case system',
      cwd: '/tmp/workspace',
    });

    expect(captured?.command).toEqual([
      'pi',
      '--provider',
      'azure-openai-responses',
      '--model',
      'gpt-5-codex',
      '--system-prompt',
      'target system',
      '--mode',
      'rpc',
      '--no-session',
      '--tools',
      'read',
      '--thinking',
      'low',
    ]);
    expect(captured?.env.AZURE_OPENAI_API_KEY).toBe('agentv-local');
    expect(captured?.env.AZURE_OPENAI_BASE_URL).toBe('http://127.0.0.1:10531/v1');
    expect(captured?.stdin).toContain('"type":"prompt"');
    expect(captured?.stdin).toContain('case system\\n\\nhello rpc');
    expect(captured?.stdin).not.toContain('"method":"run"');
    expect(captured?.stdinEnd).toBe('manual');
    expect(captured?.completeOnStdout?.('{"type":"agent_end"}\n')).toBe(true);
    expect(extractLastAssistantContent(response.output)).toBe('rpc ok');
    expect(response.tokenUsage).toEqual({ input: 2, output: 3 });
    expect(response.targetExecution?.status).toBe('success');
    expect(response.targetExecution?.providerKind).toBe('pi-rpc');
  });

  it('maps pi-rpc protocol errors to malformed target envelopes', async () => {
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async () => ({
      stdout: 'not-json\n',
      stderr: '',
      exitCode: 0,
    }));

    const response = await provider.invoke({ question: 'hello rpc', cwd: '/tmp/workspace' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('malformed_output');
    expect(response.targetExecution?.message).toMatch(/malformed protocol/i);
  });

  it('maps pi-rpc command response errors to target task failures', async () => {
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async (options) => {
      const request = JSON.parse(options.stdin?.trim() ?? '{}') as { id: string };
      return {
        stdout: `${JSON.stringify({
          type: 'response',
          id: request.id,
          command: 'prompt',
          success: false,
          error: 'task failed',
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    });

    const response = await provider.invoke({ question: 'hello rpc', cwd: '/tmp/workspace' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('target_task_failure');
    expect(response.targetExecution?.message).toBe('task failed');
  });

  it('maps pi-rpc assistant stopReason errors to target task failures', async () => {
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async (options) => {
      const request = JSON.parse(options.stdin?.trim() ?? '{}') as { id: string };
      return {
        stdout: `${JSON.stringify({
          type: 'response',
          id: request.id,
          command: 'prompt',
          success: true,
        })}\n${JSON.stringify({
          type: 'agent_end',
          messages: [
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: 'No API key for provider: openai-codex',
            },
          ],
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    });

    const response = await provider.invoke({ question: 'hello rpc', cwd: '/tmp/workspace' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('target_task_failure');
    expect(response.targetExecution?.message).toBe('No API key for provider: openai-codex');
  });

  it('maps pi-rpc timeout and crash failures to target envelopes', async () => {
    const timeoutProvider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async () => ({
      stdout: 'partial',
      stderr: '',
      exitCode: null,
      timedOut: true,
      signal: 'SIGTERM',
    }));
    const crashProvider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async () => ({
      stdout: 'partial',
      stderr: 'crashed',
      exitCode: null,
      signal: 'SIGSEGV',
    }));

    const timeout = await timeoutProvider.invoke({ question: 'hello', cwd: '/tmp/workspace' });
    const crash = await crashProvider.invoke({ question: 'hello', cwd: '/tmp/workspace' });

    expect(timeout.targetExecution?.errorKind).toBe('timeout');
    expect(crash.targetExecution?.errorKind).toBe('signal_crash');
    expect(crash.targetExecution?.logs?.stderr?.text).toBe('crashed');
  });

  it('resolves pi-cli and pi-rpc command argv without disturbing plain LLM providers', async () => {
    const piCli = resolveTargetDefinition(
      {
        id: 'pi-cli-id',
        name: 'pi-cli-id',
        provider: 'pi-cli',
        runtime: { mode: 'profile', home: '/tmp/pi-home' },
        config: {
          command: ['pi-shim', '--profile', 'clean'],
          model: 'gpt-5-codex',
        },
      } as never,
      {},
    );
    const piRpc = resolveTargetDefinition(
      {
        id: 'pi-rpc-id',
        name: 'pi-rpc-id',
        provider: 'pi-rpc',
        runtime: 'host',
        config: {
          command: ['pi'],
          subprovider: 'openai',
          base_url: '{{ env.OPENAI_BASE_URL }}',
          api_key: '{{ env.OPENAI_API_KEY }}',
        },
      } as never,
      { OPENAI_BASE_URL: 'http://127.0.0.1:10531/v1', OPENAI_API_KEY: 'local-key' },
    );
    const llm = resolveTargetDefinition(
      { name: 'mock-llm', provider: 'mock', response: 'still works' },
      {},
    );

    expect(piCli.kind).toBe('pi-cli');
    if (piCli.kind !== 'pi-cli') throw new Error('expected pi-cli');
    expect(piCli.config.command).toEqual(['pi-shim', '--profile', 'clean']);
    expect(piCli.config.runtime).toEqual({ mode: 'profile', home: '/tmp/pi-home' });

    expect(piRpc.kind).toBe('pi-rpc');
    if (piRpc.kind !== 'pi-rpc') throw new Error('expected pi-rpc');
    expect(piRpc.config.command).toEqual(['pi']);
    expect(piRpc.config.subprovider).toBe('azure');
    expect(piRpc.config.baseUrl).toBe('http://127.0.0.1:10531/v1');
    expect(piRpc.config.apiKey).toBe('local-key');

    const provider = createProvider(llm);
    const response = await provider.invoke({ question: 'hello' });
    expect(extractLastAssistantContent(response.output)).toBe('still works');
  });

  it('detects pi-rpc completion from current protocol output', () => {
    expect(_internal.hasRpcAgentEnd('{"type":"agent_end"}\n', 'req-1')).toBe(true);
    expect(
      _internal.hasRpcAgentEnd(
        '{"id":"req-1","type":"response","command":"prompt","success":false}\n',
        'req-1',
      ),
    ).toBe(true);
    expect(_internal.hasRpcAgentEnd('{"type":"response","success":true}\n', 'req-1')).toBe(false);
  });

  it('detects existing RPC mode flags in custom pi-rpc commands', () => {
    expect(_internal.hasModeFlag(['pi', '--mode', 'rpc'])).toBe(true);
    expect(_internal.hasModeFlag(['pi', '--mode=rpc'])).toBe(true);
    expect(_internal.hasModeFlag(['pi'])).toBe(false);
  });
});

function baseCliConfig(): PiCliResolvedConfig {
  return {
    command: ['pi-shim', '--profile', 'clean'],
    executable: 'pi-shim',
    model: 'gpt-5-codex',
    runtime: {
      mode: 'profile',
      home: '/tmp/pi-profile',
      env: { PI_TEST_FLAG: 'enabled' },
    },
    timeoutMs: 1_000,
  };
}

function baseRpcConfig(): PiRpcResolvedConfig {
  return {
    command: ['pi'],
    subprovider: 'azure',
    model: 'gpt-5-codex',
    apiKey: 'agentv-local',
    baseUrl: 'http://127.0.0.1:10531/v1',
    tools: 'read',
    thinking: 'low',
    systemPrompt: 'target system',
    runtime: { mode: 'host' },
    timeoutMs: 1_000,
  };
}
