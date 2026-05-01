import type { EnvLookup } from './providers/types.js';

const ENV_VAR_PATTERN = /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Regex that matches a string consisting of exactly one `${{ VAR }}` reference
 * and nothing else. Used to detect whole-value substitutions eligible for type coercion.
 */
const WHOLE_VAR_PATTERN = /^\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

/**
 * Coerce a resolved string to its native primitive type when appropriate.
 * "true"/"false" become booleans; integer/float strings become numbers.
 * All other strings (including empty string) are returned as-is.
 */
function coercePrimitive(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

/**
 * Recursively interpolate `${{ VAR }}` references in all string values.
 * Missing variables resolve to empty string.
 * Non-string values pass through unchanged. Returns a new object (no mutation).
 *
 * Type coercion: when the **entire** string value is a single `${{ VAR }}` reference
 * (no surrounding text), the resolved value is coerced to its native type —
 * `"true"`/`"false"` become booleans, numeric strings become numbers. This allows
 * boolean and numeric config fields to be driven by environment variables:
 *
 * ```yaml
 * # .agentv/config.yaml
 * results:
 *   export:
 *     auto_push: ${{ AGENTV_AUTO_PUSH }}   # AGENTV_AUTO_PUSH=true → boolean true
 * ```
 *
 * Inline/partial substitutions (e.g. `"prefix-${{ VAR }}"`) are always strings.
 */
export function interpolateEnv(value: unknown, env: EnvLookup): unknown {
  if (typeof value === 'string') {
    // Whole-value substitution: coerce the resolved value to its native type.
    const wholeMatch = WHOLE_VAR_PATTERN.exec(value);
    if (wholeMatch) {
      const resolved = env[wholeMatch[1] as string] ?? '';
      return coercePrimitive(resolved);
    }
    // Partial/inline substitution: always produces a string.
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
