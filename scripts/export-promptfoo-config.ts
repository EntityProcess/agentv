#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

type JsonMap = Record<string, unknown>;

interface HostEnvironmentExport {
  readonly type: 'host';
  readonly workdir: string;
  readonly env?: Record<string, string>;
  readonly setup?: {
    readonly command: readonly string[];
    readonly cwd?: string;
    readonly timeoutMs?: number;
  };
}

export class PromptfooExportDiagnostic extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PromptfooExportDiagnostic';
  }
}

export interface ExportPromptfooConfigOptions {
  inputPath: string;
  outputPath: string;
}

// Promptfoo validates JavaScript/TypeScript provider modules as class providers
// only when the provider id ends at the file extension. The `:callApi` suffix is
// valid for some Promptfoo file-backed hooks/assertions, but not provider ids.
const GENERATED_CODEX_CLI_PROVIDER_REF =
  'file://.agentv/generated/promptfoo/providers/codex-cli-provider.ts';
const GENERATED_HOST_ENVIRONMENT_EXTENSION_REF =
  'file://.agentv/generated/promptfoo/extensions/host-environment.ts:beforeAll';

const AGENTV_PROVIDER_LOWERINGS: Record<string, string> = {
  'agentv:codex-cli': GENERATED_CODEX_CLI_PROVIDER_REF,
};

const TOP_LEVEL_KEY_RENAMES: Record<string, string> = {
  default_test: 'defaultTest',
  evaluate_options: 'evaluateOptions',
};

const EVALUATE_OPTIONS_KEY_RENAMES: Record<string, string> = {
  max_concurrency: 'maxConcurrency',
};

const AGENTV_ONLY_PROVIDER_KEYS = new Set(['runtime']);
const SUPPORTED_HOST_ENVIRONMENT_KEYS = new Set(['type', 'workdir', 'setup', 'env']);
const DOCKER_ENVIRONMENT_KEYS = new Set([
  'context',
  'dockerfile',
  'image',
  'mounts',
  'resources',
  'secrets',
  'services',
]);

function assertRecord(value: unknown, label: string): JsonMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptfooExportDiagnostic(
      'invalid_config',
      `${label} must be a YAML object for Promptfoo export.`,
    );
  }
  return value as JsonMap;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PromptfooExportDiagnostic('invalid_environment', `${label} must be a string.`);
  }
  return value.trim();
}

function assertStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = assertRecord(value, label);
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    output[key] = assertString(entry, `${label}.${key}`);
  }
  return output;
}

function assertSetup(value: unknown): HostEnvironmentExport['setup'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const setup = assertRecord(value, 'environment.setup');
  for (const key of Object.keys(setup)) {
    if (key !== 'command' && key !== 'cwd' && key !== 'timeout_ms' && key !== 'timeoutMs') {
      throw new PromptfooExportDiagnostic(
        'unsupported_environment',
        `Unsupported host environment setup field '${key}'. Export supports setup.command, setup.cwd, and setup.timeout_ms.`,
      );
    }
  }
  const command = setup.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new PromptfooExportDiagnostic(
      'invalid_environment',
      'environment.setup.command must be a non-empty string array.',
    );
  }
  const timeoutValue = setup.timeout_ms ?? setup.timeoutMs;
  if (timeoutValue !== undefined && (typeof timeoutValue !== 'number' || timeoutValue <= 0)) {
    throw new PromptfooExportDiagnostic(
      'invalid_environment',
      'environment.setup.timeout_ms must be a positive number of milliseconds.',
    );
  }
  return {
    command: command as string[],
    ...(setup.cwd !== undefined && { cwd: assertString(setup.cwd, 'environment.setup.cwd') }),
    ...(typeof timeoutValue === 'number' && { timeoutMs: timeoutValue }),
  };
}

function resolveFileReference(reference: string, baseDir: string): string {
  const filePath = reference.slice('file://'.length);
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function readEnvironmentInput(value: unknown, inputDir: string): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (!value.startsWith('file://')) {
    throw new PromptfooExportDiagnostic(
      'unsupported_environment_ref',
      'environment must be an inline host recipe or a file:// reference.',
    );
  }
  const environmentPath = resolveFileReference(value, inputDir);
  const parsed = YAML.parse(readFileSync(environmentPath, 'utf8'));
  return parsed;
}

function environmentDiagnosticForDocker(): PromptfooExportDiagnostic {
  return new PromptfooExportDiagnostic(
    'unsupported_docker_environment',
    'Docker environment export is not supported yet. Export refuses to silently degrade Docker isolation, image/context, mounts, services, resources, secrets, or provenance.',
  );
}

function parseHostEnvironment(value: unknown, inputDir: string): HostEnvironmentExport {
  const environment = assertRecord(readEnvironmentInput(value, inputDir), 'environment');
  const type = environment.type ?? 'host';
  if (
    type === 'docker' ||
    Object.keys(environment).some((key) => DOCKER_ENVIRONMENT_KEYS.has(key))
  ) {
    throw environmentDiagnosticForDocker();
  }
  if (type !== 'host') {
    throw new PromptfooExportDiagnostic(
      'unsupported_environment',
      'Only environment.type: host can be exported to Promptfoo in the initial exporter.',
    );
  }
  for (const key of Object.keys(environment)) {
    if (!SUPPORTED_HOST_ENVIRONMENT_KEYS.has(key)) {
      throw new PromptfooExportDiagnostic(
        'unsupported_environment',
        `Unsupported host environment field '${key}'. Export supports workdir, setup, and env.`,
      );
    }
  }

  const workdir = assertString(environment.workdir, 'environment.workdir');
  const env = assertStringRecord(environment.env, 'environment.env');
  const setup = assertSetup(environment.setup);
  return {
    type: 'host',
    workdir: path.isAbsolute(workdir) ? workdir : path.resolve(inputDir, workdir),
    ...(env !== undefined && { env }),
    ...(setup !== undefined && { setup }),
  };
}

function agentvEnvironmentMetadata(environment: HostEnvironmentExport): JsonMap {
  return {
    type: environment.type,
    workdir: environment.workdir,
  };
}

function mergeJsonObject(value: unknown, additions: JsonMap): JsonMap {
  const base =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonMap) : {};
  return {
    ...base,
    ...additions,
  };
}

function addEnvironmentToProvider(provider: unknown, environment: HostEnvironmentExport): unknown {
  const environmentMetadata = agentvEnvironmentMetadata(environment);
  const configAdditions = {
    agentv_environment_workdir: environment.workdir,
    agentv_environment: environmentMetadata,
  };

  if (typeof provider === 'string') {
    return {
      id: lowerProviderId(provider),
      config: configAdditions,
    };
  }

  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    const providerObject = provider as JsonMap;
    if (looksLikeProviderOptionsMap(providerObject)) {
      const [[id, options]] = Object.entries(providerObject);
      const optionObject =
        options && typeof options === 'object' && !Array.isArray(options)
          ? (options as JsonMap)
          : {};
      return {
        [lowerProviderId(id)]: {
          ...optionObject,
          config: mergeJsonObject(optionObject.config, configAdditions),
        },
      };
    }
    return {
      ...providerObject,
      config: mergeJsonObject(providerObject.config, configAdditions),
    };
  }

  return provider;
}

function lowerProviderId(id: string): string {
  if (!id.startsWith('agentv:')) {
    return id;
  }

  const lowered = AGENTV_PROVIDER_LOWERINGS[id];
  if (!lowered) {
    throw new PromptfooExportDiagnostic(
      'unsupported_provider',
      `Unsupported AgentV-only provider '${id}'. Export currently supports: ${Object.keys(
        AGENTV_PROVIDER_LOWERINGS,
      ).join(', ')}.`,
    );
  }
  return lowered;
}

function lowerProviderObject(provider: JsonMap): JsonMap {
  const lowered: JsonMap = {};
  for (const [key, value] of Object.entries(provider)) {
    if (AGENTV_ONLY_PROVIDER_KEYS.has(key)) {
      continue;
    }
    lowered[key] = key === 'id' && typeof value === 'string' ? lowerProviderId(value) : value;
  }
  return lowered;
}

function looksLikeProviderOptionsMap(provider: JsonMap): boolean {
  return !('id' in provider) && Object.keys(provider).length === 1;
}

function lowerProviderEntry(provider: unknown, environment?: HostEnvironmentExport): unknown {
  if (environment) {
    return lowerProviderEntry(addEnvironmentToProvider(provider, environment));
  }

  if (typeof provider === 'string') {
    return lowerProviderId(provider);
  }

  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    const providerObject = provider as JsonMap;
    if (looksLikeProviderOptionsMap(providerObject)) {
      const [[id, options]] = Object.entries(providerObject);
      return { [lowerProviderId(id)]: options };
    }
    return lowerProviderObject(providerObject);
  }

  return provider;
}

function lowerProviders(providers: unknown, environment?: HostEnvironmentExport): unknown {
  if (typeof providers === 'string') {
    return lowerProviderEntry(providers, environment);
  }
  if (Array.isArray(providers)) {
    return providers.map((provider) => lowerProviderEntry(provider, environment));
  }
  if (providers && typeof providers === 'object') {
    return lowerProviderEntry(providers, environment);
  }
  return providers;
}

function renameObjectKeys(value: unknown, renames: Record<string, string>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const output: JsonMap = {};
  for (const [key, childValue] of Object.entries(value as JsonMap)) {
    output[renames[key] ?? key] = childValue;
  }
  return output;
}

function defaultTestWithEnvironment(value: unknown, environment: HostEnvironmentExport): JsonMap {
  if (typeof value === 'string') {
    throw new PromptfooExportDiagnostic(
      'unsupported_environment_default_test_ref',
      'Host environment export cannot inject workdir vars into a default_test file reference yet. Inline default_test before exporting to Promptfoo.',
    );
  }
  const defaultTest =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonMap) : {};
  return {
    ...defaultTest,
    vars: mergeJsonObject(defaultTest.vars, {
      agentv_environment_workdir: environment.workdir,
    }),
    metadata: mergeJsonObject(defaultTest.metadata, {
      agentv_environment: agentvEnvironmentMetadata(environment),
    }),
  };
}

function promptfooConfigFromAgentVConfig(
  config: JsonMap,
  environment?: HostEnvironmentExport,
): JsonMap {
  const promptfooConfig: JsonMap = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === 'environment') {
      continue;
    }
    const outputKey = TOP_LEVEL_KEY_RENAMES[key] ?? key;
    if (key === 'providers') {
      promptfooConfig[outputKey] = lowerProviders(value, environment);
      continue;
    }
    if (key === 'default_test') {
      promptfooConfig[outputKey] = environment
        ? defaultTestWithEnvironment(value, environment)
        : value;
      continue;
    }
    if (key === 'evaluate_options') {
      promptfooConfig[outputKey] = renameObjectKeys(value, EVALUATE_OPTIONS_KEY_RENAMES);
      continue;
    }
    promptfooConfig[outputKey] = value;
  }
  if (environment && !('defaultTest' in promptfooConfig)) {
    promptfooConfig.defaultTest = defaultTestWithEnvironment(undefined, environment);
  }
  if (environment) {
    promptfooConfig.metadata = mergeJsonObject(promptfooConfig.metadata, {
      agentv_environment: agentvEnvironmentMetadata(environment),
    });
    promptfooConfig.extensions = [
      ...((Array.isArray(promptfooConfig.extensions)
        ? promptfooConfig.extensions
        : []) as unknown[]),
      GENERATED_HOST_ENVIRONMENT_EXTENSION_REF,
    ];
  }
  return promptfooConfig;
}

function writeGeneratedProviderFiles(outputPath: string, config: JsonMap): void {
  const serialized = YAML.stringify(config);
  if (!serialized.includes(GENERATED_CODEX_CLI_PROVIDER_REF)) {
    return;
  }

  const providerPath = path.join(
    path.dirname(outputPath),
    '.agentv',
    'generated',
    'promptfoo',
    'providers',
    'codex-cli-provider.ts',
  );
  mkdirSync(path.dirname(providerPath), { recursive: true });
  writeFileSync(
    providerPath,
    [
      'export async function callApi() {',
      '  return {',
      "    error: 'agentv:codex-cli was exported for Promptfoo config validation. Runtime Promptfoo execution requires a complete AgentV Promptfoo provider wrapper.',",
      '  };',
      '}',
      '',
      'export default class CodexCliPromptfooProvider {',
      '  label;',
      '  config;',
      '',
      '  constructor(options = {}) {',
      '    this.label = options.label;',
      '    this.config = options.config;',
      '  }',
      '',
      '  id() {',
      "    return this.label || 'agentv:codex-cli';",
      '  }',
      '',
      '  async callApi() {',
      '    return callApi();',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function setupCwdForExport(
  environment: HostEnvironmentExport,
  inputDir: string,
): string | undefined {
  const cwd = environment.setup?.cwd;
  if (!environment.setup) {
    return undefined;
  }
  if (!cwd) {
    return inputDir;
  }
  return path.isAbsolute(cwd) ? cwd : path.resolve(environment.workdir, cwd);
}

function writeGeneratedHostEnvironmentExtension(
  outputPath: string,
  environment: HostEnvironmentExport | undefined,
  inputDir: string,
): void {
  if (!environment) {
    return;
  }

  const extensionPath = path.join(
    path.dirname(outputPath),
    '.agentv',
    'generated',
    'promptfoo',
    'extensions',
    'host-environment.ts',
  );
  mkdirSync(path.dirname(extensionPath), { recursive: true });
  const setup =
    environment.setup === undefined
      ? null
      : {
          command: environment.setup.command,
          cwd: setupCwdForExport(environment, inputDir),
          ...(environment.setup.timeoutMs !== undefined && {
            timeoutMs: environment.setup.timeoutMs,
          }),
        };
  writeFileSync(
    extensionPath,
    [
      "import { spawnSync } from 'node:child_process';",
      "import { mkdirSync } from 'node:fs';",
      '',
      `const environment = ${JSON.stringify(agentvEnvironmentMetadata(environment), null, 2)};`,
      `const setup = ${JSON.stringify(setup, null, 2)};`,
      `const environmentEnv = ${JSON.stringify(environment.env ?? {}, null, 2)};`,
      '',
      'export function beforeAll(context) {',
      '  mkdirSync(environment.workdir, { recursive: true });',
      '  if (setup) {',
      '    const result = spawnSync(setup.command[0], setup.command.slice(1), {',
      '      cwd: setup.cwd,',
      '      env: {',
      '        ...process.env,',
      '        ...environmentEnv,',
      '        AGENTV_ENVIRONMENT_WORKDIR: environment.workdir,',
      '      },',
      '      input: JSON.stringify({ environment }, null, 2),',
      "      encoding: 'utf8',",
      '      timeout: setup.timeoutMs,',
      '    });',
      '    if (result.error) {',
      '      throw result.error;',
      '    }',
      '    if (result.status && result.status !== 0) {',
      '      throw new Error(`AgentV host environment setup failed with exit code ${result.status}: ${result.stderr || result.stdout || ""}`);',
      '    }',
      '  }',
      '  return context;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

export function exportPromptfooConfig(options: ExportPromptfooConfigOptions): JsonMap {
  const input = readFileSync(options.inputPath, 'utf8');
  const parsed = assertRecord(YAML.parse(input), options.inputPath);
  const inputDir = path.dirname(options.inputPath);
  const environment =
    parsed.environment !== undefined
      ? parseHostEnvironment(parsed.environment, inputDir)
      : undefined;
  const promptfooConfig = promptfooConfigFromAgentVConfig(parsed, environment);
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeGeneratedHostEnvironmentExtension(options.outputPath, environment, inputDir);
  writeFileSync(options.outputPath, YAML.stringify(promptfooConfig), 'utf8');
  writeGeneratedProviderFiles(options.outputPath, promptfooConfig);
  return promptfooConfig;
}

function parseArgs(argv: string[]): ExportPromptfooConfigOptions {
  const options: Partial<ExportPromptfooConfigOptions> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      options.inputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output') {
      options.outputPath = argv[i + 1];
      i += 1;
    }
  }

  if (!options.inputPath || !options.outputPath) {
    throw new PromptfooExportDiagnostic(
      'usage',
      'Usage: bun scripts/export-promptfoo-config.ts --input <agentv.eval.yaml> --output <promptfooconfig.yaml>',
    );
  }

  return {
    inputPath: path.resolve(options.inputPath),
    outputPath: path.resolve(options.outputPath),
  };
}

if (import.meta.main) {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    exportPromptfooConfig(options);
    console.log(`Exported Promptfoo config: ${options.outputPath}`);
  } catch (error) {
    if (error instanceof PromptfooExportDiagnostic) {
      console.error(`error[${error.code}]: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
