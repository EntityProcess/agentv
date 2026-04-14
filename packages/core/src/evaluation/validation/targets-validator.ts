import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import {
  CLI_PLACEHOLDERS,
  COMMON_TARGET_SETTINGS,
  findDeprecatedCamelCaseTargetWarnings,
} from '../providers/targets.js';
import { KNOWN_PROVIDERS, PROVIDER_ALIASES } from '../providers/types.js';
import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Cross-provider settings derived from the schema source of truth in targets.ts.
// Adding a field to COMMON_TARGET_SETTINGS automatically makes it valid here.
const COMMON_SETTINGS = new Set<string>(COMMON_TARGET_SETTINGS);

const RETRY_SETTINGS = new Set([
  'max_retries',
  'retry_initial_delay_ms',
  'retry_max_delay_ms',
  'retry_backoff_factor',
  'retry_status_codes',
]);

const AZURE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'endpoint',
  'resource',
  'api_key',
  'deployment',
  'model',
  'version',
  'api_version',
  'api_format',
  'temperature',
  'max_output_tokens',
]);

const OPENAI_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'endpoint',
  'base_url',
  'api_key',
  'model',
  'deployment',
  'variant',
  'api_format',
  'temperature',
  'max_output_tokens',
]);

const OPENROUTER_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'api_key',
  'model',
  'deployment',
  'variant',
  'temperature',
  'max_output_tokens',
]);

const ANTHROPIC_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'api_key',
  'model',
  'deployment',
  'variant',
  'temperature',
  'max_output_tokens',
  'thinking_budget',
]);

const GEMINI_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  ...RETRY_SETTINGS,
  'api_key',
  'model',
  'deployment',
  'variant',
  'temperature',
  'max_output_tokens',
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
  'log_dir',
  'log_directory',
  'log_format',
  'log_output_format',
  'system_prompt',
]);

const COPILOT_SDK_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'cli_url',
  'cli_path',
  'github_token',
  'model',
  'cwd',
  'timeout_seconds',
  'log_dir',
  'log_format',
  'system_prompt',
  'byok',
]);

const COPILOT_CLI_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'executable',
  'command',
  'binary',
  'args',
  'arguments',
  'model',
  'cwd',
  'timeout_seconds',
  'log_dir',
  'log_format',
  'system_prompt',
]);

const VSCODE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'executable',
  'wait',
  'dry_run',
  'subagent_root',
  'timeout_seconds',
]);

const MOCK_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'response',
  'trace', // For testing tool-trajectory evaluator
]);

// CLI_SETTINGS removed - Zod schema validation now handles CLI provider settings validation
// in resolveCliConfig() via CliTargetInputSchema

const CLAUDE_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'executable',
  'command',
  'binary',
  'model',
  'cwd',
  'timeout_seconds',
  'log_dir',
  'log_directory',
  'log_format',
  'log_output_format',
  'system_prompt',
  'max_turns',
  'max_budget_usd',
]);

const CC_MIRROR_SETTINGS = new Set([...CLAUDE_SETTINGS, 'variant']);

function getKnownSettings(provider: string): Set<string> | null {
  const normalizedProvider = provider.toLowerCase();
  switch (normalizedProvider) {
    case 'openai':
      return OPENAI_SETTINGS;
    case 'openrouter':
      return OPENROUTER_SETTINGS;
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
    case 'copilot-sdk':
    case 'copilot_sdk':
      return COPILOT_SDK_SETTINGS;
    case 'copilot':
    case 'copilot-cli':
      return COPILOT_CLI_SETTINGS;
    case 'cc-mirror':
      return CC_MIRROR_SETTINGS;
    case 'claude':
    case 'claude-code':
    case 'claude-cli':
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
  const baseFields = new Set([
    'name',
    'provider',
    'grader_target',
    'judge_target',
    'workers',
    '$schema',
    'targets',
  ]);

  const removedFields = new Set(['workspace_template', 'workspaceTemplate']);

  for (const key of Object.keys(target)) {
    if (removedFields.has(key)) {
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: `${location}.${key}`,
        message:
          'workspace_template has been removed from targets. Use eval-level workspace.template instead.',
      });
      continue;
    }
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
    // Critical check: command is required
    const command = target.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.command`,
        message: "CLI provider requires 'command' as a non-empty string",
      });
    } else {
      // Validate CLI placeholders early to give helpful feedback
      recordUnknownPlaceholders(command, absolutePath, `${location}.command`, errors);
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

    const timeoutSeconds = healthcheck.timeout_seconds;
    if (timeoutSeconds !== undefined) {
      const numericTimeout = Number(timeoutSeconds);
      if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.timeout_seconds`,
          message: 'healthcheck.timeout_seconds must be a positive number when provided',
        });
      }
    }

    // Determine healthcheck type by presence of url or command
    const hasUrl = typeof healthcheck.url === 'string' && healthcheck.url.trim().length > 0;
    const hasCommand =
      typeof healthcheck.command === 'string' && healthcheck.command.trim().length > 0;

    if (!hasUrl && !hasCommand) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: "healthcheck must have either 'url' (HTTP) or 'command' (command)",
      });
      return;
    }

    if (hasUrl) {
      // HTTP healthcheck — url already validated above
      return;
    }

    // Command healthcheck
    recordUnknownPlaceholders(
      healthcheck.command as string,
      absolutePath,
      `${location}.command`,
      errors,
    );

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

    for (const warning of findDeprecatedCamelCaseTargetWarnings(target, location)) {
      const fieldMatch = warning.message.match(/field '([^']+)'/);
      const replacementMatch = warning.message.match(/Use '([^']+)' instead/);
      const field = fieldMatch?.[1] ?? 'unknown';
      const replacement = replacementMatch?.[1] ?? 'snake_case';
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: warning.location,
        message: `camelCase field '${field}' is no longer supported in targets.yaml. Use '${replacement}' instead.`,
      });
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
    const hasUseTarget =
      typeof target.use_target === 'string' && target.use_target.trim().length > 0;
    const providerValue = typeof provider === 'string' ? provider.trim().toLowerCase() : undefined;
    const isTemplated = typeof provider === 'string' && /^\$\{\{.+\}\}$/.test(provider.trim());
    if (!hasUseTarget && (typeof provider !== 'string' || provider.trim().length === 0)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.provider`,
        message:
          "Missing or invalid 'provider' field (must be a non-empty string, or use use_target for delegation)",
      });
    } else if (typeof provider === 'string' && !isTemplated && !knownProviders.includes(provider)) {
      // Warning for unknown providers (non-fatal); skip when provider uses ${{ VAR }}
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
    if (typeof provider === 'string' && !isTemplated) {
      validateUnknownSettings(target, provider, absolutePath, location, errors);
    }

    // Optional field: grader_target / judge_target (must be string if present)
    const graderTarget = target.grader_target ?? target.judge_target;
    if (graderTarget !== undefined && typeof graderTarget !== 'string') {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.grader_target`,
        message: "Invalid 'grader_target' field (must be a string)",
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
