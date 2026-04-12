import path from 'node:path';
import { z } from 'zod';

import type { EnvLookup, TargetDefinition } from './types.js';

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

    // Workspace template directory - optional (mutually exclusive with cwd)
    workspace_template: z.string().optional(),

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
    judge_target: z.string().optional(), // backward compat
    workers: z.number().int().min(1).optional(),
    provider_batching: z.boolean().optional(),
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
    workspaceTemplate: z.string().optional(),
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
 * ${{ VAR_NAME }} syntax and converts external YAML field names to the
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

  // Resolve workspace template (mutually exclusive with cwd)
  const workspaceTemplateSource = input.workspace_template;
  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${targetName} workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Resolve working directory
  let cwd = resolveOptionalString(input.cwd, env, `${targetName} working directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  // Resolve relative cwd paths against eval file directory
  if (cwd && evalFilePath && !path.isAbsolute(cwd)) {
    cwd = path.resolve(path.dirname(path.resolve(evalFilePath)), cwd);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${targetName}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

  // Fallback: if cwd is not set, workspace_template is not set, and we have an eval file path, use the eval directory
  if (!cwd && !workspaceTemplate && evalFilePath) {
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
    workspaceTemplate,
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
 * Azure OpenAI settings used by the Vercel AI SDK.
 */
export interface AzureResolvedConfig {
  readonly resourceName: string;
  readonly deploymentName: string;
  readonly apiKey: string;
  readonly version?: string;
  readonly apiFormat?: ApiFormat;
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
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export interface CopilotCliResolvedConfig {
  readonly executable: string;
  readonly model?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export interface CopilotSdkResolvedConfig {
  readonly cliUrl?: string;
  readonly cliPath?: string;
  readonly githubToken?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
  /** BYOK provider type: "azure", "openai", or "anthropic". */
  readonly byokType?: string;
  /** BYOK base URL for the provider endpoint. */
  readonly byokBaseUrl?: string;
  /** BYOK API key for authenticating with the provider. */
  readonly byokApiKey?: string;
  /** BYOK bearer token (takes precedence over apiKey when set). */
  readonly byokBearerToken?: string;
  /** BYOK Azure API version (e.g. "2024-10-21"). Only used when byokType is "azure". */
  readonly byokApiVersion?: string;
  /** BYOK wire API format: "completions" or "responses". */
  readonly byokWireApi?: string;
}

export interface CopilotLogResolvedConfig {
  /** Explicit path to a session directory containing events.jsonl. */
  readonly sessionDir?: string;
  /** Session UUID — combined with sessionStateDir to build the path. */
  readonly sessionId?: string;
  /** Auto-discovery mode. 'latest' picks the most recent session. */
  readonly discover?: 'latest';
  /** Override the default ~/.copilot/session-state directory. */
  readonly sessionStateDir?: string;
  /** Filter discovery by working directory. */
  readonly cwd?: string;
}

export interface PiCodingAgentResolvedConfig {
  readonly subprovider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export interface PiCliResolvedConfig {
  readonly executable: string;
  readonly subprovider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
  readonly systemPrompt?: string;
}

export interface ClaudeResolvedConfig {
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  /** New stream_log field. false=no stream log (default), 'raw'=per-event, 'summary'=consolidated. */
  readonly streamLog?: false | 'raw' | 'summary';
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
  readonly workspaceTemplate?: string;
  readonly timeoutMs?: number;
}

export interface AgentVResolvedConfig {
  readonly model: string;
  readonly temperature: number;
}

export interface TargetDeprecationWarning {
  readonly location: string;
  readonly message: string;
}

const DEPRECATED_TARGET_CAMEL_CASE_FIELDS = new Map<string, string>([
  ['providerBatching', 'provider_batching'],
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
  ['logFormat', 'log_format'],
  ['logOutputFormat', 'log_output_format'],
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
]);

const DEPRECATED_HEALTHCHECK_CAMEL_CASE_FIELDS = new Map<string, string>([
  ['timeoutSeconds', 'timeout_seconds'],
]);

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

function assertNoDeprecatedCamelCaseTargetFields(definition: TargetDefinition): void {
  if (Object.prototype.hasOwnProperty.call(definition, 'workspaceTemplate')) {
    throw new Error(
      `${definition.name}: target-level workspace_template has been removed. Use eval-level workspace.template.`,
    );
  }

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

/** Base fields shared by all resolved targets. */
interface ResolvedTargetBase {
  readonly name: string;
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

export type ResolvedTarget =
  | (ResolvedTargetBase & { readonly kind: 'openai'; readonly config: OpenAIResolvedConfig })
  | (ResolvedTargetBase & {
      readonly kind: 'openrouter';
      readonly config: OpenRouterResolvedConfig;
    })
  | (ResolvedTargetBase & { readonly kind: 'azure'; readonly config: AzureResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'anthropic'; readonly config: AnthropicResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'gemini'; readonly config: GeminiResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'codex'; readonly config: CodexResolvedConfig })
  | (ResolvedTargetBase & {
      readonly kind: 'copilot-sdk';
      readonly config: CopilotSdkResolvedConfig;
    })
  | (ResolvedTargetBase & {
      readonly kind: 'copilot-cli';
      readonly config: CopilotCliResolvedConfig;
    })
  | (ResolvedTargetBase & {
      readonly kind: 'copilot-log';
      readonly config: CopilotLogResolvedConfig;
    })
  | (ResolvedTargetBase & {
      readonly kind: 'pi-coding-agent';
      readonly config: PiCodingAgentResolvedConfig;
    })
  | (ResolvedTargetBase & { readonly kind: 'pi-cli'; readonly config: PiCliResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'claude'; readonly config: ClaudeResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'claude-cli'; readonly config: ClaudeResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'claude-sdk'; readonly config: ClaudeResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'mock'; readonly config: MockResolvedConfig })
  | (ResolvedTargetBase & {
      readonly kind: 'vscode' | 'vscode-insiders';
      readonly config: VSCodeResolvedConfig;
    })
  | (ResolvedTargetBase & { readonly kind: 'agentv'; readonly config: AgentVResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'cli'; readonly config: CliResolvedConfig })
  | (ResolvedTargetBase & { readonly kind: 'transcript'; readonly config: Record<string, never> });

/**
 * Optional settings accepted on ALL target definitions regardless of provider.
 * Exported so the targets validator can reuse the same list — adding a field
 * here automatically makes it valid in targets.yaml without a separate update.
 */
export const COMMON_TARGET_SETTINGS = [
  'use_target',
  'provider_batching',
  'subagent_mode_allowed',
  'fallback_targets',
] as const;

const USE_TARGET_ENV_PATTERN = /^\$\{\{\s*([A-Z0-9_]+)\s*\}\}$/i;

const BASE_TARGET_SCHEMA = z
  .object({
    name: z.string().min(1, 'target name is required'),
    provider: z.string().optional(),
    use_target: z.string().optional(),
    grader_target: z.string().optional(),
    judge_target: z.string().optional(), // backward compat
    workers: z.number().int().min(1).optional(),
    workspace_template: z.string().optional(),
    subagent_mode_allowed: z.boolean().optional(),
    fallback_targets: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const DEFAULT_AZURE_API_VERSION = '2024-12-01-preview';
const DEFAULT_AZURE_RESPONSES_API_VERSION = 'v1';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function normalizeAzureApiVersion(
  value: string | undefined,
  apiFormat: ApiFormat | undefined,
): string {
  const defaultVersion =
    apiFormat === 'responses' ? DEFAULT_AZURE_RESPONSES_API_VERSION : DEFAULT_AZURE_API_VERSION;

  if (!value) {
    return defaultVersion;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return defaultVersion;
  }

  const withoutPrefix = trimmed.replace(/^api[-_]?version\s*=\s*/i, '').trim();
  return withoutPrefix.length > 0 ? withoutPrefix : defaultVersion;
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

export function resolveDelegatedTargetDefinition(
  name: string,
  definitions: ReadonlyMap<string, TargetDefinition>,
  env: EnvLookup = process.env,
): TargetDefinition | undefined {
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

    const envMatch = rawUseTarget.match(USE_TARGET_ENV_PATTERN);
    const envVarName = envMatch?.[1];
    const resolvedName = envVarName ? (env[envVarName]?.trim() ?? '') : rawUseTarget;

    if (resolvedName.length === 0) {
      if (envVarName) {
        throw new Error(
          `Target "${definition.name}" uses use_target: \${{ ${envVarName} }}, but ${envVarName} is not set. Set ${envVarName} to the name of a concrete target (for example, "azure") before running the eval.`,
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
          `Target "${definition.name}" uses use_target: \${{ ${envVarName} }}, which resolved to "${resolvedName}", but no target named "${resolvedName}" exists.`,
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

export function resolveTargetDefinition(
  definition: TargetDefinition,
  env: EnvLookup = process.env,
  evalFilePath?: string,
  options?: { readonly emitDeprecationWarnings?: boolean },
): ResolvedTarget {
  void options;
  assertNoDeprecatedCamelCaseTargetFields(definition);

  const parsed = BASE_TARGET_SCHEMA.parse(definition);
  if (parsed.workspace_template !== undefined) {
    throw new Error(
      `${parsed.name}: target-level workspace_template has been removed. Use eval-level workspace.template.`,
    );
  }
  if (!parsed.provider) {
    throw new Error(
      `${parsed.name}: 'provider' is required (targets with use_target must be resolved before calling resolveTargetDefinition)`,
    );
  }
  const provider = resolveString(
    parsed.provider,
    env,
    `${parsed.name} provider`,
    true,
  ).toLowerCase();
  const providerBatching = resolveOptionalBoolean(parsed.provider_batching);
  const subagentModeAllowed = resolveOptionalBoolean(parsed.subagent_mode_allowed);

  // Shared base fields for all resolved targets
  const fallbackTargets = parsed.fallback_targets;
  const base = {
    name: parsed.name,
    graderTarget: parsed.grader_target ?? parsed.judge_target,
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
    case 'azure-openai':
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
    case 'google':
    case 'google-gemini':
      return {
        kind: 'gemini',
        ...base,
        config: resolveGeminiConfig(parsed, env),
      };
    case 'codex':
    case 'codex-cli':
      return {
        kind: 'codex',
        ...base,
        config: resolveCodexConfig(parsed, env, evalFilePath),
      };
    case 'copilot-sdk':
    case 'copilot_sdk':
      return {
        kind: 'copilot-sdk',
        ...base,
        config: resolveCopilotSdkConfig(parsed, env, evalFilePath),
      };
    case 'copilot':
    case 'copilot-cli':
      return {
        kind: 'copilot-cli',
        ...base,
        config: resolveCopilotCliConfig(parsed, env, evalFilePath),
      };
    case 'copilot-log':
      return {
        kind: 'copilot-log',
        ...base,
        config: resolveCopilotLogConfig(parsed, env),
      };
    case 'pi':
    case 'pi-coding-agent':
      return {
        kind: 'pi-coding-agent',
        ...base,
        config: resolvePiCodingAgentConfig(parsed, env, evalFilePath),
      };
    case 'pi-cli':
      return {
        kind: 'pi-cli',
        ...base,
        config: resolvePiCliConfig(parsed, env, evalFilePath),
      };
    case 'claude':
    case 'claude-code':
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

  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function resolveAzureConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): AzureResolvedConfig {
  const endpointSource = target.endpoint ?? target.resource;
  const apiKeySource = target.api_key;
  const deploymentSource = target.deployment ?? target.model;
  const versionSource = target.version ?? target.api_version;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;

  const resourceName = resolveString(endpointSource, env, `${target.name} endpoint`);
  const apiKey = resolveString(apiKeySource, env, `${target.name} api key`);
  const deploymentName = resolveString(deploymentSource, env, `${target.name} deployment`);
  const apiFormat = resolveApiFormat(target, env, target.name);
  const version = normalizeAzureApiVersion(
    resolveOptionalString(versionSource, env, `${target.name} api version`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
    apiFormat,
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
    apiFormat,
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

function resolveOpenAIConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): OpenAIResolvedConfig {
  const endpointSource = target.endpoint ?? target.base_url;
  const apiKeySource = target.api_key;
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;

  const baseURL = normalizeOpenAIBaseUrl(
    resolveOptionalString(endpointSource, env, `${target.name} endpoint`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  );
  const apiKey = resolveString(apiKeySource, env, `${target.name} api key`);
  const model = resolveString(modelSource, env, `${target.name} model`);
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
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;
  const retry = resolveRetryConfig(target);

  return {
    apiKey: resolveString(apiKeySource, env, `${target.name} OpenRouter api key`),
    model: resolveString(modelSource, env, `${target.name} OpenRouter model`),
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
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens;
  const thinkingBudgetSource = target.thinking_budget;

  const apiKey = resolveString(apiKeySource, env, `${target.name} Anthropic api key`);
  const model = resolveString(modelSource, env, `${target.name} Anthropic model`);
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
  evalFilePath?: string,
): CodexResolvedConfig {
  const modelSource = target.model;
  const executableSource = target.executable ?? target.command ?? target.binary;
  const argsSource = target.args ?? target.arguments;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource =
    target.log_format ?? target.log_output_format ?? env.AGENTV_CODEX_LOG_FORMAT;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target, env.AGENTV_CODEX_LOG_FORMAT);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

  const model = resolveOptionalString(modelSource, env, `${target.name} codex model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const executable =
    resolveOptionalString(executableSource, env, `${target.name} codex executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'codex';

  const args = resolveOptionalStringArray(argsSource, env, `${target.name} codex args`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} codex cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} codex workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${target.name}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} codex timeout`);
  const logDir = resolveOptionalString(logDirSource, env, `${target.name} codex log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const logFormat = normalizeCodexLogFormat(logFormatSource);

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    model,
    executable,
    args,
    cwd,
    workspaceTemplate,
    timeoutMs,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function normalizeCodexLogFormat(value: unknown): 'summary' | 'json' | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error("codex log format must be 'summary' or 'json'");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'summary') {
    return normalized;
  }
  throw new Error("codex log format must be 'summary' or 'json'");
}

/**
 * Resolve the stream_log config field, falling back to log_format with a
 * deprecation warning.
 *
 * Resolution order:
 *   1. stream_log (new canonical field)
 *   2. log_format / log_output_format (deprecated, mapped to stream_log equivalent)
 *   3. environment variable fallback (optional)
 *
 * Mapping: log_format 'json' → 'raw', log_format 'summary' → 'summary'.
 */
function resolveStreamLog(
  target: { stream_log?: unknown; log_format?: unknown; log_output_format?: unknown; name: string },
  envFallback?: unknown,
): {
  streamLog: false | 'raw' | 'summary' | undefined;
  logFormat: 'summary' | 'json' | undefined;
  deprecationWarning?: string;
} {
  // 1. New stream_log field takes precedence
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

  // 2. Fall back to log_format (deprecated)
  const logFormatRaw = target.log_format ?? target.log_output_format ?? envFallback;
  if (logFormatRaw === undefined || logFormatRaw === null) {
    return { streamLog: undefined, logFormat: undefined };
  }

  if (typeof logFormatRaw !== 'string') {
    throw new Error(`${target.name}: log_format must be 'summary' or 'json'`);
  }

  const normalized = logFormatRaw.trim().toLowerCase();
  if (normalized !== 'json' && normalized !== 'summary') {
    throw new Error(`${target.name}: log_format must be 'summary' or 'json'`);
  }

  const streamLogEquivalent = normalized === 'json' ? 'raw' : 'summary';
  return {
    streamLog: streamLogEquivalent,
    logFormat: normalized as 'json' | 'summary',
    deprecationWarning: `${target.name}: 'log_format' is deprecated and will be removed in v4.16. Use 'stream_log: ${streamLogEquivalent}' instead (log_format: '${normalized}' → stream_log: '${streamLogEquivalent}').`,
  };
}

function resolveCopilotSdkConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): CopilotSdkResolvedConfig {
  const cliUrlSource = target.cli_url;
  const cliPathSource = target.cli_path;
  const githubTokenSource = target.github_token;
  const modelSource = target.model;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource = target.log_format;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

  const cliUrl = resolveOptionalString(cliUrlSource, env, `${target.name} copilot-sdk cli URL`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cliPath = resolveOptionalString(cliPathSource, env, `${target.name} copilot-sdk cli path`, {
    allowLiteral: true,
    optionalEnv: true,
  });

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

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} copilot-sdk workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${target.name}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

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

  const logFormat = normalizeCopilotLogFormat(logFormatSource);

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  // BYOK (Bring Your Own Key) — allows routing through a user-provided endpoint
  // instead of GitHub's Copilot infrastructure. The byok block maps to the SDK's
  // `provider` option on createSession(). See copilot-sdk docs/auth/byok.md.
  const byok = target.byok as Record<string, unknown> | undefined;
  let byokType: string | undefined;
  let byokBaseUrl: string | undefined;
  let byokApiKey: string | undefined;
  let byokBearerToken: string | undefined;
  let byokApiVersion: string | undefined;
  let byokWireApi: string | undefined;

  if (byok && typeof byok === 'object') {
    byokType = resolveOptionalString(byok.type, env, `${target.name} byok type`, {
      allowLiteral: true,
      optionalEnv: true,
    });

    byokBaseUrl = resolveOptionalString(byok.base_url, env, `${target.name} byok base URL`, {
      allowLiteral: true,
      optionalEnv: true,
    });

    byokApiKey = resolveOptionalString(byok.api_key, env, `${target.name} byok API key`, {
      allowLiteral: false,
      optionalEnv: true,
    });

    byokBearerToken = resolveOptionalString(
      byok.bearer_token,
      env,
      `${target.name} byok bearer token`,
      {
        allowLiteral: false,
        optionalEnv: true,
      },
    );

    byokApiVersion = resolveOptionalString(
      byok.api_version,
      env,
      `${target.name} byok API version`,
      {
        allowLiteral: true,
        optionalEnv: true,
      },
    );

    byokWireApi = resolveOptionalString(byok.wire_api, env, `${target.name} byok wire API`, {
      allowLiteral: true,
      optionalEnv: true,
    });

    // base_url is required when byok is specified
    if (!byokBaseUrl) {
      throw new Error(`${target.name}: 'byok.base_url' is required when 'byok' is specified`);
    }
  }

  return {
    cliUrl,
    cliPath,
    githubToken,
    model,
    cwd,
    workspaceTemplate,
    timeoutMs,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
    byokType,
    byokBaseUrl,
    byokApiKey,
    byokBearerToken,
    byokApiVersion,
    byokWireApi,
  };
}

function resolveCopilotCliConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): CopilotCliResolvedConfig {
  const executableSource = target.executable ?? target.command ?? target.binary;
  const modelSource = target.model;
  const argsSource = target.args ?? target.arguments;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource = target.log_format;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

  const executable =
    resolveOptionalString(executableSource, env, `${target.name} copilot-cli executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'copilot';

  const model = resolveOptionalString(modelSource, env, `${target.name} copilot-cli model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const args = resolveOptionalStringArray(argsSource, env, `${target.name} copilot-cli args`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} copilot-cli cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} copilot-cli workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${target.name}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

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

  const logFormat = normalizeCopilotLogFormat(logFormatSource);

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    executable,
    model,
    args,
    cwd,
    workspaceTemplate,
    timeoutMs,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function normalizeCopilotLogFormat(value: unknown): 'summary' | 'json' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error("copilot log format must be 'summary' or 'json'");
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'summary') return normalized;
  throw new Error("copilot log format must be 'summary' or 'json'");
}

function resolvePiCodingAgentConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): PiCodingAgentResolvedConfig {
  const subproviderSource = target.subprovider;
  const modelSource = target.model ?? target.pi_model;
  const apiKeySource = target.api_key;
  const toolsSource = target.tools ?? target.pi_tools;
  const thinkingSource = target.thinking ?? target.pi_thinking;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource = target.log_format;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

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

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} pi workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${target.name}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} pi timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} pi log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const logFormat =
    logFormatSource === 'json' || logFormatSource === 'summary' ? logFormatSource : undefined;

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
    workspaceTemplate,
    timeoutMs,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function resolvePiCliConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): PiCliResolvedConfig {
  const executableSource = target.executable ?? target.command ?? target.binary;
  const subproviderSource = target.subprovider;
  const modelSource = target.model ?? target.pi_model;
  const apiKeySource = target.api_key;
  const toolsSource = target.tools ?? target.pi_tools;
  const thinkingSource = target.thinking ?? target.pi_thinking;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource = target.log_format;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

  const executable =
    resolveOptionalString(executableSource, env, `${target.name} pi-cli executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'pi';

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

  const tools = resolveOptionalString(toolsSource, env, `${target.name} pi-cli tools`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const thinking = resolveOptionalString(thinkingSource, env, `${target.name} pi-cli thinking`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const rawArgs = target.args ?? target.arguments;
  const args = resolveOptionalStringArray(rawArgs, env, `${target.name} pi-cli args`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} pi-cli cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} pi-cli workspace template`,
    { allowLiteral: true, optionalEnv: true },
  );

  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  if (cwd && workspaceTemplate) {
    throw new Error(`${target.name}: 'cwd' and 'workspace_template' are mutually exclusive.`);
  }

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} pi-cli timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} pi-cli log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const logFormat =
    logFormatSource === 'json' || logFormatSource === 'summary' ? logFormatSource : undefined;

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return {
    executable,
    subprovider,
    model,
    apiKey,
    baseUrl,
    tools,
    thinking,
    args,
    cwd,
    workspaceTemplate,
    timeoutMs,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
    systemPrompt,
  };
}

function resolveClaudeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  evalFilePath?: string,
): ClaudeResolvedConfig {
  const modelSource = target.model;
  const cwdSource = target.cwd;
  const workspaceTemplateSource = target.workspace_template;
  const timeoutSource = target.timeout_seconds;
  const logDirSource = target.log_dir ?? target.log_directory;
  const logFormatSource =
    target.log_format ?? target.log_output_format ?? env.AGENTV_CLAUDE_LOG_FORMAT;
  const systemPromptSource = target.system_prompt;

  const streamLogResult = resolveStreamLog(target);
  if (streamLogResult.deprecationWarning) {
    process.stderr.write(`[agentv] ⚠ ${streamLogResult.deprecationWarning}\n`);
  }

  const model = resolveOptionalString(modelSource, env, `${target.name} claude model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} claude cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  let workspaceTemplate = resolveOptionalString(
    workspaceTemplateSource,
    env,
    `${target.name} claude workspace template`,
    {
      allowLiteral: true,
      optionalEnv: true,
    },
  );

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

  // Validate mutual exclusivity of cwd and workspace_template
  if (cwd && workspaceTemplate) {
    throw new Error(
      `${target.name}: 'cwd' and 'workspace_template' are mutually exclusive. Use 'cwd' to run in an existing directory, or 'workspace_template' to copy a template to a temp location.`,
    );
  }

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} claude timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} claude log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const logFormat = normalizeClaudeLogFormat(logFormatSource);

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  const maxTurns = typeof target.max_turns === 'number' ? target.max_turns : undefined;

  const maxBudgetUsd =
    typeof target.max_budget_usd === 'number' ? target.max_budget_usd : undefined;

  return {
    model,
    systemPrompt,
    cwd,
    workspaceTemplate,
    timeoutMs,
    maxTurns,
    maxBudgetUsd,
    logDir,
    logFormat,
    streamLog: streamLogResult.streamLog,
  };
}

function normalizeClaudeLogFormat(value: unknown): 'summary' | 'json' | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error("claude log format must be 'summary' or 'json'");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'summary') {
    return normalized;
  }
  throw new Error("claude log format must be 'summary' or 'json'");
}

function resolveMockConfig(target: z.infer<typeof BASE_TARGET_SCHEMA>): MockResolvedConfig {
  const response = typeof target.response === 'string' ? target.response : undefined;
  return { response };
}

function resolveVSCodeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  insiders: boolean,
  evalFilePath?: string,
): VSCodeResolvedConfig {
  const workspaceTemplateEnvVar = resolveOptionalLiteralString(target.workspace_template);
  let workspaceTemplate = workspaceTemplateEnvVar
    ? resolveOptionalString(
        workspaceTemplateEnvVar,
        env,
        `${target.name} workspace template path`,
        {
          allowLiteral: true,
          optionalEnv: true,
        },
      )
    : undefined;

  // Resolve relative workspace template paths against eval file directory
  if (workspaceTemplate && evalFilePath && !path.isAbsolute(workspaceTemplate)) {
    workspaceTemplate = path.resolve(path.dirname(path.resolve(evalFilePath)), workspaceTemplate);
  }

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
    workspaceTemplate,
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
 * @param env - Environment variable lookup for ${{ VAR }} resolution
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

function resolveDiscover(value: unknown, targetName: string): 'latest' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'latest') return 'latest';
  throw new Error(`Target "${targetName}": discover must be "latest" (got "${String(value)}")`);
}

function resolveCopilotLogConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): CopilotLogResolvedConfig {
  const sessionDirSource = target.session_dir;
  const sessionIdSource = target.session_id;
  const discoverSource = target.discover;
  const sessionStateDirSource = target.session_state_dir;
  const cwdSource = target.cwd;

  return {
    sessionDir: resolveOptionalString(
      sessionDirSource,
      env,
      `${target.name} copilot-log session_dir`,
      { allowLiteral: true, optionalEnv: true },
    ),
    sessionId: resolveOptionalString(
      sessionIdSource,
      env,
      `${target.name} copilot-log session_id`,
      { allowLiteral: true, optionalEnv: true },
    ),
    discover: resolveDiscover(discoverSource, target.name),
    sessionStateDir: resolveOptionalString(
      sessionStateDirSource,
      env,
      `${target.name} copilot-log session_state_dir`,
      { allowLiteral: true, optionalEnv: true },
    ),
    cwd: resolveOptionalString(cwdSource, env, `${target.name} copilot-log cwd`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
  };
}

/**
 * Resolve a string value from targets.yaml, supporting `${{ VARIABLE }}` env var syntax.
 *
 * Security: By default (`allowLiteral: false`), values MUST use the `${{ VARIABLE_NAME }}`
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

  // Check for ${{ variable }} syntax
  const envVarMatch = trimmed.match(/^\$\{\{\s*([A-Z0-9_]+)\s*\}\}$/i);
  if (envVarMatch) {
    const varName = envVarMatch[1];
    const envValue = env[varName];
    const optionalEnv = options?.optionalEnv ?? false;

    // Treat empty or undefined env vars the same way
    if (envValue === undefined || envValue.trim().length === 0) {
      if (optionalEnv) {
        return undefined;
      }
      const status = envValue === undefined ? 'is not set' : 'is empty';
      throw new Error(`Environment variable '${varName}' required for ${description} ${status}`);
    }
    return envValue;
  }

  // Return as literal value
  const allowLiteral = options?.allowLiteral ?? false;
  if (!allowLiteral) {
    throw new Error(
      `${description} must use \${{ VARIABLE_NAME }} syntax for environment variables or be marked as allowing literals`,
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

    // Check for ${{ variable }} syntax
    const envVarMatch = trimmed.match(/^\$\{\{\s*([A-Z0-9_]+)\s*\}\}$/i);
    if (envVarMatch) {
      const varName = envVarMatch[1];
      const envValue = env[varName];
      if (envValue !== undefined) {
        if (envValue.trim().length === 0) {
          throw new Error(`Environment variable '${varName}' for ${description}[${i}] is empty`);
        }
        resolved.push(envValue);
        continue;
      }
      throw new Error(`Environment variable '${varName}' for ${description}[${i}] is not set`);
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
