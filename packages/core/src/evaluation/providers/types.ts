import type { Content, ContentImage } from '../content.js';
import { getTextContent, isContentArray } from '../content.js';
import type { EnvironmentRecipe } from '../loaders/environment-recipe.js';
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
  | 'codex-cli'
  | 'codex-app-server'
  | 'codex-sdk'
  | 'copilot-sdk'
  | 'copilot-cli'
  | 'pi-sdk'
  | 'pi-coding-agent'
  | 'pi-cli'
  | 'pi-rpc'
  | 'claude-cli'
  | 'claude-sdk'
  | 'cli'
  | 'mock'
  | 'vscode'
  | 'vscode-insiders'
  | 'agentv'
  | 'transcript'
  | 'replay';

/**
 * Agent providers that spawn interactive sessions with filesystem access.
 * These providers read files directly from the filesystem using file:// URIs.
 *
 * Passive transcript replay is handled by provider: replay or --transcript,
 * not by provider-specific log targets.
 */
export const AGENT_PROVIDER_KINDS: readonly ProviderKind[] = [
  'codex-cli',
  'codex-app-server',
  'codex-sdk',
  'copilot-sdk',
  'copilot-cli',
  'pi-sdk',
  'pi-coding-agent',
  'pi-cli',
  'pi-rpc',
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
 * Providers NOT in this list (agent providers, transcript, cli, replay)
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
  'codex-cli',
  'codex-app-server',
  'codex-sdk',
  'copilot-sdk',
  'copilot-cli',
  'pi-sdk',
  'pi-coding-agent',
  'pi-cli',
  'pi-rpc',
  'claude-cli',
  'claude-sdk',
  'cli',
  'mock',
  'vscode',
  'vscode-insiders',
  'agentv',
  'transcript',
  'replay',
] as const;

/**
 * Schema identifier for providers.yaml files (version 2).
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

/**
 * A tool the model may call during multi-step provider execution. Pi-ai-shaped:
 * the parameter shape is JSON Schema (provider-library-neutral wire format),
 * and execute() is invoked by the provider once the model emits a tool call.
 */
export interface ProviderTool {
  /** Tool name as shown to the model. */
  readonly name: string;
  /** Tool description as shown to the model. */
  readonly description: string;
  /** JSON Schema for the tool's input. */
  readonly parameters: JsonObject;
  /**
   * Executes the tool. Receives the parsed input the model produced. Errors
   * are caught and surfaced to the model as tool-error results; the loop
   * continues unless `maxSteps` is reached.
   */
  execute(input: unknown): Promise<unknown> | unknown;
}

export interface ProviderRequest {
  readonly question: string;
  readonly systemPrompt?: string;
  readonly chatPrompt?: ChatPrompt;
  readonly inputFiles?: readonly string[];
  readonly evalCaseId?: string;
  readonly suite?: string;
  readonly evalFilePath?: string;
  readonly attempt?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly metadata?: JsonObject;
  readonly signal?: AbortSignal;
  /** Working directory override (e.g., from eval-level workspace.template) */
  readonly cwd?: string;
  /** VS Code .code-workspace file (resolved from workspace.template) */
  readonly workspaceFile?: string;
  /** When true, AgentV captures file changes from workspace — provider should skip forced diff prompt */
  readonly captureFileChanges?: boolean;
  /** Real-time observability callbacks (optional) */
  readonly streamCallbacks?: ProviderStreamCallbacks;
  /** Braintrust span IDs for trace-claude-code plugin (optional) */
  readonly braintrustSpanIds?: { readonly parentSpanId: string; readonly rootSpanId: string };
  /**
   * Tools the model may call. When provided, the provider runs the agent loop:
   * model turn → tool execution → model turn, repeated until the model returns
   * no further tool calls or `maxSteps` is reached. Required for built-in agent
   * grader mode (filesystem-introspection rubrics).
   */
  readonly tools?: readonly ProviderTool[];
  /**
   * Maximum number of agent loop iterations (model turn + tool execution = one
   * step). Required when `tools` is non-empty. Ignored otherwise.
   */
  readonly maxSteps?: number;
  /**
   * Image inputs appended to the last user turn. Used by graders that judge
   * screenshot/image content (e.g. red-team UI evals). Providers that do not
   * support multimodal input should drop these gracefully.
   */
  readonly images?: readonly ContentImage[];
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
  /** Execution status when the provider exposes it. */
  readonly status?: 'ok' | 'error' | 'timeout' | 'cancelled' | 'unknown';
}

/**
 * Normalized provider skill-call metadata.
 *
 * This mirrors Promptfoo's `providerResponse.metadata.skillCalls` semantics:
 * provider/import adapters populate entries from explicit provider events where
 * possible, or from normalized tool-call evidence when the provider lacks a
 * first-class skill event. Assertions consume this read model instead of
 * scanning transcripts.
 */
export interface SkillCall {
  /** Stable skill name. */
  readonly name: string;
  /** Original provider/tool input when available. */
  readonly input?: unknown;
  /** Skill file path or resolved descriptor path when available. */
  readonly path?: string;
  /** Evidence source such as `tool` or `heuristic`. */
  readonly source?: string;
  /** Whether the provider reported the skill attempt as errored. */
  readonly isError?: boolean;
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

export type TargetExecutionErrorKind =
  | 'target_task_failure'
  | 'spawn_failure'
  | 'nonzero_exit'
  | 'signal_crash'
  | 'timeout'
  | 'cancelled'
  | 'malformed_output'
  | 'sandbox_infra_failure'
  | 'agentv_orchestrator_failure';

export interface TargetExecutionLogCapture {
  readonly text: string;
  readonly truncated: boolean;
  readonly bytes: number;
  readonly storedBytes: number;
}

export interface TargetExecutionCommand {
  readonly argv?: readonly string[];
  readonly commandLine?: string;
  readonly cwd?: string;
}

export interface TargetExecutionArtifacts {
  readonly targetExecutionPath?: string;
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  readonly transcriptPath?: string;
  readonly transcriptRawPath?: string;
  readonly summaryPath?: string;
  readonly metricsPath?: string;
  readonly fileChangesPath?: string;
  readonly outputPath?: string;
  readonly answerPath?: string;
}

/**
 * Provider-neutral target runtime envelope. Providers report target/process
 * outcomes here so AgentV can serialize target crashes, timeouts, malformed
 * protocol output, and partial transcripts without treating them as AgentV
 * orchestrator failures. Provider-specific detail belongs in `details`.
 */
export interface TargetExecutionEnvelope {
  readonly schemaVersion: 'agentv.target_execution.v1';
  readonly status: 'success' | 'error';
  readonly targetId: string;
  readonly providerId: string;
  readonly providerKind: string;
  readonly runtimeMode?: 'host' | 'profile' | 'sandbox' | string;
  readonly command?: TargetExecutionCommand;
  readonly timeoutMs?: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly errorKind?: TargetExecutionErrorKind;
  readonly message?: string;
  readonly logs?: {
    readonly stdout?: TargetExecutionLogCapture;
    readonly stderr?: TargetExecutionLogCapture;
  };
  readonly transcript?: {
    readonly messages?: readonly Message[];
    readonly finalOutput?: string;
  };
  readonly fileChanges?: {
    readonly available: boolean;
    readonly summary?: string;
  };
  readonly artifacts?: TargetExecutionArtifacts;
  readonly details?: Record<string, unknown>;
}

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

/**
 * Per-step trace summary for tool-using provider calls. Populated only when
 * the request had `tools`. Single-shot calls leave `steps` undefined.
 */
export interface ProviderStepInfo {
  /** Number of agent loop steps executed (1 = single model turn, no tool calls). */
  readonly count: number;
  /** Total tool calls across all steps. */
  readonly toolCallCount: number;
}

export interface ProviderResponse {
  readonly raw?: unknown;
  readonly usage?: JsonObject;
  readonly metadata?: Record<string, unknown> & {
    readonly skillCalls?: readonly SkillCall[];
    readonly attemptedSkillCalls?: readonly SkillCall[];
  };
  readonly targetExecution?: TargetExecutionEnvelope;
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
  /** Multi-step trace summary; populated only when the request used `tools`. */
  readonly steps?: ProviderStepInfo;
  /**
   * Synthetic unified diff of files generated by the provider outside the
   * eval workspace_path (e.g. copilot session-state artifacts in
   * `~/.copilot/session-state/<uuid>/files/`).
   *
   * When set, the orchestrator merges this into `file_changes` so that LLM
   * and script graders can inspect agent-generated artifacts even when they are
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
  readonly environment?: EnvironmentRecipe;
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

export interface ProviderDefinition {
  /** Internal canonical provider label. Authored YAML uses providers[].label, falling back to providers[].id. */
  readonly name: string;
  /** Normalized AgentV provider label retained for resolver compatibility. */
  readonly id?: string | undefined;
  /** Display label used by result identity and selection. */
  readonly label?: string | undefined;
  /** Promptfoo-shaped provider options bag. Provider settings are flattened at the boundary. */
  readonly config?: unknown | undefined;
  readonly runtime?: unknown | undefined;
  /** AgentV-only provider-scoped environment overlay. */
  readonly environment?: EnvironmentRecipe | unknown | undefined;
  readonly prompts?: unknown | undefined;
  readonly transform?: unknown | undefined;
  readonly delay?: number | unknown | undefined;
  readonly inputs?: unknown | undefined;
  readonly provider?: ProviderKind | string;
  /** Original public providers[].id backend/spec string after public provider normalization. */
  readonly provider_spec?: string | undefined;
  // Delegation: resolve this provider definition as another named provider.
  // Supports ${{ ENV_VAR }} syntax (e.g., use_target: ${{ AGENT_TARGET }}).
  readonly use_target?: string | unknown | undefined;
  readonly grader_target?: string | undefined;
  readonly workers?: number | undefined;
  // Request batching
  readonly batch_requests?: boolean | undefined;
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
  readonly api_format?: string | unknown | undefined;
  readonly model_id?: string | unknown | undefined;
  readonly wire_model?: string | unknown | undefined;
  // Anthropic fields
  readonly variant?: string | unknown | undefined;
  readonly thinking_budget?: number | unknown | undefined;
  // Common fields
  readonly temperature?: number | unknown | undefined;
  readonly max_output_tokens?: number | unknown | undefined;
  // Codex fields
  readonly executable?: string | unknown | undefined;
  readonly command?: string | readonly string[] | unknown | undefined;
  readonly binary?: string | unknown | undefined;
  readonly args?: unknown | undefined;
  readonly arguments?: unknown | undefined;
  readonly reasoning_effort?: string | unknown | undefined;
  readonly model_reasoning_effort?: string | unknown | undefined;
  readonly model_verbosity?: string | unknown | undefined;
  readonly sandbox_mode?: string | unknown | undefined;
  readonly approval_policy?: string | unknown | undefined;
  readonly cwd?: string | unknown | undefined;
  readonly timeout_seconds?: number | unknown | undefined;
  readonly log_dir?: string | unknown | undefined;
  readonly log_directory?: string | unknown | undefined;
  /** false=no stream log, 'raw'=per-event, 'summary'=consolidated. */
  readonly stream_log?: string | boolean | unknown | undefined;
  // System prompt (codex, copilot, claude, pi-coding-agent)
  readonly system_prompt?: string | unknown | undefined;
  // Claude Agent SDK fields
  readonly max_turns?: number | unknown | undefined;
  readonly max_budget_usd?: number | unknown | undefined;
  // Mock fields
  readonly response?: string | unknown | undefined;
  // Replay fixture fields
  readonly fixtures?: string | unknown | undefined;
  readonly execution_traces?: string | unknown | undefined;
  readonly transcripts?: string | unknown | undefined;
  readonly source_target?: string | unknown | undefined;
  readonly eval_path?: string | unknown | undefined;
  // VSCode fields
  readonly wait?: boolean | unknown | undefined;
  readonly dry_run?: boolean | unknown | undefined;
  readonly subagent_root?: string | unknown | undefined;
  // CLI fields
  readonly files_format?: string | unknown | undefined;
  readonly attachments_format?: string | unknown | undefined;
  readonly env?: unknown | undefined;
  readonly healthcheck?: unknown | undefined;
  // Copilot SDK fields
  readonly cli_url?: string | unknown | undefined;
  readonly cli_path?: string | unknown | undefined;
  readonly github_token?: string | unknown | undefined;
  // Retry configuration fields
  readonly max_retries?: number | unknown | undefined;
  readonly retry_initial_delay_ms?: number | unknown | undefined;
  readonly retry_max_delay_ms?: number | unknown | undefined;
  readonly retry_backoff_factor?: number | unknown | undefined;
  readonly retry_status_codes?: unknown | undefined;
  // Fallback targets for provider errors
  readonly fallback_targets?: readonly string[] | unknown | undefined;
}
