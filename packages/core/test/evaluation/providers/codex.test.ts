import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CodexAppServerProvider,
  CodexCliProvider,
} from '../../../src/evaluation/providers/codex-cli.js';
import {
  type CodexLogEntry,
  consumeCodexLogEntries,
  subscribeToCodexLogEntries,
} from '../../../src/evaluation/providers/codex-log-tracker.js';
import {
  type ProviderRequest,
  extractLastAssistantContent,
} from '../../../src/evaluation/providers/types.js';

async function createTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

describe('CodexCliProvider', () => {
  let fixturesRoot: string;

  beforeEach(async () => {
    fixturesRoot = await createTempDir('codex-provider-');
    consumeCodexLogEntries();
  });

  afterEach(async () => {
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  it('mirrors input files and composes preread block', async () => {
    const runner = mock(
      async (_opts: {
        prompt: string;
        args: readonly string[];
        onStdoutChunk?: (chunk: string) => void;
      }) => ({
        stdout: JSON.stringify({ messages: [{ role: 'assistant', content: 'done' }] }),
        stderr: '',
        exitCode: 0,
      }),
    );
    const provider = new CodexCliProvider(
      'codex-target',
      {
        command: [process.execPath, '--profile', 'default'],
        model: 'test',
        runtime: { mode: 'host' },
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
    };

    const response = await provider.invoke(request);

    expect(extractLastAssistantContent(response.output)).toBe('done');
    expect(runner).toHaveBeenCalledTimes(1);
    const invocation = runner.mock.calls[0][0];
    expect(invocation.executable).toBe(process.execPath);
    expect(invocation.args.slice(0, 7)).toEqual([
      '--profile',
      'default',
      '--model',
      'test',
      'exec',
      '--json',
      '--color',
    ]);
    expect(invocation.args.slice(7, 9)).toEqual(['never', '--skip-git-repo-check']);
    expect(invocation.args).toContain('--profile');
    expect(invocation.args).toContain('default');
    expect(invocation.args).toContain('--model');
    expect(invocation.args).toContain('test');
    expect(invocation.args[invocation.args.length - 1]).toBe('-');
    expect(invocation.prompt).toContain('python.instructions.md');
    expect(invocation.prompt).toContain('main.py');
    expect(invocation.prompt).toContain('[[ ## user_query ## ]]');

    const raw = response.raw as Record<string, unknown>;
    const inputFilePaths = raw.inputFiles as readonly string[];
    expect(Array.isArray(inputFilePaths)).toBe(true);
    expect(inputFilePaths?.length).toBe(2);
    // Verify the input files are the original file paths (no longer mirrored)
    expect(inputFilePaths).toContain(guidelineFile);
    expect(inputFilePaths).toContain(attachmentFile);
  });

  it('returns a target error envelope when Codex CLI emits invalid JSON', async () => {
    const runner = mock(async () => ({
      stdout: 'not json',
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CodexCliProvider(
      'codex-target',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
        logDir: fixturesRoot,
      },
      runner,
    );

    const request: ProviderRequest = {
      question: 'Hello',
    };

    const response = await provider.invoke(request);

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('malformed_output');
    expect(response.targetExecution?.logs?.stdout?.text).toBe('not json');
    expect(extractLastAssistantContent(response.output)).toContain('Error:');
  });

  it('parses JSONL output from codex exec', async () => {
    const jsonl = [
      { type: 'thread.started' },
      { type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'final answer' } },
      { type: 'turn.completed' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const runner = mock(async () => ({
      stdout: jsonl,
      stderr: '',
      exitCode: 0,
    }));

    const provider = new CodexCliProvider(
      'codex-target',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
        logDir: fixturesRoot,
      },
      runner,
    );

    const request: ProviderRequest = {
      question: 'Use JSONL',
    };

    const response = await provider.invoke(request);
    expect(extractLastAssistantContent(response.output)).toBe('final answer');
  });

  it('streams codex output to a readable log file', async () => {
    const runner = mock(async (options: { readonly onStdoutChunk?: (chunk: string) => void }) => {
      const reasoning = JSON.stringify({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'thinking hard' },
      });
      const final = JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'done' },
      });
      options.onStdoutChunk?.(`${reasoning}\n`);
      options.onStdoutChunk?.(final);
      return {
        stdout: JSON.stringify({ messages: [{ role: 'assistant', content: 'done' }] }),
        stderr: '',
        exitCode: 0,
      };
    });

    const provider = new CodexCliProvider(
      'codex-target',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
        logDir: fixturesRoot,
      },
      runner,
    );

    const observedEntries: CodexLogEntry[] = [];
    const unsubscribe = subscribeToCodexLogEntries((entry) => {
      observedEntries.push(entry);
    });

    try {
      const response = await provider.invoke({ question: 'log it', evalCaseId: 'case-123' });
      const raw = response.raw as Record<string, unknown>;
      expect(typeof raw.logFile).toBe('string');
      const logFile = raw.logFile as string;
      const logContent = await readFile(logFile, 'utf8');
      expect(logContent).toContain('item.completed: thinking hard');
      expect(logContent).toContain('item.completed: done');

      const tracked = consumeCodexLogEntries();
      expect(tracked.some((entry) => entry.filePath === logFile)).toBe(true);
      expect(observedEntries.some((entry) => entry.filePath === logFile)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('supports raw stream logs for detailed inspection', async () => {
    const runner = mock(async (options: { readonly onStdoutChunk?: (chunk: string) => void }) => {
      const event = JSON.stringify({
        type: 'item.completed',
        item: { type: 'tool_call', tool: 'search', args: { q: 'hello' } },
      });
      options.onStdoutChunk?.(event);
      return {
        stdout: JSON.stringify({ messages: [{ role: 'assistant', content: 'ok' }] }),
        stderr: '',
        exitCode: 0,
      };
    });

    const provider = new CodexCliProvider(
      'codex-target',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
        logDir: fixturesRoot,
        streamLog: 'raw',
      },
      runner,
    );

    const response = await provider.invoke({ question: 'log it json', evalCaseId: 'case-json' });
    const raw = response.raw as Record<string, unknown>;
    const logFile = raw.logFile as string;
    const logContent = await readFile(logFile, 'utf8');
    expect(logContent).toContain('"tool": "search"');
    expect(logContent).toContain('"q": "hello"');
  });

  it('builds an isolated profile environment without copying host HOME or CODEX_HOME', async () => {
    const profileHome = path.join(fixturesRoot, 'profile-home');
    const codexHome = path.join(fixturesRoot, 'codex-home');
    const tmp = path.join(fixturesRoot, 'tmp');
    const runner = mock(async () => ({
      stdout: JSON.stringify({ messages: [{ role: 'assistant', content: 'profile ok' }] }),
      stderr: '',
      exitCode: 0,
    }));
    const provider = new CodexCliProvider(
      'codex-profile',
      {
        command: [process.execPath],
        runtime: {
          mode: 'profile',
          home: profileHome,
          codexHome,
          tmpDir: tmp,
          env: { AGENTV_PROFILE_MARKER: 'yes' },
        },
      },
      runner,
    );

    await provider.invoke({ question: 'profile env' });

    const invocation = runner.mock.calls[0][0];
    expect(invocation.env.HOME).toBe(profileHome);
    expect(invocation.env.CODEX_HOME).toBe(codexHome);
    expect(invocation.env.TMPDIR).toBe(tmp);
    expect(invocation.env.AGENTV_PROFILE_MARKER).toBe('yes');
    expect(invocation.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('returns a nonzero-exit target envelope with captured stderr', async () => {
    const runner = mock(async () => ({
      stdout: '',
      stderr: 'boom',
      exitCode: 3,
    }));
    const provider = new CodexCliProvider(
      'codex-crash',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
      },
      runner,
    );

    const response = await provider.invoke({ question: 'fail' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('nonzero_exit');
    expect(response.targetExecution?.exitCode).toBe(3);
    expect(response.targetExecution?.logs?.stderr?.text).toBe('boom');
  });

  it('returns a timeout target envelope', async () => {
    const runner = mock(async () => ({
      stdout: 'partial',
      stderr: '',
      exitCode: null,
      timedOut: true,
    }));
    const provider = new CodexCliProvider(
      'codex-timeout',
      {
        command: [process.execPath],
        runtime: { mode: 'host' },
        timeoutMs: 10,
      },
      runner,
    );

    const response = await provider.invoke({ question: 'hang' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('timeout');
    expect(response.targetExecution?.logs?.stdout?.text).toBe('partial');
  });

  it('returns unsupported target error for sandbox runtime until sandbox runtime is available', async () => {
    const runner = mock(async () => {
      throw new Error('should not run');
    });
    const provider = new CodexCliProvider(
      'codex-sandbox',
      {
        command: [process.execPath],
        runtime: { mode: 'sandbox' },
      },
      runner,
    );

    const response = await provider.invoke({ question: 'sandbox' });

    expect(runner).not.toHaveBeenCalled();
    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('sandbox_infra_failure');
  });

  it('runs codex-app-server through initialize, thread/start, and turn/start JSON-RPC messages', async () => {
    const serverScript = path.join(fixturesRoot, 'fake-codex-app-server.js');
    const captureFile = path.join(fixturesRoot, 'app-server-requests.json');
    await writeFile(
      serverScript,
      [
        "const { writeFileSync } = require('node:fs');",
        'const captureFile = process.argv[2];',
        'let buffer = "";',
        'const requests = [];',
        'function send(message) { process.stdout.write(`${JSON.stringify(message)}\\n`); }',
        'function capture(message) { requests.push(message); writeFileSync(captureFile, JSON.stringify(requests)); }',
        'function handle(message) {',
        '  capture(message);',
        '  if (message.method === "initialize") {',
        '    send({ id: message.id, result: { userAgent: "fake", codexHome: process.cwd(), platformFamily: "unix", platformOs: "linux" } });',
        '    return;',
        '  }',
        '  if (message.method === "thread/start") {',
        '    send({ id: message.id, result: { thread: { id: "thread-1" } } });',
        '    return;',
        '  }',
        '  if (message.method === "turn/start") {',
        '    send({ id: message.id, result: { turn: { id: "turn-1", items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: null, completedAt: null, durationMs: null } } });',
        '    send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: Date.now(), item: { type: "agentMessage", id: "msg-1", text: "app server answer", phase: "final_answer", memoryCitation: null } } });',
        '    send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", items: [], itemsView: "notLoaded", status: "completed", error: null, startedAt: 1, completedAt: 2, durationMs: 1000 } } });',
        '    setTimeout(() => process.exit(0), 0);',
        '  }',
        '}',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk;',
        '  const lines = buffer.split(/\\r?\\n/);',
        '  buffer = lines.pop() ?? "";',
        '  for (const line of lines) {',
        '    if (line.trim()) handle(JSON.parse(line));',
        '  }',
        '});',
      ].join('\n'),
      'utf8',
    );
    const provider = new CodexAppServerProvider('codex-app', {
      command: [
        process.execPath,
        serverScript,
        captureFile,
        '-c',
        'model_provider="agentv-openai"',
        'app-server',
        '--stdio',
      ],
      model: 'gpt-5.4-mini',
      modelReasoningEffort: 'low',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      runtime: { mode: 'host' },
      systemPrompt: 'system instructions',
    });

    const response = await provider.invoke({ question: 'hello', evalCaseId: 'case-app' });

    const captured = JSON.parse(await readFile(captureFile, 'utf8')) as Array<{
      method: string;
      params: Record<string, unknown>;
    }>;
    expect(captured.map((message) => message.method)).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
    ]);
    expect(captured[1].params).toMatchObject({
      model: 'gpt-5.4-mini',
      modelProvider: 'agentv-openai',
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      baseInstructions: 'system instructions',
      ephemeral: true,
    });
    expect(captured[2].params).toMatchObject({
      threadId: 'thread-1',
      approvalPolicy: 'never',
      model: 'gpt-5.4-mini',
      effort: 'low',
    });
    expect(captured[2].params.input).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('[[ ## user_query ## ]]'),
        text_elements: [],
      }),
    ]);
    expect(response.targetExecution?.providerKind).toBe('codex-app-server');
    expect(extractLastAssistantContent(response.output)).toBe('app server answer');
  });

  it('maps codex-app-server JSON-RPC errors to a target execution envelope', async () => {
    const serverScript = path.join(fixturesRoot, 'fake-codex-app-server-error.js');
    await writeFile(
      serverScript,
      [
        'let buffer = "";',
        'function send(message) { process.stdout.write(`${JSON.stringify(message)}\\n`); }',
        'function handle(message) {',
        '  if (message.method === "initialize") {',
        '    send({ id: message.id, result: { userAgent: "fake", codexHome: process.cwd(), platformFamily: "unix", platformOs: "linux" } });',
        '    return;',
        '  }',
        '  send({ id: message.id, error: { code: -32602, message: "bad thread config" } });',
        '}',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk;',
        '  const lines = buffer.split(/\\r?\\n/);',
        '  buffer = lines.pop() ?? "";',
        '  for (const line of lines) {',
        '    if (line.trim()) handle(JSON.parse(line));',
        '  }',
        '});',
      ].join('\n'),
      'utf8',
    );
    const provider = new CodexAppServerProvider('codex-app-error', {
      command: [process.execPath, serverScript],
      runtime: { mode: 'host' },
      timeoutMs: 1000,
    });

    const response = await provider.invoke({ question: 'hello' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('malformed_output');
    expect(response.targetExecution?.message).toContain('bad thread config');
    expect(response.targetExecution?.logs?.stderr?.text).toContain(
      'Codex app-server JSON-RPC error',
    );
  });
});
