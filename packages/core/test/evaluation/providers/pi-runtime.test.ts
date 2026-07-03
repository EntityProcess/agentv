import { describe, expect, it, mock } from 'bun:test';

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

    const response = await provider.invoke({ question: 'hello', cwd: '/tmp/workspace' });

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
  });

  it('returns structured pi-cli malformed-output errors', async () => {
    const provider = new PiCliProvider('pi-cli-target', baseCliConfig(), async () => ({
      stdout: 'not json\n',
      stderr: '',
      exitCode: 0,
    }));

    const response = await provider.invoke({ question: 'hello', cwd: '/tmp/workspace' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('malformed_output');
    expect(extractLastAssistantContent(response.output)).toMatch(/malformed output/i);
  });

  it('runs pi-rpc over process stdio and returns fake RPC success', async () => {
    let captured: PiProcessRunOptions | undefined;
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async (options) => {
      captured = options;
      const request = JSON.parse(options.stdin?.trim() ?? '{}') as { id: string };
      return {
        stdout: `${JSON.stringify({ type: 'event', event: { kind: 'start' } })}\n${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            output: [{ role: 'assistant', content: 'rpc ok' }],
            token_usage: { input: 2, output: 3 },
          },
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    });

    const response = await provider.invoke({ question: 'hello rpc', cwd: '/tmp/workspace' });

    expect(captured?.command).toEqual(['pi', '--mode', 'rpc']);
    expect(captured?.stdin).toContain('"method":"run"');
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

  it('maps pi-rpc result errors to target task failures', async () => {
    const provider = new PiRpcProvider('pi-rpc-target', baseRpcConfig(), async (options) => {
      const request = JSON.parse(options.stdin?.trim() ?? '{}') as { id: string };
      return {
        stdout: `${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { message: 'task failed' },
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
        config: { command: ['pi'] },
      } as never,
      {},
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

    const provider = createProvider(llm);
    const response = await provider.invoke({ question: 'hello' });
    expect(extractLastAssistantContent(response.output)).toBe('still works');
  });

  it('does not append duplicate RPC mode flags', () => {
    expect(_internal.ensureRpcMode(['pi', '--mode', 'rpc'])).toEqual(['pi', '--mode', 'rpc']);
    expect(_internal.ensureRpcMode(['pi', '--mode=rpc'])).toEqual(['pi', '--mode=rpc']);
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
    model: 'gpt-5-codex',
    runtime: { mode: 'host' },
    timeoutMs: 1_000,
  };
}
