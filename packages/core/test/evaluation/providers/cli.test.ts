import { afterEach, describe, expect, it, mock } from 'bun:test';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CliProvider, type CommandRunResult } from '../../../src/evaluation/providers/cli.js';
import type { CliResolvedConfig } from '../../../src/evaluation/providers/targets.js';
import {
  type ProviderRequest,
  extractLastAssistantContent,
} from '../../../src/evaluation/providers/types.js';

const baseConfig: CliResolvedConfig = {
  command: 'agent-cli run {PROMPT} {FILES} {OUTPUT_FILE}',
  filesFormat: '--file {path}',
  timeoutMs: 2000,
};

const baseRequest: ProviderRequest = {
  question: 'Hello world',
  inputFiles: ['./fixtures/spec.md'],
  evalCaseId: 'case-1',
  attempt: 0,
};

describe('CliProvider', () => {
  const createdFiles: string[] = [];

  afterEach(async () => {
    // Clean up any files created during tests
    await Promise.all(
      createdFiles.map((file) =>
        unlink(file).catch(() => {
          /* ignore */
        }),
      ),
    );
    createdFiles.length = 0;
  });

  it('renders placeholders and returns response from output file', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      // Extract the output file path from the command
      // The command template includes {OUTPUT_FILE} which gets replaced with the temp file path
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        await writeFile(outputFilePath, 'Test response from CLI', 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toContain('Test response from CLI');
    expect(response.raw && (response.raw as Record<string, unknown>).command).toBeDefined();
    expect(response.targetExecution?.status).toBe('success');
    expect(response.targetExecution?.targetId).toBe('cli-target');
    expect(response.targetExecution?.logs?.stdout?.text).toContain('agent-cli run');
    const command = runner.mock.calls[0]?.[0] as string;
    expect(command).toContain('--file');
    expect(command).toContain('Hello world');
  });

  it('writes prompt to PROMPT_FILE placeholder and passes its path to the command', async () => {
    let promptFileContent = '';
    const promptFileConfig: CliResolvedConfig = {
      ...baseConfig,
      command: 'agent-cli run --prompt-file {PROMPT_FILE} {OUTPUT_FILE}',
    };

    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const promptFileMatch = command.match(/agentv-case-1-\d+-\w+\.prompt\.txt/);
      if (promptFileMatch) {
        const promptFilePath = path.join(os.tmpdir(), promptFileMatch[0]);
        promptFileContent = await readFile(promptFilePath, 'utf8');
        createdFiles.push(promptFilePath);
      }

      const outputFileMatch = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (outputFileMatch) {
        const outputFilePath = path.join(os.tmpdir(), outputFileMatch[0]);
        await writeFile(outputFilePath, 'Response via prompt file', 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', promptFileConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(extractLastAssistantContent(response.output)).toBe('Response via prompt file');
    expect(promptFileContent).toBe('Hello world');
    const command = runner.mock.calls[0]?.[0] as string;
    expect(command).toContain('.prompt.txt');
  });

  it('returns target execution envelopes for non-zero exit codes', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '',
        stderr: 'Something went wrong',
        exitCode: 2,
        failed: true,
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const response = await provider.invoke(baseRequest);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('nonzero_exit');
    expect(response.targetExecution?.exitCode).toBe(2);
    expect((response.raw as { error?: string }).error).toMatch(/exit code 2/i);
  });

  it('treats timed out commands as failures', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        failed: true,
        timedOut: true,
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const response = await provider.invoke(baseRequest);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('timeout');
    expect(response.targetExecution?.message).toMatch(/timed out/i);
  });

  it('returns target execution envelopes for spawn failures', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '',
        stderr: 'not found',
        exitCode: null,
        failed: true,
        spawnErrorCode: 'ENOENT',
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('spawn_failure');
    expect(response.targetExecution?.logs?.stderr?.text).toBe('not found');
  });

  it('returns target execution envelopes for signal crashes', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        exitCode: null,
        failed: true,
        signal: 'SIGSEGV',
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('signal_crash');
    expect(response.targetExecution?.signal).toBe('SIGSEGV');
    expect(response.targetExecution?.logs?.stdout?.text).toBe('partial stdout');
  });

  it('returns target execution envelopes for cancellation', async () => {
    const controller = new AbortController();
    const runner = mock(async (_command, _options): Promise<CommandRunResult> => {
      controller.abort();
      return {
        stdout: 'partial stdout before cancel',
        stderr: '',
        exitCode: null,
        failed: true,
        signal: 'SIGTERM',
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke({ ...baseRequest, signal: controller.signal });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('cancelled');
    expect(response.targetExecution?.logs?.stdout?.text).toContain('partial stdout');
  });

  it('returns malformed-output envelopes when the output file is missing', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '{"event":"partial"}\n',
        stderr: '',
        exitCode: 0,
        failed: false,
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('malformed_output');
    expect(response.targetExecution?.logs?.stdout?.text).toContain('partial');
  });

  it('returns target task failure envelopes for CLI-reported errors', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        await writeFile(
          outputFilePath,
          JSON.stringify({ text: 'partial answer', error: 'task failed' }),
          'utf-8',
        );
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: 'structured event before failure',
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(extractLastAssistantContent(response.output)).toBe('partial answer');
    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('target_task_failure');
    expect(response.targetExecution?.message).toBe('task failed');
  });

  it('runs sandbox runtime commands without inheriting host env', async () => {
    process.env.AGENTV_SANDBOX_SHOULD_NOT_LEAK = 'host-secret';
    let capturedRuntime: Record<string, unknown> | undefined;
    const sandboxRunner = mock(async (command: string, options): Promise<CommandRunResult> => {
      capturedRuntime = options.runtime as Record<string, unknown>;
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        await writeFile(outputFilePath, JSON.stringify({ text: 'sandbox response' }), 'utf-8');
        createdFiles.push(outputFilePath);
      }
      return {
        stdout: 'sandbox stdout',
        stderr: 'sandbox stderr',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider(
      'cli-target',
      baseConfig,
      undefined,
      {
        mode: 'sandbox',
        image: 'agentv-target:sha256',
        env: { SAFE_ENV: '1' },
        secrets: { OPENAI_API_KEY: 'explicit-key' },
        mounts: [{ source: '/host/workspace', target: '/workspace', access: 'rw' }],
      },
      sandboxRunner,
    );

    const response = await provider.invoke(baseRequest);

    expect(sandboxRunner).toHaveBeenCalledTimes(1);
    expect(capturedRuntime?.env).toEqual({ SAFE_ENV: '1' });
    expect(capturedRuntime?.secrets).toEqual({ OPENAI_API_KEY: 'explicit-key' });
    expect(JSON.stringify(capturedRuntime)).not.toContain('host-secret');
    expect(response.targetExecution?.runtimeMode).toBe('sandbox');
    expect(response.targetExecution?.status).toBe('success');
    expect(response.targetExecution?.logs?.stdout?.text).toBe('sandbox stdout');
    expect(response.targetExecution?.logs?.stderr?.text).toBe('sandbox stderr');
    expect(extractLastAssistantContent(response.output)).toBe('sandbox response');
    process.env.AGENTV_SANDBOX_SHOULD_NOT_LEAK = undefined;
  });

  it('distinguishes sandbox infra failure from target nonzero exit', async () => {
    const infraRunner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '',
        stderr: 'docker daemon unavailable',
        exitCode: 125,
        failed: true,
        sandboxInfraFailure: true,
      }),
    );
    const targetFailureRunner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: 'target stdout',
        stderr: 'target failed',
        exitCode: 2,
        failed: true,
      }),
    );
    const runtime = { mode: 'sandbox' as const, image: 'agentv-target:sha256' };

    const infraResponse = await new CliProvider(
      'cli-target',
      baseConfig,
      undefined,
      runtime,
      infraRunner,
    ).invoke(baseRequest);
    const targetResponse = await new CliProvider(
      'cli-target',
      baseConfig,
      undefined,
      runtime,
      targetFailureRunner,
    ).invoke(baseRequest);

    expect(infraResponse.targetExecution?.runtimeMode).toBe('sandbox');
    expect(infraResponse.targetExecution?.errorKind).toBe('sandbox_infra_failure');
    expect(targetResponse.targetExecution?.runtimeMode).toBe('sandbox');
    expect(targetResponse.targetExecution?.errorKind).toBe('nonzero_exit');
    expect(targetResponse.targetExecution?.logs?.stdout?.text).toBe('target stdout');
  });

  it('returns timeout and cancellation envelopes for sandbox work', async () => {
    const timeoutRunner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: 'partial transcript',
        stderr: '',
        exitCode: null,
        failed: true,
        timedOut: true,
      }),
    );
    const controller = new AbortController();
    const cancelRunner = mock(async (_command, _options): Promise<CommandRunResult> => {
      controller.abort();
      return {
        stdout: 'cancel partial',
        stderr: '',
        exitCode: null,
        failed: true,
        signal: 'SIGTERM',
      };
    });
    const runtime = { mode: 'sandbox' as const, image: 'agentv-target:sha256' };

    const timeoutResponse = await new CliProvider(
      'cli-target',
      baseConfig,
      undefined,
      runtime,
      timeoutRunner,
    ).invoke(baseRequest);
    const cancelResponse = await new CliProvider(
      'cli-target',
      baseConfig,
      undefined,
      runtime,
      cancelRunner,
    ).invoke({ ...baseRequest, signal: controller.signal });

    expect(timeoutResponse.targetExecution?.errorKind).toBe('timeout');
    expect(timeoutResponse.targetExecution?.logs?.stdout?.text).toBe('partial transcript');
    expect(cancelResponse.targetExecution?.errorKind).toBe('cancelled');
    expect(cancelResponse.targetExecution?.logs?.stdout?.text).toBe('cancel partial');
  });

  it('uses request.cwd as working directory override in invoke', async () => {
    let capturedCwd: string | undefined;
    const runner = mock(async (command: string, options): Promise<CommandRunResult> => {
      capturedCwd = options?.cwd;
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        await writeFile(outputFilePath, 'response', 'utf-8');
        createdFiles.push(outputFilePath);
      }
      return { stdout: '', stderr: '', exitCode: 0, failed: false };
    });

    const configWithCwd: CliResolvedConfig = { ...baseConfig, cwd: '/config/cwd' };
    const provider = new CliProvider('cli-target', configWithCwd, runner);

    // request.cwd should override config.cwd
    await provider.invoke({ ...baseRequest, cwd: '/workspace/path' });
    expect(capturedCwd).toBe('/workspace/path');
  });

  it('falls back to config.cwd when request.cwd is undefined in invoke', async () => {
    let capturedCwd: string | undefined;
    const runner = mock(async (command: string, options): Promise<CommandRunResult> => {
      capturedCwd = options?.cwd;
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        await writeFile(outputFilePath, 'response', 'utf-8');
        createdFiles.push(outputFilePath);
      }
      return { stdout: '', stderr: '', exitCode: 0, failed: false };
    });

    const configWithCwd: CliResolvedConfig = { ...baseConfig, cwd: '/config/cwd' };
    const provider = new CliProvider('cli-target', configWithCwd, runner);

    await provider.invoke(baseRequest); // no cwd in request
    expect(capturedCwd).toBe('/config/cwd');
  });

  it('uses request.cwd as working directory override in invokeBatch', async () => {
    let capturedCwd: string | undefined;
    const runner = mock(async (command: string, options): Promise<CommandRunResult> => {
      capturedCwd = options?.cwd;
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const jsonl = `${JSON.stringify({ id: 'case-1', text: 'ok' })}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }
      return { stdout: '', stderr: '', exitCode: 0, failed: false };
    });

    const configWithCwd: CliResolvedConfig = { ...baseConfig, cwd: '/config/cwd' };
    const provider = new CliProvider('cli-target', configWithCwd, runner);

    // First request's cwd should override config.cwd for the batch
    await provider.invokeBatch([{ ...baseRequest, cwd: '/workspace/path' }]);
    expect(capturedCwd).toBe('/workspace/path');
  });

  it('falls back to config.cwd when request.cwd is undefined in invokeBatch', async () => {
    let capturedCwd: string | undefined;
    const runner = mock(async (command: string, options): Promise<CommandRunResult> => {
      capturedCwd = options?.cwd;
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const jsonl = `${JSON.stringify({ id: 'case-1', text: 'ok' })}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }
      return { stdout: '', stderr: '', exitCode: 0, failed: false };
    });

    const configWithCwd: CliResolvedConfig = { ...baseConfig, cwd: '/config/cwd' };
    const provider = new CliProvider('cli-target', configWithCwd, runner);

    // No cwd in request — should fall back to config.cwd
    await provider.invokeBatch([baseRequest]);
    expect(capturedCwd).toBe('/config/cwd');
  });

  it('supports batch mode by reading JSONL records keyed by id', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const jsonl =
          `${JSON.stringify({ id: 'case-1', text: 'Batch response 1' })}\n` +
          `${JSON.stringify({ id: 'case-2', text: 'Batch response 2' })}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const request2: ProviderRequest = {
      ...baseRequest,
      evalCaseId: 'case-2',
    };

    const responses = await provider.invokeBatch([baseRequest, request2]);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(responses).toHaveLength(2);
    expect(extractLastAssistantContent(responses[0]?.output)).toBe('Batch response 1');
    expect(extractLastAssistantContent(responses[1]?.output)).toBe('Batch response 2');
  });

  it('returns error response for batch output missing requested ids', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const jsonl = `${JSON.stringify({ id: 'case-1', text: 'Batch response 1' })}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const request2: ProviderRequest = {
      ...baseRequest,
      evalCaseId: 'case-2',
    };

    // Missing IDs now return error responses instead of throwing,
    // allowing other eval cases with matching IDs to be evaluated correctly
    const responses = await provider.invokeBatch([baseRequest, request2]);
    expect(responses).toHaveLength(2);

    // First request has matching ID - should succeed
    expect(extractLastAssistantContent(responses[0]?.output)).toBe('Batch response 1');

    // Second request has missing ID - should return error response
    const errorContent = extractLastAssistantContent(responses[1]?.output);
    expect(errorContent).toMatch(/Batch output missing id 'case-2'/);
    expect(responses[1]?.raw?.error).toBe("Batch output missing id 'case-2'");
    expect(responses[1]?.targetExecution?.errorKind).toBe('malformed_output');
  });

  it('parses output from single case JSON output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          output: [
            {
              role: 'assistant',
              content: 'Response with tool calls',
              tool_calls: [
                { tool: 'search', input: { query: 'hello' }, output: 'result' },
                { tool: 'analyze', input: { data: 123 } },
              ],
            },
          ],
        };
        await writeFile(outputFilePath, JSON.stringify(output), 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(extractLastAssistantContent(response.output)).toBe('Response with tool calls');
    expect(response.output).toBeDefined();
    expect(response.output).toHaveLength(1);
    expect(response.output?.[0].role).toBe('assistant');
    expect(response.output?.[0].toolCalls).toHaveLength(2);
    expect(response.output?.[0].toolCalls?.[0].tool).toBe('search');
    expect(response.output?.[0].toolCalls?.[0].input).toEqual({ query: 'hello' });
    expect(response.output?.[0].toolCalls?.[0].output).toBe('result');
    expect(response.output?.[0].toolCalls?.[1].tool).toBe('analyze');
  });

  it('parses output from batch JSONL output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const record1 = {
          id: 'case-1',
          text: 'Response 1',
          output: [
            {
              role: 'assistant',
              tool_calls: [{ tool: 'toolA', input: { x: 1 } }],
            },
          ],
        };
        const record2 = {
          id: 'case-2',
          text: 'Response 2',
          output: [
            {
              role: 'assistant',
              tool_calls: [{ tool: 'toolB', input: { y: 2 } }],
            },
          ],
        };
        const jsonl = `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const request2: ProviderRequest = {
      ...baseRequest,
      evalCaseId: 'case-2',
    };

    const responses = await provider.invokeBatch([baseRequest, request2]);

    expect(responses).toHaveLength(2);
    expect(responses[0]?.output).toBeDefined();
    expect(responses[0]?.output?.[0].toolCalls?.[0].tool).toBe('toolA');
    expect(responses[1]?.output).toBeDefined();
    expect(responses[1]?.output?.[0].toolCalls?.[0].tool).toBe('toolB');
  });

  it('handles messages without tool_calls', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          text: 'Response',
          output: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        };
        await writeFile(outputFilePath, JSON.stringify(output), 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(response.output).toBeDefined();
    expect(response.output).toHaveLength(2);
    expect(response.output?.[0].toolCalls).toBeUndefined();
    expect(response.output?.[1].toolCalls).toBeUndefined();
  });

  it('parses execution metrics from single case JSON output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          text: 'Response with metrics',
          token_usage: { input: 1000, output: 500, cached: 100 },
          cost_usd: 0.0045,
          duration_ms: 2500,
        };
        await writeFile(outputFilePath, JSON.stringify(output), 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(extractLastAssistantContent(response.output)).toBe('Response with metrics');
    expect(response.tokenUsage).toEqual({ input: 1000, output: 500, cached: 100 });
    expect(response.costUsd).toBe(0.0045);
    expect(response.durationMs).toBe(2500);
  });

  it('falls back to measured duration when CLI does not report duration_ms', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          text: 'Response without duration',
          token_usage: { input: 500, output: 250 },
        };
        await writeFile(outputFilePath, JSON.stringify(output), 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);
    const response = await provider.invoke(baseRequest);

    expect(response.tokenUsage).toEqual({ input: 500, output: 250 });
    expect(response.costUsd).toBeUndefined();
    // durationMs should be set to measured wall-clock time (fallback)
    expect(response.durationMs).toBeDefined();
    expect(typeof response.durationMs).toBe('number');
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parses execution metrics from batch JSONL output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const record1 = {
          id: 'case-1',
          text: 'Batch response 1',
          token_usage: { input: 800, output: 400 },
          cost_usd: 0.003,
          duration_ms: 1500,
        };
        const record2 = {
          id: 'case-2',
          text: 'Batch response 2',
          token_usage: { input: 1200, output: 600 },
          cost_usd: 0.005,
          duration_ms: 2000,
        };
        const jsonl = `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const request2: ProviderRequest = {
      ...baseRequest,
      evalCaseId: 'case-2',
    };

    const responses = await provider.invokeBatch([baseRequest, request2]);

    expect(responses).toHaveLength(2);

    expect(responses[0]?.tokenUsage).toEqual({ input: 800, output: 400 });
    expect(responses[0]?.costUsd).toBe(0.003);
    expect(responses[0]?.durationMs).toBe(1500);

    expect(responses[1]?.tokenUsage).toEqual({ input: 1200, output: 600 });
    expect(responses[1]?.costUsd).toBe(0.005);
    expect(responses[1]?.durationMs).toBe(2000);
  });

  it('uses per-request fallback duration for batch when records omit duration_ms', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        // Record 1 has duration, record 2 does not
        const record1 = {
          id: 'case-1',
          text: 'Batch response 1',
          duration_ms: 1000,
        };
        const record2 = {
          id: 'case-2',
          text: 'Batch response 2',
          // no duration_ms
        };
        const jsonl = `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n`;
        await writeFile(outputFilePath, jsonl, 'utf-8');
        createdFiles.push(outputFilePath);
      }

      return {
        stdout: command,
        stderr: '',
        exitCode: 0,
        failed: false,
      };
    });

    const provider = new CliProvider('cli-target', baseConfig, runner);

    const request2: ProviderRequest = {
      ...baseRequest,
      evalCaseId: 'case-2',
    };

    const responses = await provider.invokeBatch([baseRequest, request2]);

    expect(responses).toHaveLength(2);

    // Record 1 uses its own duration
    expect(responses[0]?.durationMs).toBe(1000);

    // Record 2 uses fallback (measured / count)
    expect(responses[1]?.durationMs).toBeDefined();
    expect(typeof responses[1]?.durationMs).toBe('number');
    expect(responses[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
