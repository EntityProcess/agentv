import type { JsonObject } from "../types.js";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool" | "function";

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly name?: string;
}

export type ChatPrompt = readonly ChatMessage[];

export type ProviderKind =
  | "azure"
  | "anthropic"
  | "gemini"
  | "codex"
  | "cli"
  | "mock"
  | "vscode"
  | "vscode-insiders";

/**
 * Agent providers that have filesystem access and don't need unwrapped guidelines.
 * These providers read files directly from the filesystem using file:// URIs.
 */
export const AGENT_PROVIDER_KINDS: readonly ProviderKind[] = [
  "codex",
  "vscode",
  "vscode-insiders",
] as const;

/**
 * List of all supported provider kinds.
 * This is the source of truth for provider validation.
 */
export const KNOWN_PROVIDERS: readonly ProviderKind[] = [
  "azure",
  "anthropic",
  "gemini",
  "codex",
  "cli",
  "mock",
  "vscode",
  "vscode-insiders",
] as const;

/**
 * Provider aliases that are accepted in target definitions.
 * These map to the canonical ProviderKind values.
 */
export const PROVIDER_ALIASES: readonly string[] = [
  "azure-openai", // alias for "azure"
  "google", // alias for "gemini"
  "google-gemini", // alias for "gemini"
  "codex-cli", // alias for "codex"
  "openai", // legacy/future support
  "bedrock", // legacy/future support
  "vertex", // legacy/future support
] as const;

/**
 * Schema identifier for targets.yaml files (version 2).
 */
export const TARGETS_SCHEMA_V2 = "agentv-targets-v2.2";

export interface ProviderRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly guidelines?: string;
  readonly guideline_patterns?: readonly string[];
  readonly chatPrompt?: ChatPrompt;
  readonly inputFiles?: readonly string[];
  readonly evalCaseId?: string;
  readonly attempt?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly metadata?: JsonObject;
  readonly signal?: AbortSignal;
}

export interface ProviderResponse {
  readonly text: string;
  readonly reasoning?: string;
  readonly raw?: unknown;
  readonly usage?: JsonObject;
}

/**
 * Type guard to check if a provider is an agent provider with filesystem access.
 * Agent providers read files directly and don't need unwrapped guideline content.
 */
export function isAgentProvider(provider: Provider | undefined): boolean {
  return provider ? AGENT_PROVIDER_KINDS.includes(provider.kind) : false;
}

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly targetName: string;
  invoke(request: ProviderRequest): Promise<ProviderResponse>;
  /**
   * Optional capability marker for provider-managed batching (single session handling multiple requests).
   */
  readonly supportsBatch?: boolean;
  /**
   * Optional batch invocation hook. When defined alongside supportsBatch=true,
   * the orchestrator may send multiple requests in a single provider session.
   */
  invokeBatch?(requests: readonly ProviderRequest[]): Promise<readonly ProviderResponse[]>;
}

export type EnvLookup = Readonly<Record<string, string | undefined>>;

export interface TargetDefinition {
  readonly name: string;
  readonly provider: ProviderKind | string;
  readonly judge_target?: string | undefined;
  readonly workers?: number | undefined;
  // Provider batching
  readonly provider_batching?: boolean | undefined;
  readonly providerBatching?: boolean | undefined;
  // Azure fields
  readonly endpoint?: string | unknown | undefined;
  readonly resource?: string | unknown | undefined;
  readonly resourceName?: string | unknown | undefined;
  readonly api_key?: string | unknown | undefined;
  readonly apiKey?: string | unknown | undefined;
  readonly deployment?: string | unknown | undefined;
  readonly deploymentName?: string | unknown | undefined;
  readonly model?: string | unknown | undefined;
  readonly version?: string | unknown | undefined;
  readonly api_version?: string | unknown | undefined;
  // Anthropic fields
  readonly variant?: string | unknown | undefined;
  readonly thinking_budget?: number | unknown | undefined;
  readonly thinkingBudget?: number | unknown | undefined;
  // Common fields
  readonly temperature?: number | unknown | undefined;
  readonly max_output_tokens?: number | unknown | undefined;
  readonly maxTokens?: number | unknown | undefined;
  // Codex fields
  readonly executable?: string | unknown | undefined;
  readonly command?: string | unknown | undefined;
  readonly binary?: string | unknown | undefined;
  readonly args?: unknown | undefined;
  readonly arguments?: unknown | undefined;
  readonly cwd?: string | unknown | undefined;
  readonly timeout_seconds?: number | unknown | undefined;
  readonly timeoutSeconds?: number | unknown | undefined;
  readonly log_dir?: string | unknown | undefined;
  readonly logDir?: string | unknown | undefined;
  readonly log_directory?: string | unknown | undefined;
  readonly logDirectory?: string | unknown | undefined;
  readonly log_format?: string | unknown | undefined;
  readonly logFormat?: string | unknown | undefined;
  readonly log_output_format?: string | unknown | undefined;
  readonly logOutputFormat?: string | unknown | undefined;
  // Mock fields
  readonly response?: string | unknown | undefined;
  readonly delayMs?: number | unknown | undefined;
  readonly delayMinMs?: number | unknown | undefined;
  readonly delayMaxMs?: number | unknown | undefined;
  // VSCode fields
  readonly vscode_cmd?: string | unknown | undefined;
  readonly wait?: boolean | unknown | undefined;
  readonly dry_run?: boolean | unknown | undefined;
  readonly dryRun?: boolean | unknown | undefined;
  readonly subagent_root?: string | unknown | undefined;
  readonly subagentRoot?: string | unknown | undefined;
  readonly workspace_template?: string | unknown | undefined;
  readonly workspaceTemplate?: string | unknown | undefined;
  // CLI fields
  readonly command_template?: string | unknown | undefined;
  readonly commandTemplate?: string | unknown | undefined;
  readonly files_format?: string | unknown | undefined;
  readonly filesFormat?: string | unknown | undefined;
  readonly attachments_format?: string | unknown | undefined;
  readonly attachmentsFormat?: string | unknown | undefined;
  readonly env?: unknown | undefined;
  readonly healthcheck?: unknown | undefined;
  // Retry configuration fields
  readonly max_retries?: number | unknown | undefined;
  readonly maxRetries?: number | unknown | undefined;
  readonly retry_initial_delay_ms?: number | unknown | undefined;
  readonly retryInitialDelayMs?: number | unknown | undefined;
  readonly retry_max_delay_ms?: number | unknown | undefined;
  readonly retryMaxDelayMs?: number | unknown | undefined;
  readonly retry_backoff_factor?: number | unknown | undefined;
  readonly retryBackoffFactor?: number | unknown | undefined;
  readonly retry_status_codes?: unknown | undefined;
  readonly retryStatusCodes?: unknown | undefined;
}
