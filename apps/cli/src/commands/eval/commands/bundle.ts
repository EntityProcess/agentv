import path from 'node:path';
import {
  type EvalTargetRef,
  type EvalTargetSpec,
  type TargetDefinition,
  loadTestSuite,
  readTargetDefinitions,
} from '@agentv/core';
import { array, command, multioption, option, optional, positional, string } from 'cmd-ts';

import { discoverTargetsFile } from '../../../utils/targets.js';
import { loadEnvFromHierarchy } from '../env.js';
import { findRepoRoot, resolveEvalPaths } from '../shared.js';
import { readTestSuiteTarget } from '../targets.js';
import { type TaskBundleTargetSelection, materializeEvalBundle } from '../task-bundle.js';

function unique(values: readonly string[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function targetReferenceNames(target: TargetDefinition): readonly string[] {
  const references: string[] = [];
  for (const key of ['use_target', 'grader_target', 'judge_target'] as const) {
    const value = target[key];
    if (typeof value === 'string' && value.trim().length > 0 && !value.includes('${{')) {
      references.push(value.trim());
    }
  }

  const fallbackTargets = target.fallback_targets;
  if (Array.isArray(fallbackTargets)) {
    for (const value of fallbackTargets) {
      if (typeof value === 'string' && value.trim().length > 0 && !value.includes('${{')) {
        references.push(value.trim());
      }
    }
  }

  return references;
}

function ensureTargetGraph(
  targetName: string,
  definitions: readonly TargetDefinition[],
  targetsFilePath: string,
): void {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const seen = new Set<string>();

  function visit(name: string, requestedBy?: string): void {
    if (seen.has(name)) {
      return;
    }
    const definition = byName.get(name);
    if (!definition) {
      const available = definitions
        .map((entry) => entry.name)
        .sort()
        .join(', ');
      const owner = requestedBy ? ` referenced by target '${requestedBy}'` : '';
      throw new Error(
        `Target '${name}'${owner} not found in ${targetsFilePath}. Available targets: ${available}`,
      );
    }
    seen.add(name);
    for (const referenceName of targetReferenceNames(definition)) {
      visit(referenceName, name);
    }
  }

  visit(targetName);
}

function definitionsWithEvalTargetRefs(
  definitions: readonly TargetDefinition[],
  targetRefs: readonly EvalTargetRef[] | undefined,
): readonly TargetDefinition[] {
  if (!targetRefs) {
    return definitions;
  }

  const result = [...definitions];
  for (const ref of targetRefs) {
    if (ref.use_target && !result.some((definition) => definition.name === ref.name)) {
      result.push({ name: ref.name, use_target: ref.use_target } as TargetDefinition);
    }
  }
  return result;
}

function definitionsWithEvalTargetSpec(
  definitions: readonly TargetDefinition[],
  targetSpec: EvalTargetSpec | undefined,
): readonly TargetDefinition[] {
  if (!targetSpec?.definition) {
    return definitions;
  }
  if (!targetSpec.extends) {
    return [
      targetSpec.definition,
      ...definitions.filter((definition) => definition.name !== targetSpec.name),
    ];
  }
  const base = definitions.find((definition) => definition.name === targetSpec.extends);
  if (!base) {
    const available = definitions.map((definition) => definition.name).join(', ');
    throw new Error(
      `Target '${targetSpec.extends}' not found for eval-local target '${targetSpec.name}'. Available targets: ${available}`,
    );
  }
  const effective = {
    ...base,
    ...targetSpec.definition,
    name: targetSpec.name,
  } as TargetDefinition;
  return [effective, ...definitions.filter((definition) => definition.name !== targetSpec.name)];
}

function buildBundleRuntime(options: {
  readonly targetNames: readonly string[];
  readonly budgetUsd?: number;
  readonly threshold?: number;
}): Record<string, unknown> {
  const runtime: Record<string, unknown> =
    options.targetNames.length === 1 ? { target: options.targetNames[0] } : {};
  if (options.budgetUsd !== undefined) {
    runtime.budget_usd = options.budgetUsd;
  }
  if (options.threshold !== undefined) {
    runtime.threshold = options.threshold;
  }
  return runtime;
}

export const evalBundleCommand = command({
  name: 'bundle',
  description: 'Create a portable self-contained directory for an eval suite',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval',
      description: 'Path or glob resolving to one eval file',
    }),
    out: option({
      type: string,
      long: 'out',
      description: 'Portable bundle output directory',
    }),
    target: multioption({
      type: array(string),
      long: 'target',
      description: 'Target name to bundle (repeatable). Defaults to eval target(s) or default.',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: 'Path to targets.yaml (overrides discovery)',
    }),
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const resolvedPaths = await resolveEvalPaths([args.evalPath], cwd);
    if (resolvedPaths.length !== 1) {
      throw new Error(
        `agentv eval bundle requires exactly one eval file, but matched ${resolvedPaths.length}: ${resolvedPaths.join(', ')}`,
      );
    }

    const evalFilePath = resolvedPaths[0];
    await loadEnvFromHierarchy({ testFilePath: evalFilePath, repoRoot, verbose: false });
    const suite = await loadTestSuite(evalFilePath, repoRoot);
    if (suite.providerFactory) {
      throw new Error(
        'TypeScript evals with task() provider functions cannot be bundled into portable YAML yet.',
      );
    }

    let definitions: readonly TargetDefinition[];
    let targetNames: readonly string[];
    if (suite.inlineTarget) {
      definitions = [suite.inlineTarget];
      targetNames = unique(args.target.length > 0 ? args.target : [suite.inlineTarget.name]);
    } else {
      const targetsFilePath = await discoverTargetsFile({
        explicitPath: args.targets,
        testFilePath: evalFilePath,
        repoRoot,
        cwd,
      });
      definitions = definitionsWithEvalTargetSpec(
        definitionsWithEvalTargetRefs(
          await readTargetDefinitions(targetsFilePath),
          suite.targetRefs,
        ),
        suite.targetSpec,
      );
      const suiteTarget = await readTestSuiteTarget(evalFilePath);
      targetNames = unique(
        args.target.length > 0
          ? args.target
          : (suite.targets ?? [suite.targetSpec?.name ?? suiteTarget ?? 'default']),
      );
      for (const targetName of targetNames) {
        ensureTargetGraph(targetName, definitions, targetsFilePath);
      }
    }

    const targetSelections: TaskBundleTargetSelection[] = targetNames.map((targetName) => ({
      evalFileAbsolutePath: evalFilePath,
      targetName,
      definitions,
    }));

    const paths = await materializeEvalBundle({
      evalFilePath,
      tests: suite.tests,
      targetSelections,
      outputDir: args.out,
      cwd,
      repoRoot,
      runtime: buildBundleRuntime({
        targetNames,
        budgetUsd: suite.budgetUsd,
        threshold: suite.threshold,
      }),
    });

    console.log(`Bundle written to: ${paths.bundleDir}`);
    console.log(
      `  Eval: ${path.relative(paths.bundleDir, paths.evalPath).split(path.sep).join('/')}`,
    );
    console.log(
      `  Targets: ${path.relative(paths.bundleDir, paths.targetsPath).split(path.sep).join('/')}`,
    );
    console.log(
      `  Manifest: ${path.relative(paths.bundleDir, paths.manifestPath).split(path.sep).join('/')}`,
    );
  },
});
