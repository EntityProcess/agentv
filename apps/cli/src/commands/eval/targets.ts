import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  type ResolvedTarget,
  type TargetDefinition,
  buildDirectoryChain,
  listTargetNames,
  readTargetDefinitions,
  readTestSuiteMetadata,
  resolveTargetDefinition,
} from '@agentv/core';
import { validateTargetsFile } from '@agentv/core/evaluation/validation';

const TARGET_FILE_CANDIDATES = [
  'targets.yaml',
  'targets.yml',
  path.join('.agentv', 'targets.yaml'),
  path.join('.agentv', 'targets.yml'),
];

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTestSuiteTarget(testFilePath: string): Promise<string | undefined> {
  const metadata = await readTestSuiteMetadata(testFilePath);
  return metadata.target;
}

async function discoverTargetsFile(options: {
  readonly explicitPath?: string;
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
}): Promise<string> {
  const { explicitPath, testFilePath, repoRoot, cwd } = options;

  if (explicitPath) {
    const resolvedExplicit = path.resolve(explicitPath);
    if (await fileExists(resolvedExplicit)) {
      return resolvedExplicit;
    }

    for (const candidate of TARGET_FILE_CANDIDATES) {
      const nested = path.join(resolvedExplicit, candidate);
      if (await fileExists(nested)) {
        return nested;
      }
    }

    throw new Error(`targets.yaml not found at provided path: ${resolvedExplicit}`);
  }

  const directories = [...buildDirectoryChain(testFilePath, repoRoot)];

  // Also check cwd if not already in chain
  const resolvedCwd = path.resolve(cwd);
  if (!directories.includes(resolvedCwd)) {
    directories.push(resolvedCwd);
  }
  for (const directory of directories) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const fullPath = path.join(directory, candidate);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }

  throw new Error('Unable to locate targets.yaml. Use --targets to specify the file explicitly.');
}

export interface TargetSelection {
  readonly definitions: readonly TargetDefinition[];
  readonly resolvedTarget: ResolvedTarget;
  readonly targetName: string;
  readonly targetSource: 'cli' | 'test-file' | 'default';
  readonly targetsFilePath: string;
}

export interface TargetSelectionOptions {
  readonly testFilePath: string;
  readonly repoRoot: string;
  readonly cwd: string;
  readonly explicitTargetsPath?: string;
  readonly cliTargetName?: string;
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

  const targetDefinition = definitions.find(
    (definition: TargetDefinition) => definition.name === targetChoice.name,
  );
  if (!targetDefinition) {
    const available = listTargetNames(definitions).join(', ');
    throw new Error(
      `Target '${targetChoice.name}' not found in ${targetsFilePath}. Available targets: ${available}`,
    );
  }

  if (dryRun) {
    const mockTarget: ResolvedTarget = {
      kind: 'mock',
      name: `${targetDefinition.name}-dry-run`,
      judgeTarget: undefined,
      config: {
        response: '{"answer":"Mock dry-run response"}',
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
    const resolvedTarget = resolveTargetDefinition(targetDefinition, env);
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
