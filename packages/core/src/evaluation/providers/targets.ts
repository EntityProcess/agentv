import path from 'node:path';
import { z } from 'zod';

import { renderEnvTemplateString } from '../interpolation.js';
import {
  type EnvironmentRecipe,
  isResolvedEnvironmentRecipe,
  resolveEnvironmentRecipe,
} from '../loaders/environment-recipe.js';
import type { TargetRuntimeConfig, TargetRuntimeMode } from './sandbox-runner.js';
import type { EnvLookup, ProviderDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Zod Schemas for CLI Provider Configuration
// ---------------------------------------------------------------------------

/**
 * Loose input schema for HTTP healthcheck configuration.
 * Accepts raw YAML input before normalization and validation.
 *
 * @example
 * ```yaml
 * healthcheck:
 *   url: http://localhost:8080/health
 *   timeout_seconds: 30
 * ```
 */
export const CliHealthcheckHttpInputSchema = z
  .object({
    url: z.string().min(1, 'healthcheck URL is required'),
    timeout_seconds: z.number().positive().optional(),
  })
  .passthrough();

/**
 * Loose input schema for command healthcheck configuration.
 * Accepts raw YAML input before normalization and validation.
 *
 * @example
 * ```yaml
 * healthcheck:
 *   command: curl http://localhost:8080/health
 *   cwd: /app
 *   timeout_seconds: 10
 * ```
 */
export const CliHealthcheckCommandInputSchema = z
  .object({
    command: z.string().min(1, 'healthcheck command is required'),
    cwd: z.string().optional(),
    timeout_seconds: z.number().positive().optional(),
  })
  .passthrough();

/**
 * Union for healthcheck input configuration.
 * The healthcheck type is self-describing: presence of `url` indicates HTTP,
 * presence of `command` indicates a command healthcheck.
 *
 * @see CliHealthcheckHttpInputSchema for HTTP healthcheck configuration
 * @see CliHealthcheckCommandInputSchema for command healthcheck configuration
 */
export const CliHealthcheckInputSchema = z.union([
  CliHealthcheckHttpInputSchema,
  CliHealthcheckCommandInputSchema,
]);

/**
 * Loose input schema for CLI target configuration.
 * Accepts raw YAML input before normalization and validation.
 *
 * This schema validates the raw YAML input structure before normalization
 * and environment variable resolution. Unknown properties are allowed
 * (passthrough mode) to support future extensions.
 *
 * @example
 * ```yaml
 * targets:
 *   - name: my-agent
 *     provider: cli
 *     command: agent run {PROMPT}
 *     timeout_seconds: 120
 *     healthcheck:
 *       url: http://localhost:8080/health
 * ```
 */
export const CliTargetInputSchema = z
  .object({
    name: z.string().min(1, 'target name is required'),
    provider: z
      .string()
      .refine((p) => p.toLowerCase() === 'cli', { message: "provider must be 'cli'" }),

    // Command - required
    command: z.string(),

    // Files format - optional
    files_format: z.string().optional(),
    attachments_format: z.string().optional(),

    // Working directory - optional
    cwd: z.string().optional(),

    // Timeout in seconds - optional
    timeout_seconds: z.number().positive().optional(),

    // Healthcheck configuration - optional
    healthcheck: CliHealthcheckInputSchema.optional(),

    // Verbose mode - optional
    verbose: z.boolean().optional(),
    cli_verbose: z.boolean().optional(),

    // Keep temp files - optional
    keep_temp_files: z.boolean().optional(),
    keep_output_files: z.boolean().optional(),

    // Common target fields
    grader_target: z.string().optional(),
    workers: z.number().int().min(1).optional(),
    batch_requests: z.boolean().optional(),
  })
  .passthrough();

/**
 * Strict normalized schema for HTTP healthcheck configuration.
 * Rejects unknown properties.
 * This is an internal schema used as part of CliHealthcheckSchema.
 */
const CliHealthcheckHttpSchema = z
  .object({
    url: z.string().min(1),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

/**
 * Strict normalized schema for command healthcheck configuration.
 * Rejects unknown properties.
 * This is an internal schema used as part of CliHealthcheckSchema.
 */
const CliHealthcheckCommandSchema = z
  .object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

/**
 * Strict normalized schema for healthcheck configuration.
 * Union supporting HTTP and command healthchecks, distinguished by the
 * presence of `url` (HTTP) or `command` (command).
 * Rejects unknown properties to catch typos and misconfigurations.
 *
 * @see CliHealthcheckHttpSchema for HTTP healthcheck fields
 * @see CliHealthcheckCommandSchema for command healthcheck fields
 */
export const CliHealthcheckSchema = z.union([
  CliHealthcheckHttpSchema,
  CliHealthcheckCommandSchema,
]);

/**
 * Strict normalized schema for CLI target configuration.
 * This is the final validated shape after environment variable resolution
 * and internal field normalization.
 *
 * Uses .strict() to reject unknown properties, ensuring configuration
 * errors are caught early rather than silently ignored.
 *
 * @example
 * ```typescript
 * const config: CliNormalizedConfig = {
 *   command: 'agent run {PROMPT}',
 *   timeoutMs: 120000,
 *   verbose: true,
 * };
 * CliTargetConfigSchema.parse(config); // Validates the normalized config
 * ```
 */
export const CliTargetConfigSchema = z
  .object({
    command: z.string().min(1),
    filesFormat: z.string().optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().positive().optional(),
    healthcheck: CliHealthcheckSchema.optional(),
    verbose: z.boolean().optional(),
    keepTempFiles: z.boolean().optional(),
  })
  .strict();

// Type inference from schemas
export type CliHealthcheckInput = z.infer<typeof CliHealthcheckInputSchema>;
export type CliTargetInput = z.infer<typeof CliTargetInputSchema>;
export type CliNormalizedHealthcheck = z.infer<typeof CliHealthcheckSchema>;
export type CliNormalizedConfig = z.infer<typeof CliTargetConfigSchema>;

/**
 * Resolved CLI configuration type derived from CliTargetConfigSchema.
 * This is the final validated shape used by the CLI provider at runtime.
 * Using Readonly to ensure immutability for runtime safety.
 */
export type CliResolvedConfig = Readonly<CliNormalizedConfig>;

/**
 * Normalizes a healthcheck input from raw YAML input to the strict internal
 * form used by the CLI provider. Resolves environment variables.
 *
 * @param input - The loose healthcheck input from YAML
 * @param env - Environment variable lookup
 * @param targetName - Name of the target (for error messages)
 * @param evalFilePath - Optional path to eval file for relative path resolution
 * @returns Normalized healthcheck configuration
 */
export function normalizeCliHealthcheck(
  input: CliHealthcheckInput,
  env: EnvLookup,
  targetName: string,
  evalFilePath?: string,
): CliNormalizedHealthcheck {
  const timeoutSeconds = input.timeout_seconds;
  const timeoutMs = timeoutSeconds !== undefined ? Math.floor(timeoutSeconds * 1000) : undefined;

  if ('url' in input && input.url) {
    const url = resolveString(input.url, env, `${targetName} healthcheck URL`);
    return {
      url,
      timeoutMs,
    };
  }

  // command healthcheck
  if (!('command' in input) || !input.command) {
    throw new Error(
      `${targetName} healthcheck: Either 'command' or 'url' is required for healthcheck`,
    );
  }
  const command = resolveString(input.command, env, `${targetName} healthcheck command`, true);

  let cwd = resolveOptionalString(input.cwd, env, `${targetName} healthcheck cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  // Resolve relative cwd paths against eval file directory
  if (cwd && evalFilePath && !path.isAbsolute(cwd)) {
    cwd = path.resolve(path.dirname(path.resolve(evalFilePath)), cwd);
  }
  // Fallback: if cwd is not set and we have an eval file path, use the eval directory
  if (!cwd && evalFilePath) {
    cwd = path.dirname(path.resolve(evalFilePath));
  }

  return {
    command,
    cwd,
    timeoutMs,
  };
}

/**
 * Normalizes a CLI target input from raw YAML input to the strict internal
 * form used by the CLI provider. Resolves environment variables.
 *
 * This function resolves environment variable references using
 * {{ env.VAR_NAME }} syntax and converts external YAML field names to the
 * internal runtime shape.
 *
 * @param input - The loose CLI target input from YAML
 * @param env - Environment variable lookup
 * @param evalFilePath - Optional path to eval file for relative path resolution
 * @returns Normalized CLI configuration matching CliResolvedConfig
 */
export function normalizeCliTargetInput(
  input: CliTargetInput,
  env: EnvLookup,
  evalFilePath?: string,
): CliNormalizedConfig {
  const targetName = input.name;

  const command = resolveString(input.command, env, `${targetName} CLI command`, true);

  // Coalesce files format variants
  const filesFormatSource = input.files_format ?? input.attachments_format;
  const filesFormat = resolveOptionalLiteralString(filesFormatSource);

  // Resolve working directory
  let cwd = resolveOptionalString(input.cwd, env, `${targetName} working directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  // Resolve relative cwd paths against eval file directory
  if (cwd && evalFilePath && !path.isAbsolute(cwd)) {
    cwd = path.resolve(path.dirname(path.resolve(evalFilePath)), cwd);
  }

  // Fallback: if cwd is not set and we have an eval file path, use the eval directory
  if (!cwd && evalFilePath) {
    cwd = path.dirname(path.resolve(evalFilePath));
  }

  // Coalesce timeout variants (seconds -> ms)
  const timeoutSeconds = input.timeout_seconds;
  const timeoutMs = timeoutSeconds !== undefined ? Math.floor(timeoutSeconds * 1000) : undefined;

  // Coalesce verbose variants
  const verbose = resolveOptionalBoolean(input.verbose ?? input.cli_verbose);

  // Coalesce keepTempFiles variants
  const keepTempFiles = resolveOptionalBoolean(input.keep_temp_files ?? input.keep_output_files);

  // Normalize healthcheck if present
  const healthcheck = input.healthcheck
    ? normalizeCliHealthcheck(input.healthcheck, env, targetName, evalFilePath)
    : undefined;

  return {
    command,
    filesFormat,
    cwd,
    timeoutMs,
    healthcheck,
    verbose,
    keepTempFiles,
  };
}

// ---------------------------------------------------------------------------
// Other Provider Configurations and Utilities
// ---------------------------------------------------------------------------

/**
 * Supported CLI placeholder tokens that can be used in command templates.
 * These are replaced with actual values during command execution.
 */
export const CLI_PLACEHOLDERS = new Set([
  'PROMPT',
  'PROMPT_FILE',
  'EVAL_ID',
  'ATTEMPT',
  'FILES',
  'OUTPUT_FILE',
]);

export interface RetryConfig {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly retryableStatusCodes?: readonly number[];
}

/**
 * Selects which OpenAI-compatible API endpoint to use.
 * - "chat" (default): POST /chat/completions — universally supported by all OpenAI-compatible providers.
 * - "responses": POST /responses — only supported by api.openai.com.
 *
 * Maps to Vercel AI SDK methods: "chat" → provider.chat(model), "responses" → provider(model).
 */
export type ApiFormat = 'chat' | 'responses';

/**
 * Azure OpenAI settings.
 *
 * Note: `api_format` was removed — AgentV always routes Azure targets through
 * pi-ai's Responses API path. Chat-completions-only Azure deployments must
 * use `provider: openai` with a deployment-scoped `base_url`.
 */
export interface AzureResolvedConfig {
  readonly resourceName: string;
  readonly deploymentName: string;
  readonly apiKey: string;
  readonly version?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly retry?: RetryConfig;
}

/**
 * OpenAI-compatible settings used by the Vercel AI SDK.
 */
export interface OpenAIResolvedConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiFormat?: ApiFormat;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly retry?: RetryConfig;
}

/**
 * OpenRouter settings used by the Vercel AI SDK provider.
 */
export interface OpenRouterResolvedConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly retry?: RetryConfig;
}

/**
 * Anthropic Claude settings used by the Vercel AI SDK.
 */
export interface AnthropicResolvedConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingBudget?: number;
  readonly retry?: RetryConfig;
}

/**
 * Google Gemini settings used by the Vercel AI SDK.
 */
export interface GeminiResolvedConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly retry?: RetryConfig;
}

export interface CodexResolvedConfig {
  readonly model?: string;
  readonly modelReasoningEffort?: CodexModelReasoningEffort;
  readonly modelVerbosity?: CodexModelVerbosity;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiFormat?: ApiFormat;
  readonly sandboxMode?: CodexSandboxMode;
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly command?: readonly string[];
  readonly runtime: CodingAgentRuntimeConfig;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export type CodingAgentRuntimeMode = 'host' | 'profile' | 'sandbox';

export interface CodingAgentRuntimeConfig {
  readonly mode: CodingAgentRuntimeMode;
  readonly home?: string;
  readonly codexHome?: string;
  readonly tmpDir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly envAllowlist?: readonly string[];
}

export interface CopilotCliResolvedConfig {
  readonly command: readonly string[];
  readonly executable: string;
  readonly model?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
  readonly customProvider?: CopilotCustomProviderConfig;
}

export interface CopilotCustomProviderConfig {
  readonly type?: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly bearerToken?: string;
  readonly apiVersion?: string;
  readonly wireApi?: string;
  readonly modelId?: string;
  readonly wireModel?: string;
}

export interface CopilotSdkResolvedConfig {
  readonly cliUrl?: string;
  readonly cliPath?: string;
  readonly args?: readonly string[];
  readonly githubToken?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
  readonly customProvider?: CopilotCustomProviderConfig;
}

export interface PiCodingAgentResolvedConfig {
  readonly subprovider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export interface PiCliResolvedConfig {
  readonly command: readonly string[];
  readonly executable: string;
  readonly subprovider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
  readonly runtime: PiRuntimeResolvedConfig;
}

export interface PiRpcResolvedConfig {
  readonly command: readonly string[];
  readonly subprovider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
  readonly runtime: PiRuntimeResolvedConfig;
}

export interface PiRuntimeResolvedConfig {
  readonly mode: 'host' | 'profile' | 'sandbox';
  readonly home?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface ClaudeResolvedConfig {
  readonly command: readonly string[];
  readonly executable: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  /** When true (default), passes --dangerously-skip-permissions to the Claude CLI. Matches ClaudeSdkProvider behavior. */
  readonly bypassPermissions?: boolean;
}

export interface MockResolvedConfig {
  readonly response?: string;
  readonly delayMs?: number;
  readonly delayMinMs?: number;
  readonly delayMaxMs?: number;
}

export interface VSCodeResolvedConfig {
  readonly executable: string;
  readonly waitForResponse: boolean;
  readonly dryRun: boolean;
  readonly subagentRoot?: string;
  readonly timeoutMs?: number;
}

export interface AgentVResolvedConfig {
  readonly model: string;
  readonly temperature: number;
}

export interface ReplayResolvedConfig {
  readonly source?: ReplayResolvedSource;
  readonly fixturesPath?: string;
  readonly transcriptsPath?: string;
  readonly sourceTarget: string;
  readonly suite?: string;
  readonly evalPath?: string;
  readonly variant?: string;
}

export type ReplayResolvedSource =
  | { readonly kind: 'fixtures'; readonly path: string }
  | { readonly kind: 'execution_traces'; readonly path: string }
  | { readonly kind: 'transcripts'; readonly path: string };

export interface TargetDeprecationWarning {
  readonly location: string;
  readonly message: string;
}

const DEPRECATED_TARGET_CAMEL_CASE_FIELDS = new Map<string, string>([
  ['providerBatching', 'batch_requests'],
  ['subagentModeAllowed', 'subagent_mode_allowed'],
  ['fallbackTargets', 'fallback_targets'],
  ['resourceName', 'endpoint'],
  ['baseUrl', 'base_url'],
  ['apiKey', 'api_key'],
  ['deploymentName', 'model'],
  ['thinkingBudget', 'thinking_budget'],
  ['maxTokens', 'max_output_tokens'],
  ['apiFormat', 'api_format'],
  ['timeoutSeconds', 'timeout_seconds'],
  ['logDir', 'log_dir'],
  ['logDirectory', 'log_directory'],
  ['logFormat', 'stream_log'],
  ['logOutputFormat', 'stream_log'],
  ['systemPrompt', 'system_prompt'],
  ['maxTurns', 'max_turns'],
  ['maxBudgetUsd', 'max_budget_usd'],
  ['dryRun', 'dry_run'],
  ['subagentRoot', 'subagent_root'],
  ['filesFormat', 'files_format'],
  ['attachmentsFormat', 'attachments_format'],
  ['cliUrl', 'cli_url'],
  ['cliPath', 'cli_path'],
  ['githubToken', 'github_token'],
  ['sessionDir', 'session_dir'],
  ['sessionId', 'session_id'],
  ['sessionStateDir', 'session_state_dir'],
  ['maxRetries', 'max_retries'],
  ['retryInitialDelayMs', 'retry_initial_delay_ms'],
  ['retryMaxDelayMs', 'retry_max_delay_ms'],
  ['retryBackoffFactor', 'retry_backoff_factor'],
  ['retryStatusCodes', 'retry_status_codes'],
  ['reasoningEffort', 'reasoning_effort'],
  ['modelReasoningEffort', 'reasoning_effort'],
  ['modelVerbosity', 'model_verbosity'],
  ['sandboxMode', 'sandbox_mode'],
  ['approvalPolicy', 'approval_policy'],
]);

export type CodexModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type CodexModelVerbosity = 'low' | 'medium' | 'high';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';

const CODEX_MODEL_REASONING_EFFORT_VALUES = new Set<CodexModelReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const CODEX_MODEL_VERBOSITY_VALUES = new Set<CodexModelVerbosity>(['low', 'medium', 'high']);

const CODEX_SANDBOX_MODE_VALUES = new Set<CodexSandboxMode>([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

const CODEX_APPROVAL_POLICY_VALUES = new Set<CodexApprovalPolicy>([
  'never',
  'on-request',
  'on-failure',
  'untrusted',
]);

const DEPRECATED_HEALTHCHECK_CAMEL_CASE_FIELDS = new Map<string, string>([
  ['timeoutSeconds', 'timeout_seconds'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface NormalizeInternalProviderDefinitionOptions {
  readonly defaultName?: string;
}

export interface NormalizeProviderDefinitionOptions {
  readonly location?: string;
}

export type ExpandedProviderDefinitionEntry = {
  readonly rawId: string;
  readonly rawDefinition: Record<string, unknown>;
  readonly definition: ProviderDefinition;
};

export function isProviderSpecString(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('package:') || trimmed.startsWith('file://') || trimmed.includes(':');
}

export function expandProviderDefinitionEntries(
  entries: readonly unknown[],
  options: {
    readonly location?: string;
    readonly stringMode?: 'all' | 'spec-only';
  } = {},
): readonly ExpandedProviderDefinitionEntry[] {
  const location = options.location ?? 'providers';
  const stringMode = options.stringMode ?? 'all';
  const expanded: ExpandedProviderDefinitionEntry[] = [];

  entries.forEach((entry, index) => {
    const entryLocation = `${location}[${index}]`;
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id.length === 0) {
        throw new Error(`Invalid ${entryLocation}: provider string must be non-empty.`);
      }
      if (stringMode === 'spec-only' && !isProviderSpecString(id)) {
        return;
      }
      const rawDefinition = { id };
      expanded.push({
        rawId: id,
        rawDefinition,
        definition: normalizeProviderDefinition(rawDefinition, { location: entryLocation }),
      });
      return;
    }

    if (!isRecord(entry)) {
      throw new Error(`Invalid ${entryLocation}: provider must be a string or object.`);
    }

    if (typeof entry.id === 'string' && entry.id.trim().length > 0) {
      expanded.push({
        rawId: entry.id.trim(),
        rawDefinition: entry,
        definition: normalizeProviderDefinition(entry, { location: entryLocation }),
      });
      return;
    }

    const mapEntries = Object.entries(entry);
    if (mapEntries.length === 0) {
      throw new Error(`Invalid ${entryLocation}: provider map must not be empty.`);
    }

    for (const [providerId, providerOptions] of mapEntries) {
      if (providerId.trim().length === 0) {
        throw new Error(`Invalid ${entryLocation}: provider map key must be non-empty.`);
      }
      if (!isRecord(providerOptions)) {
        throw new Error(
          `Invalid ${entryLocation}.${providerId}: provider map value must be an object.`,
        );
      }
      const { id: _ignoredId, ...optionsWithoutId } = providerOptions;
      const rawDefinition = { ...optionsWithoutId, id: providerId };
      expanded.push({
        rawId: providerId,
        rawDefinition,
        definition: normalizeProviderDefinition(rawDefinition, {
          location: `${entryLocation}.${providerId}`,
        }),
      });
    }
  });

  return expanded;
}

function normalizePublicProviderId(providerId: string): {
  readonly provider: string;
  readonly config: Record<string, unknown>;
} {
  const providerSpecConfig = { provider_spec: providerId };
  const colonIndex = providerId.indexOf(':');
  if (colonIndex === -1) {
    return { provider: providerId, config: providerSpecConfig };
  }

  const provider = providerId.slice(0, colonIndex).trim();
  const spec = providerId.slice(colonIndex + 1).trim();
  if (!provider || !spec) {
    return { provider: providerId, config: providerSpecConfig };
  }

  switch (provider) {
    case 'exec':
      assertCrossPlatformExecProviderSpec(spec, providerId);
      return { provider: 'cli', config: { ...providerSpecConfig, command: spec } };
    case 'agentv': {
      const codexCliPrefix = 'codex-cli:';
      if (spec === 'codex-cli') {
        return { provider: 'codex-cli', config: providerSpecConfig };
      }
      if (spec.startsWith(codexCliPrefix)) {
        return {
          provider: 'codex-cli',
          config: { ...providerSpecConfig, model: spec.slice(codexCliPrefix.length) },
        };
      }
      return { provider, config: { ...providerSpecConfig, model: spec } };
    }
    case 'openai': {
      const codexSdkPrefix = 'codex-sdk:';
      const codexAliasPrefix = 'codex:';
      const codexAppServerPrefix = 'codex-app-server:';
      const codexDesktopPrefix = 'codex-desktop:';
      if (spec === 'codex' || spec === 'codex-sdk') {
        return { provider: 'codex-sdk', config: providerSpecConfig };
      }
      if (spec.startsWith(codexSdkPrefix)) {
        return {
          provider: 'codex-sdk',
          config: { ...providerSpecConfig, model: spec.slice(codexSdkPrefix.length) },
        };
      }
      if (spec.startsWith(codexAliasPrefix)) {
        return {
          provider: 'codex-sdk',
          config: { ...providerSpecConfig, model: spec.slice(codexAliasPrefix.length) },
        };
      }
      if (spec === 'codex-app-server' || spec === 'codex-desktop') {
        return { provider: 'codex-app-server', config: providerSpecConfig };
      }
      if (spec.startsWith(codexAppServerPrefix)) {
        return {
          provider: 'codex-app-server',
          config: { ...providerSpecConfig, model: spec.slice(codexAppServerPrefix.length) },
        };
      }
      if (spec.startsWith(codexDesktopPrefix)) {
        return {
          provider: 'codex-app-server',
          config: { ...providerSpecConfig, model: spec.slice(codexDesktopPrefix.length) },
        };
      }
      const responsesPrefix = 'responses:';
      const chatPrefix = 'chat:';
      if (spec.startsWith(responsesPrefix)) {
        return {
          provider,
          config: {
            ...providerSpecConfig,
            api_format: 'responses',
            model: spec.slice(responsesPrefix.length),
          },
        };
      }
      if (spec.startsWith(chatPrefix)) {
        return {
          provider,
          config: {
            ...providerSpecConfig,
            api_format: 'chat',
            model: spec.slice(chatPrefix.length),
          },
        };
      }
      return { provider, config: { ...providerSpecConfig, model: spec } };
    }
    case 'anthropic': {
      const messagesPrefix = 'messages:';
      return {
        provider,
        config: {
          ...providerSpecConfig,
          model: spec.startsWith(messagesPrefix) ? spec.slice(messagesPrefix.length) : spec,
        },
      };
    }
    case 'azure':
    case 'gemini':
    case 'openrouter':
      return { provider, config: { ...providerSpecConfig, model: spec } };
    default:
      return { provider, config: { ...providerSpecConfig, model: spec } };
  }
}

function assertCrossPlatformExecProviderSpec(spec: string, providerId: string): void {
  const command = spec.trim();
  const firstToken = command.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (
    firstToken === 'sh' ||
    firstToken === 'bash' ||
    firstToken.endsWith('.sh') ||
    /(?:^|[/\\])[^/\\]+\.sh$/i.test(firstToken)
  ) {
    throw new Error(
      `Invalid providers[].id '${providerId}': exec: is reserved for explicitly cross-platform commands such as 'exec:node ./provider.js'. Use a file:// TypeScript/JavaScript custom provider or a package provider such as 'package:@agentv/promptfoo-providers:CodexCliProvider' for AgentV CLI compatibility instead of shell wrappers.`,
    );
  }
}

/**
 * Converts the public Promptfoo-shaped provider object into AgentV's internal
 * provider definition. Public YAML uses `providers[].id` for the backend/provider
 * spec and `providers[].label` for the stable AgentV result/selection key.
 */
export function normalizeProviderDefinition(
  definition: unknown,
  options: NormalizeProviderDefinitionOptions = {},
): ProviderDefinition {
  const location = options.location ?? 'provider';
  if (!isRecord(definition)) {
    throw new Error(`Invalid ${location}: provider must be an object.`);
  }

  const rawId = definition.id;
  const providerId =
    typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined;
  if (!providerId) {
    throw new Error(`Invalid ${location}.id: expected a non-empty provider backend string.`);
  }

  if (definition.provider !== undefined) {
    throw new Error(
      `Invalid ${location}.provider: use providers[].id for the backend and providers[].label for the stable AgentV identity.`,
    );
  }
  if (definition.name !== undefined) {
    throw new Error(`Invalid ${location}.name: use providers[].label for the stable identity.`);
  }
  if (definition.container !== undefined) {
    throw new Error(`Invalid ${location}.container: use an environment recipe for testbed setup.`);
  }
  if (definition.install !== undefined) {
    throw new Error(`Invalid ${location}.install: use environment.setup.`);
  }

  const rawLabel = definition.label;
  const name =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : providerId;
  const { id: _id, label: _label, environment, ...rest } = definition;
  const publicSpec = normalizePublicProviderId(providerId);
  const authoredConfig = isRecord(rest.config) ? rest.config : {};

  const normalized = normalizeInternalProviderDefinition({
    ...rest,
    config: {
      ...publicSpec.config,
      ...authoredConfig,
    },
    id: name,
    provider: publicSpec.provider,
  });
  return {
    ...normalized,
    ...(environment !== undefined ? { environment } : {}),
  };
}

/** Normalizes an internal provider definition object for resolver use. */
export function normalizeInternalProviderDefinition(
  definition: unknown,
  options: NormalizeInternalProviderDefinitionOptions = {},
): ProviderDefinition {
  if (!isRecord(definition)) {
    throw new Error('Provider definition must be an object');
  }
  assertNoTargetTestbedFields(definition);

  const rawId = definition.id;
  const rawLabel = definition.label;
  const rawName = definition.name;
  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : undefined;
  const legacyName =
    typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : undefined;
  const name = id ?? legacyName ?? label ?? options.defaultName;
  if (!name || name.trim().length === 0) {
    throw new Error("Provider definition is missing a valid 'id' field");
  }

  const config = isRecord(definition.config) ? definition.config : {};
  return {
    ...config,
    ...definition,
    ...(id !== undefined ? { id } : {}),
    label: label ?? name,
    name,
  } as unknown as ProviderDefinition;
}

function assertNoTargetTestbedFields(definition: Record<string, unknown>): void {
  if (definition.container !== undefined) {
    throw new Error(
      'Provider definitions cannot include container setup; use an environment recipe.',
    );
  }
  if (definition.install !== undefined) {
    throw new Error('Provider definitions cannot include install steps; use environment.setup.');
  }
}

export async function resolveProviderDefinitionEnvironments(
  definitions: readonly ProviderDefinition[],
  baseDir: string,
  options: { readonly location?: string } = {},
): Promise<readonly ProviderDefinition[]> {
  const location = options.location ?? 'providers';
  return Promise.all(
    definitions.map(async (definition, index) => {
      if (
        definition.environment === undefined ||
        isResolvedEnvironmentRecipe(definition.environment)
      ) {
        return definition;
      }
      return {
        ...definition,
        environment: await resolveEnvironmentRecipe(
          definition.environment,
          baseDir,
          `${location}[${index}].environment`,
        ),
      };
    }),
  );
}

function collectDeprecatedCamelCaseWarnings(
  value: unknown,
  location: string,
  aliases: ReadonlyMap<string, string>,
): TargetDeprecationWarning[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }

  const warnings: TargetDeprecationWarning[] = [];
  for (const [camelCaseField, snakeCaseField] of aliases) {
    if (Object.prototype.hasOwnProperty.call(value, camelCaseField)) {
      warnings.push({
        location: `${location}.${camelCaseField}`,
        message: `camelCase field '${camelCaseField}' is no longer supported in targets.yaml. Use '${snakeCaseField}' instead.`,
      });
    }
  }

  return warnings;
}

function assertNoDeprecatedCamelCaseTargetFields(definition: ProviderDefinition): void {
  const warning = findDeprecatedCamelCaseTargetWarnings(
    definition,
    `target "${definition.name}"`,
  )[0];
  if (!warning) {
    return;
  }

  const fieldMatch = warning.message.match(/field '([^']+)'/);
  const replacementMatch = warning.message.match(/Use '([^']+)' instead/);
  const field = fieldMatch?.[1] ?? 'unknown';
  const replacement = replacementMatch?.[1] ?? 'snake_case';
  throw new Error(
    `${warning.location}: camelCase field '${field}' is no longer supported in targets.yaml. Use '${replacement}' instead.`,
  );
}

function assertNoRemovedTargetFields(definition: ProviderDefinition): void {
  const rawDefinition = definition as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'judge_target')) {
    throw new Error(
      `target "${definition.name}".judge_target: field 'judge_target' has been removed. Use 'grader_target' instead.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'provider_batching')) {
    throw new Error(
      `target "${definition.name}".provider_batching: field 'provider_batching' has been removed. Use 'batch_requests' instead.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'log_format')) {
    throw new Error(
      `target "${definition.name}".log_format: field 'log_format' has been removed. Use 'stream_log' instead.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawDefinition, 'log_output_format')) {
    throw new Error(
      `target "${definition.name}".log_output_format: field 'log_output_format' has been removed. Use 'stream_log' instead.`,
    );
  }
}

export function findDeprecatedCamelCaseTargetWarnings(
  target: unknown,
  location: string,
): readonly TargetDeprecationWarning[] {
  const warnings = collectDeprecatedCamelCaseWarnings(
    target,
    location,
    DEPRECATED_TARGET_CAMEL_CASE_FIELDS,
  );

  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    return warnings;
  }

  const healthcheck = (target as { healthcheck?: unknown }).healthcheck;
  warnings.push(
    ...collectDeprecatedCamelCaseWarnings(
      healthcheck,
      `${location}.healthcheck`,
      DEPRECATED_HEALTHCHECK_CAMEL_CASE_FIELDS,
    ),
  );

  return warnings;
}

/**
 * Healthcheck configuration type derived from CliHealthcheckSchema.
 * Supports both HTTP and command-based healthchecks.
 */
export type CliHealthcheck = Readonly<CliNormalizedHealthcheck>;

// Note: CliResolvedConfig is a type alias derived from CliNormalizedConfig (see above),
// which itself is inferred from CliTargetConfigSchema for type safety and single source of truth.

/** Base fields shared by all resolved provider backends. */
interface ResolvedProviderBackendBase {
  readonly name: string;
  readonly label?: string;
  readonly runtime?: TargetRuntimeConfig;
  readonly environment?: EnvironmentRecipe;
  readonly graderTarget?: string;
  readonly workers?: number;
  readonly providerBatching?: boolean;
  /**
   * Whether this target can be executed via executor subagents in subagent mode.
   * Defaults to `true` for all non-CLI providers. Set `false` in targets.yaml
   * to force CLI invocation even in subagent mode.
   */
  readonly subagentModeAllowed?: boolean;
  /**
   * Ordered list of target names to try when the primary target fails after
   * exhausting retries. Each fallback is attempted in order.
   */
  readonly fallbackTargets?: readonly string[];
}

export type ResolvedProviderBackend =
  | (ResolvedProviderBackendBase & {
      readonly kind: 'openai';
      readonly config: OpenAIResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'openrouter';
      readonly config: OpenRouterResolvedConfig;
    })
  | (ResolvedProviderBackendBase & { readonly kind: 'azure'; readonly config: AzureResolvedConfig })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'anthropic';
      readonly config: AnthropicResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'gemini';
      readonly config: GeminiResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'codex-cli' | 'codex-app-server' | 'codex-sdk';
      readonly config: CodexResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'copilot-sdk';
      readonly config: CopilotSdkResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'copilot-cli';
      readonly config: CopilotCliResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'pi-sdk' | 'pi-coding-agent';
      readonly config: PiCodingAgentResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'pi-cli';
      readonly config: PiCliResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'pi-rpc';
      readonly config: PiRpcResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'claude-cli';
      readonly config: ClaudeResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'claude-sdk';
      readonly config: ClaudeResolvedConfig;
    })
  | (ResolvedProviderBackendBase & { readonly kind: 'mock'; readonly config: MockResolvedConfig })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'vscode' | 'vscode-insiders';
      readonly config: VSCodeResolvedConfig;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'agentv';
      readonly config: AgentVResolvedConfig;
    })
  | (ResolvedProviderBackendBase & { readonly kind: 'cli'; readonly config: CliResolvedConfig })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'transcript';
      readonly config: Record<string, never>;
    })
  | (ResolvedProviderBackendBase & {
      readonly kind: 'replay';
      readonly config: ReplayResolvedConfig;
    });

/**
 * Optional settings accepted on all provider definitions regardless of backend.
 * Exported so provider validation can reuse the same list.
 */
export const COMMON_PROVIDER_SETTINGS = [
  'runtime',
  'environment',
  'batch_requests',
  'subagent_mode_allowed',
  'fallback_targets',
] as const;

const USE_TARGET_ENV_PATTERN = /^\s*\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;
const SECRET_ENV_TEMPLATE_PATTERN = /^\s*\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;
const LEGACY_ENV_TEMPLATE_PATTERN = /^\s*\$\{\{\s*([A-Z0-9_]+)\s*\}\}\s*$/i;

const BASE_TARGET_SCHEMA = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1, 'target name is required'),
    label: z.string().optional(),
    provider: z.string().optional(),
    provider_spec: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    runtime: z.unknown().optional(),
    environment: z.unknown().optional(),
    use_target: z.string().optional(),
    grader_target: z.string().optional(),
    workers: z.number().int().min(1).optional(),
    subagent_mode_allowed: z.boolean().optional(),
    fallback_targets: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

// Azure targets always go through pi-ai's `/openai/v1/responses` path, which
// requires `?api-version=v1`. The legacy chat-completions default
// (`2024-12-01-preview`) is no longer reachable from the Azure provider here.
const DEFAULT_AZURE_API_VERSION = 'v1';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const TARGET_RUNTIME_MODE_VALUES = new Set<TargetRuntimeMode>(['host', 'profile', 'sandbox']);

function normalizeAzureApiVersion(value: string | undefined): string {
  if (!value) {
    return DEFAULT_AZURE_API_VERSION;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_AZURE_API_VERSION;
  }

  const withoutPrefix = trimmed.replace(/^api[-_]?version\s*=\s*/i, '').trim();
  return withoutPrefix.length > 0 ? withoutPrefix : DEFAULT_AZURE_API_VERSION;
}

function resolveRetryConfig(target: z.infer<typeof BASE_TARGET_SCHEMA>): RetryConfig | undefined {
  const maxRetries = resolveOptionalNumber(target.max_retries, `${target.name} max retries`);
  const initialDelayMs = resolveOptionalNumber(
    target.retry_initial_delay_ms,
    `${target.name} retry initial delay`,
  );
  const maxDelayMs = resolveOptionalNumber(
    target.retry_max_delay_ms,
    `${target.name} retry max delay`,
  );
  const backoffFactor = resolveOptionalNumber(
    target.retry_backoff_factor,
    `${target.name} retry backoff factor`,
  );
  const retryableStatusCodes = resolveOptionalNumberArray(
    target.retry_status_codes,
    `${target.name} retry status codes`,
  );

  // Only return retry config if at least one field is set
  if (
    maxRetries === undefined &&
    initialDelayMs === undefined &&
    maxDelayMs === undefined &&
    backoffFactor === undefined &&
    retryableStatusCodes === undefined
  ) {
    return undefined;
  }

  return {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
    retryableStatusCodes,
  };
}

function resolveTargetRuntime(
  rawRuntime: unknown,
  targetName: string,
): TargetRuntimeConfig | undefined {
  if (rawRuntime === undefined || rawRuntime === null) {
    return undefined;
  }
  if (typeof rawRuntime === 'string') {
    const mode = rawRuntime.trim();
    if (TARGET_RUNTIME_MODE_VALUES.has(mode as TargetRuntimeMode)) {
      return { mode: mode as TargetRuntimeMode };
    }
  }
  if (isRecord(rawRuntime)) {
    const mode = typeof rawRuntime.mode === 'string' ? rawRuntime.mode.trim() : '';
    if (TARGET_RUNTIME_MODE_VALUES.has(mode as TargetRuntimeMode)) {
      return { ...rawRuntime, mode: mode as TargetRuntimeMode };
    }
  }
  throw new Error(
    `Invalid runtime for target "${targetName}": use 'host' or an object with mode: host|profile|sandbox.`,
  );
}

export function resolveDelegatedProviderDefinition(
  name: string,
  definitions: ReadonlyMap<string, ProviderDefinition>,
  env: EnvLookup = process.env,
): ProviderDefinition | undefined {
  let definition = definitions.get(name);
  if (!definition) {
    return undefined;
  }

  const visited = [definition.name];

  for (let depth = 0; depth < 10; depth++) {
    const rawUseTarget =
      typeof definition.use_target === 'string' ? definition.use_target.trim() : undefined;
    if (!rawUseTarget) {
      return definition;
    }

    const legacyEnvMatch = rawUseTarget.match(LEGACY_ENV_TEMPLATE_PATTERN);
    if (legacyEnvMatch) {
      const envVarName = legacyEnvMatch[1] ?? 'VARIABLE_NAME';
      throw new Error(
        `Target "${definition.name}" uses removed legacy use_target syntax \${{ ${envVarName} }}. Use {{ env.${envVarName} }} instead.`,
      );
    }

    const envMatch = rawUseTarget.match(USE_TARGET_ENV_PATTERN);
    const envVarName = envMatch?.[1];
    const resolvedName = envVarName ? (env[envVarName]?.trim() ?? '') : rawUseTarget;

    if (resolvedName.length === 0) {
      if (envVarName) {
        throw new Error(
          `Target "${definition.name}" uses use_target: {{ env.${envVarName} }}, but ${envVarName} is not set. Set ${envVarName} to the name of a concrete target (for example, "azure") before running the eval.`,
        );
      }

      throw new Error(
        `Target "${definition.name}" has an empty use_target value. Point it at a concrete target name before running the eval.`,
      );
    }

    const next = definitions.get(resolvedName);
    if (!next) {
      if (envVarName) {
        throw new Error(
          `Target "${definition.name}" uses use_target: {{ env.${envVarName} }}, which resolved to "${resolvedName}", but no target named "${resolvedName}" exists.`,
        );
      }

      throw new Error(
        `Target "${definition.name}" uses use_target: "${resolvedName}", but no target named "${resolvedName}" exists.`,
      );
    }

    if (visited.includes(next.name)) {
      const chain = [...visited, next.name].join(' -> ');
      throw new Error(`Circular use_target reference detected: ${chain}`);
    }

    definition = next;
    visited.push(definition.name);
  }

  throw new Error(
    `Target "${name}" exceeded the maximum use_target resolution depth (10). Check for a delegation loop or overly deep alias chain.`,
  );
}

export function resolveProviderDefinition(
  definition: ProviderDefinition,
  env: EnvLookup = process.env,
  evalFilePath?: string,
  options?: { readonly emitDeprecationWarnings?: boolean },
): ResolvedProviderBackend {
  void options;
  const normalizedDefinition = normalizeInternalProviderDefinition(definition);
  assertNoRemovedTargetFields(normalizedDefinition);
  assertNoDeprecatedCamelCaseTargetFields(normalizedDefinition);

  const parsed = BASE_TARGET_SCHEMA.parse(normalizedDefinition);
  if (!parsed.provider) {
    throw new Error(
      `${parsed.name}: 'provider' is required (provider definitions with use_target must be resolved before calling resolveProviderDefinition)`,
    );
  }
  const provider = resolveString(
    parsed.provider,
    env,
    `${parsed.name} provider`,
    true,
  ).toLowerCase();
  if (provider === 'claude' || provider === 'copilot') {
    throw new Error(
      `Target "${parsed.name}" uses ambiguous provider '${provider}'. Choose an explicit provider such as '${provider}-cli' or '${provider}-sdk'.`,
    );
  }
  if (provider === 'copilot-log') {
    throw new Error(
      `Target "${parsed.name}" uses removed provider 'copilot-log'. Import Copilot events with 'agentv import copilot' and replay the normalized transcript with provider: replay and transcripts: <path>.`,
    );
  }
  const providerBatching = resolveOptionalBoolean(parsed.batch_requests);
  const subagentModeAllowed = resolveOptionalBoolean(parsed.subagent_mode_allowed);

  // Shared base fields for all resolved targets
  const fallbackTargets = parsed.fallback_targets;
  const base = {
    name: parsed.name,
    label: parsed.label,
    runtime: resolveTargetRuntime(parsed.runtime, parsed.name),
    environment: isResolvedEnvironmentRecipe(parsed.environment) ? parsed.environment : undefined,
    graderTarget: parsed.grader_target,
    workers: parsed.workers,
    providerBatching,
    subagentModeAllowed,
    ...(fallbackTargets ? { fallbackTargets } : {}),
  } as const;

  switch (provider) {
    case 'openai':
      return {
        kind: 'openai',
        ...base,
        config: resolveOpenAIConfig(parsed, env),
      };
    case 'openrouter':
      return {
        kind: 'openrouter',
        ...base,
        config: resolveOpenRouterConfig(parsed, env),
      };
    case 'azure':
      return {
        kind: 'azure',
        ...base,
        config: resolveAzureConfig(parsed, env),
      };
    case 'anthropic':
      return {
        kind: 'anthropic',
        ...base,
        config: resolveAnthropicConfig(parsed, env),
      };
    case 'gemini':
      return {
        kind: 'gemini',
        ...base,
        config: resolveGeminiConfig(parsed, env),
      };
    case 'codex':
      throw new Error(
        `Target "${parsed.name}" uses ambiguous provider 'codex'. Choose 'codex-cli', 'codex-app-server', or 'codex-sdk'.`,
      );
    case 'codex-cli':
    case 'codex-app-server':
    case 'codex-sdk':
      return {
        kind: provider as 'codex-cli' | 'codex-app-server' | 'codex-sdk',
        ...base,
        config: resolveCodexConfig(parsed, env, provider, evalFilePath),
      };
    case 'copilot-sdk':
      return {
        kind: 'copilot-sdk',
        ...base,
        config: resolveCopilotSdkConfig(parsed, env, evalFilePath),
      };
    case 'copilot-cli':
      return {
        kind: 'copilot-cli',
        ...base,
        config: resolveCopilotCliConfig(parsed, env, evalFilePath),
      };
    case 'pi-sdk':
    case 'pi-coding-agent':
      return {
        kind: provider as 'pi-sdk' | 'pi-coding-agent',
        ...base,
        config: resolvePiCodingAgentConfig(parsed, env, evalFilePath),
      };
    case 'pi-cli':
      return {
        kind: 'pi-cli',
        ...base,
        config: resolvePiCliConfig(parsed, env, evalFilePath),
      };
    case 'pi-rpc':
      return {
        kind: 'pi-rpc',
        ...base,
        config: resolvePiRpcConfig(parsed, env, evalFilePath),
      };
    case 'claude-cli':
      return {
        kind: 'claude-cli',
        ...base,
        config: resolveClaudeConfig(parsed, env, evalFilePath),
      };
    case 'claude-sdk':
      return {
        kind: 'claude-sdk',
        ...base,
        config: resolveClaudeConfig(parsed, env, evalFilePath),
      };
    case 'mock':
      return {
        kind: 'mock',
        ...base,
        config: resolveMockConfig(parsed),
      };
    case 'vscode':
    case 'vscode-insiders':
      return {
        kind: provider as 'vscode' | 'vscode-insiders',
        ...base,
        config: resolveVSCodeConfig(parsed, env, provider === 'vscode-insiders', evalFilePath),
      };
    case 'agentv': {
      const model = typeof parsed.model === 'string' ? parsed.model : undefined;
      if (!model) {
        throw new Error(
          `Target "${parsed.name}" (provider: agentv) requires a "model" field (e.g., "openai:gpt-5-mini")`,
        );
      }
      const temperature = typeof parsed.temperature === 'number' ? parsed.temperature : 0;
      return {
        kind: 'agentv',
        ...base,
        workers: typeof parsed.workers === 'number' ? parsed.workers : undefined,
        config: { model, temperature },
      };
    }
    case 'cli':
      return {
        kind: 'cli',
        ...base,
        config: resolveCliConfig(parsed, env, evalFilePath),
      };
    case 'replay':
      return {
        kind: 'replay',
        ...base,
        config: resolveReplayConfig(parsed, env, evalFilePath),
      };
    default:
      // Unknown provider kind — resolve as CLI target.
      // This enables convention-based provider discovery: scripts in
      // .agentv/providers/ are registered in the ProviderRegistry under
      // their filename, and users can reference them by name directly.
      // The ProviderRegistry factory handles creating the appropriate
      // CliProvider with the discovered script path.
      return {
        kind: 'cli',
        ...base,
        config: resolveDiscoveredProviderConfig(parsed, provider, env, evalFilePath),
      };
  }
}

function normalizeOpenAIBaseUrl(value: string | undefined): string {
  if (!value) {
    return DEFAULT_OPENAI_BASE_URL;
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return DEFAULT_OPENAI_BASE_URL;
  }

  if (/\.openai\.azure\.com\/openai\/deployments\/[^/]+$/i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function resolveAzureConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): AzureResolvedConfig {
  // `api_format` was removed from Azure targets — pi-ai always routes Azure
  // through `/openai/v1/responses`, so the chat-completions branch is gone.
  // Reject the field loudly so users on chat-only deployments switch to the
  // documented escape hatch instead of silently 400-ing on every call.
  if (target.api_format !== undefined) {
    throw new Error(
      `The 'api_format' field has been removed from Azure targets ('${target.name}'). AgentV always uses Azure's Responses API. If your deployment only exposes /chat/completions, use 'provider: openai' with a deployment-scoped 'base_url' instead. See docs/targets/llm-providers for details.`,
    );
  }

  const endpointSource = target.endpoint ?? target.resource;
  const apiKeySource = target.api_key;
  const deploymentSource = target.deployment ?? target.model;
  const versionSource = target.version ?? target.api_version;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;

  const resourceName = resolveString(endpointSource, env, `${target.name} endpoint`);
  const apiKey = resolveString(apiKeySource, env, `${target.name} api key`);
  const deploymentName = resolveString(deploymentSource, env, `${target.name} deployment`);
  const version = normalizeAzureApiVersion(
    resolveOptionalString(versionSource, env, `${target.name} api version`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );
  const temperature = resolveOptionalNumber(temperatureSource, `${target.name} temperature`);
  const maxOutputTokens = resolveOptionalNumber(
    maxTokensSource,
    `${target.name} max output tokens`,
  );
  const retry = resolveRetryConfig(target);

  return {
    resourceName,
    deploymentName,
    apiKey,
    version,
    temperature,
    maxOutputTokens,
    retry,
  };
}

function resolveApiFormat(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  targetName: string,
): ApiFormat | undefined {
  const raw = resolveOptionalString(target.api_format, env, `${targetName} api format`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  if (raw === undefined) return undefined;
  if (raw === 'chat' || raw === 'responses') return raw;
  throw new Error(
    `Invalid api_format '${raw}' for target '${targetName}'. Must be 'chat' or 'responses'.`,
  );
}

function resolveProviderSpecModel(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  description: string,
): string {
  return resolveString(
    target.model ?? target.deployment ?? target.variant,
    env,
    description,
    typeof target.provider_spec === 'string',
  );
}

function resolveOpenAIConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): OpenAIResolvedConfig {
  const endpointSource = target.endpoint ?? target.base_url;
  const apiKeySource = target.api_key;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;

  const baseURL = normalizeOpenAIBaseUrl(
    resolveOptionalString(endpointSource, env, `${target.name} endpoint`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );
  const apiKey = resolveString(apiKeySource, env, `${target.name} api key`);
  const model = resolveProviderSpecModel(target, env, `${target.name} model`);
  const retry = resolveRetryConfig(target);

  return {
    baseURL,
    apiKey,
    model,
    apiFormat: resolveApiFormat(target, env, target.name),
    temperature: resolveOptionalNumber(temperatureSource, `${target.name} temperature`),
    maxOutputTokens: resolveOptionalNumber(maxTokensSource, `${target.name} max output tokens`),
    retry,
  };
}

function resolveOpenRouterConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): OpenRouterResolvedConfig {
  const apiKeySource = target.api_key;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;
  const retry = resolveRetryConfig(target);

  return {
    apiKey: resolveString(apiKeySource, env, `${target.name} OpenRouter api key`),
    model: resolveProviderSpecModel(target, env, `${target.name} OpenRouter model`),
    temperature: resolveOptionalNumber(temperatureSource, `${target.name} temperature`),
    maxOutputTokens: resolveOptionalNumber(maxTokensSource, `${target.name} max output tokens`),
    retry,
  };
}

function resolveAnthropicConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): AnthropicResolvedConfig {
  const apiKeySource = target.api_key;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;
  const thinkingBudgetSource = target.thinking_budget;

  const apiKey = resolveString(apiKeySource, env, `${target.name} Anthropic api key`);
  const model = resolveProviderSpecModel(target, env, `${target.name} Anthropic model`);
  const retry = resolveRetryConfig(target);

  return {
    apiKey,
    model,
    temperature: resolveOptionalNumber(temperatureSource, `${target.name} temperature`),
    maxOutputTokens: resolveOptionalNumber(maxTokensSource, `${target.name} max output tokens`),
    thinkingBudget: resolveOptionalNumber(thinkingBudgetSource, `${target.name} thinking budget`),
    retry,
  };
}

function resolveGeminiConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): GeminiResolvedConfig {
  const apiKeySource = target.api_key;
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;

  const apiKey = resolveString(apiKeySource, env, `${target.name} Google API key`);
  const model =
    resolveOptionalString(modelSource, env, `${target.name} Gemini model`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'gemini-2.5-flash';
  const retry = resolveRetryConfig(target);

  return {
    apiKey,
    model,
    temperature: resolveOptionalNumber(temperatureSource, `${target.name} temperature`),
    maxOutputTokens: resolveOptionalNumber(maxTokensSource, `${target.name} max output tokens`),
    retry,
  };
}

function resolveCodexConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  provider: string,
  _evalFilePath?: string,
): CodexResolvedConfig {
  const modelSource = target.model;
  const modelReasoningEffortSource = target.reasoning_effort ?? target.model_reasoning_effort;
  const modelVerbositySource = target.model_verbosity;
  const baseUrlSource = target.base_url ?? target.endpoint;
  const apiKeySource = target.api_key;
  const apiFormatSource = target.api_format;
  const sandboxModeSource = target.sandbox_mode;
  const approvalPolicySource = target.approval_policy;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;
  const runtime = resolveCodingAgentRuntime(target.runtime, env, target.name);

  if (provider === 'codex') {
    throw new Error(
      `Target "${target.name}" uses ambiguous provider 'codex'. Choose 'codex-cli', 'codex-app-server', or 'codex-sdk'.`,
    );
  }
  assertNoCodexProcessFieldAliases(target, provider);

  const streamLogResult = resolveStreamLog({ name: target.name, stream_log: target.stream_log });

  const model = resolveOptionalString(modelSource, env, `${target.name} codex model`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const modelReasoningEffort = normalizeCodexModelReasoningEffort(
    resolveOptionalString(
      modelReasoningEffortSource,
      env,
      `${target.name} codex model reasoning effort`,
      {
        allowLiteral: true,
        optionalEnv: true,
      },
    ),
  );
  const modelVerbosity = normalizeCodexModelVerbosity(
    resolveOptionalString(modelVerbositySource, env, `${target.name} codex model verbosity`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );

  const baseUrl = resolveOptionalString(baseUrlSource, env, `${target.name} codex base URL`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const apiKey = resolveOptionalString(apiKeySource, env, `${target.name} codex API key`, {
    allowLiteral: false,
    optionalEnv: true,
  });

  const apiFormat = resolveApiFormat({ ...target, api_format: apiFormatSource }, env, target.name);

  const sandboxMode = normalizeCodexSandboxMode(
    resolveOptionalString(sandboxModeSource, env, `${target.name} codex sandbox mode`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );

  const approvalPolicy = normalizeCodexApprovalPolicy(
    resolveOptionalString(approvalPolicySource, env, `${target.name} codex approval policy`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );

  const command =
    provider === 'codex-sdk'
      ? resolveOptionalCommandArgv(target.command, env, `${target.name} codex command`)
      : resolveRequiredCommandArgv(target.command, env, `${target.name} codex command`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} codex cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} codex timeout`);
  const logDir = resolveOptionalString(logDirSource, env, `${target.name} codex log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    model,
    modelReasoningEffort,
    modelVerbosity,
    baseUrl,
    apiKey,
    apiFormat,
    sandboxMode,
    approvalPolicy,
    command,
    runtime,
    cwd,
    timeoutMs,
    logDir,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function assertNoCodexProcessFieldAliases(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  provider: string,
): void {
  if (provider === 'codex-sdk') {
    return;
  }
  for (const field of ['executable', 'binary', 'args', 'arguments'] as const) {
    if (target[field] !== undefined) {
      throw new Error(
        `Target "${target.name}" (${provider}) uses removed field '${field}'. Use config.command as a non-empty argv array instead.`,
      );
    }
  }
}

function resolveRequiredCommandArgv(
  value: unknown,
  env: EnvLookup,
  label: string,
): readonly string[] {
  const command = resolveOptionalCommandArgv(value, env, label);
  if (!command || command.length === 0) {
    throw new Error(`${label} must be a non-empty argv array`);
  }
  return command;
}

function resolveOptionalCommandArgv(
  value: unknown,
  env: EnvLookup,
  label: string,
): readonly string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a non-empty argv array`);
  }
  const resolved = value.map((entry, index) =>
    resolveString(entry, env, `${label}[${index}]`, true),
  );
  if (resolved.length === 0 || resolved.some((entry) => entry.trim().length === 0)) {
    throw new Error(`${label} must be a non-empty argv array`);
  }
  return resolved;
}

function resolveCodingAgentRuntime(
  value: unknown,
  env: EnvLookup,
  targetName: string,
): CodingAgentRuntimeConfig {
  if (value === undefined || value === null) {
    return { mode: 'host' };
  }
  if (typeof value === 'string') {
    return { mode: normalizeCodingAgentRuntimeMode(value, targetName) };
  }
  if (!isRecord(value)) {
    throw new Error(
      `Target "${targetName}" runtime must be 'host' or an object with mode: host|profile|sandbox.`,
    );
  }

  const mode = normalizeCodingAgentRuntimeMode(value.mode, targetName);
  const runtimeEnv = resolveRuntimeEnv(value.env, env, targetName);
  const envAllowlist = resolveRuntimeEnvAllowlist(value.env_allowlist ?? value.envAllowlist);
  return {
    mode,
    home: resolveOptionalString(value.home, env, `${targetName} runtime home`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
    codexHome: resolveOptionalString(
      value.codex_home ?? value.codexHome,
      env,
      `${targetName} runtime CODEX_HOME`,
      {
        allowLiteral: true,
        optionalEnv: true,
      },
    ),
    tmpDir: resolveOptionalString(
      value.tmp_dir ?? value.tmpDir,
      env,
      `${targetName} runtime tmp dir`,
      {
        allowLiteral: true,
        optionalEnv: true,
      },
    ),
    ...(runtimeEnv ? { env: runtimeEnv } : {}),
    ...(envAllowlist ? { envAllowlist } : {}),
  };
}

function normalizeCodingAgentRuntimeMode(
  value: unknown,
  targetName: string,
): CodingAgentRuntimeMode {
  if (typeof value !== 'string') {
    throw new Error(`Target "${targetName}" runtime.mode must be one of: host, profile, sandbox.`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'host' || normalized === 'profile' || normalized === 'sandbox') {
    return normalized;
  }
  throw new Error(`Target "${targetName}" runtime.mode must be one of: host, profile, sandbox.`);
}

function resolveRuntimeEnvAllowlist(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('runtime.env_allowlist must be an array of strings.');
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function assertNoProcessCommandAliases(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  provider: 'claude-cli' | 'copilot-cli',
): void {
  const raw = target as Record<string, unknown>;
  for (const field of ['executable', 'binary', 'args', 'arguments']) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      throw new Error(
        `Target "${target.name}" (provider: ${provider}) uses removed field '${field}'. Use config.command as a non-empty argv array instead.`,
      );
    }
  }
}

function resolveCommandArgv(
  value: unknown,
  env: EnvLookup,
  label: string,
  defaultCommand: readonly string[],
): readonly string[] {
  if (value === undefined || value === null) {
    return defaultCommand;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a non-empty argv array of strings.`);
  }
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty argv array of strings.`);
  }
  return resolveOptionalStringArray(value, env, label) ?? defaultCommand;
}

function normalizeCodexModelReasoningEffort(
  value: string | undefined,
): CodexModelReasoningEffort | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (CODEX_MODEL_REASONING_EFFORT_VALUES.has(normalized as CodexModelReasoningEffort)) {
    return normalized as CodexModelReasoningEffort;
  }

  throw new Error(
    `codex reasoning_effort must be one of: ${[...CODEX_MODEL_REASONING_EFFORT_VALUES].join(', ')}`,
  );
}

function normalizeCodexModelVerbosity(value: string | undefined): CodexModelVerbosity | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (CODEX_MODEL_VERBOSITY_VALUES.has(normalized as CodexModelVerbosity)) {
    return normalized as CodexModelVerbosity;
  }

  throw new Error(
    `codex model_verbosity must be one of: ${[...CODEX_MODEL_VERBOSITY_VALUES].join(', ')}`,
  );
}

function normalizeCodexSandboxMode(value: string | undefined): CodexSandboxMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (CODEX_SANDBOX_MODE_VALUES.has(normalized as CodexSandboxMode)) {
    return normalized as CodexSandboxMode;
  }

  throw new Error(
    `codex sandbox_mode must be one of: ${[...CODEX_SANDBOX_MODE_VALUES].join(', ')}`,
  );
}

function normalizeCodexApprovalPolicy(value: string | undefined): CodexApprovalPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (CODEX_APPROVAL_POLICY_VALUES.has(normalized as CodexApprovalPolicy)) {
    return normalized as CodexApprovalPolicy;
  }

  throw new Error(
    `codex approval_policy must be one of: ${[...CODEX_APPROVAL_POLICY_VALUES].join(', ')}`,
  );
}

/** Resolve canonical stream_log config and the legacy logger format it implies. */
function resolveStreamLog(target: { stream_log?: unknown; name: string }): {
  streamLog: false | 'raw' | 'summary' | undefined;
  logFormat: 'summary' | 'json' | undefined;
} {
  if (target.stream_log !== undefined && target.stream_log !== null) {
    const val = target.stream_log;
    if (val === false || val === 'false') {
      return { streamLog: false, logFormat: undefined };
    }
    if (val === 'raw') {
      return { streamLog: 'raw', logFormat: 'json' };
    }
    if (val === 'summary') {
      return { streamLog: 'summary', logFormat: 'summary' };
    }
    throw new Error(`${target.name}: stream_log must be false, 'raw', or 'summary'`);
  }

  return { streamLog: undefined, logFormat: undefined };
}

function resolveCopilotSdkConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): CopilotSdkResolvedConfig {
  const cliUrlSource = target.cli_url;
  const cliPathSource = target.cli_path;
  const argsSource = target.args ?? target.arguments;
  const githubTokenSource = target.github_token;
  const modelSource = target.model;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);

  const cliUrl = resolveOptionalString(cliUrlSource, env, `${target.name} copilot-sdk cli URL`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cliPath = resolveOptionalString(cliPathSource, env, `${target.name} copilot-sdk cli path`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const args = resolveOptionalStringArray(argsSource, env, `${target.name} copilot-sdk args`);

  const githubToken = resolveOptionalString(
    githubTokenSource,
    env,
    `${target.name} copilot-sdk github token`,
    {
      allowLiteral: false,
      optionalEnv: true,
    },
  );

  const model = resolveOptionalString(modelSource, env, `${target.name} copilot-sdk model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} copilot-sdk cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} copilot-sdk timeout`);

  const logDir = resolveOptionalString(
    logDirSource,
    env,
    `${target.name} copilot-sdk log directory`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  const customProvider = resolveCopilotFlatProviderConfig(target, env);

  return {
    cliUrl,
    cliPath,
    args,
    githubToken,
    model,
    cwd,
    timeoutMs,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
    ...(customProvider ? { customProvider } : {}),
  };
}

function resolveCopilotFlatProviderConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): CopilotCustomProviderConfig | undefined {
  const baseUrlSource = target.base_url;
  if (!baseUrlSource) return undefined;

  const baseUrl = resolveOptionalString(baseUrlSource, env, `${target.name} copilot base URL`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  if (!baseUrl) return undefined;

  const type = resolveOptionalString(
    target.subprovider,
    env,
    `${target.name} copilot provider type`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );
  const apiKey = resolveOptionalString(target.api_key, env, `${target.name} copilot API key`, {
    allowLiteral: false,
    optionalEnv: true,
  });
  const bearerToken = resolveOptionalString(
    target.bearer_token,
    env,
    `${target.name} copilot bearer token`,
    {
      allowLiteral: false,
      optionalEnv: true,
    },
  );
  const apiVersion = resolveOptionalString(
    target.api_version,
    env,
    `${target.name} copilot API version`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );
  const apiFormat = resolveOptionalString(
    target.api_format,
    env,
    `${target.name} copilot API format`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );
  const modelId = resolveOptionalString(target.model_id, env, `${target.name} copilot model ID`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const wireModel = resolveOptionalString(
    target.wire_model,
    env,
    `${target.name} copilot wire model`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  return {
    ...(type ? { type } : {}),
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(bearerToken ? { bearerToken } : {}),
    ...(apiVersion ? { apiVersion } : {}),
    ...(apiFormat ? { wireApi: apiFormat } : {}),
    ...(modelId ? { modelId } : {}),
    ...(wireModel ? { wireModel } : {}),
  };
}

function resolveCopilotCliConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): CopilotCliResolvedConfig {
  assertNoProcessCommandAliases(target, 'copilot-cli');
  const command = resolveCommandArgv(target.command, env, `${target.name} copilot-cli command`, [
    'copilot',
  ]);
  const modelSource = target.model;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);

  const model = resolveOptionalString(modelSource, env, `${target.name} copilot-cli model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} copilot-cli cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} copilot-cli timeout`);

  const logDir = resolveOptionalString(
    logDirSource,
    env,
    `${target.name} copilot-cli log directory`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;
  const customProvider = resolveCopilotFlatProviderConfig(target, env);

  return {
    command,
    executable: command[0] ?? 'copilot',
    args: command.slice(1),
    model,
    cwd,
    timeoutMs,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
    ...(customProvider ? { customProvider } : {}),
  };
}

function resolvePiCodingAgentConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): PiCodingAgentResolvedConfig {
  const subproviderSource = target.subprovider;
  const modelSource = target.model ?? target.pi_model;
  const apiKeySource = target.api_key;
  const toolsSource = target.tools ?? target.pi_tools;
  const thinkingSource = target.reasoning_effort ?? target.thinking ?? target.pi_thinking;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);

  const subprovider = resolveOptionalString(
    subproviderSource,
    env,
    `${target.name} pi subprovider`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  const model = resolveOptionalString(modelSource, env, `${target.name} pi model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const apiKey = resolveOptionalString(apiKeySource, env, `${target.name} pi api key`, {
    allowLiteral: false,
    optionalEnv: true,
  });

  const baseUrlSource = target.base_url ?? target.endpoint;
  const baseUrl = resolveOptionalString(baseUrlSource, env, `${target.name} pi base url`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const tools = resolveOptionalString(toolsSource, env, `${target.name} pi tools`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const thinking = resolveOptionalString(thinkingSource, env, `${target.name} pi thinking`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} pi cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} pi timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} pi log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    subprovider,
    model,
    apiKey,
    baseUrl,
    tools,
    thinking,
    cwd,
    timeoutMs,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function resolvePiCliConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): PiCliResolvedConfig {
  const command = resolveProcessCommandArgv(target, env, `${target.name} pi-cli command`, ['pi']);
  const subproviderSource = target.subprovider;
  const modelSource = target.model ?? target.pi_model;
  const apiKeySource = target.api_key;
  const toolsSource = target.tools ?? target.pi_tools;
  const thinkingSource = target.reasoning_effort ?? target.thinking ?? target.pi_thinking;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);

  const subprovider = resolveOptionalString(
    subproviderSource,
    env,
    `${target.name} pi-cli subprovider`,
    { allowLiteral: true, optionalEnv: true },
  );

  const model = resolveOptionalString(modelSource, env, `${target.name} pi-cli model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const apiKey = resolveOptionalString(apiKeySource, env, `${target.name} pi-cli api key`, {
    allowLiteral: false,
    optionalEnv: true,
  });

  const baseUrlSource = target.base_url ?? target.endpoint;
  const baseUrl = resolveOptionalString(baseUrlSource, env, `${target.name} pi-cli base url`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const piCliSubprovider = normalizePiCliSubprovider(subprovider, baseUrl);

  const tools = resolveOptionalString(toolsSource, env, `${target.name} pi-cli tools`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const thinking = resolveOptionalString(thinkingSource, env, `${target.name} pi-cli thinking`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} pi-cli cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} pi-cli timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} pi-cli log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    command,
    executable: command[0],
    subprovider: piCliSubprovider,
    model,
    apiKey,
    baseUrl,
    tools,
    thinking,
    cwd,
    timeoutMs,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
    runtime: resolvePiRuntimeConfig(target, env),
  };
}

function resolvePiRpcConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): PiRpcResolvedConfig {
  const command = resolveProcessCommandArgv(target, env, `${target.name} pi-rpc command`, ['pi']);
  const subproviderSource = target.subprovider;
  const modelSource = target.model ?? target.pi_model;
  const apiKeySource = target.api_key;
  const toolsSource = target.tools ?? target.pi_tools;
  const thinkingSource = target.reasoning_effort ?? target.thinking ?? target.pi_thinking;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;
  const streamLogResult = resolveStreamLog(target);

  const subprovider = resolveOptionalString(
    subproviderSource,
    env,
    `${target.name} pi-rpc subprovider`,
    { allowLiteral: true, optionalEnv: true },
  );
  const model = resolveOptionalString(modelSource, env, `${target.name} pi-rpc model`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const apiKey = resolveOptionalString(apiKeySource, env, `${target.name} pi-rpc api key`, {
    allowLiteral: false,
    optionalEnv: true,
  });
  const baseUrlSource = target.base_url ?? target.endpoint;
  const baseUrl = resolveOptionalString(baseUrlSource, env, `${target.name} pi-rpc base url`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const piRpcSubprovider = normalizePiCliSubprovider(subprovider, baseUrl);
  const tools = resolveOptionalString(toolsSource, env, `${target.name} pi-rpc tools`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const thinking = resolveOptionalString(thinkingSource, env, `${target.name} pi-rpc thinking`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const cwd = resolveOptionalString(cwdSource, env, `${target.name} pi-rpc cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} pi-rpc timeout`);
  const logDir = resolveOptionalString(logDirSource, env, `${target.name} pi-rpc log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    command,
    subprovider: piRpcSubprovider,
    model,
    apiKey,
    baseUrl,
    tools,
    thinking,
    cwd,
    timeoutMs,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
    runtime: resolvePiRuntimeConfig(target, env),
  };
}

function normalizePiCliSubprovider(
  subprovider: string | undefined,
  baseUrl: string | undefined,
): string | undefined {
  if (!baseUrl) return subprovider;
  if (!subprovider || subprovider.toLowerCase() === 'openai') {
    // PI CLI's OpenAI provider treats --api-key as a real OpenAI key path.
    // OpenAI-compatible endpoints work reliably through its Azure provider,
    // which accepts full endpoint URLs via AZURE_OPENAI_BASE_URL.
    return 'azure';
  }
  return subprovider;
}

function resolveProcessCommandArgv(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  description: string,
  defaultCommand: readonly string[],
): readonly string[] {
  const rawCommand = target.command;
  if (Array.isArray(rawCommand)) {
    const command = resolveOptionalStringArray(rawCommand, env, description);
    if (!command || command.length === 0) {
      throw new Error(`${description} must be a non-empty argv array`);
    }
    return command;
  }

  const executableSource = target.executable ?? target.command ?? target.binary;
  const executable = resolveOptionalString(executableSource, env, `${description} executable`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const args = resolveOptionalStringArray(
    target.args ?? target.arguments,
    env,
    `${description} args`,
  );
  return [...(executable ? [executable] : defaultCommand), ...(args ?? [])];
}

function resolvePiRuntimeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): PiRuntimeResolvedConfig {
  const raw = target.runtime;
  if (raw === undefined || raw === null) {
    return { mode: 'host' };
  }
  if (typeof raw === 'string') {
    return { mode: normalizeRuntimeMode(raw, target.name) };
  }
  if (!isRecord(raw)) {
    throw new Error(`${target.name} runtime must be 'host' or an object with mode`);
  }

  const mode = normalizeRuntimeMode(String(raw.mode ?? ''), target.name);
  const home = resolveOptionalString(raw.home, env, `${target.name} runtime home`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const runtimeEnv = resolveRuntimeEnv(raw.env, env, target.name);
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== 'mode' && key !== 'home' && key !== 'env'),
  );
  return {
    ...rest,
    mode,
    ...(home ? { home } : {}),
    ...(runtimeEnv ? { env: runtimeEnv } : {}),
  };
}

function normalizeRuntimeMode(value: string, targetName: string): PiRuntimeResolvedConfig['mode'] {
  const mode = value.trim();
  if (mode === 'host' || mode === 'profile' || mode === 'sandbox') {
    return mode;
  }
  throw new Error(`${targetName} runtime.mode must be one of: host, profile, sandbox`);
}

function resolveRuntimeEnv(
  raw: unknown,
  env: EnvLookup,
  targetName: string,
): Readonly<Record<string, string>> | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error(`${targetName} runtime.env must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`${targetName} runtime.env has invalid variable name '${key}'`);
    }
    const resolved = resolveOptionalString(value, env, `${targetName} runtime.env.${key}`, {
      allowLiteral: true,
      optionalEnv: true,
    });
    if (resolved !== undefined) {
      result[key] = resolved;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolveClaudeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  _evalFilePath?: string,
): ClaudeResolvedConfig {
  assertNoProcessCommandAliases(target, 'claude-cli');
  const command = resolveCommandArgv(target.command, env, `${target.name} claude-cli command`, [
    'claude',
  ]);
  const modelSource = target.model;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);

  const model = resolveOptionalString(modelSource, env, `${target.name} claude model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} claude cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} claude timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} claude log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  const maxTurns = typeof target.max_turns === 'number' ? target.max_turns : undefined;

  const maxBudgetUsd =
    typeof target.max_budget_usd === 'number' ? target.max_budget_usd : undefined;

  const bypassPermissions =
    target.bypass_permissions !== undefined
      ? resolveOptionalBoolean(target.bypass_permissions)
      : undefined;

  return {
    command,
    executable: command[0] ?? 'claude',
    model,
    systemPrompt,
    cwd,
    timeoutMs,
    maxTurns,
    maxBudgetUsd,
    logDir,
    logFormat: streamLogResult.logFormat,
    streamLog: streamLogResult.streamLog,
    bypassPermissions,
  };
}

function resolveMockConfig(target: z.infer<typeof BASE_TARGET_SCHEMA>): MockResolvedConfig {
  const response = typeof target.response === 'string' ? target.response : undefined;
  return { response };
}

function resolveReplayConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): ReplayResolvedConfig {
  const fixtures = resolveOptionalString(target.fixtures, env, `${target.name} replay fixtures`, {
    allowLiteral: true,
  });
  const executionTraces = resolveOptionalString(
    target.execution_traces,
    env,
    `${target.name} replay execution_traces`,
    {
      allowLiteral: true,
    },
  );
  const transcripts = resolveOptionalString(
    target.transcripts,
    env,
    `${target.name} replay transcripts`,
    {
      allowLiteral: true,
    },
  );
  if ((fixtures ? 1 : 0) + (executionTraces ? 1 : 0) + (transcripts ? 1 : 0) !== 1) {
    throw new Error(
      `Target "${target.name}" (provider: replay) requires exactly one replay source: "fixtures", "execution_traces", or "transcripts"`,
    );
  }
  const fixturesPath = fixtures ? resolveReplaySourcePath(fixtures, evalFilePath) : undefined;
  const executionTracesPath = executionTraces
    ? resolveReplaySourcePath(executionTraces, evalFilePath)
    : undefined;
  const transcriptsPath = transcripts
    ? resolveReplaySourcePath(transcripts, evalFilePath)
    : undefined;
  const source: ReplayResolvedSource = fixturesPath
    ? { kind: 'fixtures', path: fixturesPath }
    : executionTracesPath
      ? { kind: 'execution_traces', path: executionTracesPath }
      : { kind: 'transcripts', path: transcriptsPath as string };
  const sourceTarget = resolveString(
    target.source_target,
    env,
    `${target.name} replay source_target`,
    true,
  );
  const suite = resolveOptionalString(target.suite, env, `${target.name} replay suite`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const evalPath = resolveOptionalString(target.eval_path, env, `${target.name} replay eval_path`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const variant = resolveOptionalString(target.variant, env, `${target.name} replay variant`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  return {
    source,
    fixturesPath,
    transcriptsPath,
    sourceTarget,
    suite,
    evalPath,
    variant,
  };
}

function resolveReplaySourcePath(sourcePath: string, evalFilePath?: string): string {
  return evalFilePath && !path.isAbsolute(sourcePath)
    ? path.resolve(path.dirname(path.resolve(evalFilePath)), sourcePath)
    : path.resolve(sourcePath);
}

function resolveVSCodeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  insiders: boolean,
  _evalFilePath?: string,
): VSCodeResolvedConfig {
  const executableSource = target.executable;
  const waitSource = target.wait;
  const dryRunSource = target.dry_run;
  const subagentRootSource = target.subagent_root;
  const timeoutSource = target.timeout_seconds;

  const defaultCommand = insiders ? 'code-insiders' : 'code';
  const executable =
    resolveOptionalString(executableSource, env, `${target.name} vscode executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? defaultCommand;

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} vscode timeout`);

  return {
    executable,
    waitForResponse: resolveOptionalBoolean(waitSource) ?? true,
    dryRun: resolveOptionalBoolean(dryRunSource) ?? false,
    subagentRoot: resolveOptionalString(subagentRootSource, env, `${target.name} subagent root`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
    timeoutMs,
  };
}

/**
 * Custom Zod error map for CLI provider validation.
 * Provides clear, user-friendly error messages for common validation failures.
 */
const cliErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return { message: `Unknown CLI provider settings: ${issue.keys.join(', ')}` };
  }
  if (issue.code === z.ZodIssueCode.invalid_union) {
    return { message: "healthcheck must have either 'url' (HTTP) or 'command' (command)" };
  }
  if (issue.code === z.ZodIssueCode.invalid_type && issue.expected === 'string') {
    return { message: `${ctx.defaultError} (expected a string value)` };
  }
  return { message: ctx.defaultError };
};

/**
 * Resolves a CLI target configuration using Zod schema validation and normalization.
 *
 * This function:
 * 1. Parses the raw target with CliTargetInputSchema for structural validation
 * 2. Normalizes the input using normalizeCliTargetInput() for env var resolution and casing
 * 3. Validates CLI placeholders in the command
 *
 * @param target - The raw target definition from YAML
 * @param env - Environment variable lookup for {{ env.VAR }} resolution
 * @param evalFilePath - Optional path to eval file for relative path resolution
 * @returns Normalized CLI configuration matching CliResolvedConfig
 */
function resolveCliConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): CliResolvedConfig {
  // Parse with Zod schema for structural validation with custom error messages
  const parseResult = CliTargetInputSchema.safeParse(target, { errorMap: cliErrorMap });
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const path = firstError?.path.join('.') || '';
    const prefix = path ? `${target.name} ${path}: ` : `${target.name}: `;
    throw new Error(`${prefix}${firstError?.message}`);
  }

  // Normalize the parsed input (handles env var resolution, casing, path resolution)
  const normalized = normalizeCliTargetInput(parseResult.data, env, evalFilePath);

  // Validate CLI placeholders in command
  assertSupportedCliPlaceholders(normalized.command, `${target.name} CLI command`);

  // Validate CLI placeholders in healthcheck command if present
  if (
    'command' in (normalized.healthcheck ?? {}) &&
    (normalized.healthcheck as { command: string }).command
  ) {
    assertSupportedCliPlaceholders(
      (normalized.healthcheck as { command: string }).command,
      `${target.name} healthcheck command`,
    );
  }

  return normalized;
}

/**
 * Resolves configuration for a discovered (convention-based) provider.
 *
 * When the provider kind doesn't match any built-in provider, it is assumed
 * to be a convention-based provider discovered from `.agentv/providers/`.
 * The command defaults to `bun run .agentv/providers/<kind>.ts {PROMPT}`
 * but can be overridden via `command` in the target definition.
 */
function resolveDiscoveredProviderConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  providerKind: string,
  env: EnvLookup,
  evalFilePath?: string,
): CliResolvedConfig {
  // Use explicit command if provided, otherwise derive from convention
  const command = target.command
    ? resolveString(target.command, env, `${target.name} command`, true)
    : `bun run .agentv/providers/${providerKind}.ts {PROMPT}`;

  // Resolve optional fields using the same patterns as CLI providers
  const timeoutSeconds = target.timeout_seconds;
  const timeoutMs = resolveTimeoutMs(timeoutSeconds, `${target.name} timeout`);

  let cwd = resolveOptionalString(target.cwd, env, `${target.name} working directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  // Resolve relative cwd paths against eval file directory
  if (cwd && evalFilePath && !path.isAbsolute(cwd)) {
    cwd = path.resolve(path.dirname(path.resolve(evalFilePath)), cwd);
  }

  // Fallback: if cwd is not set and we have an eval file path, use the eval directory
  if (!cwd && evalFilePath) {
    cwd = path.dirname(path.resolve(evalFilePath));
  }

  return {
    command,
    cwd,
    timeoutMs,
  };
}

function resolveTimeoutMs(source: unknown, description: string): number | undefined {
  const seconds = resolveOptionalNumber(source, `${description} (seconds)`);
  if (seconds === undefined) {
    return undefined;
  }
  if (seconds <= 0) {
    throw new Error(`${description} must be greater than zero seconds`);
  }
  return Math.floor(seconds * 1000);
}

function assertSupportedCliPlaceholders(template: string, description: string): void {
  const placeholders = extractCliPlaceholders(template);
  for (const placeholder of placeholders) {
    if (!CLI_PLACEHOLDERS.has(placeholder)) {
      throw new Error(
        `${description} includes unsupported placeholder '{${placeholder}}'. Supported placeholders: ${Array.from(CLI_PLACEHOLDERS).join(', ')}`,
      );
    }
  }
}

function extractCliPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{([A-Z_]+)\}/g);
  const results: string[] = [];
  for (const match of matches) {
    if (match[1]) {
      results.push(match[1]);
    }
  }
  return results;
}

function resolveString(
  source: unknown,
  env: EnvLookup,
  description: string,
  allowLiteral = false,
): string {
  const value = resolveOptionalString(source, env, description, {
    allowLiteral,
    optionalEnv: false,
  });
  if (value === undefined) {
    throw new Error(`${description} is required`);
  }
  return value;
}

/**
 * Resolve a string value from targets.yaml, supporting `{{ env.VARIABLE }}` env var syntax.
 *
 * Security: By default (`allowLiteral: false`), values MUST use the `{{ env.VARIABLE_NAME }}`
 * syntax to reference environment variables. Literal strings are rejected to prevent
 * secrets (API keys, tokens) from being committed in plaintext to targets.yaml.
 * Only non-sensitive fields like `cwd` or `model` use `allowLiteral: true`.
 */
function resolveOptionalString(
  source: unknown,
  env: EnvLookup,
  description: string,
  options?: { allowLiteral?: boolean; optionalEnv?: boolean },
): string | undefined {
  if (source === undefined || source === null) {
    return undefined;
  }
  if (typeof source !== 'string') {
    throw new Error(`${description} must be a string`);
  }
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const legacyEnvVarMatch = trimmed.match(LEGACY_ENV_TEMPLATE_PATTERN);
  if (legacyEnvVarMatch) {
    const varName = legacyEnvVarMatch[1];
    throw new Error(
      `${description} uses removed legacy environment syntax \${{ ${varName} }}. Use {{ env.${varName} }} instead.`,
    );
  }

  if (trimmed.includes('{{') && trimmed.includes('env.')) {
    const allowLiteral = options?.allowLiteral ?? false;
    const isSecretField = /\b(api key|bearer token|github token|token|secret)\b/i.test(description);
    const wholeEnvMatch = trimmed.match(SECRET_ENV_TEMPLATE_PATTERN);
    if (!allowLiteral && isSecretField && !SECRET_ENV_TEMPLATE_PATTERN.test(trimmed)) {
      throw new Error(`${description} must use a whole {{ env.VARIABLE_NAME }} reference`);
    }
    const rendered = renderEnvTemplateString(trimmed, env).trim();
    if (rendered.length === 0) {
      if (options?.optionalEnv ?? false) {
        return undefined;
      }
      if (wholeEnvMatch) {
        const varName = wholeEnvMatch[1] ?? 'VARIABLE_NAME';
        throw new Error(
          `${description} env template {{ env.${varName} }} resolved to an empty value; ${varName} is not set`,
        );
      }
      throw new Error(`${description} env template resolved to an empty value`);
    }
    return rendered;
  }

  // Return as literal value
  const allowLiteral = options?.allowLiteral ?? false;
  if (!allowLiteral) {
    throw new Error(
      `${description} must use {{ env.VARIABLE_NAME }} syntax for environment variables or be marked as allowing literals`,
    );
  }
  return trimmed;
}

function resolveOptionalLiteralString(source: unknown): string | undefined {
  if (source === undefined || source === null) {
    return undefined;
  }
  if (typeof source !== 'string') {
    throw new Error('expected string value');
  }
  const trimmed = source.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveOptionalNumber(source: unknown, description: string): number | undefined {
  if (source === undefined || source === null || source === '') {
    return undefined;
  }
  if (typeof source === 'number') {
    return Number.isFinite(source) ? source : undefined;
  }
  if (typeof source === 'string') {
    const numeric = Number(source);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  throw new Error(`${description} must be a number`);
}

function resolveOptionalBoolean(source: unknown): boolean | undefined {
  if (source === undefined || source === null || source === '') {
    return undefined;
  }
  if (typeof source === 'boolean') {
    return source;
  }
  if (typeof source === 'string') {
    const lowered = source.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') {
      return true;
    }
    if (lowered === 'false' || lowered === '0') {
      return false;
    }
  }
  throw new Error('expected boolean value');
}

function resolveOptionalStringArray(
  source: unknown,
  env: EnvLookup,
  description: string,
): readonly string[] | undefined {
  if (source === undefined || source === null) {
    return undefined;
  }
  if (!Array.isArray(source)) {
    throw new Error(`${description} must be an array of strings`);
  }
  if (source.length === 0) {
    return undefined;
  }
  const resolved: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (typeof item !== 'string') {
      throw new Error(`${description}[${i}] must be a string`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`${description}[${i}] cannot be empty`);
    }

    const legacyEnvVarMatch = trimmed.match(LEGACY_ENV_TEMPLATE_PATTERN);
    if (legacyEnvVarMatch) {
      const varName = legacyEnvVarMatch[1];
      throw new Error(
        `${description}[${i}] uses removed legacy environment syntax \${{ ${varName} }}. Use {{ env.${varName} }} instead.`,
      );
    }

    if (trimmed.includes('{{') && trimmed.includes('env.')) {
      const wholeEnvMatch = trimmed.match(SECRET_ENV_TEMPLATE_PATTERN);
      const rendered = renderEnvTemplateString(trimmed, env).trim();
      if (rendered.length === 0) {
        if (wholeEnvMatch) {
          const varName = wholeEnvMatch[1] ?? 'VARIABLE_NAME';
          throw new Error(
            `${description}[${i}] env template {{ env.${varName} }} resolved to an empty value; ${varName} is not set`,
          );
        }
        throw new Error(`${description}[${i}] env template resolved to an empty value`);
      }
      resolved.push(rendered);
      continue;
    }

    // Treat as literal value
    resolved.push(trimmed);
  }
  return resolved.length > 0 ? resolved : undefined;
}

function resolveOptionalNumberArray(
  source: unknown,
  description: string,
): readonly number[] | undefined {
  if (source === undefined || source === null) {
    return undefined;
  }
  if (!Array.isArray(source)) {
    throw new Error(`${description} must be an array of numbers`);
  }
  if (source.length === 0) {
    return undefined;
  }
  const resolved: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error(`${description}[${i}] must be a number`);
    }
    resolved.push(item);
  }
  return resolved.length > 0 ? resolved : undefined;
}
