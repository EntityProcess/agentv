import { AnthropicProvider, AzureProvider, GeminiProvider } from './ai-sdk.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { CliProvider } from './cli.js';
import { CodexProvider } from './codex.js';
import { CopilotCliProvider } from './copilot-cli.js';
import { MockProvider } from './mock.js';
import { PiAgentSdkProvider } from './pi-agent-sdk.js';
import { PiCodingAgentProvider } from './pi-coding-agent.js';
import type { ResolvedTarget } from './targets.js';
import { resolveTargetDefinition } from './targets.js';
import type { EnvLookup, Provider, TargetDefinition } from './types.js';
import { VSCodeProvider } from './vscode-provider.js';

export type {
  EnvLookup,
  Provider,
  ProviderKind,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
  TargetDefinition,
} from './types.js';

export type {
  AnthropicResolvedConfig,
  AzureResolvedConfig,
  ClaudeCodeResolvedConfig,
  CliResolvedConfig,
  CopilotResolvedConfig,
  GeminiResolvedConfig,
  MockResolvedConfig,
  PiAgentSdkResolvedConfig,
  PiCodingAgentResolvedConfig,
  ResolvedTarget,
  VSCodeResolvedConfig,
} from './targets.js';

export { resolveTargetDefinition };
export { readTargetDefinitions, listTargetNames } from './targets-file.js';
export {
  ensureVSCodeSubagents,
  type EnsureSubagentsOptions,
  type EnsureSubagentsResult,
} from './vscode-provider.js';
export { consumeCodexLogEntries, subscribeToCodexLogEntries } from './codex-log-tracker.js';
export { consumePiLogEntries, subscribeToPiLogEntries } from './pi-log-tracker.js';
export {
  consumeClaudeCodeLogEntries,
  subscribeToClaudeCodeLogEntries,
} from './claude-code-log-tracker.js';
export {
  consumeCopilotCliLogEntries,
  subscribeToCopilotCliLogEntries,
} from './copilot-cli-log-tracker.js';

export function createProvider(target: ResolvedTarget): Provider {
  switch (target.kind) {
    case 'azure':
      return new AzureProvider(target.name, target.config);
    case 'anthropic':
      return new AnthropicProvider(target.name, target.config);
    case 'gemini':
      return new GeminiProvider(target.name, target.config);
    case 'cli':
      return new CliProvider(target.name, target.config);
    case 'codex':
      return new CodexProvider(target.name, target.config);
    case 'copilot-cli':
      return new CopilotCliProvider(target.name, target.config);
    case 'pi-coding-agent':
      return new PiCodingAgentProvider(target.name, target.config);
    case 'pi-agent-sdk':
      return new PiAgentSdkProvider(target.name, target.config);
    case 'claude-code':
      return new ClaudeCodeProvider(target.name, target.config);
    case 'mock':
      return new MockProvider(target.name, target.config);
    case 'vscode':
    case 'vscode-insiders':
      return new VSCodeProvider(target.name, target.config, target.kind);
    default: {
      // Exhaustive check
      const neverTarget: never = target;
      throw new Error(`Unsupported provider kind ${(neverTarget as { kind: string }).kind}`);
    }
  }
}

export function resolveAndCreateProvider(
  definition: TargetDefinition,
  env: EnvLookup = process.env,
): Provider {
  const resolved = resolveTargetDefinition(definition, env);
  return createProvider(resolved);
}
