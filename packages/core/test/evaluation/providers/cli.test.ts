import { afterEach, describe, expect, it, mock } from 'bun:test';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CliProvider, type CommandRunResult } from '../../../src/evaluation/providers/cli.js';
import type { CliResolvedConfig } from '../../../src/evaluation/providers/targets.js';
import type { ProviderRequest } from '../../../src/evaluation/providers/types.js';

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
    expect(response.text).toContain('Test response from CLI');
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
});
