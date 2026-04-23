import {
  type ResolvedTarget,
  type TargetDefinition,
  listTargetNames,
  readTargetDefinitions,
  readTestSuiteMetadata,
  resolveTargetDefinition,
} from '@agentv/core';
import { validateTargetsFile } from '@agentv/core/evaluation/validation';
import { discoverTargetsFile } from '../../utils/targets.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

/**
 * Dry-run mock response: satisfies all LLM grader schemas (freeform, rubric, score-range)
 * so that --dry-run works end-to-end including graders without real LLM calls.
 *
 * - freeformEvaluationSchema:    "score" (required), "assertions" (optional)
 * - rubricEvaluationSchema:      "checks" (required), "overall_reasoning" (required)
 * - scoreRangeEvaluationSchema:  "checks" (required), "overall_reasoning" (optional)
 */
const DRY_RUN_MOCK_RESPONSE =
  '{"score":1,"assertions":[],"checks":[],"overall_reasoning":"dry-run mock"}';

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
  definitions: readonly TargetDefinition[],
  env: NodeJS.ProcessEnv,
  targetsFilePath: string,
): TargetDefinition {
  const maxDepth = 5;
  let current: TargetDefinition | undefined = definitions.find((d) => d.name === name);
  if (!current) {
    const available = listTargetNames(definitions).join(', ');
    throw new Error(
      `Target '${name}' not found in ${targetsFilePath}. Available targets: ${available}`,
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

    const next: TargetDefinition | undefined = definitions.find((d) => d.name === resolved.trim());
    if (!next) {
      const available = listTargetNames(definitions).join(', ');
      throw new Error(
        `Target '${name}' use_target '${resolved.trim()}' not found in ${targetsFilePath}. Available targets: ${available}`,
      );
    }
    current = next;
  }

  return current;
}

export async function readTestSuiteTarget(testFilePath: string): Promise<string | undefined> {
  const metadata = await readTestSuiteMetadata(testFilePath);
  return metadata.target;
}

export async function readTestSuiteTargets(
  testFilePath: string,
): Promise<readonly string[] | undefined> {
  const metadata = await readTestSuiteMetadata(testFilePath);
  return metadata.targets;
}

export interface TargetSelection {
  readonly definitions: readonly TargetDefinition[];
  readonly resolvedTarget: ResolvedTarget;
  readonly targetName: string;
  readonly targetSource: 'cli' | 'test-file' | 'default';
  readonly targetsFilePath: string;
  /** Per-target hooks from eval file (eval-level customization) */
  readonly targetHooks?: import('@agentv/core').TargetHooksConfig;
}

export interface TargetSelectionOptions {
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly explicitTargetsPath?: string;
  readonly cliTargetName?: string;
  readonly cliTargetNames?: readonly string[];
  readonly dryRun: boolean;
  readonly dryRunDelay: number;
  readonly dryRunDelayMin: number;
  readonly dryRunDelayMax: number;
  readonly env: NodeJS.ProcessEnv;
}

function pickTargetName(options: {
  readonly cliTargetName?: string;
  readonly fileTargetName?: string;
}): { readonly name: string; readonly source: 'cli' | 'test-file' | 'default' } {
  const cliName = options.cliTargetName?.trim();
  if (cliName && cliName !== 'default') {
    return { name: cliName, source: 'cli' };
  }

  const fileName = options.fileTargetName?.trim();
  if (fileName && fileName.length > 0) {
    return { name: fileName, source: 'test-file' };
  }

  return { name: 'default', source: 'default' };
}

export async function selectTarget(options: TargetSelectionOptions): Promise<TargetSelection> {
  const {
    testFilePath,
    repoRoot,
    cwd,
    explicitTargetsPath,
    cliTargetName,
    dryRun,
    dryRunDelay,
    dryRunDelayMin,
    dryRunDelayMax,
    env,
  } = options;

  const targetsFilePath = await discoverTargetsFile({
    explicitPath: explicitTargetsPath,
    testFilePath,
    repoRoot,
    cwd,
  });

  // Validate the targets file and show warnings
  const validationResult = await validateTargetsFile(targetsFilePath);
  const warnings = validationResult.errors.filter((e) => e.severity === 'warning');
  const useColors = isTTY();

  if (warnings.length > 0) {
    console.warn(`\nWarnings in ${targetsFilePath}:`);
    for (const warning of warnings) {
      const location = warning.location ? ` [${warning.location}]` : '';
      const prefix = useColors ? `${ANSI_YELLOW}  ⚠${ANSI_RESET}` : '  ⚠';
      const message = useColors ? `${ANSI_YELLOW}${warning.message}${ANSI_RESET}` : warning.message;
      console.warn(`${prefix}${location} ${message}`);
    }
    console.warn('');
  }

  // Check for errors (should fail if invalid)
  const errors = validationResult.errors.filter((e) => e.severity === 'error');
  if (errors.length > 0) {
    console.error(`\nErrors in ${targetsFilePath}:`);
    for (const error of errors) {
      const location = error.location ? ` [${error.location}]` : '';
      const prefix = useColors ? `${ANSI_RED}  ✗${ANSI_RESET}` : '  ✗';
      const message = useColors ? `${ANSI_RED}${error.message}${ANSI_RESET}` : error.message;
      console.error(`${prefix}${location} ${message}`);
    }
    throw new Error(`Targets file validation failed with ${errors.length} error(s)`);
  }

  const definitions = await readTargetDefinitions(targetsFilePath);
  const fileTargetName = await readTestSuiteTarget(testFilePath);
  const targetChoice = pickTargetName({ cliTargetName, fileTargetName });

  const targetDefinition = resolveUseTarget(targetChoice.name, definitions, env, targetsFilePath);

  if (dryRun) {
    const mockTarget: ResolvedTarget = {
      kind: 'mock',
      name: `${targetDefinition.name}-dry-run`,
      graderTarget: undefined,
      config: {
        response: DRY_RUN_MOCK_RESPONSE,
        delayMs: dryRunDelay,
        delayMinMs: dryRunDelayMin,
        delayMaxMs: dryRunDelayMax,
      },
    };

    return {
      definitions,
      resolvedTarget: mockTarget,
      targetName: targetChoice.name,
      targetSource: targetChoice.source,
      targetsFilePath,
    };
  }

  try {
    const resolvedTarget = resolveTargetDefinition(targetDefinition, env, testFilePath, {
      emitDeprecationWarnings: false,
    });
    return {
      definitions,
      resolvedTarget,
      targetName: targetChoice.name,
      targetSource: targetChoice.source,
      targetsFilePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve target '${targetChoice.name}': ${message}`);
  }
}

/**
 * Select multiple targets for matrix evaluation.
 * Returns an array of TargetSelection, one per target name.
 */
export async function selectMultipleTargets(
  options: TargetSelectionOptions & {
    readonly targetNames: readonly string[];
    readonly targetRefs?: readonly import('@agentv/core').EvalTargetRef[];
  },
): Promise<readonly TargetSelection[]> {
  const {
    testFilePath,
    repoRoot,
    cwd,
    explicitTargetsPath,
    dryRun,
    dryRunDelay,
    dryRunDelayMin,
    dryRunDelayMax,
    env,
    targetNames,
    targetRefs,
  } = options;

  // Build a lookup for target hooks from eval target refs
  const hooksMap = new Map<string, import('@agentv/core').TargetHooksConfig>();
  if (targetRefs) {
    for (const ref of targetRefs) {
      if (ref.hooks) {
        hooksMap.set(ref.name, ref.hooks);
      }
    }
  }

  const targetsFilePath = await discoverTargetsFile({
    explicitPath: explicitTargetsPath,
    testFilePath,
    repoRoot,
    cwd,
  });

  // Validate targets file once
  const validationResult = await validateTargetsFile(targetsFilePath);
  const warnings = validationResult.errors.filter((e) => e.severity === 'warning');
  const useColors = isTTY();
  if (warnings.length > 0) {
    console.warn(`\nWarnings in ${targetsFilePath}:`);
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
    console.error(`\nErrors in ${targetsFilePath}:`);
    for (const error of errors) {
      const location = error.location ? ` [${error.location}]` : '';
      const prefix = useColors ? `${ANSI_RED}  ✗${ANSI_RESET}` : '  ✗';
      const message = useColors ? `${ANSI_RED}${error.message}${ANSI_RESET}` : error.message;
      console.error(`${prefix}${location} ${message}`);
    }
    throw new Error(`Targets file validation failed with ${errors.length} error(s)`);
  }

  const fileDefinitions = await readTargetDefinitions(targetsFilePath);

  // Inject synthetic definitions from eval target refs (for use_target delegation)
  const definitions = [...fileDefinitions];
  if (targetRefs) {
    for (const ref of targetRefs) {
      if (ref.use_target && !fileDefinitions.some((d) => d.name === ref.name)) {
        definitions.push({ name: ref.name, use_target: ref.use_target } as TargetDefinition);
      }
    }
  }

  const results: TargetSelection[] = [];

  for (const name of targetNames) {
    const targetDefinition = resolveUseTarget(name, definitions, env, targetsFilePath);
    const hooks = hooksMap.get(name);

    if (dryRun) {
      const mockTarget: ResolvedTarget = {
        kind: 'mock',
        name: `${targetDefinition.name}-dry-run`,
        graderTarget: undefined,
        config: {
          response: DRY_RUN_MOCK_RESPONSE,
          delayMs: dryRunDelay,
          delayMinMs: dryRunDelayMin,
          delayMaxMs: dryRunDelayMax,
        },
      };
      results.push({
        definitions,
        resolvedTarget: mockTarget,
        targetName: name,
        targetSource: 'cli',
        targetsFilePath,
        ...(hooks && { targetHooks: hooks }),
      });
    } else {
      try {
        const resolvedTarget = resolveTargetDefinition(targetDefinition, env, testFilePath, {
          emitDeprecationWarnings: false,
        });
        results.push({
          definitions,
          resolvedTarget,
          targetName: name,
          targetSource: 'cli',
          targetsFilePath,
          ...(hooks && { targetHooks: hooks }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resolve target '${name}': ${message}`);
      }
    }
  }

  return results;
}
