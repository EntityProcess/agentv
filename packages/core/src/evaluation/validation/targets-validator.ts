import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { CLI_PLACEHOLDERS } from '../providers/targets.js';
import { KNOWN_PROVIDERS, PROVIDER_ALIASES } from '../providers/types.js';
import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Known settings properties for each provider type
const COMMON_SETTINGS = new Set(['provider_batching', 'providerBatching']);

const RETRY_SETTINGS = new Set([
  'max_retries',
  'maxRetries',
  'retry_initial_delay_ms',
  'retryInitialDelayMs',
  'retry_max_delay_ms',
  'retryMaxDelayMs',
  'retry_backoff_factor',
  'retryBackoffFactor',
  'retry_status_codes',
  'retryStatusCodes',
]);

const AZURE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'endpoint',
  'resource',
  'resourceName',
  'api_key',
  'apiKey',
  'deployment',
  'deploymentName',
  'model',
  'version',
  'api_version',
  'temperature',
  'max_output_tokens',
  'maxTokens',
]);

const ANTHROPIC_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'api_key',
  'apiKey',
  'model',
  'deployment',
  'variant',
  'temperature',
  'max_output_tokens',
  'maxTokens',
  'thinking_budget',
  'thinkingBudget',
]);

const GEMINI_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'api_key',
  'apiKey',
  'model',
  'deployment',
  'variant',
  'temperature',
  'max_output_tokens',
  'maxTokens',
]);

const CODEX_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'model',
  'executable',
  'command',
  'binary',
  'args',
  'arguments',
  'cwd',
  'timeout_seconds',
  'timeoutSeconds',
  'log_dir',
  'logDir',
  'log_directory',
  'logDirectory',
  'log_format',
  'logFormat',
  'log_output_format',
  'logOutputFormat',
  'system_prompt',
  'systemPrompt',
  'workspace_template',
  'workspaceTemplate',
]);

const COPILOT_SDK_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'cli_url',
  'cliUrl',
  'cli_path',
  'cliPath',
  'github_token',
  'githubToken',
  'model',
  'cwd',
  'timeout_seconds',
  'timeoutSeconds',
  'log_dir',
  'logDir',
  'log_format',
  'logFormat',
  'system_prompt',
  'systemPrompt',
  'workspace_template',
  'workspaceTemplate',
]);

const VSCODE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'executable',
  'workspace_template',
  'workspaceTemplate',
  'wait',
  'dry_run',
  'dryRun',
  'subagent_root',
  'subagentRoot',
  'timeout_seconds',
  'timeoutSeconds',
]);

const MOCK_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'response',
  'delayMs',
  'delayMinMs',
  'delayMaxMs',
  'trace', // For testing tool_trajectory evaluator
]);

// CLI_SETTINGS removed - Zod schema validation now handles CLI provider settings validation
// in resolveCliConfig() via CliTargetInputSchema

const CLAUDE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'model',
  'cwd',
  'timeout_seconds',
  'timeoutSeconds',
  'log_dir',
  'logDir',
  'log_directory',
  'logDirectory',
  'log_format',
  'logFormat',
  'log_output_format',
  'logOutputFormat',
  'system_prompt',
  'systemPrompt',
  'workspace_template',
  'workspaceTemplate',
  'max_turns',
  'maxTurns',
  'max_budget_usd',
  'maxBudgetUsd',
]);

function getKnownSettings(provider: string): Set<string> | null {
  const normalizedProvider = provider.toLowerCase();
  switch (normalizedProvider) {
    case 'azure':
    case 'azure-openai':
      return AZURE_SETTINGS;
    case 'anthropic':
      return ANTHROPIC_SETTINGS;
    case 'gemini':
    case 'google':
    case 'google-gemini':
      return GEMINI_SETTINGS;
    case 'codex':
    case 'codex-cli':
      return CODEX_SETTINGS;
    case 'copilot':
    case 'copilot-sdk':
    case 'copilot_sdk':
    case 'copilot-cli':
      return COPILOT_SDK_SETTINGS;
    case 'claude':
    case 'claude-code':
    case 'claude-sdk':
      return CLAUDE_SETTINGS;
    case 'vscode':
    case 'vscode-insiders':
      return VSCODE_SETTINGS;
    case 'mock':
      return MOCK_SETTINGS;
    case 'cli':
      // CLI provider validation is now handled by Zod schema in resolveCliConfig()
      // Return null to skip duplicate validation in validateUnknownSettings()
      return null;
    default:
      return null; // Unknown provider, can't validate settings
  }
}

function validateUnknownSettings(
  target: JsonObject,
  provider: string,
  absolutePath: string,
  location: string,
  errors: ValidationError[],
): void {
  const knownSettings = getKnownSettings(provider);
  if (!knownSettings) {
    // Unknown provider, skip settings validation
    return;
  }

  // Known base target fields that aren't settings
  const baseFields = new Set(['name', 'provider', 'judge_target', 'workers', '$schema', 'targets']);

  for (const key of Object.keys(target)) {
    if (!baseFields.has(key) && !knownSettings.has(key)) {
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: `${location}.${key}`,
        message: `Unknown setting '${key}' for ${provider} provider. This property will be ignored.`,
      });
    }
  }
}

/**
 * Validate a targets file (agentv-targets-v2.1 schema).
 */
export async function validateTargetsFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const absolutePath = path.resolve(filePath);

  let parsed: unknown;
  try {
    const content = await readFile(absolutePath, 'utf8');
    parsed = parse(content);
  } catch (error) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: `Failed to parse YAML: ${(error as Error).message}`,
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'targets',
      errors,
    };
  }

  /**
   * Simplified CLI settings validation for early file validation.
   * Detailed type checking is now handled by Zod schema validation in resolveCliConfig().
   * This function focuses on critical early checks: command template presence and placeholder validation.
   */
  function validateCliSettings(
    target: JsonObject,
    absolutePath: string,
    location: string,
    errors: ValidationError[],
  ): void {
    // Critical check: command template is required
    const commandTemplate = target.command_template ?? target.commandTemplate;
    if (typeof commandTemplate !== 'string' || commandTemplate.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.commandTemplate`,
        message:
          "CLI provider requires 'command_template' or 'commandTemplate' as a non-empty string",
      });
    } else {
      // Validate CLI placeholders early to give helpful feedback
      recordUnknownPlaceholders(
        commandTemplate,
        absolutePath,
        `${location}.commandTemplate`,
        errors,
      );
    }

    // Early validation of healthcheck structure and placeholders
    const healthcheck = target.healthcheck;
    if (healthcheck !== undefined) {
      validateCliHealthcheck(healthcheck, absolutePath, `${location}.healthcheck`, errors);
    }
  }

  function validateCliHealthcheck(
    healthcheck: unknown,
    absolutePath: string,
    location: string,
    errors: ValidationError[],
  ): void {
    if (!isObject(healthcheck)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: "'healthcheck' must be an object when provided",
      });
      return;
    }

    const type = healthcheck.type;
    if (type !== 'http' && type !== 'command') {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.type`,
        message: "healthcheck.type must be either 'http' or 'command'",
      });
      return;
    }

    const timeoutSeconds = healthcheck.timeout_seconds ?? healthcheck.timeoutSeconds;
    if (timeoutSeconds !== undefined) {
      const numericTimeout = Number(timeoutSeconds);
      if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.timeoutSeconds`,
          message: 'healthcheck.timeoutSeconds must be a positive number when provided',
        });
      }
    }

    if (type === 'http') {
      const url = healthcheck.url;
      if (typeof url !== 'string' || url.trim().length === 0) {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.url`,
          message: 'healthcheck.url must be a non-empty string for http checks',
        });
      }
      return;
    }

    const commandTemplate = healthcheck.command_template ?? healthcheck.commandTemplate;
    if (typeof commandTemplate !== 'string' || commandTemplate.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.commandTemplate`,
        message: 'healthcheck.commandTemplate must be a non-empty string for command checks',
      });
    } else {
      recordUnknownPlaceholders(
        commandTemplate,
        absolutePath,
        `${location}.commandTemplate`,
        errors,
      );
    }

    const cwd = healthcheck.cwd;
    if (cwd !== undefined && typeof cwd !== 'string') {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.cwd`,
        message: 'healthcheck.cwd must be a string when provided',
      });
    }
  }

  function recordUnknownPlaceholders(
    template: string,
    absolutePath: string,
    location: string,
    errors: ValidationError[],
  ): void {
    const placeholders = extractPlaceholders(template);
    for (const placeholder of placeholders) {
      if (!CLI_PLACEHOLDERS.has(placeholder)) {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location,
          message: `Unknown CLI placeholder '{${placeholder}}'. Supported placeholders: ${Array.from(CLI_PLACEHOLDERS).join(', ')}`,
        });
      }
    }
  }

  function extractPlaceholders(template: string): string[] {
    const matches = template.matchAll(/\{([A-Z_]+)\}/g);
    const result: string[] = [];
    for (const match of matches) {
      const placeholder = match[1];
      if (placeholder) {
        result.push(placeholder);
      }
    }
    return result;
  }

  if (!isObject(parsed)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: 'File must contain a YAML object',
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'targets',
      errors,
    };
  }

  // Validate targets array
  const targets = parsed.targets;
  if (!Array.isArray(targets)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      location: 'targets',
      message: "Missing or invalid 'targets' field (must be an array)",
    });
    return {
      valid: errors.length === 0,
      filePath: absolutePath,
      fileType: 'targets',
      errors,
    };
  }

  // Validate each target definition
  const knownProviders = [...KNOWN_PROVIDERS, ...PROVIDER_ALIASES];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const location = `targets[${i}]`;

    if (!isObject(target)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: 'Target must be an object',
      });
      continue;
    }

    // Required field: name
    const name = target.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.name`,
        message: "Missing or invalid 'name' field (must be a non-empty string)",
      });
    }

    // Required field: provider
    const provider = target.provider;
    const providerValue = typeof provider === 'string' ? provider.trim().toLowerCase() : undefined;
    if (typeof provider !== 'string' || provider.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.provider`,
        message: "Missing or invalid 'provider' field (must be a non-empty string)",
      });
    } else if (!knownProviders.includes(provider)) {
      // Warning for unknown providers (non-fatal)
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: `${location}.provider`,
        message: `Unknown provider '${provider}'. Known providers: ${knownProviders.join(', ')}`,
      });
    }

    // Validate CLI provider fields
    if (providerValue === 'cli') {
      validateCliSettings(target, absolutePath, location, errors);
    }

    // Check for unknown settings properties on target object
    if (typeof provider === 'string') {
      validateUnknownSettings(target, provider, absolutePath, location, errors);
    }

    // Optional field: judge_target (must be string if present)
    const judgeTarget = target.judge_target;
    if (judgeTarget !== undefined && typeof judgeTarget !== 'string') {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.judge_target`,
        message: "Invalid 'judge_target' field (must be a string)",
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    filePath: absolutePath,
    fileType: 'targets',
    errors,
  };
}
