import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isPlainConfigObject } from '../../config-overlays.js';
import { expandProviderDefinitionEntries } from '../providers/targets.js';
import { parseYamlValue } from '../yaml-loader.js';

const FILE_PROTOCOL = 'file://';
const ARRAY_FIELDS = new Set(['providers', 'targets', 'graders', 'tests', 'projects']);
const OBJECT_FIELDS = new Set([
  'defaults',
  'execution',
  'results',
  'hooks',
  'refs',
  'tags',
  'dashboard',
]);
const SCALAR_OR_ARRAY_FIELDS = new Set(['eval_patterns']);
const SCALAR_FIELDS = new Set(['required_version', '$schema']);
const PROJECT_EXECUTION_DEFAULT_FIELDS = new Set([
  'max_concurrency',
  'verbose',
  'keep_workspaces',
  'workspace_path',
]);
const SUPPORTED_FILE_REF_FIELDS = new Set([
  ...ARRAY_FIELDS,
  ...OBJECT_FIELDS,
  ...SCALAR_OR_ARRAY_FIELDS,
  ...SCALAR_FIELDS,
]);
const RUNTIME_MODES = new Set(['host', 'profile', 'sandbox']);
const AMBIGUOUS_PROVIDER_ALIASES = new Set(['codex', 'claude', 'copilot', 'pi']);
const REMOVED_TARGET_FIELDS = new Map([
  ['label', "target identity uses 'id'; remove 'label'."],
  ['name', "target identity uses 'id'; remove 'name'."],
  ['executable', "put process argv under 'config.command'."],
  ['binary', "put process argv under 'config.command'."],
  ['args', "put process argv under 'config.command'."],
  ['arguments', "put process argv under 'config.command'."],
  ['environment', 'environment recipes belong at suite/test/case scope, not under targets.'],
  ['container', 'container/testbed setup belongs in an environment recipe, not under targets.'],
  ['install', 'install/setup steps belong in environment.setup, not under targets.'],
  ['grader_target', "grader selection belongs in 'defaults.grader' or evaluator config."],
  ['workers', "target-level 'workers' is not general run policy; use 'execution.max_concurrency'."],
  [
    'batch_requests',
    "target-level 'batch_requests' is not part of the base config contract; keep provider batching under provider-specific config only when needed.",
  ],
  [
    'subagent_mode_allowed',
    "target-level 'subagent_mode_allowed' is not part of the base config contract.",
  ],
]);
const REMOVED_PROVIDER_FIELDS = new Map(
  Array.from(REMOVED_TARGET_FIELDS).filter(
    ([field]) =>
      field !== 'label' && field !== 'environment' && field !== 'container' && field !== 'install',
  ),
);

export type RuntimeMode = 'host' | 'profile' | 'sandbox';

export type NormalizedRuntimeConfig = {
  readonly mode: RuntimeMode;
  readonly [key: string]: unknown;
};

export type NormalizedTargetConfig = {
  readonly id: string;
  readonly provider: string;
  readonly runtime?: NormalizedRuntimeConfig;
  readonly config: Record<string, unknown>;
};

export type ConfigDefaults = {
  readonly provider?: string;
  readonly grader?: string;
};

export type ConfigExecution = {
  readonly max_concurrency?: number;
};

export type ComposableConfigGraph = {
  readonly targets?: readonly NormalizedTargetConfig[];
  readonly tests?: readonly unknown[];
  readonly defaults?: ConfigDefaults;
  readonly execution?: ConfigExecution;
};

type NormalizeOptions = {
  readonly allowExecutionDefaultFields?: boolean;
};

export async function resolveConfigFieldReferences(
  rawConfig: Record<string, unknown>,
  configPath: string,
): Promise<Record<string, unknown>> {
  const resolvedEntries = await Promise.all(
    Object.entries(rawConfig).map(async ([field, value]) => {
      if (!isFileReference(value)) {
        return [field, value] as const;
      }
      if (!SUPPORTED_FILE_REF_FIELDS.has(field)) {
        throw new Error(
          `Field '${field}' in ${configPath} cannot use a file:// reference because it is not a supported top-level config field.`,
        );
      }
      return [field, await loadReferencedFieldValue(field, value, configPath)] as const;
    }),
  );
  return Object.fromEntries(resolvedEntries);
}

export async function loadComposableConfigGraph(
  configPath: string,
): Promise<ComposableConfigGraph> {
  const raw = parseYamlValue(await readFile(configPath, 'utf8'));
  if (!isPlainConfigObject(raw)) {
    throw new Error(`Config graph at ${configPath} must be a YAML object.`);
  }
  const resolved = await resolveConfigFieldReferences(raw, configPath);
  return normalizeComposableConfigGraph(resolved, configPath);
}

export function normalizeComposableConfigGraph(
  rawConfig: Record<string, unknown>,
  configPath: string,
  options: NormalizeOptions = {},
): ComposableConfigGraph {
  if (rawConfig.graders !== undefined) {
    throw new Error(
      `Field 'graders' in ${configPath} has been removed. A grader is just a provider — move each entry into 'providers' and select it via 'defaults.grader' or an assertion's provider override, not a separate grader list.`,
    );
  }
  if (rawConfig.targets !== undefined) {
    throw new Error(
      `Field 'targets' in ${configPath} has been removed. Use 'providers:'; map targets[].id to providers[].label and targets[].provider to providers[].id.`,
    );
  }
  const graph: ComposableConfigGraph = {
    ...(rawConfig.providers !== undefined
      ? { targets: parseProviders(rawConfig.providers, `${configPath}:providers`) }
      : {}),
    ...(rawConfig.tests !== undefined
      ? { tests: parseArray(rawConfig.tests, `${configPath}:tests`) }
      : {}),
    ...(rawConfig.defaults !== undefined
      ? { defaults: parseDefaults(rawConfig.defaults, `${configPath}:defaults`) }
      : {}),
    ...(rawConfig.execution !== undefined
      ? {
          execution: parseExecution(
            rawConfig.execution,
            `${configPath}:execution`,
            options.allowExecutionDefaultFields ?? false,
          ),
        }
      : {}),
  };

  validateDefaultSelections(graph, configPath);
  return graph;
}

function isFileReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FILE_PROTOCOL);
}

async function loadReferencedFieldValue(
  field: string,
  reference: string,
  ownerPath: string,
): Promise<unknown> {
  const referencedPath = resolveReferencePath(reference, ownerPath);
  const parsed = parseYamlValue(await readFile(referencedPath, 'utf8'));
  if (isPlainConfigObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, field)) {
    throw new Error(
      `Invalid ${field} file reference in ${ownerPath}: ${referencedPath} must contain the '${field}' value directly, not an object wrapped in '${field}'.`,
    );
  }
  validateReferencedFieldShape(field, parsed, referencedPath);
  return parsed;
}

function resolveReferencePath(reference: string, ownerPath: string): string {
  const filePath = reference.slice(FILE_PROTOCOL.length);
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(path.resolve(ownerPath)), filePath);
}

function validateReferencedFieldShape(field: string, value: unknown, referencedPath: string): void {
  if (ARRAY_FIELDS.has(field) && !Array.isArray(value)) {
    throw new Error(`Referenced ${field} file ${referencedPath} must contain a YAML array.`);
  }
  if (OBJECT_FIELDS.has(field) && !isPlainConfigObject(value)) {
    throw new Error(`Referenced ${field} file ${referencedPath} must contain a YAML object.`);
  }
  if (SCALAR_OR_ARRAY_FIELDS.has(field) && typeof value !== 'string' && !Array.isArray(value)) {
    throw new Error(
      `Referenced ${field} file ${referencedPath} must contain a scalar or array value.`,
    );
  }
}

function parseArray(value: unknown, location: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${location}: expected an array.`);
  }
  return value;
}

function parseProviders(value: unknown, location: string): readonly NormalizedTargetConfig[] {
  return expandProviderDefinitionEntries(parseArray(value, location), {
    location,
    stringMode: 'all',
  }).map((entry) => parseProvider(entry.rawDefinition, entry.definition, `${location}`));
}

function parseProvider(
  value: unknown,
  definition: ReturnType<typeof expandProviderDefinitionEntries>[number]['definition'],
  location: string,
): NormalizedTargetConfig {
  if (!isPlainConfigObject(value)) {
    throw new Error(`Invalid ${location}: provider must be an object.`);
  }
  for (const [field, message] of REMOVED_PROVIDER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Invalid ${location}.${field}: ${message}`);
    }
  }

  const id = definition.name;
  const provider = readRequiredString(definition.provider, `${location}.id`);
  if (AMBIGUOUS_PROVIDER_ALIASES.has(provider)) {
    throw new Error(
      `Invalid ${location}.id: '${provider}' is ambiguous; choose an explicit provider such as '${provider}-cli' or '${provider}-sdk'.`,
    );
  }

  const config = readOptionalObject(value.config, `${location}.config`) ?? {};
  validateCommand(config.command, `${location}.config.command`, {
    allowString: provider === 'cli',
  });
  const runtime =
    definition.runtime !== undefined
      ? parseRuntime(definition.runtime, `${location}.runtime`)
      : undefined;

  return {
    id,
    provider,
    config,
    ...(runtime !== undefined ? { runtime } : {}),
  };
}

function parseRuntime(value: unknown, location: string): NormalizedRuntimeConfig {
  if (typeof value === 'string') {
    const mode = value.trim();
    if (RUNTIME_MODES.has(mode)) {
      return { mode: mode as RuntimeMode };
    }
  }
  if (isPlainConfigObject(value)) {
    const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
    if (RUNTIME_MODES.has(mode)) {
      return { ...value, mode: mode as RuntimeMode };
    }
  }
  throw new Error(`Invalid ${location}: use 'host' or an object with mode: host|profile|sandbox.`);
}

function parseDefaults(value: unknown, location: string): ConfigDefaults {
  const defaults = readOptionalObject(value, location);
  if (!defaults) {
    throw new Error(`Invalid ${location}: expected an object.`);
  }
  if (defaults.target !== undefined) {
    throw new Error(
      `Invalid ${location}.target: defaults.target has been removed. Use defaults.provider.`,
    );
  }
  const provider = readOptionalString(defaults.provider, `${location}.provider`);
  const grader = readOptionalString(defaults.grader, `${location}.grader`);
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(grader !== undefined ? { grader } : {}),
  };
}

function parseExecution(
  value: unknown,
  location: string,
  allowDefaultFields: boolean,
): ConfigExecution {
  const execution = readOptionalObject(value, location);
  if (!execution) {
    throw new Error(`Invalid ${location}: expected an object.`);
  }
  for (const key of Object.keys(execution)) {
    if (key !== 'max_concurrency') {
      if (allowDefaultFields && PROJECT_EXECUTION_DEFAULT_FIELDS.has(key)) {
        continue;
      }
      throw new Error(
        `Invalid ${location}.${key}: unsupported execution field. Use execution.max_concurrency for eval parallelism.`,
      );
    }
  }
  const rawMaxConcurrency = execution.max_concurrency;
  if (rawMaxConcurrency === undefined) {
    return {};
  }
  if (
    typeof rawMaxConcurrency !== 'number' ||
    !Number.isInteger(rawMaxConcurrency) ||
    rawMaxConcurrency < 1 ||
    rawMaxConcurrency > 50
  ) {
    throw new Error(`Invalid ${location}.max_concurrency: expected an integer between 1 and 50.`);
  }
  return { max_concurrency: rawMaxConcurrency };
}

function validateDefaultSelections(graph: ComposableConfigGraph, configPath: string): void {
  // A grader is just a provider selected for a grading role, not a separate
  // entity. Only validate against providers defined inline in this same config
  // document; external provider catalogs are resolved lazily at eval-run time.
  if (!graph.targets || graph.targets.length === 0) {
    return;
  }
  const targetIds = new Set(graph.targets.map((target) => target.id));
  if (graph.defaults?.provider !== undefined && !targetIds.has(graph.defaults.provider)) {
    throw new Error(
      `Invalid defaults.provider in ${configPath}: '${graph.defaults.provider}' does not match a configured provider label or id.`,
    );
  }
  if (graph.defaults?.grader !== undefined && !targetIds.has(graph.defaults.grader)) {
    throw new Error(
      `Invalid defaults.grader in ${configPath}: '${graph.defaults.grader}' does not match a configured provider label or id.`,
    );
  }
}

function readRequiredString(value: unknown, location: string): string {
  const result = readOptionalString(value, location);
  if (result === undefined) {
    throw new Error(`Invalid ${location}: expected a non-empty string.`);
  }
  return result;
}

function readOptionalString(value: unknown, location: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${location}: expected a non-empty string.`);
  }
  return value.trim();
}

function readOptionalObject(value: unknown, location: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainConfigObject(value)) {
    throw new Error(`Invalid ${location}: expected an object.`);
  }
  return value;
}

function validateCommand(
  value: unknown,
  location: string,
  options: { readonly allowString?: boolean } = {},
): void {
  if (value === undefined) {
    return;
  }
  if (options.allowString && typeof value === 'string' && value.trim().length > 0) {
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new Error(`Invalid ${location}: expected a non-empty argv array of strings.`);
  }
}
