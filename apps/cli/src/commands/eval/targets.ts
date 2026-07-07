import path from 'node:path';
import {
  type EvalTargetSpec,
  type ProviderDefinition,
  type ResolvedProviderBackend,
  listProviderLabels,
  readProviderDefinitions,
  readTestSuiteMetadata,
  resolveProviderDefinition,
  resolveProviderDefinitionEnvironments,
} from '@agentv/core';
import { validateTargetsFile } from '@agentv/core/evaluation/validation';
import { discoverProvidersFile } from '../../utils/providers.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}

/**
 * Resolve a target definition, following alias chains.
 *
 * If a target has an `alias` field (supports ${{ ENV_VAR }} syntax),
 * it is resolved to the referenced target. This allows a single env var
 * to switch the entire provider config:
 *
 *   - name: default
 *     alias: ${{ AGENT_TARGET }}   # e.g. "copilot-cli"
 *
 * use_target chains are followed up to 5 levels deep to prevent cycles.
 */
function resolveUseTarget(
  name: string,
  definitions: readonly ProviderDefinition[],
  env: NodeJS.ProcessEnv,
  providersFilePath: string,
): ProviderDefinition {
  const maxDepth = 5;
  let current: ProviderDefinition | undefined = definitions.find((d) => d.name === name);
  if (!current) {
    const available = listProviderLabels(definitions).join(', ');
    throw new Error(
      `Provider '${name}' not found in ${providersFilePath}. Available providers: ${available}`,
    );
  }

  for (let depth = 0; depth < maxDepth; depth++) {
    const useTarget = current.use_target;
    if (useTarget === undefined || useTarget === null) break;
    const raw: string = String(useTarget).trim();
    if (raw.length === 0) break;

    // Resolve ${{ ENV_VAR }} syntax
    const envMatch: RegExpMatchArray | null = raw.match(/^\$\{\{\s*([A-Z0-9_]+)\s*\}\}$/i);
    const resolved: string = envMatch ? (env[envMatch[1]] ?? '') : raw;
    if (resolved.trim().length === 0) break;

    const next: ProviderDefinition | undefined = definitions.find(
      (d) => d.name === resolved.trim(),
    );
    if (!next) {
      const available = listProviderLabels(definitions).join(', ');
      throw new Error(
        `Provider '${name}' use_target '${resolved.trim()}' not found in ${providersFilePath}. Available providers: ${available}`,
      );
    }
    current = next;
  }

  return current;
}

export async function readTestSuiteProvider(testFilePath: string): Promise<string | undefined> {
  const metadata = await readTestSuiteMetadata(testFilePath);
  return metadata.target;
}

export async function readTestSuiteProviders(
  testFilePath: string,
): Promise<readonly string[] | undefined> {
  const metadata = await readTestSuiteMetadata(testFilePath);
  return metadata.targets;
}

export interface ProviderSelection {
  readonly definitions: readonly ProviderDefinition[];
  readonly resolvedProvider: ResolvedProviderBackend;
  readonly providerLabel: string;
  readonly providerDisplayLabel?: string;
  readonly providerSource: 'cli' | 'test-file' | 'default';
  readonly providersFilePath: string;
  /** Per-provider hooks from eval file (eval-level customization) */
  readonly providerHooks?: import('@agentv/core').TargetHooksConfig;
}

export interface ProviderSelectionOptions {
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly explicitProvidersPath?: string;
  readonly providerDefinitions?: readonly ProviderDefinition[];
  readonly providerDefinitionsSource?: string;
  readonly requireExplicitProviderCatalog?: boolean;
  readonly allowLegacyTargetFiles?: boolean;
  readonly cliProviderLabel?: string;
  readonly cliProviderLabels?: readonly string[];
  readonly fileProviderLabel?: string;
  readonly fileTargetSpec?: EvalTargetSpec;
  readonly modelOverride?: string;
  readonly env: NodeJS.ProcessEnv;
}

async function readProviderCatalog(options: {
  readonly explicitProvidersPath?: string;
  readonly providerDefinitions?: readonly ProviderDefinition[];
  readonly providerDefinitionsSource?: string;
  readonly requireExplicitProviderCatalog?: boolean;
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly allowLegacyTargetFiles?: boolean;
}): Promise<{ readonly definitions: readonly ProviderDefinition[]; readonly sourcePath: string }> {
  if (!options.explicitProvidersPath && options.providerDefinitions) {
    return {
      definitions: options.providerDefinitions,
      sourcePath: options.providerDefinitionsSource ?? '.agentv/config.yaml:providers',
    };
  }
  if (!options.explicitProvidersPath && options.requireExplicitProviderCatalog) {
    throw new Error(
      'No provider catalog configured. Add `providers:` to .agentv/config.yaml, use `providers: file://providers.yaml`, or pass --providers <path>.',
    );
  }
  const providersFilePath = await discoverProvidersFile({
    explicitPath: options.explicitProvidersPath,
    testFilePath: options.testFilePath,
    repoRoot: options.repoRoot,
    cwd: options.cwd,
    allowLegacyTargetFiles: options.allowLegacyTargetFiles,
  });
  await validateProviderCatalogFile(providersFilePath);
  return {
    definitions: await readProviderDefinitions(providersFilePath),
    sourcePath: providersFilePath,
  };
}

async function validateProviderCatalogFile(providersFilePath: string): Promise<void> {
  const validationResult = await validateTargetsFile(providersFilePath);
  const warnings = validationResult.errors.filter((e) => e.severity === 'warning');
  const useColors = isTTY();

  if (warnings.length > 0) {
    console.warn(`\nWarnings in ${providersFilePath}:`);
    for (const warning of warnings) {
      const location = warning.location ? ` [${warning.location}]` : '';
      const prefix = useColors ? `${ANSI_YELLOW}  ⚠${ANSI_RESET}` : '  ⚠';
      const message = useColors ? `${ANSI_YELLOW}${warning.message}${ANSI_RESET}` : warning.message;
      console.warn(`${prefix}${location} ${message}`);
    }
    console.warn('');
  }

  const errors = validationResult.errors.filter((e) => e.severity === 'error');
  if (errors.length > 0) {
    console.error(`\nErrors in ${providersFilePath}:`);
    for (const error of errors) {
      const location = error.location ? ` [${error.location}]` : '';
      const prefix = useColors ? `${ANSI_RED}  ✗${ANSI_RESET}` : '  ✗';
      const message = useColors ? `${ANSI_RED}${error.message}${ANSI_RESET}` : error.message;
      console.error(`${prefix}${location} ${message}`);
    }
    throw new Error(`Providers file validation failed with ${errors.length} error(s)`);
  }
}

function pickProviderLabel(options: {
  readonly cliProviderLabel?: string;
  readonly fileProviderLabel?: string;
}): { readonly name: string; readonly source: 'cli' | 'test-file' | 'default' } {
  const cliName = options.cliProviderLabel?.trim();
  if (cliName && cliName !== 'default') {
    return { name: cliName, source: 'cli' };
  }

  const fileName = options.fileProviderLabel?.trim();
  if (fileName && fileName.length > 0) {
    return { name: fileName, source: 'test-file' };
  }

  return { name: 'default', source: 'default' };
}

function withModelOverride(
  target: ProviderDefinition,
  modelOverride: string | undefined,
): ProviderDefinition {
  const model = modelOverride?.trim();
  return model && model.length > 0 ? { ...target, model } : target;
}

function overlayTargetDefinition(params: {
  readonly spec: EvalTargetSpec | undefined;
  readonly definitions: readonly ProviderDefinition[];
  readonly env: NodeJS.ProcessEnv;
  readonly providersFilePath: string;
}): ProviderDefinition | undefined {
  const { spec, definitions, env, providersFilePath } = params;
  if (!spec?.definition) {
    return undefined;
  }
  if (spec.extends) {
    const base = resolveUseTarget(spec.extends, definitions, env, providersFilePath);
    return {
      ...base,
      ...spec.definition,
      name: spec.name,
    };
  }
  return spec.definition;
}

function definitionsWithEffectiveTarget(
  definitions: readonly ProviderDefinition[],
  effective: ProviderDefinition,
): readonly ProviderDefinition[] {
  return [effective, ...definitions.filter((definition) => definition.name !== effective.name)];
}

async function resolveInlineDefinitionEnvironment(
  definition: ProviderDefinition,
  testFilePath: string,
  location: string,
): Promise<ProviderDefinition> {
  const [resolved] = await resolveProviderDefinitionEnvironments(
    [definition],
    path.dirname(path.resolve(testFilePath)),
    { location },
  );
  return resolved ?? definition;
}

export async function selectProvider(
  options: ProviderSelectionOptions,
): Promise<ProviderSelection> {
  const {
    testFilePath,
    repoRoot,
    cwd,
    explicitProvidersPath,
    providerDefinitions,
    providerDefinitionsSource,
    requireExplicitProviderCatalog,
    allowLegacyTargetFiles,
    cliProviderLabel,
    modelOverride,
    env,
  } = options;

  const providerCatalog = await readProviderCatalog({
    explicitProvidersPath,
    providerDefinitions,
    providerDefinitionsSource,
    requireExplicitProviderCatalog,
    testFilePath,
    repoRoot,
    cwd,
    allowLegacyTargetFiles,
  });
  const definitions = providerCatalog.definitions;
  const providersFilePath = providerCatalog.sourcePath;
  const fileTargetSpec = options.fileTargetSpec;
  const fileProviderLabel =
    options.fileProviderLabel ??
    fileTargetSpec?.name ??
    (await readTestSuiteProvider(testFilePath));
  const providerChoice = pickProviderLabel({ cliProviderLabel, fileProviderLabel });

  const rawOverlayDefinition =
    providerChoice.source === 'test-file'
      ? overlayTargetDefinition({ spec: fileTargetSpec, definitions, env, providersFilePath })
      : undefined;
  const overlayDefinition = rawOverlayDefinition
    ? await resolveInlineDefinitionEnvironment(rawOverlayDefinition, testFilePath, 'providers')
    : undefined;
  const targetDefinition = withModelOverride(
    overlayDefinition ?? resolveUseTarget(providerChoice.name, definitions, env, providersFilePath),
    modelOverride,
  );
  const effectiveDefinitions =
    overlayDefinition !== undefined
      ? definitionsWithEffectiveTarget(definitions, targetDefinition)
      : definitions;

  try {
    const resolvedProvider = resolveProviderDefinition(targetDefinition, env, testFilePath, {
      emitDeprecationWarnings: false,
    });
    return {
      definitions: effectiveDefinitions,
      resolvedProvider,
      providerLabel: providerChoice.name,
      providerSource: providerChoice.source,
      providersFilePath,
      ...(providerChoice.source === 'test-file' && fileTargetSpec?.hooks
        ? { providerHooks: fileTargetSpec.hooks }
        : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve provider '${providerChoice.name}': ${message}`);
  }
}

/**
 * Select multiple providers for matrix evaluation.
 * Returns an array of ProviderSelection, one per provider label.
 */
export async function selectMultipleProviders(
  options: ProviderSelectionOptions & {
    readonly providerLabels: readonly string[];
    readonly providerRefs?: readonly import('@agentv/core').EvalTargetRef[];
    readonly providerSource?: 'cli' | 'test-file';
  },
): Promise<readonly ProviderSelection[]> {
  const {
    testFilePath,
    repoRoot,
    cwd,
    explicitProvidersPath,
    providerDefinitions,
    providerDefinitionsSource,
    requireExplicitProviderCatalog,
    allowLegacyTargetFiles,
    env,
    providerLabels,
    providerRefs,
    modelOverride,
  } = options;

  // Build a lookup for target hooks from eval target refs
  const hooksMap = new Map<string, import('@agentv/core').TargetHooksConfig>();
  const labelsMap = new Map<string, string>();
  if (providerRefs) {
    for (const ref of providerRefs) {
      if (ref.hooks) {
        hooksMap.set(ref.name, ref.hooks);
      }
      if (ref.label) {
        labelsMap.set(ref.name, ref.label);
      }
    }
  }

  const providerCatalog = await readProviderCatalog({
    explicitProvidersPath,
    providerDefinitions,
    providerDefinitionsSource,
    requireExplicitProviderCatalog,
    testFilePath,
    repoRoot,
    cwd,
    allowLegacyTargetFiles,
  });
  const providersFilePath = providerCatalog.sourcePath;
  const fileDefinitions = providerCatalog.definitions;

  // Inject synthetic definitions from eval target refs (for use_target delegation)
  const definitions = [...fileDefinitions];
  if (providerRefs) {
    for (const ref of providerRefs) {
      if (ref.definition && !fileDefinitions.some((d) => d.name === ref.name)) {
        definitions.push(
          await resolveInlineDefinitionEnvironment(ref.definition, testFilePath, 'providers'),
        );
      } else if (ref.use_target && !fileDefinitions.some((d) => d.name === ref.name)) {
        definitions.push({ name: ref.name, use_target: ref.use_target } as ProviderDefinition);
      }
    }
  }

  const results: ProviderSelection[] = [];

  for (const name of providerLabels) {
    const targetDefinition = withModelOverride(
      resolveUseTarget(name, definitions, env, providersFilePath),
      modelOverride,
    );
    const hooks = hooksMap.get(name);
    const providerDisplayLabel = labelsMap.get(name);

    try {
      const resolvedProvider = resolveProviderDefinition(targetDefinition, env, testFilePath, {
        emitDeprecationWarnings: false,
      });
      results.push({
        definitions,
        resolvedProvider,
        providerLabel: name,
        ...(providerDisplayLabel ? { providerDisplayLabel } : {}),
        providerSource: options.providerSource ?? 'cli',
        providersFilePath,
        ...(hooks && { providerHooks: hooks }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resolve provider '${name}': ${message}`);
    }
  }

  return results;
}
