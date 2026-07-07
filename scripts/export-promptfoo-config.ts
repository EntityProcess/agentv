#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

type JsonMap = Record<string, unknown>;

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

function assertRecord(value: unknown, label: string): JsonMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptfooExportDiagnostic(
      'invalid_config',
      `${label} must be a YAML object for Promptfoo export.`,
    );
  }
  return value as JsonMap;
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

function lowerProviderEntry(provider: unknown): unknown {
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

function lowerProviders(providers: unknown): unknown {
  if (typeof providers === 'string') {
    return lowerProviderId(providers);
  }
  if (Array.isArray(providers)) {
    return providers.map(lowerProviderEntry);
  }
  if (providers && typeof providers === 'object') {
    return lowerProviderEntry(providers);
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

function promptfooConfigFromAgentVConfig(config: JsonMap): JsonMap {
  if ('environment' in config) {
    throw new PromptfooExportDiagnostic(
      'unsupported_environment',
      "Top-level 'environment' is AgentV-only and cannot be exported to Promptfoo yet. Remove it for direct Promptfoo validation, or keep running this eval through AgentV.",
    );
  }

  const promptfooConfig: JsonMap = {};
  for (const [key, value] of Object.entries(config)) {
    const outputKey = TOP_LEVEL_KEY_RENAMES[key] ?? key;
    if (key === 'providers') {
      promptfooConfig[outputKey] = lowerProviders(value);
      continue;
    }
    if (key === 'evaluate_options') {
      promptfooConfig[outputKey] = renameObjectKeys(value, EVALUATE_OPTIONS_KEY_RENAMES);
      continue;
    }
    promptfooConfig[outputKey] = value;
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

export function exportPromptfooConfig(options: ExportPromptfooConfigOptions): JsonMap {
  const input = readFileSync(options.inputPath, 'utf8');
  const parsed = assertRecord(YAML.parse(input), options.inputPath);
  const promptfooConfig = promptfooConfigFromAgentVConfig(parsed);
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
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
