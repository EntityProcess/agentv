import path from 'node:path';
import { z } from 'zod';

import type { EnvLookup, TargetDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Zod Schemas for CLI Provider Configuration
// ---------------------------------------------------------------------------

/**
 * Loose input schema for HTTP healthcheck configuration.
 * Accepts both snake_case (YAML convention) and camelCase (JavaScript convention)
 * property names for flexibility in configuration files.
 *
 * @example
 * ```yaml
 * healthcheck:
 *   type: http
 *   url: http://localhost:8080/health
 *   timeout_seconds: 30
 * ```
 */
export const CliHealthcheckHttpInputSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1, 'healthcheck URL is required'),
  timeout_seconds: z.number().positive().optional(),
  timeoutSeconds: z.number().positive().optional(),
});

/**
 * Loose input schema for command healthcheck configuration.
 * Accepts both snake_case (YAML convention) and camelCase (JavaScript convention)
 * property names for flexibility in configuration files.
 *
 * Note: discriminatedUnion requires plain ZodObject, so command_template/commandTemplate
 * presence is validated during normalization rather than here.
 *
 * @example
 * ```yaml
 * healthcheck:
 *   type: command
 *   command_template: curl http://localhost:8080/health
 *   cwd: /app
 *   timeout_seconds: 10
 * ```
 */
export const CliHealthcheckCommandInputSchema = z.object({
  type: z.literal('command'),
  command_template: z.string().optional(),
  commandTemplate: z.string().optional(),
  cwd: z.string().optional(),
  timeout_seconds: z.number().positive().optional(),
  timeoutSeconds: z.number().positive().optional(),
});

/**
 * Discriminated union for healthcheck input configuration.
 * Uses the 'type' field to distinguish between HTTP and command healthchecks.
 *
 * @see CliHealthcheckHttpInputSchema for HTTP healthcheck configuration
 * @see CliHealthcheckCommandInputSchema for command healthcheck configuration
 */
export const CliHealthcheckInputSchema = z.discriminatedUnion('type', [
  CliHealthcheckHttpInputSchema,
  CliHealthcheckCommandInputSchema,
]);

/**
 * Loose input schema for CLI target configuration.
 * Accepts both snake_case (YAML convention) and camelCase (JavaScript convention)
 * property names for maximum flexibility in configuration files.
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
 *     command_template: agent run {PROMPT}
 *     timeout_seconds: 120
 *     healthcheck:
 *       type: http
 *       url: http://localhost:8080/health
 * ```
 */
export const CliTargetInputSchema = z
  .object({
    name: z.string().min(1, 'target name is required'),
    provider: z
      .string()
      .refine((p) => p.toLowerCase() === 'cli', { message: "provider must be 'cli'" }),

    // Command template - required (accept both naming conventions)
    command_template: z.string().optional(),
    commandTemplate: z.string().optional(),

    // Files format - optional
    files_format: z.string().optional(),
    filesFormat: z.string().optional(),
    attachments_format: z.string().optional(),
    attachmentsFormat: z.string().optional(),

    // Working directory - optional
    cwd: z.string().optional(),

    // Timeout in seconds - optional
    timeout_seconds: z.number().positive().optional(),
    timeoutSeconds: z.number().positive().optional(),

    // Healthcheck configuration - optional
    healthcheck: CliHealthcheckInputSchema.optional(),

    // Verbose mode - optional
    verbose: z.boolean().optional(),
    cli_verbose: z.boolean().optional(),
    cliVerbose: z.boolean().optional(),

    // Keep temp files - optional
    keep_temp_files: z.boolean().optional(),
    keepTempFiles: z.boolean().optional(),
    keep_output_files: z.boolean().optional(),
    keepOutputFiles: z.boolean().optional(),

    // Common target fields
    judge_target: z.string().optional(),
    workers: z.number().int().min(1).optional(),
    provider_batching: z.boolean().optional(),
    providerBatching: z.boolean().optional(),
  })
  .refine((data) => data.command_template !== undefined || data.commandTemplate !== undefined, {
    message: 'Either command_template or commandTemplate is required',
  });

/**
 * Strict normalized schema for HTTP healthcheck configuration.
 * Uses camelCase property names only and rejects unknown properties.
 * This is an internal schema used as part of CliHealthcheckSchema.
 */
const CliHealthcheckHttpSchema = z
  .object({
    type: z.literal('http'),
    url: z.string().min(1),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

/**
 * Strict normalized schema for command healthcheck configuration.
 * Uses camelCase property names only and rejects unknown properties.
 * This is an internal schema used as part of CliHealthcheckSchema.
 */
const CliHealthcheckCommandSchema = z
  .object({
    type: z.literal('command'),
    commandTemplate: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

/**
 * Strict normalized schema for healthcheck configuration.
 * Discriminated union on 'type' field supporting HTTP and command healthchecks.
 * Rejects unknown properties to catch typos and misconfigurations.
 *
 * @see CliHealthcheckHttpSchema for HTTP healthcheck fields
 * @see CliHealthcheckCommandSchema for command healthcheck fields
 */
export const CliHealthcheckSchema = z.discriminatedUnion('type', [
  CliHealthcheckHttpSchema,
  CliHealthcheckCommandSchema,
]);

/**
 * Strict normalized schema for CLI target configuration.
 * This is the final validated shape after environment variable resolution
 * and snake_case to camelCase normalization.
 *
 * Uses .strict() to reject unknown properties, ensuring configuration
 * errors are caught early rather than silently ignored.
 *
 * @example
 * ```typescript
 * const config: CliNormalizedConfig = {
 *   commandTemplate: 'agent run {PROMPT}',
 *   timeoutMs: 120000,
 *   verbose: true,
 * };
 * CliTargetConfigSchema.parse(config); // Validates the normalized config
 * ```
 */
export const CliTargetConfigSchema = z
  .object({
    commandTemplate: z.string().min(1),
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
 * Normalizes a healthcheck input from loose (snake_case + camelCase) to
 * strict normalized form (camelCase only). Resolves environment variables.
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
  const timeoutSeconds = input.timeout_seconds ?? input.timeoutSeconds;
  const timeoutMs = timeoutSeconds !== undefined ? Math.floor(timeoutSeconds * 1000) : undefined;

  if (input.type === 'http') {
    const url = resolveString(input.url, env, `${targetName} healthcheck URL`);
    return {
      type: 'http',
      url,
      timeoutMs,
    };
  }

  // type === 'command'
  const commandTemplateSource = input.command_template ?? input.commandTemplate;
  if (commandTemplateSource === undefined) {
    throw new Error(
      `${targetName} healthcheck: Either command_template or commandTemplate is required for command healthcheck`,
    );
  }
  const commandTemplate = resolveString(
    commandTemplateSource,
    env,
    `${targetName} healthcheck command template`,
    true,
  );

  let cwd = resolveOptionalString(input.cwd, env, `${targetName} healthcheck cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  // Resolve relative cwd paths against eval file directory
  if (cwd && evalFilePath && !path.isAbsolute(cwd)) {
    cwd = path.resolve(path.dirname(path.resolve(evalFilePath)), cwd);
  }

  return {
    type: 'command',
    commandTemplate,
    cwd,
    timeoutMs,
  };
}

/**
 * Normalizes a CLI target input from loose (snake_case + camelCase) to
 * strict normalized form (camelCase only). Resolves environment variables.
 *
 * This function coalesces snake_case/camelCase variants and resolves
 * environment variable references using ${{ VAR_NAME }} syntax.
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

  // Coalesce command template variants - at least one is required by schema refinement
  const commandTemplateSource = input.command_template ?? input.commandTemplate;
  if (commandTemplateSource === undefined) {
    throw new Error(`${targetName}: Either command_template or commandTemplate is required`);
  }
  const commandTemplate = resolveString(
    commandTemplateSource,
    env,
    `${targetName} CLI command template`,
    true,
  );

  // Coalesce files format variants
  const filesFormatSource =
    input.files_format ?? input.filesFormat ?? input.attachments_format ?? input.attachmentsFormat;
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
  const timeoutSeconds = input.timeout_seconds ?? input.timeoutSeconds;
  const timeoutMs = timeoutSeconds !== undefined ? Math.floor(timeoutSeconds * 1000) : undefined;

  // Coalesce verbose variants
  const verbose = resolveOptionalBoolean(input.verbose ?? input.cli_verbose ?? input.cliVerbose);

  // Coalesce keepTempFiles variants
  const keepTempFiles = resolveOptionalBoolean(
    input.keep_temp_files ??
      input.keepTempFiles ??
      input.keep_output_files ??
      input.keepOutputFiles,
  );

  // Normalize healthcheck if present
  const healthcheck = input.healthcheck
    ? normalizeCliHealthcheck(input.healthcheck, env, targetName, evalFilePath)
    : undefined;

  return {
    commandTemplate,
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
  'GUIDELINES',
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
 * Azure OpenAI settings used by the Vercel AI SDK.
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
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
}

export interface PiCodingAgentResolvedConfig {
  readonly executable: string;
  readonly provider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  readonly systemPrompt?: string;
}

export interface MockResolvedConfig {
  readonly response?: string;
  readonly delayMs?: number;
  readonly delayMinMs?: number;
  readonly delayMaxMs?: number;
}

export interface VSCodeResolvedConfig {
  readonly command: string;
  readonly waitForResponse: boolean;
  readonly dryRun: boolean;
  readonly subagentRoot?: string;
  readonly workspaceTemplate?: string;
}

/**
 * Healthcheck configuration type derived from CliHealthcheckSchema.
 * Supports both HTTP and command-based healthchecks.
 */
export type CliHealthcheck = Readonly<CliNormalizedHealthcheck>;

// Note: CliResolvedConfig is a type alias derived from CliNormalizedConfig (see above),
// which itself is inferred from CliTargetConfigSchema for type safety and single source of truth.

export type ResolvedTarget =
  | {
      readonly kind: 'azure';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: AzureResolvedConfig;
    }
  | {
      readonly kind: 'anthropic';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: AnthropicResolvedConfig;
    }
  | {
      readonly kind: 'gemini';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: GeminiResolvedConfig;
    }
  | {
      readonly kind: 'codex';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: CodexResolvedConfig;
    }
  | {
      readonly kind: 'pi-coding-agent';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: PiCodingAgentResolvedConfig;
    }
  | {
      readonly kind: 'mock';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: MockResolvedConfig;
    }
  | {
      readonly kind: 'vscode' | 'vscode-insiders';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: VSCodeResolvedConfig;
    }
  | {
      readonly kind: 'cli';
      readonly name: string;
      readonly judgeTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: CliResolvedConfig;
    };

const BASE_TARGET_SCHEMA = z
  .object({
    name: z.string().min(1, 'target name is required'),
    provider: z.string().min(1, 'provider is required'),
    judge_target: z.string().optional(),
    workers: z.number().int().min(1).optional(),
  })
  .passthrough();

const DEFAULT_AZURE_API_VERSION = '2024-12-01-preview';

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
  const maxRetries = resolveOptionalNumber(
    target.max_retries ?? target.maxRetries,
    `${target.name} max retries`,
  );
  const initialDelayMs = resolveOptionalNumber(
    target.retry_initial_delay_ms ?? target.retryInitialDelayMs,
    `${target.name} retry initial delay`,
  );
  const maxDelayMs = resolveOptionalNumber(
    target.retry_max_delay_ms ?? target.retryMaxDelayMs,
    `${target.name} retry max delay`,
  );
  const backoffFactor = resolveOptionalNumber(
    target.retry_backoff_factor ?? target.retryBackoffFactor,
    `${target.name} retry backoff factor`,
  );
  const retryableStatusCodes = resolveOptionalNumberArray(
    target.retry_status_codes ?? target.retryStatusCodes,
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

export function resolveTargetDefinition(
  definition: TargetDefinition,
  env: EnvLookup = process.env,
  evalFilePath?: string,
): ResolvedTarget {
  const parsed = BASE_TARGET_SCHEMA.parse(definition);
  const provider = parsed.provider.toLowerCase();
  const providerBatching = resolveOptionalBoolean(
    parsed.provider_batching ?? parsed.providerBatching,
  );

  switch (provider) {
    case 'azure':
    case 'azure-openai':
      return {
        kind: 'azure',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveAzureConfig(parsed, env),
      };
    case 'anthropic':
      return {
        kind: 'anthropic',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveAnthropicConfig(parsed, env),
      };
    case 'gemini':
    case 'google':
    case 'google-gemini':
      return {
        kind: 'gemini',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveGeminiConfig(parsed, env),
      };
    case 'codex':
    case 'codex-cli':
      return {
        kind: 'codex',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveCodexConfig(parsed, env),
      };
    case 'pi':
    case 'pi-coding-agent':
      return {
        kind: 'pi-coding-agent',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolvePiCodingAgentConfig(parsed, env),
      };
    case 'mock':
      return {
        kind: 'mock',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveMockConfig(parsed),
      };
    case 'vscode':
    case 'vscode-insiders':
      return {
        kind: provider as 'vscode' | 'vscode-insiders',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveVSCodeConfig(parsed, env, provider === 'vscode-insiders'),
      };
    case 'cli':
      return {
        kind: 'cli',
        name: parsed.name,
        judgeTarget: parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveCliConfig(parsed, env, evalFilePath),
      };
    default:
      throw new Error(`Unsupported provider '${parsed.provider}' in target '${parsed.name}'`);
  }
}

function resolveAzureConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): AzureResolvedConfig {
  const endpointSource = target.endpoint ?? target.resource ?? target.resourceName;
  const apiKeySource = target.api_key ?? target.apiKey;
  const deploymentSource = target.deployment ?? target.deploymentName ?? target.model;
  const versionSource = target.version ?? target.api_version;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens ?? target.maxTokens;

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

function resolveAnthropicConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): AnthropicResolvedConfig {
  const apiKeySource = target.api_key ?? target.apiKey;
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens ?? target.maxTokens;
  const thinkingBudgetSource = target.thinking_budget ?? target.thinkingBudget;

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
  const apiKeySource = target.api_key ?? target.apiKey;
  const modelSource = target.model ?? target.deployment ?? target.variant;
  const temperatureSource = target.temperature;
  const maxTokensSource = target.max_output_tokens ?? target.maxTokens;

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
): CodexResolvedConfig {
  const executableSource = target.executable ?? target.command ?? target.binary;
  const argsSource = target.args ?? target.arguments;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds ?? target.timeoutSeconds;
  const logDirSource =
    target.log_dir ?? target.logDir ?? target.log_directory ?? target.logDirectory;
  const logFormatSource =
    target.log_format ??
    target.logFormat ??
    target.log_output_format ??
    target.logOutputFormat ??
    env.AGENTV_CODEX_LOG_FORMAT;

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
  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} codex timeout`);
  const logDir = resolveOptionalString(logDirSource, env, `${target.name} codex log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });
  const logFormat = normalizeCodexLogFormat(logFormatSource);

  return {
    executable,
    args,
    cwd,
    timeoutMs,
    logDir,
    logFormat,
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

function resolvePiCodingAgentConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): PiCodingAgentResolvedConfig {
  const executableSource = target.executable ?? target.command ?? target.binary;
  const providerSource = target.pi_provider ?? target.piProvider ?? target.llm_provider;
  const modelSource = target.model ?? target.pi_model ?? target.piModel;
  const apiKeySource = target.api_key ?? target.apiKey;
  const toolsSource = target.tools ?? target.pi_tools ?? target.piTools;
  const thinkingSource = target.thinking ?? target.pi_thinking ?? target.piThinking;
  const argsSource = target.args ?? target.arguments;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds ?? target.timeoutSeconds;
  const logDirSource =
    target.log_dir ?? target.logDir ?? target.log_directory ?? target.logDirectory;
  const logFormatSource = target.log_format ?? target.logFormat;
  const systemPromptSource = target.system_prompt ?? target.systemPrompt;

  const executable =
    resolveOptionalString(executableSource, env, `${target.name} pi executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'pi';

  const provider = resolveOptionalString(providerSource, env, `${target.name} pi provider`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const model = resolveOptionalString(modelSource, env, `${target.name} pi model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const apiKey = resolveOptionalString(apiKeySource, env, `${target.name} pi api key`, {
    allowLiteral: false,
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

  const args = resolveOptionalStringArray(argsSource, env, `${target.name} pi args`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} pi cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

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
    executable,
    provider,
    model,
    apiKey,
    tools,
    thinking,
    args,
    cwd,
    timeoutMs,
    logDir,
    logFormat,
    systemPrompt,
  };
}

function resolveMockConfig(target: z.infer<typeof BASE_TARGET_SCHEMA>): MockResolvedConfig {
  const response = typeof target.response === 'string' ? target.response : undefined;
  return { response };
}

function resolveVSCodeConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
  insiders: boolean,
): VSCodeResolvedConfig {
  const workspaceTemplateEnvVar = resolveOptionalLiteralString(
    target.workspace_template ?? target.workspaceTemplate,
  );
  const workspaceTemplate = workspaceTemplateEnvVar
    ? resolveOptionalString(
        workspaceTemplateEnvVar,
        env,
        `${target.name} workspace template path`,
        {
          allowLiteral: false,
          optionalEnv: true,
        },
      )
    : undefined;

  const commandSource = target.vscode_cmd ?? target.command;
  const waitSource = target.wait;
  const dryRunSource = target.dry_run ?? target.dryRun;
  const subagentRootSource = target.subagent_root ?? target.subagentRoot;

  const defaultCommand = insiders ? 'code-insiders' : 'code';
  const command = resolveOptionalLiteralString(commandSource) ?? defaultCommand;

  return {
    command,
    waitForResponse: resolveOptionalBoolean(waitSource) ?? true,
    dryRun: resolveOptionalBoolean(dryRunSource) ?? false,
    subagentRoot: resolveOptionalString(subagentRootSource, env, `${target.name} subagent root`, {
      allowLiteral: true,
      optionalEnv: true,
    }),
    workspaceTemplate,
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
  if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
    return { message: "healthcheck type must be 'http' or 'command'" };
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
 * 3. Validates CLI placeholders in the command template
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

  // Validate CLI placeholders in command template
  assertSupportedCliPlaceholders(normalized.commandTemplate, `${target.name} CLI command template`);

  // Validate CLI placeholders in healthcheck command template if present
  if (normalized.healthcheck?.type === 'command') {
    assertSupportedCliPlaceholders(
      normalized.healthcheck.commandTemplate,
      `${target.name} healthcheck command template`,
    );
  }

  return normalized;
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
