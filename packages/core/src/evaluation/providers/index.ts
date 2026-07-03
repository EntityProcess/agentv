import { AgentvProvider } from './agentv-provider.js';
import { ClaudeCliProvider } from './claude-cli.js';
import { CliProvider } from './cli.js';
import { CodexAppServerProvider, CodexCliProvider } from './codex-cli.js';
import { CopilotCliProvider } from './copilot-cli.js';
import { CopilotLogProvider } from './copilot-log.js';
import {
  AnthropicProvider,
  AzureProvider,
  GeminiProvider,
  OpenAIProvider,
  OpenRouterProvider,
} from './llm-providers.js';
import { MockProvider } from './mock.js';
import { PiCliProvider } from './pi-cli.js';
import { PiRpcProvider } from './pi-rpc.js';
import { ProviderRegistry } from './provider-registry.js';
import { ReplayProvider } from './replay.js';
import { SdkChildProvider } from './sdk-child-provider.js';
import type { ResolvedTarget } from './targets.js';
import {
  COMMON_TARGET_SETTINGS,
  resolveDelegatedTargetDefinition,
  resolveTargetDefinition,
} from './targets.js';
import type {
  EnvLookup,
  Provider,
  ProviderKind,
  ProviderRequest,
  ProviderResponse,
  TargetDefinition,
} from './types.js';
import { VSCodeProvider } from './vscode-provider.js';

export type {
  EnvLookup,
  Message,
  Provider,
  ProviderKind,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamCallbacks,
  ProviderTokenUsage,
  TargetDefinition,
  ToolCall,
} from './types.js';

export { extractLastAssistantContent } from './types.js';

export type {
  AgentVResolvedConfig,
  AnthropicResolvedConfig,
  ApiFormat,
  AzureResolvedConfig,
  ClaudeResolvedConfig,
  CliResolvedConfig,
  CopilotCliResolvedConfig,
  CopilotCustomProviderConfig,
  CopilotLogResolvedConfig,
  CopilotSdkResolvedConfig,
  GeminiResolvedConfig,
  MockResolvedConfig,
  OpenAIResolvedConfig,
  OpenRouterResolvedConfig,
  PiCliResolvedConfig,
  PiCodingAgentResolvedConfig,
  PiRpcResolvedConfig,
  ReplayResolvedConfig,
  ReplayResolvedSource,
  ResolvedTarget,
  VSCodeResolvedConfig,
} from './targets.js';

export { COMMON_TARGET_SETTINGS, resolveDelegatedTargetDefinition, resolveTargetDefinition };
export { readTargetDefinitions, listTargetNames } from './targets-file.js';
export {
  ensureVSCodeSubagents,
  type EnsureSubagentsOptions,
  type EnsureSubagentsResult,
} from './vscode-provider.js';
export { consumeCodexLogEntries, subscribeToCodexLogEntries } from './codex-log-tracker.js';
export { consumePiLogEntries, subscribeToPiLogEntries } from './pi-log-tracker.js';
export {
  consumeClaudeLogEntries,
  subscribeToClaudeLogEntries,
} from './claude-log-tracker.js';
export {
  consumeCopilotSdkLogEntries,
  subscribeToCopilotSdkLogEntries,
} from './copilot-sdk-log-tracker.js';
export {
  consumeCopilotCliLogEntries,
  subscribeToCopilotCliLogEntries,
} from './copilot-cli-log-tracker.js';

export {
  ProviderRegistry,
  type ProviderFactoryFn,
} from './provider-registry.js';

export { discoverProviders } from './provider-discovery.js';
export { discoverCopilotSessions, type CopilotSession } from './copilot-session-discovery.js';
export { ReplayProvider } from './replay.js';

class UnsupportedSandboxProvider implements Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly targetName: string;

  constructor(
    private readonly providerKind: ProviderKind,
    targetName: string,
    private readonly message: string,
  ) {
    this.kind = providerKind;
    this.targetName = targetName;
    this.id = `${providerKind}:${targetName}`;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    const now = Date.now();
    const content = `Error: ${this.message}`;
    return {
      output: [{ role: 'assistant', content }],
      durationMs: 0,
      raw: {
        error: this.message,
        unsupported_provider: this.providerKind,
        runtime_mode: 'sandbox',
      },
      targetExecution: {
        schemaVersion: 'agentv.target_execution.v1',
        status: 'error',
        targetId: this.targetName,
        providerId: this.id,
        providerKind: this.providerKind,
        runtimeMode: 'sandbox',
        startedAt: new Date(now).toISOString(),
        endedAt: new Date(now).toISOString(),
        durationMs: 0,
        errorKind: 'sandbox_infra_failure',
        message: this.message,
        logs: {
          stdout: { text: '', truncated: false, bytes: 0, storedBytes: 0 },
          stderr: {
            text: this.message,
            truncated: false,
            bytes: Buffer.byteLength(this.message, 'utf8'),
            storedBytes: Buffer.byteLength(this.message, 'utf8'),
          },
        },
        transcript: {
          messages: [{ role: 'assistant', content }],
          finalOutput: content,
        },
        details: {
          unsupported_provider: this.providerKind,
          supported_sandbox_provider: 'cli',
        },
      },
    };
  }
}

function usesSandboxRuntime(target: ResolvedTarget): boolean {
  return target.runtime?.mode === 'sandbox';
}

function unsupportedSandboxProvider(target: ResolvedTarget): Provider {
  return new UnsupportedSandboxProvider(
    target.kind as ProviderKind,
    target.name,
    `runtime.mode: sandbox is not implemented for provider '${target.kind}' yet. Use provider: cli with an explicit sandbox runtime and config.command, or switch this target to runtime: host/profile until this provider has a sandbox-aware runner.`,
  );
}

/**
 * Create and return the default provider registry with all built-in providers.
 */
export function createBuiltinProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  registry
    .register('openai', (t) => new OpenAIProvider(t.name, t.config as never))
    .register('openrouter', (t) => new OpenRouterProvider(t.name, t.config as never))
    .register('azure', (t) => new AzureProvider(t.name, t.config as never))
    .register('anthropic', (t) => new AnthropicProvider(t.name, t.config as never))
    .register('gemini', (t) => new GeminiProvider(t.name, t.config as never))
    .register('cli', (t) => new CliProvider(t.name, t.config as never, undefined, t.runtime))
    .register('codex-cli', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new CodexCliProvider(t.name, t.config as never),
    )
    .register('codex-app-server', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new CodexAppServerProvider(t.name, t.config as never),
    )
    .register('codex-sdk', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new SdkChildProvider('codex-sdk', t.name, t.config),
    )
    .register('copilot-sdk', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new SdkChildProvider('copilot-sdk', t.name, t.config),
    )
    .register('copilot-cli', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new CopilotCliProvider(t.name, t.config as never),
    )
    .register('copilot-log', (t) => new CopilotLogProvider(t.name, t.config as never))
    .register('pi-sdk', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new SdkChildProvider('pi-sdk', t.name, t.config),
    )
    .register('pi-coding-agent', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new SdkChildProvider('pi-sdk', t.name, t.config),
    )
    .register('pi-cli', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new PiCliProvider(t.name, t.config as never),
    )
    .register('pi-rpc', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new PiRpcProvider(t.name, t.config as never),
    )
    .register('claude-cli', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new ClaudeCliProvider(t.name, t.config as never),
    )
    // Explicit SDK providers are isolated behind an AgentV child runner.
    .register('claude-sdk', (t) =>
      usesSandboxRuntime(t)
        ? unsupportedSandboxProvider(t)
        : new SdkChildProvider('claude-sdk', t.name, t.config),
    )
    .register('mock', (t) => new MockProvider(t.name, t.config as never))
    .register('agentv', (t) => new AgentvProvider(t.name, t.config as never))
    .register('replay', (t) => new ReplayProvider(t.name, t.config as never))
    .register('vscode', (t) => new VSCodeProvider(t.name, t.config as never, 'vscode'))
    .register(
      'vscode-insiders',
      (t) => new VSCodeProvider(t.name, t.config as never, 'vscode-insiders'),
    );

  return registry;
}

/** Singleton registry instance used by createProvider(). */
const defaultProviderRegistry = createBuiltinProviderRegistry();

/**
 * Create a provider from a resolved target using the default registry.
 * Custom providers can be registered via `createBuiltinProviderRegistry().register()`.
 */
export function createProvider(target: ResolvedTarget): Provider {
  return defaultProviderRegistry.create(target);
}

export function resolveAndCreateProvider(
  definition: TargetDefinition,
  env: EnvLookup = process.env,
): Provider {
  const resolved = resolveTargetDefinition(definition, env);
  return createProvider(resolved);
}
