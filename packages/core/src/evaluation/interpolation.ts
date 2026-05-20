import type { EnvLookup } from './providers/types.js';

const ENV_VAR_PATTERN = /\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;
const WHOLE_TEMPLATE_VAR_PATTERN = /^\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}$/;

/**
 * Regex that matches a string consisting of exactly one `${{ VAR }}` reference
 * and nothing else. Used to detect whole-value substitutions eligible for type coercion.
 */
const WHOLE_VAR_PATTERN = /^\$\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

/**
 * Pattern matching plain integers (e.g. "42", "-7") and decimal fractions
 * (e.g. "3.14", "-0.5"). Excludes hex ("0x10"), scientific notation ("1e3"),
 * "Infinity", "NaN", and whitespace-only strings that `Number()` accepts.
 */
const PLAIN_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Coerce a resolved string to its native primitive type when appropriate.
 * "true"/"false" become booleans; plain integer/decimal strings become numbers.
 * Strings that happen to be valid JS numbers but are not plain decimal notation
 * (hex, scientific notation, "Infinity") are left as strings.
 * All other strings (including empty string) are returned as-is.
 */
function coercePrimitive(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (PLAIN_NUMBER_PATTERN.test(value)) return Number(value);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneTemplateValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneTemplateValue(item));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = cloneTemplateValue(nested);
    }
    return result;
  }
  return value;
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function lookupTemplateVar(
  vars: Readonly<Record<string, unknown>>,
  expression: string,
): unknown | undefined {
  if (!expression) return undefined;
  return expression.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }
    return current[segment];
  }, vars);
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

/**
 * Recursively interpolate `{{ var }}` references in string values using per-test vars.
 * Missing variables are left unchanged so unrelated template syntaxes remain intact.
 * When the whole string is a single variable reference, the original JSON value is preserved.
 */
export function interpolateTemplateVars(
  value: unknown,
  vars: Readonly<Record<string, unknown>>,
): unknown {
  if (typeof value === 'string') {
    const wholeMatch = WHOLE_TEMPLATE_VAR_PATTERN.exec(value);
    if (wholeMatch) {
      const resolved = lookupTemplateVar(vars, wholeMatch[1] as string);
      return resolved === undefined ? value : cloneTemplateValue(resolved);
    }

    return value.replace(TEMPLATE_VAR_PATTERN, (match, expression: string) => {
      const resolved = lookupTemplateVar(vars, expression);
      return resolved === undefined ? match : stringifyTemplateValue(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateTemplateVars(item, vars));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = interpolateTemplateVars(nested, vars);
    }
    return result;
  }

  return value;
}
