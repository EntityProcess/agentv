import type { Content } from '../content.js';
import { getTextContent, isContentArray } from '../content.js';
import type { JsonObject } from '../types.js';

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly name?: string;
}

export type ChatPrompt = readonly ChatMessage[];

export type ProviderKind =
  | 'openai'
  | 'openrouter'
  | 'azure'
  | 'anthropic'
  | 'gemini'
  | 'codex'
  | 'copilot-sdk'
  | 'copilot-cli'
  | 'copilot-log'
  | 'pi-coding-agent'
  | 'pi-cli'
  | 'claude'
  | 'claude-cli'
  | 'claude-sdk'
  | 'cli'
  | 'mock'
  | 'vscode'
  | 'vscode-insiders'
  | 'agentv'
  | 'transcript';

/**
 * Agent providers that spawn interactive sessions with filesystem access.
 * These providers read files directly from the filesystem using file:// URIs.
 *
 * Note: copilot-log is intentionally excluded — it is a passive transcript
 * reader, not an interactive agent. This allows deterministic-only evals
 * (e.g., skill-trigger) to run without a grader_target or LLM API key.
 */
export const AGENT_PROVIDER_KINDS: readonly ProviderKind[] = [
  'codex',
  'copilot-sdk',
  'copilot-cli',
  'pi-coding-agent',
  'pi-cli',
  'claude',
  'claude-cli',
  'claude-sdk',
  'vscode',
  'vscode-insiders',
] as const;

/**
 * Provider kinds that can return structured JSON for LLM grading.
 * Used by the orchestrator to decide whether a target can double as its own
 * grader when no explicit grader_target is configured.
 *
 * Providers NOT in this list (agent providers, transcript, cli, copilot-log)
 * cannot produce grader responses and should not be used as graders.
 */
export const LLM_GRADER_CAPABLE_KINDS: readonly ProviderKind[] = [
  'openai',
  'openrouter',
  'azure',
  'anthropic',
  'gemini',
  'agentv',
  'mock',
] as const;

/**
 * List of all supported provider kinds.
 * This is the source of truth for provider validation.
 */
export const KNOWN_PROVIDERS: readonly ProviderKind[] = [
  'openai',
  'openrouter',
  'azure',
  'anthropic',
  'gemini',
  'codex',
  'copilot-sdk',
  'copilot-cli',
  'copilot-log',
  'pi-coding-agent',
  'pi-cli',
  'claude',
  'claude-cli',
  'claude-sdk',
  'cli',
  'mock',
  'vscode',
  'vscode-insiders',
  'agentv',
  'transcript',
] as const;

/**
 * Provider aliases that are accepted in target definitions.
 * These map to the canonical ProviderKind values.
 */
export const PROVIDER_ALIASES: readonly string[] = [
  'azure-openai', // alias for "azure"
  'google', // alias for "gemini"
  'google-gemini', // alias for "gemini"
  'codex-cli', // alias for "codex"
  'copilot', // alias for "copilot-cli" (default copilot experience)
  'copilot_sdk', // alias for "copilot-sdk" (underscore variant)

  'pi', // alias for "pi-coding-agent"
  'claude-code', // alias for "claude" (legacy)
  'cc-mirror', // alias for "claude-cli" (auto-discovers binary from ~/.cc-mirror/<variant>/)
  'bedrock', // legacy/future support
  'vertex', // legacy/future support
] as const;

/**
 * Schema identifier for targets.yaml files (version 2).
 */
export const TARGETS_SCHEMA_V2 = 'agentv-targets-v2.2';

/** Callbacks for real-time observability during provider execution */
export interface ProviderStreamCallbacks {
  onToolCallStart?: (toolName: string, toolCallId?: string) => void;
  onToolCallEnd?: (
    toolName: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    toolCallId?: string,
  ) => void;
  onLlmCallEnd?: (model: string, tokenUsage?: ProviderTokenUsage) => void;
  /** Returns active OTel span IDs for Braintrust trace bridging (optional) */
  getActiveSpanIds?: () => { parentSpanId: string; rootSpanId: string } | null;
}

export interface ProviderRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly chatPrompt?: ChatPrompt;
  readonly inputFiles?: readonly string[];
  readonly evalCaseId?: string;
  readonly attempt?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly metadata?: JsonObject;
  readonly signal?: AbortSignal;
  /** Working directory override (e.g., from workspace_template) */
  readonly cwd?: string;
  /** VS Code .code-workspace file (resolved from workspace.template) */
  readonly workspaceFile?: string;
  /** When true, AgentV captures file changes from workspace — provider should skip forced diff prompt */
  readonly captureFileChanges?: boolean;
  /** Real-time observability callbacks (optional) */
  readonly streamCallbacks?: ProviderStreamCallbacks;
  /** Braintrust span IDs for trace-claude-code plugin (optional) */
  readonly braintrustSpanIds?: { readonly parentSpanId: string; readonly rootSpanId: string };
}

/**
 * A tool call within an output message.
 * Represents a single tool invocation with its input and optional output.
 */
export interface ToolCall {
  /** Tool name */
  readonly tool: string;
  /** Tool input arguments */
  readonly input?: unknown;
  /** Tool output result */
  readonly output?: unknown;
  /** Stable identifier for pairing tool calls */
  readonly id?: string;
  /** ISO 8601 timestamp when the tool call started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when the tool call ended */
  readonly endTime?: string;
  /** Duration of the tool call in milliseconds */
  readonly durationMs?: number;
}

/**
 * An output message from agent execution.
 * Represents a single message in the conversation with optional tool calls.
 */
export interface Message {
  /** Message role (e.g., 'assistant', 'user', 'tool') */
  readonly role: string;
  /** Optional name for the message sender */
  readonly name?: string;
  /** Message content — plain string or structured content blocks for multimodal data. */
  readonly content?: string | Content[];
  /** Tool calls made in this message */
  readonly toolCalls?: readonly ToolCall[];
  /** ISO 8601 timestamp when the message started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when the message ended */
  readonly endTime?: string;
  /** Duration of the message in milliseconds */
  readonly durationMs?: number;
  /** Provider-specific metadata */
  readonly metadata?: Record<string, unknown>;
  /** Per-message token usage metrics (optional) */
  readonly tokenUsage?: ProviderTokenUsage;
}

/** @deprecated Use Message instead */
export type OutputMessage = Message;

/**
 * Token usage metrics reported by provider.
 */
export interface ProviderTokenUsage {
  /** Input/prompt tokens consumed */
  readonly input: number;
  /** Output/completion tokens generated */
  readonly output: number;
  /** Cached tokens (optional, provider-specific) */
  readonly cached?: number;
  /** Reasoning/thinking tokens (optional, provider-specific) */
  readonly reasoning?: number;
}

export interface ProviderResponse {
  readonly raw?: unknown;
  readonly usage?: JsonObject;
  /** Output messages from agent execution (primary source for tool trajectory) */
  readonly output?: readonly Message[];
  /** Token usage metrics (optional) */
  readonly tokenUsage?: ProviderTokenUsage;
  /** Total cost in USD (optional) */
  readonly costUsd?: number;
  /** Execution duration in milliseconds (optional) */
  readonly durationMs?: number;
  /** ISO 8601 timestamp when execution started (optional) */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended (optional) */
  readonly endTime?: string;
  /**
   * Synthetic unified diff of files generated by the provider outside the
   * eval workspace_path (e.g. copilot session-state artifacts in
   * `~/.copilot/session-state/<uuid>/files/`).
   *
   * When set, the orchestrator merges this into `file_changes` so that LLM
   * and code graders can inspect agent-generated artifacts even when they are
   * written to a path agentv does not track via git or snapshot.
   */
  readonly fileChanges?: string;
}

/**
 * Extract the content from the last assistant message in an output message array.
 * Returns empty string if no assistant message found.
 *
 * Handles both plain-string content and Content[] (extracts text blocks).
 */
export function extractLastAssistantContent(messages: readonly Message[] | undefined): string {
  if (!messages || messages.length === 0) {
    return '';
  }

  // Find the last assistant message (reverse search)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content !== undefined) {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (isContentArray(msg.content)) {
        return getTextContent(msg.content);
      }
      return JSON.stringify(msg.content);
    }
  }

  return '';
}

/**
 * Type guard to check if a provider is an agent provider with filesystem access.
 * Agent providers read files directly from the filesystem.
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
  /**
   * Optional method to get a Vercel AI SDK LanguageModel instance for structured output generation.
   * Used by evaluators that need generateObject/generateText from the AI SDK.
   */
  asLanguageModel?(): import('ai').LanguageModel;
}

export type EnvLookup = Readonly<Record<string, string | undefined>>;

export interface TargetDefinition {
  readonly name: string;
  readonly provider?: ProviderKind | string;
  // Delegation: resolve this target as another named target.
  // Supports ${{ ENV_VAR }} syntax (e.g., use_target: ${{ AGENT_TARGET }}).
  readonly use_target?: string | unknown | undefined;
  readonly grader_target?: string | undefined;
  /** @deprecated Use `grader_target` instead */
  readonly judge_target?: string | undefined;
  readonly workers?: number | undefined;
  // Provider batching
  readonly provider_batching?: boolean | undefined;
  readonly subagent_mode_allowed?: boolean | undefined;
  // Azure fields
  readonly endpoint?: string | unknown | undefined;
  readonly base_url?: string | unknown | undefined;
  readonly resource?: string | unknown | undefined;
  readonly api_key?: string | unknown | undefined;
  readonly deployment?: string | unknown | undefined;
  readonly model?: string | unknown | undefined;
  readonly version?: string | unknown | undefined;
  readonly api_version?: string | unknown | undefined;
  // Anthropic fields
  readonly variant?: string | unknown | undefined;
  readonly thinking_budget?: number | unknown | undefined;
  // Common fields
  readonly temperature?: number | unknown | undefined;
  readonly max_output_tokens?: number | unknown | undefined;
  // Codex fields
  readonly executable?: string | unknown | undefined;
  readonly command?: string | unknown | undefined;
  readonly binary?: string | unknown | undefined;
  readonly args?: unknown | undefined;
  readonly arguments?: unknown | undefined;
  readonly cwd?: string | unknown | undefined;
  readonly timeout_seconds?: number | unknown | undefined;
  readonly log_dir?: string | unknown | undefined;
  readonly log_directory?: string | unknown | undefined;
  readonly log_format?: string | unknown | undefined;
  readonly log_output_format?: string | unknown | undefined;
  /** New stream_log field — replaces log_format. false=no stream log, 'raw'=per-event, 'summary'=consolidated. */
  readonly stream_log?: string | boolean | unknown | undefined;
  // System prompt (codex, copilot, claude, pi-coding-agent)
  readonly system_prompt?: string | unknown | undefined;
  // Claude Agent SDK fields
  readonly max_turns?: number | unknown | undefined;
  readonly max_budget_usd?: number | unknown | undefined;
  // Mock fields
  readonly response?: string | unknown | undefined;
  // VSCode fields
  readonly wait?: boolean | unknown | undefined;
  readonly dry_run?: boolean | unknown | undefined;
  readonly subagent_root?: string | unknown | undefined;
  readonly workspace_template?: string | unknown | undefined;
  // CLI fields
  readonly files_format?: string | unknown | undefined;
  readonly attachments_format?: string | unknown | undefined;
  readonly env?: unknown | undefined;
  readonly healthcheck?: unknown | undefined;
  // Copilot-log fields
  readonly session_dir?: string | unknown | undefined;
  readonly session_id?: string | unknown | undefined;
  readonly discover?: string | unknown | undefined;
  readonly session_state_dir?: string | unknown | undefined;
  // Copilot SDK fields
  readonly cli_url?: string | unknown | undefined;
  readonly cli_path?: string | unknown | undefined;
  readonly github_token?: string | unknown | undefined;
  // Copilot SDK BYOK (Bring Your Own Key) — routes through a user-provided endpoint
  readonly byok?: Record<string, unknown> | undefined;
  // Retry configuration fields
  readonly max_retries?: number | unknown | undefined;
  readonly retry_initial_delay_ms?: number | unknown | undefined;
  readonly retry_max_delay_ms?: number | unknown | undefined;
  readonly retry_backoff_factor?: number | unknown | undefined;
  readonly retry_status_codes?: unknown | undefined;
  // Fallback targets for provider errors
  readonly fallback_targets?: readonly string[] | unknown | undefined;
}
