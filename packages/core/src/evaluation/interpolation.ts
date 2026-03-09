import type { EnvLookup } from './providers/types.js';

const ENV_VAR_PATTERN = /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Recursively interpolate `${{ VAR }}` references in all string values.
 * Missing variables resolve to empty string.
 * Non-string values pass through unchanged. Returns a new object (no mutation).
 */
export function interpolateEnv(value: unknown, env: EnvLookup): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_, varName: string) => env[varName] ?? '');
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateEnv(val, env);
    }
    return result;
  }
  return value;
}
