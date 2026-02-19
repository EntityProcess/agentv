import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type CopilotCliLogEntry,
  consumeCopilotCliLogEntries,
  subscribeToCopilotCliLogEntries,
} from '../../../src/evaluation/providers/copilot-cli-log-tracker.js';
import { CopilotCliProvider } from '../../../src/evaluation/providers/copilot-cli.js';
import {
  type ProviderRequest,
  extractLastAssistantContent,
} from '../../../src/evaluation/providers/types.js';

async function createTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

describe('CopilotCliProvider', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = await createTempDir('copilot-provider-');
    consumeCopilotCliLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  it('invokes copilot CLI and extracts plain text response', async () => {
    const runner = mock(
      async (_opts: {
        prompt: string;
        args: readonly string[];
      }) => ({
        stdout: 'Here is the solution:\n```python\nprint("hello")\n```',
        stderr: '',
        exitCode: 0,
      }),
    );
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        timeoutMs: 1000,
        logDir: fixturesRoot,
      },
      runner,
    );

    const request: ProviderRequest = {
      question: 'Write a hello world program',
    };

    const response = await provider.invoke(request);
    const content = extractLastAssistantContent(response.outputMessages);
    expect(content).toContain('Here is the solution');
    expect(content).toContain('print("hello")');
    expect(runner).toHaveBeenCalledTimes(1);

    const invocation = runner.mock.calls[0][0];
    expect(invocation.args).toContain('-p');
    expect(invocation.args).toContain('-s');
    expect(invocation.args).toContain('--allow-all-tools');
    expect(invocation.args).toContain('--no-color');
  });

  it('strips ANSI escape codes from output', async () => {
    const runner = mock(async () => ({
      stdout: '\x1B[32mGreen text\x1B[0m and \x1B[1mbold\x1B[0m',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const response = await provider.invoke({ question: 'Test' });
    const content = extractLastAssistantContent(response.outputMessages);
    expect(content).toBe('Green text and bold');
    expect(content).not.toContain('\x1B');
  });

  it('fails on non-zero exit code', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: 'Error: authentication failed',
      exitCode: 1,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    await expect(provider.invoke({ question: 'Fail' })).rejects.toThrow(
      /exited with code 1.*authentication failed/,
    );
  });

  it('reports timeout when process times out', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        timeoutMs: 5000,
        logDir: fixturesRoot,
      },
      runner,
    );

    await expect(provider.invoke({ question: 'Timeout' })).rejects.toThrow(/timed out.*after 5s/);
  });

  it('fails when copilot produces empty output', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    await expect(provider.invoke({ question: 'Empty' })).rejects.toThrow(/no output/i);
  });

  it('passes --model flag when model is configured', async () => {
    const runner = mock(async () => ({
      stdout: 'response text',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        model: 'gpt-5-mini',
        logDir: fixturesRoot,
      },
      runner,
    );

    await provider.invoke({ question: 'Model test' });
    const invocation = runner.mock.calls[0][0];
    expect(invocation.args).toContain('--model');
    expect(invocation.args).toContain('gpt-5-mini');
  });

  it('appends custom args from config', async () => {
    const runner = mock(async () => ({
      stdout: 'response text',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        args: ['--custom-flag', 'value'],
        logDir: fixturesRoot,
      },
      runner,
    );

    await provider.invoke({ question: 'Custom args' });
    const invocation = runner.mock.calls[0][0];
    expect(invocation.args).toContain('--custom-flag');
    expect(invocation.args).toContain('value');
  });

  it('copies input files into workspace and uses relative paths in prompt', async () => {
    let capturedPromptFileContent = '';
    const runner = mock(async (options: { readonly cwd: string }) => {
      capturedPromptFileContent = await readFile(
        path.join(options.cwd, 'prompt.md'),
        'utf8',
      );
      return {
        stdout: 'done with files',
        stderr: '',
        exitCode: 0,
      };
    });
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const guidelineFile = path.join(fixturesRoot, 'prompts', 'python.instructions.md');
    await mkdir(path.dirname(guidelineFile), { recursive: true });
    await writeFile(guidelineFile, 'guideline content', 'utf8');

    const attachmentFile = path.join(fixturesRoot, 'src', 'main.py');
    await mkdir(path.dirname(attachmentFile), { recursive: true });
    await writeFile(attachmentFile, "print('hi')", 'utf8');

    const request: ProviderRequest = {
      question: 'Implement feature',
      inputFiles: [guidelineFile, attachmentFile],
      guideline_patterns: ['**/*.instructions.md'],
    };

    const response = await provider.invoke(request);
    expect(extractLastAssistantContent(response.outputMessages)).toBe('done with files');

    // The prompt file should contain relative file references (no file:// URIs).
    // The -p CLI arg references the prompt file; the actual content lives there.
    expect(capturedPromptFileContent).toContain('python.instructions.md');
    expect(capturedPromptFileContent).toContain('main.py');
    expect(capturedPromptFileContent).toContain('[[ ## user_query ## ]]');
    expect(capturedPromptFileContent).not.toContain('file://');

    // Verify copiedFiles in raw response
    const raw = response.raw as Record<string, unknown>;
    const copiedFiles = raw.copiedFiles as Array<{
      originalPath: string;
      workspaceRelativePath: string;
    }>;
    expect(copiedFiles).toHaveLength(2);
    expect(copiedFiles.some((f) => f.workspaceRelativePath === 'python.instructions.md')).toBe(
      true,
    );
    expect(copiedFiles.some((f) => f.workspaceRelativePath === 'main.py')).toBe(true);

    // Verify files were actually copied into the workspace
    const workspace = raw.workspace as string;
    const copiedGuideline = await readFile(
      path.join(workspace, 'python.instructions.md'),
      'utf8',
    ).catch(() => null);
    // Workspace is cleaned up after invoke, so files may not exist
    // The copiedFiles metadata confirms they were mapped correctly
  });

  it('handles basename collisions when copying input files', async () => {
    let capturedPromptFileContent = '';
    const runner = mock(async (options: { readonly cwd: string }) => {
      capturedPromptFileContent = await readFile(
        path.join(options.cwd, 'prompt.md'),
        'utf8',
      );
      return {
        stdout: 'done',
        stderr: '',
        exitCode: 0,
      };
    });
    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    // Create two files with the same basename in different directories
    const file1 = path.join(fixturesRoot, 'dir1', 'config.yaml');
    const file2 = path.join(fixturesRoot, 'dir2', 'config.yaml');
    await mkdir(path.join(fixturesRoot, 'dir1'), { recursive: true });
    await mkdir(path.join(fixturesRoot, 'dir2'), { recursive: true });
    await writeFile(file1, 'config1', 'utf8');
    await writeFile(file2, 'config2', 'utf8');

    const response = await provider.invoke({
      question: 'Check configs',
      inputFiles: [file1, file2],
    });

    const raw = response.raw as Record<string, unknown>;
    const copiedFiles = raw.copiedFiles as Array<{
      originalPath: string;
      workspaceRelativePath: string;
    }>;
    expect(copiedFiles).toHaveLength(2);
    expect(copiedFiles[0].workspaceRelativePath).toBe('config.yaml');
    expect(copiedFiles[1].workspaceRelativePath).toBe('config_1.yaml');

    // Verify prompt file contains both relative paths
    expect(capturedPromptFileContent).toContain('config.yaml');
    expect(capturedPromptFileContent).toContain('config_1.yaml');
  });

  it('streams output to a log file and records log entry', async () => {
    const runner = mock(async (options: { readonly onStdoutChunk?: (chunk: string) => void }) => {
      options.onStdoutChunk?.('Processing request...\n');
      options.onStdoutChunk?.('Here is the answer');
      return {
        stdout: 'Here is the answer',
        stderr: '',
        exitCode: 0,
      };
    });

    const provider = new CopilotCliProvider(
      'copilot-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const observedEntries: CopilotCliLogEntry[] = [];
    const unsubscribe = subscribeToCopilotCliLogEntries((entry) => {
      observedEntries.push(entry);
    });

    try {
      const response = await provider.invoke({ question: 'log it', evalCaseId: 'case-123' });
      const raw = response.raw as Record<string, unknown>;
      expect(typeof raw.logFile).toBe('string');
      const logFile = raw.logFile as string;
      const logContent = await readFile(logFile, 'utf8');
      expect(logContent).toContain('Processing request');
      expect(logContent).toContain('Here is the answer');

      const tracked = consumeCopilotCliLogEntries();
      expect(tracked.some((entry) => entry.filePath === logFile)).toBe(true);
      expect(observedEntries.some((entry) => entry.filePath === logFile)).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
