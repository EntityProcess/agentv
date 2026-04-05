import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
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

const createAzureMock = mock((options: unknown) => {
  const fn = () => ({ provider: 'azure', options, apiFormat: 'responses' });
  fn.chat = () => ({ provider: 'azure', options, apiFormat: 'chat' });
  fn.responses = () => ({ provider: 'azure', options, apiFormat: 'responses' });
  return fn;
});
const createOpenAIMock = mock((options: unknown) => {
  const fn = () => ({ provider: 'openai', options });
  fn.chat = () => ({ provider: 'openai', options });
  fn.responses = () => ({ provider: 'openai', options });
  return fn;
});
const createOpenRouterMock = mock((options: unknown) => () => ({
  provider: 'openrouter',
  options,
}));
const createAnthropicMock = mock(() => () => ({ provider: 'anthropic' }));
const createGeminiMock = mock(() => () => ({ provider: 'gemini' }));

mock.module('ai', () => ({
  generateText: () => generateTextMock(),
}));

mock.module('@ai-sdk/azure', () => ({
  createAzure: (options: unknown) => createAzureMock(options),
}));

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: (options: unknown) => createOpenAIMock(options),
}));

mock.module('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: (options: unknown) => createOpenRouterMock(options),
}));

mock.module('@ai-sdk/anthropic', () => ({
  createAnthropic: () => createAnthropicMock(),
}));

mock.module('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => createGeminiMock(),
}));

const providerModule = await import('../../../src/evaluation/providers/index.js');
const { resolveDelegatedTargetDefinition, resolveTargetDefinition, createProvider } =
  providerModule;
const { extractLastAssistantContent } = await import('../../../src/evaluation/providers/types.js');

describe('resolveDelegatedTargetDefinition', () => {
  it('throws a helpful error when an env-backed use_target variable is missing', () => {
    const definitions = new Map([
      ['grader', { name: 'grader', use_target: '${{ GRADER_TARGET }}' }],
      ['azure', { name: 'azure', provider: 'azure' }],
    ]);

    expect(() => resolveDelegatedTargetDefinition('grader', definitions, {})).toThrow(
      /GRADER_TARGET is not set/i,
    );
  });

  it('throws a helpful error when an env-backed use_target resolves to a missing target', () => {
    const definitions = new Map([
      ['grader', { name: 'grader', use_target: '${{ GRADER_TARGET }}' }],
    ]);

    expect(() =>
      resolveDelegatedTargetDefinition('grader', definitions, {
        GRADER_TARGET: 'azure',
      }),
    ).toThrow(/resolved to "azure".*no target named "azure" exists/i);
  });

  it('resolves a delegated target chain to a concrete definition', () => {
    const definitions = new Map([
      ['grader', { name: 'grader', use_target: '${{ GRADER_TARGET }}' }],
      ['llm', { name: 'llm', use_target: 'azure' }],
      ['azure', { name: 'azure', provider: 'azure' }],
    ]);

    const resolved = resolveDelegatedTargetDefinition('grader', definitions, {
      GRADER_TARGET: 'llm',
    });

    expect(resolved).toEqual({ name: 'azure', provider: 'azure' });
  });
});

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

  it('resolves azure api_format when configured', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'azure-responses',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_format: 'responses',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }

    expect(target.config.apiFormat).toBe('responses');
    expect(target.config.version).toBe('v1');
  });

  it('resolves azure api_format from env interpolation', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
      AZURE_OPENAI_API_FORMAT: 'responses',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'azure-env-format',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_format: '${{ AZURE_OPENAI_API_FORMAT }}',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }

    expect(target.config.apiFormat).toBe('responses');
    expect(target.config.version).toBe('v1');
  });

  it('defaults azure responses targets to api version v1', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'azure-responses-default-version',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_format: 'responses',
      },
      env,
    );

    expect(target.kind).toBe('azure');
    if (target.kind !== 'azure') {
      throw new Error('expected azure target');
    }

    expect(target.config.version).toBe('v1');
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

  it('supports vscode configuration with executable/wait/dry_run', () => {
    const target = resolveTargetDefinition(
      {
        name: 'editor',
        provider: 'vscode',
        executable: 'code-insiders',
        wait: false,
        dry_run: true,
      },
      {},
    );

    expect(target.kind).toBe('vscode');
    if (target.kind !== 'vscode') {
      throw new Error('expected vscode target');
    }

    expect(target.config.executable).toBe('code-insiders');
    expect(target.config.waitForResponse).toBe(false);
    expect(target.config.dryRun).toBe(true);
  });

  it('resolves vscode executable from env var', () => {
    const env = {
      VSCODE_CMD: '/custom/path/to/code',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'editor',
        provider: 'vscode',
        executable: '${{ VSCODE_CMD }}',
      },
      env,
    );

    expect(target.kind).toBe('vscode');
    if (target.kind !== 'vscode') {
      throw new Error('expected vscode target');
    }

    expect(target.config.executable).toBe('/custom/path/to/code');
  });

  it('resolves vscode executable from literal path', () => {
    const env = {} satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'editor',
        provider: 'vscode',
        executable: 'C:/Program Files/VSCode/code.cmd',
      },
      env,
    );

    expect(target.kind).toBe('vscode');
    if (target.kind !== 'vscode') {
      throw new Error('expected vscode target');
    }

    expect(target.config.executable).toBe('C:/Program Files/VSCode/code.cmd');
  });

  it('vscode defaults to code when no executable specified', () => {
    const env = {} satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'editor',
        provider: 'vscode',
      },
      env,
    );

    expect(target.kind).toBe('vscode');
    if (target.kind !== 'vscode') {
      throw new Error('expected vscode target');
    }

    expect(target.config.executable).toBe('code');
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

  it('resolves openai settings from environment', () => {
    const env = {
      OPENAI_ENDPOINT: 'https://llm-gateway.example.com/v1',
      OPENAI_API_KEY: 'openai-secret',
      OPENAI_MODEL: 'gpt-5.4',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'openai-target',
        provider: 'openai',
        endpoint: '${{ OPENAI_ENDPOINT }}',
        api_key: '${{ OPENAI_API_KEY }}',
        model: '${{ OPENAI_MODEL }}',
      },
      env,
    );

    expect(target.kind).toBe('openai');
    if (target.kind !== 'openai') {
      throw new Error('expected openai target');
    }

    expect(target.config).toMatchObject({
      baseURL: 'https://llm-gateway.example.com/v1',
      apiKey: 'openai-secret',
      model: 'gpt-5.4',
    });
  });

  it('resolves openrouter settings from environment', () => {
    const env = {
      OPENROUTER_API_KEY: 'openrouter-secret',
      OPENROUTER_MODEL: 'openai/gpt-5-mini',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'openrouter-target',
        provider: 'openrouter',
        api_key: '${{ OPENROUTER_API_KEY }}',
        model: '${{ OPENROUTER_MODEL }}',
      },
      env,
    );

    expect(target.kind).toBe('openrouter');
    if (target.kind !== 'openrouter') {
      throw new Error('expected openrouter target');
    }

    expect(target.config).toMatchObject({
      apiKey: 'openrouter-secret',
      model: 'openai/gpt-5-mini',
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
        command: 'code chat {PROMPT} {FILES}',
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

    expect(target.config.command).toContain('{PROMPT}');
    expect(target.config.cwd).toBe('/tmp/project');
    expect(target.config.timeoutMs).toBe(3000);
    expect(target.config.filesFormat).toBe('--file {path}');
  });

  it('accepts PROMPT_FILE as a supported cli placeholder', () => {
    const target = resolveTargetDefinition(
      {
        name: 'shell-cli-prompt-file',
        provider: 'cli',
        command: 'agent run --prompt-file {PROMPT_FILE} --out {OUTPUT_FILE}',
      },
      {},
    );

    expect(target.kind).toBe('cli');
    if (target.kind !== 'cli') {
      throw new Error('expected cli target');
    }

    expect(target.config.command).toContain('{PROMPT_FILE}');
  });

  it('throws for unknown cli placeholders', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'bad-cli',
          provider: 'cli',
          command: 'run-task {UNKNOWN}',
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

  it('rejects removed target-level workspace_template field', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'cli-with-template',
          provider: 'cli',
          command: 'echo {PROMPT}',
          workspace_template: '/templates/my-workspace',
        },
        {},
      ),
    ).toThrow(/workspace_template has been removed/i);
  });

  it('resolves copilot alias to copilot-cli', () => {
    const target = resolveTargetDefinition(
      {
        name: 'copilot-alias',
        provider: 'copilot',
      },
      {},
    );

    expect(target.kind).toBe('copilot-cli');
  });

  it('resolves copilot-cli as its own provider kind', () => {
    const target = resolveTargetDefinition(
      {
        name: 'copilot-cli-target',
        provider: 'copilot-cli',
        model: 'claude-haiku-4.5',
        timeout_seconds: 600,
      },
      {},
    );

    expect(target.kind).toBe('copilot-cli');
    if (target.kind !== 'copilot-cli') {
      throw new Error('expected copilot-cli target');
    }

    expect(target.config.executable).toBe('copilot');
    expect(target.config.model).toBe('claude-haiku-4.5');
    expect(target.config.timeoutMs).toBe(600000);
  });

  it('copilot-cli defaults executable to copilot', () => {
    const target = resolveTargetDefinition(
      {
        name: 'copilot-cli-default',
        provider: 'copilot-cli',
      },
      {},
    );

    expect(target.kind).toBe('copilot-cli');
    if (target.kind !== 'copilot-cli') {
      throw new Error('expected copilot-cli target');
    }

    expect(target.config.executable).toBe('copilot');
  });

  it('rejects removed target-level workspaceTemplate camelCase field', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'cli-camel-case',
          provider: 'cli',
          command: 'echo {PROMPT}',
          workspaceTemplate: '/templates/camel-case-workspace',
        },
        {},
      ),
    ).toThrow(/workspace_template has been removed/i);
  });

  it('rejects camelCase target fields', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'deprecated-camel-case',
          provider: 'openai',
          baseUrl: '${{ OPENAI_BASE_URL }}',
          apiKey: '${{ OPENAI_API_KEY }}',
          model: '${{ OPENAI_MODEL }}',
          maxTokens: 100,
        },
        {
          OPENAI_BASE_URL: 'https://api.openai.com/v1',
          OPENAI_API_KEY: 'test-key',
          OPENAI_MODEL: 'gpt-5-mini',
        },
      ),
    ).toThrow(/baseUrl.*base_url/i);
  });

  it('resolves agentv target with model and default temperature', () => {
    const target = resolveTargetDefinition(
      {
        name: 'agentv-grader',
        provider: 'agentv',
        model: 'openai:gpt-5-mini',
      },
      {},
    );

    expect(target.kind).toBe('agentv');
    if (target.kind !== 'agentv') {
      throw new Error('expected agentv target');
    }

    expect(target.config.model).toBe('openai:gpt-5-mini');
    expect(target.config.temperature).toBe(0);
  });

  it('resolves agentv target with explicit temperature', () => {
    const target = resolveTargetDefinition(
      {
        name: 'agentv-warm',
        provider: 'agentv',
        model: 'anthropic:claude-haiku-4.5',
        temperature: 0.7,
      },
      {},
    );

    expect(target.kind).toBe('agentv');
    if (target.kind !== 'agentv') {
      throw new Error('expected agentv target');
    }

    expect(target.config.model).toBe('anthropic:claude-haiku-4.5');
    expect(target.config.temperature).toBe(0.7);
  });

  it('throws when agentv target is missing model', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'agentv-no-model',
          provider: 'agentv',
        },
        {},
      ),
    ).toThrow(/model/i);
  });
});

describe('createProvider', () => {
  beforeEach(() => {
    generateTextMock.mockClear();
    createAzureMock.mockClear();
    createOpenAIMock.mockClear();
    createOpenRouterMock.mockClear();
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
    expect(createAzureMock.mock.calls[0]?.[0]).toMatchObject({ useDeploymentBasedUrls: true });
    expect(provider.asLanguageModel()).toMatchObject({ apiFormat: 'chat' });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toBe('ok');
  });

  it('creates an azure provider using the responses api when requested', async () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'azure-responses-target',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_format: 'responses',
      },
      env,
    );

    const provider = createProvider(resolved);
    const response = await provider.invoke({ question: 'Hello' });

    expect(createAzureMock).toHaveBeenCalledTimes(1);
    expect(createAzureMock.mock.calls[0]?.[0]).toMatchObject({ useDeploymentBasedUrls: false });
    expect(provider.asLanguageModel()).toMatchObject({ apiFormat: 'responses' });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toBe('ok');
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
    expect(extractLastAssistantContent(response.output)).toBe('ok');
  });

  it('creates an openai provider that calls the Vercel AI SDK', async () => {
    const env = {
      OPENAI_ENDPOINT: 'https://llm-gateway.example.com/v1',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_MODEL: 'gpt-5.4',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'openai-target',
        provider: 'openai',
        endpoint: '${{ OPENAI_ENDPOINT }}',
        api_key: '${{ OPENAI_API_KEY }}',
        model: '${{ OPENAI_MODEL }}',
      },
      env,
    );

    const provider = createProvider(resolved);
    expect(provider.kind).toBe('openai');

    const response = await provider.invoke({ question: 'Hello from OpenAI' });

    expect(createOpenAIMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toBe('ok');
  });

  it('creates an openrouter provider that calls the Vercel AI SDK', async () => {
    const env = {
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_MODEL: 'openai/gpt-5-mini',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'openrouter-target',
        provider: 'openrouter',
        api_key: '${{ OPENROUTER_API_KEY }}',
        model: '${{ OPENROUTER_MODEL }}',
      },
      env,
    );

    const provider = createProvider(resolved);
    expect(provider.kind).toBe('openrouter');

    const response = await provider.invoke({ question: 'Hello from OpenRouter' });

    expect(createOpenRouterMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toBe('ok');
  });

  it('resolves pi-coding-agent with azure subprovider and base_url', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'pi-azure',
        provider: 'pi-coding-agent',
        subprovider: 'azure',
        base_url: '${{ AZURE_OPENAI_ENDPOINT }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        tools: 'read,bash,edit,write',
      },
      env,
    );

    expect(resolved.kind).toBe('pi-coding-agent');
    if (resolved.kind !== 'pi-coding-agent') throw new Error('expected pi-coding-agent');
    expect(resolved.config.subprovider).toBe('azure');
    expect(resolved.config.baseUrl).toBe('https://my-resource.openai.azure.com');
    expect(resolved.config.model).toBe('gpt-4o');
    expect(resolved.config.apiKey).toBe('azure-secret');
    expect(resolved.config.tools).toBe('read,bash,edit,write');
  });

  it('resolves pi-cli with azure subprovider and base_url', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const resolved = resolveTargetDefinition(
      {
        name: 'pi-cli-azure',
        provider: 'pi-cli',
        subprovider: 'azure',
        base_url: '${{ AZURE_OPENAI_ENDPOINT }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
      },
      env,
    );

    expect(resolved.kind).toBe('pi-cli');
    if (resolved.kind !== 'pi-cli') throw new Error('expected pi-cli');
    expect(resolved.config.subprovider).toBe('azure');
    expect(resolved.config.baseUrl).toBe('https://my-resource.openai.azure.com');
    expect(resolved.config.model).toBe('gpt-4o');
    expect(resolved.config.apiKey).toBe('azure-secret');
  });
});
