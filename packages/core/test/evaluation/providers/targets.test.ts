import { beforeEach, describe, expect, it, mock } from 'bun:test';
const generateTextMock = mock(async () => ({
  text: 'ok',
  reasoningText: undefined,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  content: [],
  reasoning: [],
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  toolResults: [],
  staticToolResults: [],
  dynamicToolResults: [],
  finishReason: 'stop',
  warnings: undefined,
  providerMetadata: undefined,
}));

const createAzureMock = mock((options: unknown) => () => ({ provider: 'azure', options }));
const createAnthropicMock = mock(() => () => ({ provider: 'anthropic' }));
const createGeminiMock = mock(() => () => ({ provider: 'gemini' }));

mock.module('ai', () => ({
  generateText: () => generateTextMock(),
}));

mock.module('@ai-sdk/azure', () => ({
  createAzure: (options: unknown) => createAzureMock(options),
}));

mock.module('@ai-sdk/anthropic', () => ({
  createAnthropic: () => createAnthropicMock(),
}));

mock.module('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => createGeminiMock(),
}));

const providerModule = await import('../../../src/evaluation/providers/index.js');
const { resolveTargetDefinition, createProvider } = providerModule;

describe('resolveTargetDefinition', () => {
  beforeEach(() => {
    generateTextMock.mockClear();
  });

  it("throws when settings don't use ${{ }} syntax", () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    expect(() =>
      resolveTargetDefinition(
        {
          name: 'default',
          provider: 'azure',
          endpoint: 'AZURE_OPENAI_ENDPOINT',
          api_key: 'AZURE_OPENAI_API_KEY',
          model: 'AZURE_DEPLOYMENT_NAME',
        },
        env,
      ),
    ).toThrow(/must use.*VARIABLE_NAME.*syntax/i);
  });

  it('resolves azure settings using ${{ variable }} syntax', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'default',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    expect(target.config).toMatchObject({
      resourceName: 'https://example.openai.azure.com',
      deploymentName: 'gpt-4o',
      apiKey: 'secret',
      version: '2024-12-01-preview',
    });
  });

  it('resolves with ${{ }} syntax with extra whitespace', () => {
    const env = {
      MY_VAR: 'test-value',
      MY_API_KEY: 'literal-key',
      MY_MODEL: 'literal-model',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'test',
        provider: 'azure',
        endpoint: '${{  MY_VAR  }}',
        api_key: '${{ MY_API_KEY }}',
        model: '${{ MY_MODEL }}',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }
    expect(target.config.resourceName).toBe('test-value');
  });

  it('resolves with ${{ }} syntax without spaces', () => {
    const env = {
      MY_ENDPOINT: 'https://no-spaces.example.com',
      MY_KEY: 'key123',
      MY_MODEL: 'literal-model',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'no-spaces',
        provider: 'azure',
        endpoint: '${{MY_ENDPOINT}}',
        api_key: '${{MY_KEY}}',
        model: '${{MY_MODEL}}',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }
    expect(target.config.resourceName).toBe('https://no-spaces.example.com');
    expect(target.config.apiKey).toBe('key123');
  });

  it('throws when ${{ variable }} reference is missing from env', () => {
    const env = {} satisfies Record<string, string>;

    expect(() =>
      resolveTargetDefinition(
        {
          name: 'broken',
          provider: 'azure',
          endpoint: '${{ MISSING_VAR }}',
          api_key: 'key',
          model: 'model',
        },
        env,
      ),
    ).toThrow(/MISSING_VAR.*is not set/i);
  });

  it('normalizes azure api versions', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
      CUSTOM_VERSION: 'api-version=2024-08-01-preview',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'azure-version',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        version: '${{ CUSTOM_VERSION }}',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }

    expect(target.config.version).toBe('2024-08-01-preview');
  });

  it('throws when required azure environment variables are missing', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
    } satisfies Record<string, string>;

    expect(() =>
      resolveTargetDefinition(
        {
          name: 'broken',
          provider: 'azure',
          endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
          api_key: '${{ AZURE_OPENAI_API_KEY }}',
          model: '${{ AZURE_DEPLOYMENT_NAME }}',
        },
        env,
      ),
    ).toThrow(/AZURE_OPENAI_API_KEY/i);
  });

  it('supports vscode configuration with optional workspace template from env var', () => {
    const env = {
      WORKSPACE_TEMPLATE_PATH: '/path/to/workspace.code-workspace',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'editor',
        provider: 'vscode',
        vscode_cmd: 'code-insiders',
        wait: false,
        dry_run: true,
        workspace_template: '${{ WORKSPACE_TEMPLATE_PATH }}',
      },
      env,
    );

    expect(target.kind).toBe('vscode');
    if (target.kind !== 'vscode') {
      throw new Error('expected vscode target');
    }

    expect(target.config.command).toBe('code-insiders');
    expect(target.config.waitForResponse).toBe(false);
    expect(target.config.dryRun).toBe(true);
    expect(target.config.workspaceTemplate).toBe('/path/to/workspace.code-workspace');
  });

  it('resolves gemini settings from environment with default model', () => {
    const env = {
      GOOGLE_API_KEY: 'gemini-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'gemini-target',
        provider: 'gemini',
        api_key: '${{ GOOGLE_API_KEY }}',
      },
      env,
    );

    expect(target.kind).toBe('gemini');
    if (target.kind !== 'gemini') {
      throw new Error('expected gemini target');
    }

    expect(target.config).toMatchObject({
      apiKey: 'gemini-secret',
      model: 'gemini-2.5-flash',
    });
  });

  it('resolves gemini settings with custom model from environment', () => {
    const env = {
      GOOGLE_API_KEY: 'gemini-secret',
      GOOGLE_GEMINI_MODEL: 'gemini-2.5-pro',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'gemini-pro',
        provider: 'gemini',
        api_key: '${{ GOOGLE_API_KEY }}',
        model: '${{ GOOGLE_GEMINI_MODEL }}',
      },
      env,
    );

    expect(target.kind).toBe('gemini');
    if (target.kind !== 'gemini') {
      throw new Error('expected gemini target');
    }

    expect(target.config).toMatchObject({
      apiKey: 'gemini-secret',
      model: 'gemini-2.5-pro',
    });
  });

  it('resolves gemini with literal model string', () => {
    const env = {
      GOOGLE_API_KEY: 'gemini-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'gemini-flash',
        provider: 'google-gemini',
        api_key: '${{ GOOGLE_API_KEY }}',
        model: 'gemini-1.5-flash',
      },
      env,
    );

    expect(target.kind).toBe('gemini');
    if (target.kind !== 'gemini') {
      throw new Error('expected gemini target');
    }

    expect(target.config).toMatchObject({
      apiKey: 'gemini-secret',
      model: 'gemini-1.5-flash',
    });
  });

  it('throws when google api key is missing', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'broken-gemini',
          provider: 'gemini',
          api_key: '${{ GOOGLE_API_KEY }}',
        },
        {},
      ),
    ).toThrow(/GOOGLE_API_KEY/i);
  });

  it('honors provider_batching flag in settings', () => {
    const target = resolveTargetDefinition(
      {
        name: 'batched',
        provider: 'mock',
        provider_batching: true,
      },
      {},
    );

    expect(target.kind).toBe('mock');
    expect(target.providerBatching).toBe(true);
  });

  it('resolves cli settings including cwd and timeout', () => {
    const env = {
      WORKDIR: '/tmp/project',
      CLI_TOKEN: 'secret-token',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'shell-cli',
        provider: 'cli',
        command_template: 'code chat {PROMPT} {FILES}',
        cwd: '${{ WORKDIR }}',
        timeout_seconds: 3,
        files_format: '--file {path}',
      },
      env,
    );

    expect(target.kind).toBe('cli');
    if (target.kind !== 'cli') {
      throw new Error('expected cli target');
    }

    expect(target.config.commandTemplate).toContain('{PROMPT}');
    expect(target.config.cwd).toBe('/tmp/project');
    expect(target.config.timeoutMs).toBe(3000);
    expect(target.config.filesFormat).toBe('--file {path}');
  });

  it('throws for unknown cli placeholders', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'bad-cli',
          provider: 'cli',
          command_template: 'run-task {UNKNOWN}',
        },
        {},
      ),
    ).toThrow(/unsupported placeholder/i);
  });

  it('resolves codex args using ${{ }} syntax', () => {
    const env = {
      CODEX_PROFILE: 'default',
      CODEX_MODEL: 'gpt-4',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'codex',
        provider: 'codex',
        args: ['--profile', '${{ CODEX_PROFILE }}', '--model', '${{ CODEX_MODEL }}'],
      },
      env,
    );

    expect(target.kind).toBe('codex');
    if (target.kind !== 'codex') {
      throw new Error('expected codex target');
    }

    expect(target.config.args).toEqual(['--profile', 'default', '--model', 'gpt-4']);
  });
});

describe('createProvider', () => {
  beforeEach(() => {
    generateTextMock.mockClear();
    createAzureMock.mockClear();
    createAnthropicMock.mockClear();
    createGeminiMock.mockClear();
  });

  it('creates an azure provider that calls the Vercel AI SDK', async () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'azure-target',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
      },
      env,
    );

    const provider = createProvider(resolved);
    const response = await provider.invoke({ question: 'Hello' });

    expect(createAzureMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(response.text).toBe('ok');
  });
  it('creates a gemini provider that calls the Vercel AI SDK', async () => {
    const env = {
      GOOGLE_API_KEY: 'gemini-key',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'gemini-target',
        provider: 'gemini',
        api_key: '${{ GOOGLE_API_KEY }}',
      },
      env,
    );

    const provider = createProvider(resolved);
    expect(provider.kind).toBe('gemini');
    expect(provider.targetName).toBe('gemini-target');

    const response = await provider.invoke({ question: 'Test prompt' });

    expect(createGeminiMock).toHaveBeenCalled();
    expect(generateTextMock).toHaveBeenCalled();
    expect(response.text).toBe('ok');
  });
});
