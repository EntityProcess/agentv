import nunjucks from 'nunjucks';
import type { EnvLookup } from './providers/types.js';

export type NunjucksFilterMap = Readonly<Record<string, (...args: unknown[]) => unknown>>;

const WHOLE_SIMPLE_TEMPLATE_VAR_PATTERN =
  /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}\s*$/;
const ENV_OUTPUT_PATTERN = /\{\{\s*env\.[\s\S]*?\}\}/g;
const WHOLE_ENV_OUTPUT_PATTERN = /^\s*\{\{\s*env\.[\s\S]*?\}\}\s*$/;

/**
 * Pattern matching plain integers (e.g. "42", "-7") and decimal fractions
 * (e.g. "3.14", "-0.5"). Excludes hex ("0x10"), scientific notation ("1e3"),
 * "Infinity", "NaN", and whitespace-only strings that `Number()` accepts.
 */
const PLAIN_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Coerce a resolved string to its native primitive type when appropriate.
 * "true"/"false" become booleans; plain integer/decimal strings become numbers.
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

function createNunjucksEnvironment(filters?: NunjucksFilterMap): nunjucks.Environment {
  const environment = new nunjucks.Environment(undefined, {
    autoescape: false,
    throwOnUndefined: false,
  });
  environment.addFilter('load', (value: string) => JSON.parse(value) as unknown);
  for (const [name, filter] of Object.entries(filters ?? {})) {
    environment.addFilter(name, filter);
  }
  return environment;
}

function lookupPath(context: Readonly<Record<string, unknown>>, expression: string): unknown {
  return expression.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }
    return current[segment];
  }, context);
}

function renderString(
  template: string,
  context: Readonly<Record<string, unknown>>,
  filters?: NunjucksFilterMap,
): string {
  return createNunjucksEnvironment(filters).renderString(template, context);
}

function renderEnvString(template: string, env: EnvLookup): string {
  if (template.includes('${{')) {
    return template;
  }
  return template.replace(ENV_OUTPUT_PATTERN, (match) => renderString(match, { env }));
}

export function renderEnvTemplateString(template: string, env: EnvLookup): string {
  return renderEnvString(template, env);
}

/**
 * Build the config-load env context used for eval file interpolation.
 *
 * AgentV-owned defaults are available to YAML as `{{ env.* }}` without mutating
 * process.env. Caller-provided environment values keep precedence.
 */
export function createEvalConfigEnv(repoRoot?: string, env: EnvLookup = process.env): EnvLookup {
  const result: Record<string, string | undefined> = { ...env };
  if (repoRoot !== undefined && result.AGENTV_REPO_ROOT === undefined) {
    result.AGENTV_REPO_ROOT = repoRoot;
  }
  return result;
}

/**
 * Recursively render config-load `{{ env.VAR }}` templates in string values.
 *
 * Runtime shell variables such as `$VAR` and `${VAR}` are intentionally outside
 * this syntax and pass through unchanged for CLI target subprocesses.
 */
export function interpolateEnv(value: unknown, env: EnvLookup): unknown {
  if (typeof value === 'string') {
    const rendered = renderEnvString(value, env);
    return WHOLE_ENV_OUTPUT_PATTERN.test(value) ? coercePrimitive(rendered) : rendered;
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
 * Recursively render eval-time Nunjucks templates using per-test vars.
 *
 * The context exposes both promptfoo-style top-level vars (`{{ name }}`) and the
 * explicit namespace (`{{ vars.name }}`). When the whole field is exactly a
 * simple variable reference, the original JSON value is preserved.
 */
export function interpolateTemplateVars(
  value: unknown,
  vars: Readonly<Record<string, unknown>>,
  filters?: NunjucksFilterMap,
): unknown {
  if (typeof value === 'string') {
    const context = { ...vars, vars };
    const wholeMatch = WHOLE_SIMPLE_TEMPLATE_VAR_PATTERN.exec(value);
    if (wholeMatch) {
      const resolved = lookupPath(context, wholeMatch[1] as string);
      if (resolved !== undefined) {
        return cloneTemplateValue(resolved);
      }
    }
    return renderString(value, context, filters);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateTemplateVars(item, vars, filters));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = interpolateTemplateVars(nested, vars, filters);
    }
    return result;
  }

  return value;
}
