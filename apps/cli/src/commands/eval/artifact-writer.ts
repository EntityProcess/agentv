import path from 'node:path';

import {
  type AdditionalResultArtifactsWriter,
  type AggregateGradingArtifact,
  type EvalTest,
  type EvaluationResult,
  type ExperimentArtifactMetadata,
  type ExportDuplicatePolicy,
  type GradingArtifact,
  type IndexArtifactEntry,
  RESULT_INDEX_FILENAME,
  RUN_SUMMARY_FILENAME,
  type ResultIndexArtifact,
  type RunSummaryArtifact,
  type TimingArtifact,
  aggregateRunDir,
  buildAggregateGradingArtifact,
  buildIndexArtifactEntry as buildCoreIndexArtifactEntry,
  buildResultIndexArtifact as buildCoreResultIndexArtifact,
  buildGradingArtifact,
  buildRunSummaryArtifact,
  buildTestTargetKey,
  buildTimingArtifact,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  writeArtifacts,
  writeArtifactsFromResults as writeCoreArtifactsFromResults,
  writePerTestArtifacts as writeCorePerTestArtifacts,
  writeInitialRunSummaryArtifact,
} from '@agentv/core';
import type { TargetDefinition } from '@agentv/core';

import {
  type MaterializedTaskBundlePaths,
  type TaskBundleTargetSelection,
  materializeTaskBundle,
} from './task-bundle.js';

export {
  aggregateRunDir,
  buildAggregateGradingArtifact,
  buildRunSummaryArtifact,
  buildGradingArtifact,
  buildTestTargetKey,
  buildTimingArtifact,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  RESULT_INDEX_FILENAME,
  RUN_SUMMARY_FILENAME,
  writeArtifacts,
  writeInitialRunSummaryArtifact,
};
export type {
  AggregateGradingArtifact,
  GradingArtifact,
  IndexArtifactEntry,
  ResultIndexArtifact,
  RunSummaryArtifact,
  TimingArtifact,
};

function toRelativeArtifactPath(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join('/');
}

function buildTaskBundleIndexFields(
  outputDir: string,
  taskBundle: MaterializedTaskBundlePaths | undefined,
): Pick<
  IndexArtifactEntry,
  'task_dir' | 'eval_path' | 'targets_path' | 'files_path' | 'graders_path'
> {
  if (!taskBundle) {
    return {};
  }
  return {
    task_dir: toRelativeArtifactPath(outputDir, taskBundle.taskDir),
    eval_path: toRelativeArtifactPath(outputDir, taskBundle.evalPath),
    targets_path: toRelativeArtifactPath(outputDir, taskBundle.targetsPath),
    ...(taskBundle.filesPath
      ? { files_path: toRelativeArtifactPath(outputDir, taskBundle.filesPath) }
      : {}),
    ...(taskBundle.gradersPath
      ? { graders_path: toRelativeArtifactPath(outputDir, taskBundle.gradersPath) }
      : {}),
  };
}

export function buildIndexArtifactEntry(
  result: EvaluationResult,
  options: {
    outputDir: string;
    artifactDir?: string;
    gradingPath?: string;
    timingPath?: string;
    summaryPath?: string;
    outputPath?: string;
    answerPath?: string;
    tracePath?: string;
    transcriptPath?: string;
    metricsPath?: string;
    rawProviderLogPath?: string;
    responsePath?: string;
    taskBundle?: MaterializedTaskBundlePaths;
  },
): IndexArtifactEntry {
  return buildCoreIndexArtifactEntry(result, {
    ...options,
    extraIndexFields: buildTaskBundleIndexFields(options.outputDir, options.taskBundle),
  });
}

export function buildResultIndexArtifact(
  result: EvaluationResult,
  taskBundle?: MaterializedTaskBundlePaths,
): ResultIndexArtifact {
  const artifactSubdir = (buildCoreResultIndexArtifact(result).artifact_dir ?? '').trim();
  const extraIndexFields = taskBundle
    ? {
        task_dir: path.posix.join(artifactSubdir, 'task'),
        eval_path: path.posix.join(artifactSubdir, 'task', 'EVAL.yaml'),
        targets_path: path.posix.join(artifactSubdir, 'task', 'targets.yaml'),
        ...(taskBundle.filesPath
          ? { files_path: path.posix.join(artifactSubdir, 'task', 'files') }
          : {}),
        ...(taskBundle.gradersPath
          ? { graders_path: path.posix.join(artifactSubdir, 'task', 'graders') }
          : {}),
      }
    : undefined;
  return buildCoreResultIndexArtifact(result, extraIndexFields);
}

function targetSelectionKey(evalFileAbsolutePath: string | undefined, targetName: string): string {
  return `${evalFileAbsolutePath ? path.resolve(evalFileAbsolutePath) : ''}::${targetName}`;
}

function buildTargetSelectionMap(
  selections: readonly TaskBundleTargetSelection[] | undefined,
): Map<string, TaskBundleTargetSelection> {
  const targets = new Map<string, TaskBundleTargetSelection>();
  for (const selection of selections ?? []) {
    targets.set(
      targetSelectionKey(selection.evalFileAbsolutePath, selection.targetName),
      selection,
    );
    if (selection.resolvedTargetName) {
      targets.set(
        targetSelectionKey(selection.evalFileAbsolutePath, selection.resolvedTargetName),
        selection,
      );
    }
    if (!selection.evalFileAbsolutePath) {
      targets.set(targetSelectionKey(undefined, selection.targetName), selection);
      if (selection.resolvedTargetName) {
        targets.set(targetSelectionKey(undefined, selection.resolvedTargetName), selection);
      }
    }
  }
  return targets;
}

function findTargetSelection(
  result: EvaluationResult,
  test: EvalTest | undefined,
  targets: ReadonlyMap<string, TaskBundleTargetSelection>,
): TaskBundleTargetSelection | undefined {
  const targetName = result.target ?? 'unknown';
  const evalFileAbsolutePath = test?.source?.evalFileAbsolutePath;
  return (
    targets.get(targetSelectionKey(evalFileAbsolutePath, targetName)) ??
    targets.get(targetSelectionKey(undefined, targetName))
  );
}

function createTaskBundleArtifactsWriter(options?: {
  cwd?: string;
  repoRoot?: string;
  taskBundleTargets?: readonly TaskBundleTargetSelection[];
}): AdditionalResultArtifactsWriter | undefined {
  const targetSelections = buildTargetSelectionMap(options?.taskBundleTargets);
  if (targetSelections.size === 0) {
    return undefined;
  }

  return async ({ outputDir, result, sourceTest, testDir }) => {
    const targetSelection = findTargetSelection(result, sourceTest, targetSelections);
    if (!sourceTest || !targetSelection) {
      return undefined;
    }

    const taskBundle = await materializeTaskBundle({
      test: sourceTest,
      targetName: targetSelection.targetName,
      targetDefinitions: targetSelection.definitions as readonly TargetDefinition[],
      outputDir: testDir,
      cwd: options?.cwd,
      repoRoot: options?.repoRoot,
    });

    return buildTaskBundleIndexFields(outputDir, taskBundle);
  };
}

export async function writePerTestArtifacts(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: {
    experiment?: string;
    runId?: string;
    duplicatePolicy?: ExportDuplicatePolicy;
    cwd?: string;
    repoRoot?: string;
    sourceTests?: readonly EvalTest[];
    taskBundleTargets?: readonly TaskBundleTargetSelection[];
  },
): Promise<void> {
  await writeCorePerTestArtifacts(results, outputDir, {
    experiment: options?.experiment,
    runId: options?.runId,
    duplicatePolicy: options?.duplicatePolicy,
    sourceTests: options?.sourceTests,
    additionalArtifacts: createTaskBundleArtifactsWriter(options),
  });
}

export async function writeArtifactsFromResults(
  results: readonly EvaluationResult[],
  outputDir: string,
  options?: {
    evalFile?: string;
    experiment?: string;
    experimentMetadata?: ExperimentArtifactMetadata;
    plannedTestCount?: number;
    runId?: string;
    duplicatePolicy?: ExportDuplicatePolicy;
    cwd?: string;
    repoRoot?: string;
    sourceTests?: readonly EvalTest[];
    taskBundleTargets?: readonly TaskBundleTargetSelection[];
  },
): Promise<{
  testArtifactDir: string;
  summaryPath: string;
  indexPath: string;
}> {
  return writeCoreArtifactsFromResults(results, outputDir, {
    evalFile: options?.evalFile,
    experiment: options?.experiment,
    experimentMetadata: options?.experimentMetadata,
    plannedTestCount: options?.plannedTestCount,
    runId: options?.runId,
    duplicatePolicy: options?.duplicatePolicy,
    sourceTests: options?.sourceTests,
    additionalArtifacts: createTaskBundleArtifactsWriter(options),
  });
}
