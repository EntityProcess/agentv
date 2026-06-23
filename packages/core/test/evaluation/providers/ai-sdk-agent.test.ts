import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AiSdkAgentProvider, _internal } from '../../../src/evaluation/providers/ai-sdk-agent.js';

function mockAiSdk(generateText: ReturnType<typeof mock>) {
  return {
    ai: {
      generateText,
      stepCountIs: (stepCount: number) => ({ stepCount }),
      tool: (definition: Record<string, unknown>) => definition,
      jsonSchema: (schema: unknown) => schema,
    },
    openai: {
      createOpenAI: mock((options?: Record<string, unknown>) => {
        const provider = Object.assign(
          (modelId: string) => ({ modelId, options, api: 'responses' }),
          {
            chat: (modelId: string) => ({ modelId, options, api: 'chat' }),
          },
        );
        return provider;
      }),
    },
  };
}

describe('AiSdkAgentProvider', () => {
  afterEach(() => {
    _internal.setLoaderForTesting(undefined);
  });

  it('has the correct kind and id', () => {
    const provider = new AiSdkAgentProvider('test-target', {
      baseURL: 'http://127.0.0.1:10531/v1',
      apiKey: 'dummy',
      model: 'gpt-test',
      maxSteps: 20,
    });
    expect(provider.kind).toBe('ai-sdk-agent');
    expect(provider.id).toBe('ai-sdk-agent:test-target');
    expect(provider.targetName).toBe('test-target');
    expect(provider.supportsBatch).toBe(false);
  });

  it('rejects when signal is already aborted', async () => {
    const provider = new AiSdkAgentProvider('test-target', {
      baseURL: 'http://127.0.0.1:10531/v1',
      apiKey: 'dummy',
      model: 'gpt-test',
      maxSteps: 20,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ question: 'Hello', signal: controller.signal })).rejects.toThrow(
      'aborted before execution',
    );
  });

  it('maps tool allowlists to repo-owned coding tools', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-ai-sdk-tools-'));
    try {
      await writeFile(path.join(workspace, 'input.txt'), 'hello world\n', 'utf8');

      const tools = _internal.createCodingTools(
        workspace,
        _internal.parseToolAllowlist('read,edit'),
      );
      expect(tools.map((tool) => tool.name)).toEqual(['read', 'edit']);

      const read = tools.find((tool) => tool.name === 'read');
      const edit = tools.find((tool) => tool.name === 'edit');
      expect(await read?.execute({ path: 'input.txt' })).toMatchObject({
        path: 'input.txt',
        content: 'hello world\n',
      });
      expect(
        await edit?.execute({
          path: 'input.txt',
          old_string: 'hello',
          new_string: 'hi',
        }),
      ).toEqual({ path: 'input.txt', replacements: 1 });
      expect(await readFile(path.join(workspace, 'input.txt'), 'utf8')).toBe('hi world\n');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects unsupported tool names', () => {
    expect(() => _internal.parseToolAllowlist('read,grep')).toThrow("unsupported tool 'grep'");
  });

  it('keeps tool paths inside the eval workspace', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-ai-sdk-workspace-'));
    try {
      expect(() => _internal.resolveWorkspacePath(workspace, '../outside.txt')).toThrow(
        'outside the workspace',
      );
      expect(() => _internal.resolveWorkspacePath(workspace, '/tmp/outside.txt')).toThrow(
        'must be relative',
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('runs a mocked AI SDK tool loop and maps AgentV ProviderResponse fields', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-ai-sdk-loop-'));
    try {
      await writeFile(path.join(workspace, 'input.txt'), 'hello world\n', 'utf8');

      const generateText = mock(async (options: Record<string, unknown>) => {
        const tools = options.tools as Record<
          string,
          {
            execute(input: unknown, options?: { toolCallId?: string }): Promise<unknown>;
          }
        >;

        const readOutput = await tools.read.execute(
          { path: 'input.txt' },
          { toolCallId: 'read-1' },
        );
        const editOutput = await tools.edit.execute(
          { path: 'input.txt', old_string: 'hello', new_string: 'hi' },
          { toolCallId: 'edit-1' },
        );
        const bashOutput = await tools.bash.execute(
          { command: 'printf done' },
          { toolCallId: 'bash-1' },
        );

        return {
          text: 'Completed.',
          finishReason: 'stop',
          totalUsage: {
            inputTokens: 11,
            outputTokens: 7,
            inputTokenDetails: { cacheReadTokens: 3 },
            outputTokenDetails: { reasoningTokens: 2 },
          },
          steps: [
            {
              toolCalls: [
                { toolCallId: 'read-1', toolName: 'read', input: { path: 'input.txt' } },
                {
                  toolCallId: 'edit-1',
                  toolName: 'edit',
                  input: { path: 'input.txt', old_string: 'hello', new_string: 'hi' },
                },
                { toolCallId: 'bash-1', toolName: 'bash', input: { command: 'printf done' } },
              ],
              toolResults: [
                { toolCallId: 'read-1', toolName: 'read', output: readOutput },
                { toolCallId: 'edit-1', toolName: 'edit', output: editOutput },
                { toolCallId: 'bash-1', toolName: 'bash', output: bashOutput },
              ],
            },
          ],
        };
      });
      _internal.setLoaderForTesting(async () => mockAiSdk(generateText));

      const provider = new AiSdkAgentProvider('test-target', {
        baseURL: 'http://127.0.0.1:10531/v1',
        apiKey: 'dummy',
        model: 'gpt-test',
        temperature: 0.2,
        maxSteps: 12,
        tools: 'read,bash,edit',
        systemPrompt: 'Project-specific instructions.',
      });

      const response = await provider.invoke({
        question: 'Update greeting',
        cwd: workspace,
        maxOutputTokens: 123,
      });

      expect(generateText).toHaveBeenCalledTimes(1);
      const callOptions = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callOptions.prompt).toContain('Update greeting');
      expect(callOptions.system).toContain('Project-specific instructions.');
      expect(callOptions.stopWhen).toEqual({ stepCount: 12 });
      expect(callOptions.temperature).toBe(0.2);
      expect(callOptions.maxOutputTokens).toBe(123);
      expect(callOptions.model).toMatchObject({
        modelId: 'gpt-test',
        api: 'chat',
      });

      expect(await readFile(path.join(workspace, 'input.txt'), 'utf8')).toBe('hi world\n');
      expect(response.output?.[0]?.content).toBe('Completed.');
      expect(response.output?.[0]?.toolCalls?.map((toolCall) => toolCall.tool)).toEqual([
        'Read',
        'Edit',
        'Bash',
      ]);
      expect(response.tokenUsage).toEqual({
        input: 11,
        output: 7,
        cached: 3,
        reasoning: 2,
      });
      expect(response.steps).toEqual({ count: 1, toolCallCount: 3 });
      expect(response.raw).toMatchObject({
        provider: 'ai-sdk-agent',
        model: 'gpt-test',
        baseURL: 'http://127.0.0.1:10531/v1',
        maxSteps: 12,
        tools: ['read', 'bash', 'edit'],
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('formats dependency load failures with the managed install path', () => {
    const message = _internal.formatDependencyLoadError(new Error('boom'));
    expect(message).toContain('deps/ai-sdk-agent');
    expect(message).toContain('bun add ai@^6.0.0 @ai-sdk/openai@^3.0.0');
    expect(message).toContain('Original error: boom');
  });

  it('treats closed-pipe errors as benign and captures bounded bash output', async () => {
    expect(_internal.isBenignPipeError({ code: 'EPIPE' })).toBe(true);

    const workspace = await mkdtemp(path.join(tmpdir(), 'agentv-ai-sdk-bash-'));
    try {
      const result = await _internal.runBashCommand('yes | head -n 1', {
        cwd: workspace,
        timeoutMs: 1000,
      });
      expect(result.stdout.trim()).toBe('y');
      expect(result.timed_out).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
