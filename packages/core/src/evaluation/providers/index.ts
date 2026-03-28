import { AgentvProvider } from './agentv-provider.js';
import {
  AnthropicProvider,
  AzureProvider,
  GeminiProvider,
  OpenAIProvider,
  OpenRouterProvider,
} from './ai-sdk.js';
import { ClaudeCliProvider } from './claude-cli.js';
import { ClaudeSdkProvider } from './claude-sdk.js';
import { ClaudeProvider } from './claude.js';
import { CliProvider } from './cli.js';
import { CodexProvider } from './codex.js';
import { CopilotCliProvider } from './copilot-cli.js';
import { CopilotLogProvider } from './copilot-log.js';
import { CopilotSdkProvider } from './copilot-sdk.js';
import { MockProvider } from './mock.js';
import { PiCliProvider } from './pi-cli.js';
import { PiCodingAgentProvider } from './pi-coding-agent.js';
import { ProviderRegistry } from './provider-registry.js';
import type { ResolvedTarget } from './targets.js';
import { COMMON_TARGET_SETTINGS, resolveTargetDefinition } from './targets.js';
import type { EnvLookup, Provider, TargetDefinition } from './types.js';
import { VSCodeProvider } from './vscode-provider.js';

export type {
  EnvLookup,
  Message,
  OutputMessage,
  Provider,
  ProviderKind,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamCallbacks,
  ProviderTokenUsage,
  TargetDefinition,
  ToolCall,
} from './types.js';

export type {
  AgentVResolvedConfig,
  AnthropicResolvedConfig,
  AzureResolvedConfig,
  ClaudeResolvedConfig,
  CliResolvedConfig,
  CopilotCliResolvedConfig,
  CopilotLogResolvedConfig,
  CopilotSdkResolvedConfig,
  GeminiResolvedConfig,
  MockResolvedConfig,
  OpenAIResolvedConfig,
  OpenRouterResolvedConfig,
  PiCliResolvedConfig,
  PiCodingAgentResolvedConfig,
  ResolvedTarget,
  VSCodeResolvedConfig,
} from './targets.js';

export { COMMON_TARGET_SETTINGS, resolveTargetDefinition };
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
    .register('codex', (t) => new CodexProvider(t.name, t.config as never))
    .register('copilot-sdk', (t) => new CopilotSdkProvider(t.name, t.config as never))
    .register('copilot-cli', (t) => new CopilotCliProvider(t.name, t.config as never))
    .register('copilot-log', (t) => new CopilotLogProvider(t.name, t.config as never))
    .register('pi-coding-agent', (t) => new PiCodingAgentProvider(t.name, t.config as never))
    .register('pi-cli', (t) => new PiCliProvider(t.name, t.config as never))
    // claude-cli is the new default subprocess provider; claude is an alias
    .register('claude-cli', (t) => new ClaudeCliProvider(t.name, t.config as never))
    .register('claude', (t) => new ClaudeCliProvider(t.name, t.config as never))
    // claude-sdk is the explicit SDK provider (requires @anthropic-ai/claude-agent-sdk)
    .register('claude-sdk', (t) => new ClaudeSdkProvider(t.name, t.config as never))
    .register('mock', (t) => new MockProvider(t.name, t.config as never))
    .register('agentv', (t) => new AgentvProvider(t.name, t.config as never))
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
