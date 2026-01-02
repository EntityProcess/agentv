import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type ClaudeCodeLogEntry,
  consumeClaudeCodeLogEntries,
  subscribeToClaudeCodeLogEntries,
} from '../../../src/evaluation/providers/claude-code-log-tracker.js';
import { ClaudeCodeProvider } from '../../../src/evaluation/providers/claude-code.js';
import {
  type ProviderRequest,
  extractLastAssistantContent,
} from '../../../src/evaluation/providers/types.js';

async function createTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

describe('ClaudeCodeProvider', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = await createTempDir('claude-code-provider-');
    consumeClaudeCodeLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  it('mirrors input files and composes prompt with system prompt', async () => {
    const runner = mock(
      async (_opts: {
        args: readonly string[];
        onStdoutChunk?: (chunk: string) => void;
      }) => {
        const resultEvent = JSON.stringify({
          type: 'result',
          cost_usd: 0.01,
          duration_ms: 1000,
        });
        const assistantEvent = JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'done' }],
          },
        });
        return {
          stdout: `${assistantEvent}\n${resultEvent}`,
          stderr: '',
          exitCode: 0,
        };
      },
    );
    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        model: 'claude-sonnet-4-20250514',
        timeoutMs: 1000,
        logDir: fixturesRoot,
      },
      runner,
    );

    const guidelineFile = path.join(fixturesRoot, 'prompts', 'python.instructions.md');
    await mkdir(path.dirname(guidelineFile), { recursive: true });
    await writeFile(guidelineFile, 'guideline', 'utf8');

    const attachmentFile = path.join(fixturesRoot, 'src', 'main.py');
    await mkdir(path.dirname(attachmentFile), { recursive: true });
    await writeFile(attachmentFile, "print('hi')", 'utf8');

    const request: ProviderRequest = {
      question: 'Implement feature',
      inputFiles: [guidelineFile, attachmentFile],
      guideline_patterns: ['**/*.instructions.md'],
    };

    const response = await provider.invoke(request);

    expect(extractLastAssistantContent(response.outputMessages)).toBe('done');
    expect(runner).toHaveBeenCalledTimes(1);
    const invocation = runner.mock.calls[0][0];
    expect(invocation.args).toContain('--output-format');
    expect(invocation.args).toContain('stream-json');
    expect(invocation.args).toContain('--verbose');
    expect(invocation.args).toContain('-p');
    expect(invocation.args).toContain('--model');
    expect(invocation.args).toContain('claude-sonnet-4-20250514');
    // Prompt should be the last argument
    const lastArg = invocation.args[invocation.args.length - 1];
    expect(lastArg).toContain('Implement feature');
    expect(lastArg).toContain('python.instructions.md');
    expect(lastArg).toContain('main.py');

    const raw = response.raw as Record<string, unknown>;
    const inputFilePaths = raw.inputFiles as readonly string[];
    expect(Array.isArray(inputFilePaths)).toBe(true);
    expect(inputFilePaths?.length).toBe(2);
    expect(inputFilePaths).toContain(guidelineFile);
    expect(inputFilePaths).toContain(attachmentFile);
  });

  it('fails when Claude Code CLI emits no valid JSON', async () => {
    const runner = mock(async () => ({
      stdout: 'not json',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const request: ProviderRequest = {
      question: 'Hello',
    };

    await expect(provider.invoke(request)).rejects.toThrow(/no valid JSON/i);
  });

  it('parses JSONL output from claude code', async () => {
    const jsonl = [
      { type: 'system', session_id: 'test-123' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'read_file', input: { path: 'test.py' }, id: 'tool-1' },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file content' }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'final answer' }],
        },
      },
      { type: 'result', cost_usd: 0.02, duration_ms: 2000 },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const runner = mock(async () => ({
      stdout: jsonl,
      stderr: '',
      exitCode: 0,
    }));

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const request: ProviderRequest = {
      question: 'Use JSONL',
    };

    const response = await provider.invoke(request);
    expect(extractLastAssistantContent(response.outputMessages)).toBe('final answer');
    expect(response.usage).toBeDefined();
    expect((response.usage as Record<string, unknown>).cost_usd).toBe(0.02);
    expect((response.usage as Record<string, unknown>).duration_ms).toBe(2000);
  });

  it('extracts tool calls from output messages', async () => {
    const jsonl = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'bash', input: { command: 'ls' }, id: 'tool-1' },
            { type: 'tool_use', name: 'write_file', input: { path: 'test.py' }, id: 'tool-2' },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1\nfile2' },
            { type: 'tool_result', tool_use_id: 'tool-2', content: 'written' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
        },
      },
      { type: 'result', cost_usd: 0.01 },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const runner = mock(async () => ({
      stdout: jsonl,
      stderr: '',
      exitCode: 0,
    }));

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const response = await provider.invoke({ question: 'test' });
    const messages = response.outputMessages ?? [];
    expect(messages.length).toBeGreaterThan(0);

    // First assistant message should have tool calls
    const firstAssistant = messages.find((m) => m.role === 'assistant');
    expect(firstAssistant?.toolCalls).toBeDefined();
    expect(firstAssistant?.toolCalls?.length).toBe(2);
    expect(firstAssistant?.toolCalls?.[0].tool).toBe('bash');
    expect(firstAssistant?.toolCalls?.[1].tool).toBe('write_file');
  });

  it('streams claude code output to a readable log file', async () => {
    const runner = mock(async (options: { readonly onStdoutChunk?: (chunk: string) => void }) => {
      const system = JSON.stringify({ type: 'system', session_id: 'test-123' });
      const assistant = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'thinking hard' }],
        },
      });
      const result = JSON.stringify({ type: 'result', cost_usd: 0.01 });
      options.onStdoutChunk?.(`${system}\n`);
      options.onStdoutChunk?.(`${assistant}\n`);
      options.onStdoutChunk?.(result);
      return {
        stdout: `${system}\n${assistant}\n${result}`,
        stderr: '',
        exitCode: 0,
      };
    });

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    const observedEntries: ClaudeCodeLogEntry[] = [];
    const unsubscribe = subscribeToClaudeCodeLogEntries((entry) => {
      observedEntries.push(entry);
    });

    try {
      const response = await provider.invoke({ question: 'log it', evalCaseId: 'case-123' });
      const raw = response.raw as Record<string, unknown>;
      expect(typeof raw.logFile).toBe('string');
      const logFile = raw.logFile as string;
      const logContent = await readFile(logFile, 'utf8');
      expect(logContent).toContain('system: init');
      expect(logContent).toContain('assistant: thinking hard');

      const tracked = consumeClaudeCodeLogEntries();
      expect(tracked.some((entry) => entry.filePath === logFile)).toBe(true);
      expect(observedEntries.some((entry) => entry.filePath === logFile)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('supports JSON log format for detailed inspection', async () => {
    const runner = mock(async (options: { readonly onStdoutChunk?: (chunk: string) => void }) => {
      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'search', input: { q: 'hello' }, id: 'tool-1' }],
        },
      });
      const result = JSON.stringify({ type: 'result', cost_usd: 0.01 });
      options.onStdoutChunk?.(`${event}\n`);
      options.onStdoutChunk?.(result);
      return {
        stdout: `${event}\n${result}`,
        stderr: '',
        exitCode: 0,
      };
    });

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
        logFormat: 'json',
      },
      runner,
    );

    const response = await provider.invoke({ question: 'log it json', evalCaseId: 'case-json' });
    const raw = response.raw as Record<string, unknown>;
    const logFile = raw.logFile as string;
    const logContent = await readFile(logFile, 'utf8');
    expect(logContent).toContain('"name": "search"');
    expect(logContent).toContain('"q": "hello"');
  });

  it('handles timeout correctly', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: true,
    }));

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        timeoutMs: 5000,
        logDir: fixturesRoot,
      },
      runner,
    );

    await expect(provider.invoke({ question: 'test' })).rejects.toThrow(/timed out.*5s/i);
  });

  it('handles non-zero exit code correctly', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: 'Authentication failed',
      exitCode: 1,
    }));

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        logDir: fixturesRoot,
      },
      runner,
    );

    await expect(provider.invoke({ question: 'test' })).rejects.toThrow(
      /exited with code 1.*Authentication failed/i,
    );
  });

  it('uses custom system prompt when configured', async () => {
    const runner = mock(
      async (_opts: {
        args: readonly string[];
      }) => {
        const result = JSON.stringify({ type: 'result', cost_usd: 0.01 });
        const assistant = JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        });
        return {
          stdout: `${assistant}\n${result}`,
          stderr: '',
          exitCode: 0,
        };
      },
    );

    const provider = new ClaudeCodeProvider(
      'claude-code-target',
      {
        executable: process.execPath,
        systemPrompt: 'You are a helpful assistant.',
        logDir: fixturesRoot,
      },
      runner,
    );

    await provider.invoke({ question: 'Hello' });

    const invocation = runner.mock.calls[0][0];
    const lastArg = invocation.args[invocation.args.length - 1];
    expect(lastArg).toContain('You are a helpful assistant.');
    expect(lastArg).toContain('Hello');
  });
});
