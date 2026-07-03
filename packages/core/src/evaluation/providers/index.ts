import { AgentvProvider } from './agentv-provider.js';
import { ClaudeCliProvider } from './claude-cli.js';
import { CliProvider } from './cli.js';
import { CodexCliProvider } from './codex-cli.js';
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
import { ProviderRegistry } from './provider-registry.js';
import { ReplayProvider } from './replay.js';
import { SdkChildProvider } from './sdk-child-provider.js';
import type { ResolvedTarget } from './targets.js';
import {
  COMMON_TARGET_SETTINGS,
  resolveDelegatedTargetDefinition,
  resolveTargetDefinition,
} from './targets.js';
import type { EnvLookup, Provider, TargetDefinition } from './types.js';
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
    .register('cli', (t) => new CliProvider(t.name, t.config as never))
    .register('codex', (t) => new CodexCliProvider(t.name, t.config as never))
    .register('codex-cli', (t) => new CodexCliProvider(t.name, t.config as never))
    .register('codex-sdk', (t) => new SdkChildProvider('codex-sdk', t.name, t.config))
    .register('copilot-sdk', (t) => new SdkChildProvider('copilot-sdk', t.name, t.config))
    .register('copilot-cli', (t) => new CopilotCliProvider(t.name, t.config as never))
    .register('copilot-log', (t) => new CopilotLogProvider(t.name, t.config as never))
    .register('pi-sdk', (t) => new SdkChildProvider('pi-sdk', t.name, t.config))
    .register('pi-coding-agent', (t) => new SdkChildProvider('pi-sdk', t.name, t.config))
    .register('pi-cli', (t) => new PiCliProvider(t.name, t.config as never))
    // claude-cli is the new default subprocess provider; claude is an alias
    .register('claude-cli', (t) => new ClaudeCliProvider(t.name, t.config as never))
    .register('claude', (t) => new ClaudeCliProvider(t.name, t.config as never))
    // Explicit SDK providers are isolated behind an AgentV child runner.
    .register('claude-sdk', (t) => new SdkChildProvider('claude-sdk', t.name, t.config))
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
