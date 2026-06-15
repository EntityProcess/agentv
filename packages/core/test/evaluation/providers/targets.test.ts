import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

const piCompleteMock = mock(async (model: { provider: string }) => ({
  content: [{ type: 'text', text: 'ok' }],
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  api: 'openai-completions',
  provider: model.provider,
  model: 'mock',
  stopReason: 'stop',
  timestamp: Date.now(),
  role: 'assistant',
}));
const piGetModelMock = mock((provider: string, modelId: string) => ({
  id: modelId,
  name: modelId,
  api: 'openai-completions',
  provider,
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
}));
const piRegisterMock = mock(() => {});

mock.module('@earendil-works/pi-ai', () => ({
  complete: (...args: unknown[]) => piCompleteMock(...(args as [{ provider: string }])),
  getModel: (provider: string, modelId: string) => piGetModelMock(provider, modelId),
  registerBuiltInApiProviders: () => piRegisterMock(),
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
    piCompleteMock.mockClear();
    piGetModelMock.mockClear();
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
      version: 'v1',
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

  it('rejects azure api_format with a migration error', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    expect(() =>
      resolveTargetDefinition(
        {
          name: 'azure-with-api-format',
          provider: 'azure',
          endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
          api_key: '${{ AZURE_OPENAI_API_KEY }}',
          model: '${{ AZURE_DEPLOYMENT_NAME }}',
          api_format: 'responses',
        },
        env,
      ),
    ).toThrow(/'api_format' field is no longer supported/i);
  });

  it('defaults azure to api version v1', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'azure-default-version',
        provider: 'azure',
        endpoint: '${{ AZURE_OPENAI_ENDPOINT }}',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
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

  it('resolves codex model_reasoning_effort from env', () => {
    const target = resolveTargetDefinition(
      {
        name: 'codex',
        provider: 'codex',
        model: '${{ CODEX_MODEL }}',
        model_reasoning_effort: '${{ CODEX_REASONING_EFFORT }}',
      },
      {
        CODEX_MODEL: 'gpt-5.5',
        CODEX_REASONING_EFFORT: 'low',
      },
    );

    expect(target.kind).toBe('codex');
    if (target.kind !== 'codex') {
      throw new Error('expected codex target');
    }

    expect(target.config.model).toBe('gpt-5.5');
    expect(target.config.modelReasoningEffort).toBe('low');
  });

  it('rejects unsupported codex model_reasoning_effort values', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'codex',
          provider: 'codex',
          model_reasoning_effort: 'tiny',
        },
        {},
      ),
    ).toThrow(/model_reasoning_effort must be one of: minimal, low, medium, high, xhigh/);
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

  it('claude-cli defaults executable to claude', () => {
    const target = resolveTargetDefinition(
      {
        name: 'claude-default',
        provider: 'claude-cli',
      },
      {},
    );

    expect(target.kind).toBe('claude-cli');
    if (target.kind !== 'claude-cli') {
      throw new Error('expected claude-cli target');
    }

    expect(target.config.executable).toBe('claude');
  });

  it('claude-cli accepts custom executable', () => {
    const target = resolveTargetDefinition(
      {
        name: 'claude-zai',
        provider: 'claude-cli',
        executable: 'claude-zai',
      },
      {},
    );

    expect(target.kind).toBe('claude-cli');
    if (target.kind !== 'claude-cli') {
      throw new Error('expected claude-cli target');
    }

    expect(target.config.executable).toBe('claude-zai');
  });

  it('cc-mirror with explicit executable resolves to claude-cli kind', () => {
    const target = resolveTargetDefinition(
      {
        name: 'claude-zai',
        provider: 'cc-mirror',
        executable: '/usr/local/bin/claude-zai',
      },
      {},
    );

    expect(target.kind).toBe('claude-cli');
    if (target.kind !== 'claude-cli') {
      throw new Error('expected claude-cli target');
    }

    expect(target.config.executable).toBe('/usr/local/bin/claude-zai');
  });

  it('cc-mirror with explicit variant and executable', () => {
    const target = resolveTargetDefinition(
      {
        name: 'my-mirror',
        provider: 'cc-mirror',
        variant: 'claude-zai',
        executable: '/opt/bin/zai',
      },
      {},
    );

    expect(target.kind).toBe('claude-cli');
    if (target.kind !== 'claude-cli') {
      throw new Error('expected claude-cli target');
    }

    expect(target.config.executable).toBe('/opt/bin/zai');
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

  it('resolves copilot-cli with custom_provider openai config', () => {
    const env = {
      OPENAI_ENDPOINT: 'https://api.openai.example/v1',
      OPENAI_API_KEY: 'openai-secret',
      OPTIONAL_BEARER_TOKEN: 'bearer-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-cli-openai',
        provider: 'copilot-cli',
        custom_provider: {
          type: 'openai',
          base_url: '${{ OPENAI_ENDPOINT }}',
          api_key: '${{ OPENAI_API_KEY }}',
          bearer_token: '${{ OPTIONAL_BEARER_TOKEN }}',
          wire_api: 'responses',
          api_version: '2024-10-21',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-cli');
    if (target.kind !== 'copilot-cli') {
      throw new Error('expected copilot-cli target');
    }

    expect(target.config.customProvider).toEqual({
      type: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'openai-secret',
      bearerToken: 'bearer-secret',
      wireApi: 'responses',
      apiVersion: '2024-10-21',
    });
  });

  it('resolves copilot-sdk with byok azure config', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-secret',
      AZURE_DEPLOYMENT_NAME: 'gpt-4o',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-azure',
        provider: 'copilot-sdk',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        byok: {
          type: 'azure',
          base_url: '${{ AZURE_OPENAI_ENDPOINT }}',
          api_key: '${{ AZURE_OPENAI_API_KEY }}',
          api_version: '2024-10-21',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.model).toBe('gpt-4o');
    expect(target.config.byokType).toBe('azure');
    expect(target.config.byokBaseUrl).toBe('https://my-resource.openai.azure.com');
    expect(target.config.byokApiKey).toBe('azure-secret');
    expect(target.config.byokApiVersion).toBe('2024-10-21');
  });

  it('resolves copilot-sdk with byok openai config', () => {
    const env = {
      OPENAI_API_KEY: 'openai-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-openai',
        provider: 'copilot-sdk',
        model: 'gpt-5',
        byok: {
          type: 'openai',
          base_url: 'https://api.openai.com/v1',
          api_key: '${{ OPENAI_API_KEY }}',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.byokType).toBe('openai');
    expect(target.config.byokBaseUrl).toBe('https://api.openai.com/v1');
    expect(target.config.byokApiKey).toBe('openai-secret');
  });

  it('resolves copilot-sdk with custom_provider openai config', () => {
    const env = {
      OPENAI_ENDPOINT: 'https://api.openai.example/v1',
      OPENAI_API_KEY: 'openai-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-openai-custom-provider',
        provider: 'copilot-sdk',
        model: 'gpt-5',
        custom_provider: {
          type: 'openai',
          base_url: '${{ OPENAI_ENDPOINT }}',
          api_key: '${{ OPENAI_API_KEY }}',
          wire_api: 'responses',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.customProvider).toEqual({
      type: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'openai-secret',
      wireApi: 'responses',
    });
    expect(target.config.byokType).toBe('openai');
    expect(target.config.byokBaseUrl).toBe('https://api.openai.example/v1');
    expect(target.config.byokApiKey).toBe('openai-secret');
    expect(target.config.byokWireApi).toBe('responses');
  });

  it('copilot-sdk byok defaults type to undefined when not specified', () => {
    const env = {
      MY_KEY: 'secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-byok-minimal',
        provider: 'copilot-sdk',
        byok: {
          base_url: 'http://localhost:11434/v1',
          api_key: '${{ MY_KEY }}',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.byokType).toBeUndefined();
    expect(target.config.byokBaseUrl).toBe('http://localhost:11434/v1');
    expect(target.config.byokApiKey).toBe('secret');
  });

  it('copilot-sdk byok rejects missing base_url', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'copilot-sdk-no-url',
          provider: 'copilot-sdk',
          byok: {
            type: 'azure',
            api_key: '${{ MY_KEY }}',
          },
        },
        { MY_KEY: 'secret' },
      ),
    ).toThrow(/byok\.base_url.*required/i);
  });

  it('copilot-sdk byok rejects literal api_key', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'copilot-sdk-literal-key',
          provider: 'copilot-sdk',
          byok: {
            base_url: 'https://example.com',
            api_key: 'plaintext-secret',
          },
        },
        {},
      ),
    ).toThrow(/must use.*VARIABLE_NAME/i);
  });

  it('copilot-sdk byok rejects literal bearer_token', () => {
    expect(() =>
      resolveTargetDefinition(
        {
          name: 'copilot-sdk-literal-bearer',
          provider: 'copilot-sdk',
          byok: {
            base_url: 'https://example.com',
            bearer_token: 'plaintext-bearer-secret',
          },
        },
        {},
      ),
    ).toThrow(/must use.*VARIABLE_NAME/i);
  });

  it('copilot-sdk byok supports bearer_token', () => {
    const env = {
      MY_TOKEN: 'bearer-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-bearer',
        provider: 'copilot-sdk',
        byok: {
          base_url: 'https://custom-endpoint.example.com/v1',
          bearer_token: '${{ MY_TOKEN }}',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.byokBearerToken).toBe('bearer-secret');
    expect(target.config.byokApiKey).toBeUndefined();
  });

  it('copilot-sdk byok supports wire_api', () => {
    const env = {
      FOUNDRY_KEY: 'foundry-secret',
    } satisfies Record<string, string>;

    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-responses',
        provider: 'copilot-sdk',
        model: 'gpt-5',
        byok: {
          type: 'openai',
          base_url: 'https://resource.openai.azure.com/openai/v1/',
          api_key: '${{ FOUNDRY_KEY }}',
          wire_api: 'responses',
        },
      },
      env,
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.byokWireApi).toBe('responses');
  });

  it('copilot-sdk without byok has no byok fields', () => {
    const target = resolveTargetDefinition(
      {
        name: 'copilot-sdk-plain',
        provider: 'copilot-sdk',
        model: 'gpt-4o',
      },
      {},
    );

    expect(target.kind).toBe('copilot-sdk');
    if (target.kind !== 'copilot-sdk') {
      throw new Error('expected copilot-sdk target');
    }

    expect(target.config.byokType).toBeUndefined();
    expect(target.config.byokBaseUrl).toBeUndefined();
    expect(target.config.byokApiKey).toBeUndefined();
    expect(target.config.customProvider).toBeUndefined();
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

  it('preserves Azure deployment-scoped OpenAI base URLs', () => {
    const target = resolveTargetDefinition(
      {
        name: 'azure-chat',
        provider: 'openai',
        base_url: 'https://resource.openai.azure.com/openai/deployments/gpt-4o',
        api_key: '${{ AZURE_OPENAI_API_KEY }}',
        model: '${{ AZURE_DEPLOYMENT_NAME }}',
        api_format: 'chat',
      },
      {
        AZURE_OPENAI_API_KEY: 'test-key',
        AZURE_DEPLOYMENT_NAME: 'gpt-4o',
      },
    );

    expect(target.kind).toBe('openai');
    if (target.kind !== 'openai') {
      throw new Error('expected openai target');
    }

    expect(target.config.baseURL).toBe(
      'https://resource.openai.azure.com/openai/deployments/gpt-4o',
    );
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
    piCompleteMock.mockClear();
    piGetModelMock.mockClear();
  });

  it('routes openai targets through pi-ai openai-completions', async () => {
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

    expect(piGetModelMock).toHaveBeenCalledWith('openai', 'gpt-5.4');
    expect(piCompleteMock).toHaveBeenCalledTimes(1);
    expect(extractLastAssistantContent(response.output)).toBe('ok');
  });

  it('routes openai targets with apiFormat=responses through pi-ai openai-responses', async () => {
    const env = {
      OPENAI_ENDPOINT: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'k',
      OPENAI_MODEL: 'gpt-5',
    } satisfies Record<string, string>;
    const resolved = resolveTargetDefinition(
      {
        name: 'openai-resp',
        provider: 'openai',
        endpoint: '${{ OPENAI_ENDPOINT }}',
        api_key: '${{ OPENAI_API_KEY }}',
        model: '${{ OPENAI_MODEL }}',
        api_format: 'responses',
      },
      env,
    );
    const provider = createProvider(resolved);
    await provider.invoke({ question: 'Hello' });
    // The model passed to pi-ai's complete() should carry api='openai-responses'
    const modelArg = piCompleteMock.mock.calls[0]?.[0] as { api: string };
    expect(modelArg.api).toBe('openai-responses');
  });

  it('routes openrouter targets through pi-ai openai-completions with the OpenRouter baseUrl', async () => {
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
    await provider.invoke({ question: 'Hello' });

    expect(piGetModelMock).toHaveBeenCalledWith('openrouter', 'openai/gpt-5-mini');
    const modelArg = piCompleteMock.mock.calls[0]?.[0] as { baseUrl: string };
    expect(modelArg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('routes anthropic targets through pi-ai anthropic-messages and forwards thinkingBudget', async () => {
    const env = {
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-sonnet-4',
    } satisfies Record<string, string>;
    const resolved = resolveTargetDefinition(
      {
        name: 'anthropic-target',
        provider: 'anthropic',
        api_key: '${{ ANTHROPIC_API_KEY }}',
        model: '${{ ANTHROPIC_MODEL }}',
        thinking_budget: 4096,
      },
      env,
    );
    const provider = createProvider(resolved);
    expect(provider.kind).toBe('anthropic');
    await provider.invoke({ question: 'Hello' });

    expect(piGetModelMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4');
    const callOptions = piCompleteMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOptions).toMatchObject({
      thinkingEnabled: true,
      thinkingBudgetTokens: 4096,
    });
  });

  it('routes gemini targets through pi-ai google-generative-ai', async () => {
    const env = { GOOGLE_API_KEY: 'gemini-key' } satisfies Record<string, string>;
    const resolved = resolveTargetDefinition(
      { name: 'gemini-target', provider: 'gemini', api_key: '${{ GOOGLE_API_KEY }}' },
      env,
    );
    const provider = createProvider(resolved);
    expect(provider.kind).toBe('gemini');
    await provider.invoke({ question: 'Hello' });
    expect(piGetModelMock.mock.calls[0]?.[0]).toBe('google');
  });

  it('routes azure targets through pi-ai azure-openai-responses and forwards azureBaseUrl', async () => {
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
    await provider.invoke({ question: 'Hello' });

    expect(piGetModelMock).toHaveBeenCalledWith('azure-openai-responses', 'gpt-4o');
    const callOptions = piCompleteMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOptions).toMatchObject({
      azureBaseUrl: 'https://example.openai.azure.com/openai/v1',
    });
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

  it('resolves pi-coding-agent thinking level from target config', () => {
    const resolved = resolveTargetDefinition(
      {
        name: 'pi-openai-codex',
        provider: 'pi-coding-agent',
        subprovider: 'openai-codex',
        model: 'gpt-5.5',
        thinking: 'medium',
      },
      {},
    );

    expect(resolved.kind).toBe('pi-coding-agent');
    if (resolved.kind !== 'pi-coding-agent') throw new Error('expected pi-coding-agent');
    expect(resolved.config.model).toBe('gpt-5.5');
    expect(resolved.config.thinking).toBe('medium');
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

  it('resolves pi-cli thinking level from env-backed config', () => {
    const resolved = resolveTargetDefinition(
      {
        name: 'pi-cli-openai-codex',
        provider: 'pi-cli',
        subprovider: 'openai-codex',
        model: 'gpt-5.5',
        thinking: '${{ PI_THINKING }}',
      },
      { PI_THINKING: 'medium' },
    );

    expect(resolved.kind).toBe('pi-cli');
    if (resolved.kind !== 'pi-cli') throw new Error('expected pi-cli');
    expect(resolved.config.model).toBe('gpt-5.5');
    expect(resolved.config.thinking).toBe('medium');
  });
});
