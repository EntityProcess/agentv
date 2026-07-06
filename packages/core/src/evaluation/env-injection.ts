/**
 * v5-native environment injection for AgentV project config.
 *
 * `env_path` loads dotenv-style files and `env_from` runs argv commands and
 * parses their stdout, both injecting into `process.env` before validation
 * and eval so target `{{ env.* }}` interpolation can see the values. This is
 * the replacement path for the deprecated `hooks.before_session`.
 *
 * Existing `process.env` values always win — neither source overwrites a key
 * that is already set. Values are never printed; only file paths, commands,
 * and counts are logged.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EnvFromEntry, EnvFromFormat } from './loaders/config-loader.js';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse `KEY=value` / `export KEY=value` lines, shared by `env_path` dotenv
 * files and `env_from` `shell_exports` output. Quotes are stripped; blank
 * lines, comments, and non-matching lines are skipped.
 */
export function parseShellExportsEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Parse a flat JSON object of string values for `env_from` `format: json`.
 * Throws on invalid JSON, non-object shapes, invalid env var names, or
 * non-string values.
 */
export function parseJsonEnv(content: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Do not include the parser's message: JS engines embed a snippet of the
    // offending content in JSON syntax errors, which could leak a secret
    // value from malformed env_from output.
    throw new Error('invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected a flat JSON object of string values');
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ENV_NAME_PATTERN.test(key)) {
      throw new Error(`invalid environment variable name "${key}"`);
    }
    if (typeof value !== 'string') {
      throw new Error(`value for "${key}" must be a string`);
    }
    result[key] = value;
  }

  return result;
}

/** Injects vars into process.env; existing keys and invalid names are skipped. Returns injected count. */
function injectEnv(vars: Record<string, string>): number {
  let injected = 0;
  for (const [key, value] of Object.entries(vars)) {
    if (!ENV_NAME_PATTERN.test(key)) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
      injected++;
    }
  }
  return injected;
}

export type EnvPathLoadResult = {
  readonly loaded: readonly string[];
  readonly missing: readonly string[];
  readonly injectedCount: number;
};

/**
 * Load one or more dotenv-style files and inject their variables into
 * `process.env`. Relative paths resolve against `baseDir`. A missing file
 * warns and is skipped rather than failing the command.
 */
export async function loadEnvPathFiles(
  envPaths: readonly string[],
  baseDir: string,
): Promise<EnvPathLoadResult> {
  const loaded: string[] = [];
  const missing: string[] = [];
  let injectedCount = 0;

  for (const envPath of envPaths) {
    const resolvedPath = path.isAbsolute(envPath) ? envPath : path.join(baseDir, envPath);

    let content: string;
    try {
      content = await readFile(resolvedPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        missing.push(resolvedPath);
        logWarning(`env_path file not found: ${resolvedPath}`);
        continue;
      }
      throw new Error(`Could not read env_path file ${resolvedPath}: ${(error as Error).message}`);
    }

    injectedCount += injectEnv(parseShellExportsEnv(content));
    loaded.push(resolvedPath);
  }

  if (injectedCount > 0) {
    console.log(
      `env_path injected ${injectedCount} environment variable(s) from ${loaded.length} file(s).`,
    );
  }

  return { loaded, missing, injectedCount };
}

export type EnvFromRunResult = {
  readonly injectedCount: number;
};

function parseEnvFromOutput(stdout: string, format: EnvFromFormat): Record<string, string> {
  return format === 'json' ? parseJsonEnv(stdout) : parseShellExportsEnv(stdout);
}

/**
 * Run one or more `env_from` argv commands and inject their parsed stdout
 * into `process.env`. A non-zero exit, spawn failure, or unparseable output
 * throws — command failures must fail the invoking command. stdout is never
 * logged or included in error messages since it may carry secret values.
 */
export async function runEnvFromEntries(
  entries: readonly EnvFromEntry[],
  options: { readonly cwd: string },
): Promise<EnvFromRunResult> {
  let injectedCount = 0;

  for (const entry of entries) {
    const [command, ...args] = entry.command;
    const commandLabel = entry.command.join(' ');
    console.log(`Running env_from command: ${commandLabel}`);

    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.error) {
      throw new Error(`env_from command failed to start: ${commandLabel}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `env_from command exited with code ${result.status ?? 'unknown'}: ${commandLabel}`,
      );
    }

    const format = entry.format ?? 'shell_exports';
    let vars: Record<string, string>;
    try {
      vars = parseEnvFromOutput(result.stdout ?? '', format);
    } catch (error) {
      throw new Error(
        `env_from command produced invalid ${format} output: ${commandLabel}: ${(error as Error).message}`,
      );
    }

    injectedCount += injectEnv(vars);
  }

  if (injectedCount > 0) {
    console.log(`env_from injected ${injectedCount} environment variable(s).`);
  }

  return { injectedCount };
}

function logWarning(message: string): void {
  console.warn(`Warning: ${message}`);
}
