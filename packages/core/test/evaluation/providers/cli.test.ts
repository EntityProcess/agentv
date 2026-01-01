import { afterEach, describe, expect, it, mock } from 'bun:test';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CliProvider, type CommandRunResult } from '../../../src/evaluation/providers/cli.js';
import type { CliResolvedConfig } from '../../../src/evaluation/providers/targets.js';
import {
  type ProviderRequest,
  extractLastAssistantContent,
} from '../../../src/evaluation/providers/types.js';

const baseConfig: CliResolvedConfig = {
  commandTemplate: 'agent-cli run {PROMPT} {FILES} {OUTPUT_FILE}',
  filesFormat: '--file {path}',
  timeoutMs: 2000,
};

const baseRequest: ProviderRequest = {
  question: 'Hello world',
  guidelines: 'guideline text',
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
    expect(extractLastAssistantContent(response.outputMessages)).toContain(
      'Test response from CLI',
    );
    expect(response.raw && (response.raw as Record<string, unknown>).command).toBeDefined();
    const command = runner.mock.calls[0]?.[0] as string;
    expect(command).toContain('--file');
    expect(command).toContain('Hello world');
  });

  it('throws on non-zero exit codes with stderr context', async () => {
    const runner = mock(
      async (_command, _options): Promise<CommandRunResult> => ({
        stdout: '',
        stderr: 'Something went wrong',
        exitCode: 2,
        failed: true,
      }),
    );

    const provider = new CliProvider('cli-target', baseConfig, runner);

    await expect(provider.invoke(baseRequest)).rejects.toThrow(/exit code 2/i);
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

    await expect(provider.invoke(baseRequest)).rejects.toThrow(/timed out/i);
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
    expect(extractLastAssistantContent(responses[0]?.outputMessages)).toBe('Batch response 1');
    expect(extractLastAssistantContent(responses[1]?.outputMessages)).toBe('Batch response 2');
  });

  it('throws when batch output is missing requested ids', async () => {
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

    await expect(provider.invokeBatch([baseRequest, request2])).rejects.toThrow(/missing ids/i);
  });

  it('parses output_messages from single case JSON output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          output_messages: [
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

    expect(extractLastAssistantContent(response.outputMessages)).toBe('Response with tool calls');
    expect(response.outputMessages).toBeDefined();
    expect(response.outputMessages).toHaveLength(1);
    expect(response.outputMessages?.[0].role).toBe('assistant');
    expect(response.outputMessages?.[0].toolCalls).toHaveLength(2);
    expect(response.outputMessages?.[0].toolCalls?.[0].tool).toBe('search');
    expect(response.outputMessages?.[0].toolCalls?.[0].input).toEqual({ query: 'hello' });
    expect(response.outputMessages?.[0].toolCalls?.[0].output).toBe('result');
    expect(response.outputMessages?.[0].toolCalls?.[1].tool).toBe('analyze');
  });

  it('parses output_messages from batch JSONL output', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-batch-\d+-\w+\.jsonl/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const record1 = {
          id: 'case-1',
          text: 'Response 1',
          output_messages: [
            {
              role: 'assistant',
              tool_calls: [{ tool: 'toolA', input: { x: 1 } }],
            },
          ],
        };
        const record2 = {
          id: 'case-2',
          text: 'Response 2',
          output_messages: [
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
    expect(responses[0]?.outputMessages).toBeDefined();
    expect(responses[0]?.outputMessages?.[0].toolCalls?.[0].tool).toBe('toolA');
    expect(responses[1]?.outputMessages).toBeDefined();
    expect(responses[1]?.outputMessages?.[0].toolCalls?.[0].tool).toBe('toolB');
  });

  it('handles messages without tool_calls', async () => {
    const runner = mock(async (command: string): Promise<CommandRunResult> => {
      const match = command.match(/agentv-case-1-\d+-\w+\.json/);
      if (match) {
        const outputFilePath = path.join(os.tmpdir(), match[0]);
        const output = {
          text: 'Response',
          output_messages: [
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

    expect(response.outputMessages).toBeDefined();
    expect(response.outputMessages).toHaveLength(2);
    expect(response.outputMessages?.[0].toolCalls).toBeUndefined();
    expect(response.outputMessages?.[1].toolCalls).toBeUndefined();
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

    expect(extractLastAssistantContent(response.outputMessages)).toBe('Response with metrics');
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
