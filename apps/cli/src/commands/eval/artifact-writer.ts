import path from 'node:path';

import {
  type AdditionalResultArtifactsWriter,
  type AggregateGradingArtifact,
  type EnvironmentSummaryWire,
  type EvalTest,
  type EvaluationResult,
  type ExperimentArtifactMetadata,
  type ExportDuplicatePolicy,
  type GradingArtifact,
  type IndexArtifactEntry,
  RESULT_INDEX_FILENAME,
  RUN_CONFIG_FILENAME,
  RUN_SUMMARY_FILENAME,
  type ResultIndexArtifact,
  type RunConfigArtifact,
  type RunRuntimeSourceMetadata,
  type RunSummaryArtifact,
  type TimingArtifact,
  aggregateRunDir,
  buildAggregateGradingArtifact,
  buildIndexArtifactEntry as buildCoreIndexArtifactEntry,
  buildResultIndexArtifact as buildCoreResultIndexArtifact,
  buildEvalTestTargetKey,
  buildEvaluationResultTargetKey,
  buildGradingArtifact,
  buildRunSummaryArtifact,
  buildTestTargetKey,
  buildTimingArtifact,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  readRunConfigArtifact,
  writeArtifacts,
  writeArtifactsFromResults as writeCoreArtifactsFromResults,
  writePerTestArtifacts as writeCorePerTestArtifacts,
  writeInitialRunSummaryArtifact,
} from '@agentv/core';
import type { ProviderDefinition } from '@agentv/core';

import {
  type MaterializedTaskBundlePaths,
  type TaskBundleProviderSelection,
  materializeTaskBundle,
} from './task-bundle.js';

export {
  aggregateRunDir,
  buildAggregateGradingArtifact,
  buildEvalTestTargetKey,
  buildEvaluationResultTargetKey,
  buildRunSummaryArtifact,
  buildGradingArtifact,
  buildTestTargetKey,
  buildTimingArtifact,
  deduplicateByTestIdTarget,
  parseJsonlResults,
  RESULT_INDEX_FILENAME,
  RUN_CONFIG_FILENAME,
  RUN_SUMMARY_FILENAME,
  readRunConfigArtifact,
  writeArtifacts,
  writeInitialRunSummaryArtifact,
};
export type {
  AggregateGradingArtifact,
  GradingArtifact,
  EnvironmentSummaryWire,
  IndexArtifactEntry,
  ResultIndexArtifact,
  RunConfigArtifact,
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
  'test_dir' | 'eval_path' | 'providers_path' | 'files_path' | 'graders_path'
> {
  if (!taskBundle) {
    return {};
  }
  return {
    test_dir: toRelativeArtifactPath(outputDir, taskBundle.testDir),
    eval_path: toRelativeArtifactPath(outputDir, taskBundle.evalPath),
    providers_path: toRelativeArtifactPath(outputDir, taskBundle.providersPath),
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
    resultDir?: string;
    gradingPath?: string;
    summaryPath?: string;
    outputPath?: string;
    answerPath?: string;
    transcriptPath?: string;
    transcriptRawPath?: string;
    metricsPath?: string;
    fileChangesPath?: string;
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
  const artifactSubdir = (buildCoreResultIndexArtifact(result).result_dir ?? '').trim();
  const extraIndexFields = taskBundle
    ? {
        test_dir: path.posix.join(artifactSubdir, 'test'),
        eval_path: path.posix.join(artifactSubdir, 'test', 'EVAL.yaml'),
        providers_path: path.posix.join(artifactSubdir, 'test', 'providers.yaml'),
        ...(taskBundle.filesPath
          ? { files_path: path.posix.join(artifactSubdir, 'test', 'files') }
          : {}),
        ...(taskBundle.gradersPath
          ? { graders_path: path.posix.join(artifactSubdir, 'test', 'graders') }
          : {}),
      }
    : undefined;
  return buildCoreResultIndexArtifact(result, extraIndexFields);
}

function providerSelectionKey(
  evalFileAbsolutePath: string | undefined,
  providerLabel: string,
): string {
  return `${evalFileAbsolutePath ? path.resolve(evalFileAbsolutePath) : ''}::${providerLabel}`;
}

function buildProviderSelectionMap(
  selections: readonly TaskBundleProviderSelection[] | undefined,
): Map<string, TaskBundleProviderSelection> {
  const providers = new Map<string, TaskBundleProviderSelection>();
  for (const selection of selections ?? []) {
    providers.set(
      providerSelectionKey(selection.evalFileAbsolutePath, selection.providerLabel),
      selection,
    );
    if (selection.resolvedProviderName) {
      providers.set(
        providerSelectionKey(selection.evalFileAbsolutePath, selection.resolvedProviderName),
        selection,
      );
    }
    if (!selection.evalFileAbsolutePath) {
      providers.set(providerSelectionKey(undefined, selection.providerLabel), selection);
      if (selection.resolvedProviderName) {
        providers.set(providerSelectionKey(undefined, selection.resolvedProviderName), selection);
      }
    }
  }
  return providers;
}

function findProviderSelection(
  result: EvaluationResult,
  test: EvalTest | undefined,
  providers: ReadonlyMap<string, TaskBundleProviderSelection>,
): TaskBundleProviderSelection | undefined {
  const providerLabel = result.target ?? 'unknown';
  const evalFileAbsolutePath = test?.source?.evalFileAbsolutePath;
  return (
    providers.get(providerSelectionKey(evalFileAbsolutePath, providerLabel)) ??
    providers.get(providerSelectionKey(undefined, providerLabel))
  );
}

function createTaskBundleArtifactsWriter(options?: {
  cwd?: string;
  repoRoot?: string;
  taskBundleTargets?: readonly TaskBundleProviderSelection[];
}): AdditionalResultArtifactsWriter | undefined {
  const providerSelections = buildProviderSelectionMap(options?.taskBundleTargets);
  if (providerSelections.size === 0) {
    return undefined;
  }

  return async ({ outputDir, result, sourceTest, testDir }) => {
    const providerSelection = findProviderSelection(result, sourceTest, providerSelections);
    if (!sourceTest || !providerSelection) {
      return undefined;
    }

    const taskBundle = await materializeTaskBundle({
      test: sourceTest,
      providerLabel: providerSelection.providerLabel,
      providerDefinitions: providerSelection.definitions as readonly ProviderDefinition[],
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
    resultGroup?: string;
    cwd?: string;
    repoRoot?: string;
    sourceTests?: readonly EvalTest[];
    taskBundleTargets?: readonly TaskBundleProviderSelection[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
    runtimeSource?: RunRuntimeSourceMetadata;
    tags?: Record<string, string>;
  },
): Promise<void> {
  await writeCorePerTestArtifacts(results, outputDir, {
    experiment: options?.experiment,
    resultGroup: options?.resultGroup,
    runId: options?.runId,
    duplicatePolicy: options?.duplicatePolicy,
    sourceTests: options?.sourceTests,
    additionalArtifacts: options?.additionalArtifacts ?? createTaskBundleArtifactsWriter(options),
    runtimeSource: options?.runtimeSource,
    tags: options?.tags,
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
    resultGroup?: string;
    cwd?: string;
    repoRoot?: string;
    sourceTests?: readonly EvalTest[];
    taskBundleTargets?: readonly TaskBundleProviderSelection[];
    additionalArtifacts?: AdditionalResultArtifactsWriter;
    runtimeSource?: RunRuntimeSourceMetadata;
    tags?: Record<string, string>;
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
    resultGroup: options?.resultGroup,
    sourceTests: options?.sourceTests,
    additionalArtifacts: options?.additionalArtifacts ?? createTaskBundleArtifactsWriter(options),
    runtimeSource: options?.runtimeSource,
    tags: options?.tags,
  });
}
