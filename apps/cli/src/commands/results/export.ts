/**
 * `agentv results export` — converts a canonical run workspace or run manifest
 * manifest into a directory structure matching the artifact-writer output format.
 *
 * Output structure:
 *   <output-dir>/
 *     summary.json             — run aggregate scores, metadata, and timing
 *     index.jsonl              — per-test manifest with artifact pointers
 *     <test-id>/
 *       summary.json           — per-case aggregate
 *       run-1/result.json      — per-run result
 *       run-1/grading.json     — per-run grading artifact (assertions, graders)
 *       run-1/metrics.json     — per-run metrics artifact
 *
 * This module delegates artifact building to the shared artifact-writer so
 * that summary/grading/timing schemas stay aligned with `agentv eval`.
 *
 * How to extend:
 *   - To change artifact schemas, update artifact-writer.ts (single source of truth).
 *   - To add new per-test workspace files, add them under each test directory.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { command, flag, oneOf, option, optional, positional, string } from 'cmd-ts';

import type {
  AdditionalResultArtifactsWriter,
  AdditionalResultIndexFields,
  EvaluationResult,
  ExportDuplicatePolicy,
  IndexArtifactEntry,
} from '@agentv/core';

import { parseJsonlResults, writeArtifactsFromResults } from '../eval/artifact-writer.js';
import {
  RESULT_INDEX_FILENAME,
  isReservedResultsNamespace,
  isRunManifestPath,
} from '../eval/result-layout.js';
import { loadManifestResults } from './manifest.js';
import {
  type ProjectionBundle,
  buildProjectionBundle,
  serializeProjectionBundle,
  writeProjectionBundle,
} from './projection-bundle.js';
import { loadResults as loadSharedResults, resolveSourceFile } from './shared.js';

// ── Export logic ─────────────────────────────────────────────────────────

export async function exportResults(
  sourceFile: string,
  content: string,
  outputDir: string,
  options?: { duplicatePolicy?: ExportDuplicatePolicy },
): Promise<void> {
  const results = parseJsonlResults(content);
  const sourceIndexRecords = parseIndexArtifactEntries(content);

  if (results.length === 0) {
    throw new Error(`No results found in ${sourceFile}`);
  }

  await writeArtifactsFromResults(results, outputDir, {
    evalFile: sourceFile,
    runId: deriveExportRunId(sourceFile),
    duplicatePolicy: options?.duplicatePolicy ?? 'update',
    additionalArtifacts: createExportBundleArtifactsWriter({
      outputDir,
      sourceBaseDir: path.dirname(sourceFile),
      sourceRecordsByResult: buildSourceRecordMap(results, sourceIndexRecords),
    }),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the default output directory from a run manifest path.
 */
export function deriveOutputDir(cwd: string, sourceFile: string): string {
  if (!isRunManifestPath(sourceFile)) {
    throw new Error(`Expected a run manifest named ${RESULT_INDEX_FILENAME}: ${sourceFile}`);
  }

  const runDir = path.dirname(sourceFile);
  const segments = path.normalize(runDir).split(path.sep).filter(Boolean);
  const resultsIndex = segments.lastIndexOf('results');
  if (resultsIndex >= 0 && resultsIndex < segments.length - 2) {
    const runSegments = segments.slice(resultsIndex + 1);
    if (!isReservedResultsNamespace(runSegments[0])) {
      return path.join(cwd, '.agentv', 'results', 'export', ...runSegments);
    }
  }

  const parentDir = path.basename(runDir);
  if (parentDir.startsWith('eval_')) {
    return path.join(cwd, '.agentv', 'results', 'export', parentDir.slice(5));
  }
  return path.join(cwd, '.agentv', 'results', 'export', parentDir);
}

export function deriveExportRunId(sourceFile: string): string {
  if (isRunManifestPath(sourceFile)) {
    return path.basename(path.dirname(sourceFile));
  }
  return path.basename(sourceFile, path.extname(sourceFile));
}

export async function loadExportSource(
  source: string | undefined,
  cwd: string,
): Promise<{
  sourceFile: string;
  results: readonly EvaluationResult[];
  indexRecords?: readonly IndexArtifactEntry[];
}> {
  const { sourceFile } = await resolveSourceFile(source, cwd);
  const { results } = await loadSharedResults(source, cwd);
  const indexRecords = isRunManifestPath(sourceFile)
    ? readIndexArtifactEntries(sourceFile)
    : undefined;
  return { sourceFile, results, indexRecords };
}

function parseIndexArtifactEntries(content: string): IndexArtifactEntry[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IndexArtifactEntry);
}

function readIndexArtifactEntries(indexPath: string): IndexArtifactEntry[] {
  return parseIndexArtifactEntries(readFileSync(indexPath, 'utf8'));
}

function buildSourceRecordMap(
  results: readonly EvaluationResult[],
  sourceRecords: readonly IndexArtifactEntry[],
): ReadonlyMap<EvaluationResult, IndexArtifactEntry> {
  return new Map(
    results.flatMap((result, index) => {
      const sourceRecord = sourceRecords[index];
      return sourceRecord ? [[result, sourceRecord] as const] : [];
    }),
  );
}

function isSafeRelativePath(relativePath: string | undefined): relativePath is string {
  return (
    typeof relativePath === 'string' &&
    relativePath.trim().length > 0 &&
    !path.isAbsolute(relativePath) &&
    !relativePath.split(/[\\/]+/).includes('..')
  );
}

function toRelativeArtifactPath(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join('/');
}

function hasCopiedSubdir(testBundleDir: string, dirname: string): boolean {
  return existsSync(path.join(testBundleDir, dirname));
}

function createExportBundleArtifactsWriter(options: {
  readonly outputDir: string;
  readonly sourceBaseDir: string;
  readonly sourceRecordsByResult: ReadonlyMap<EvaluationResult, IndexArtifactEntry>;
}): AdditionalResultArtifactsWriter | undefined {
  if (options.sourceRecordsByResult.size === 0) {
    return undefined;
  }

  return async ({ result, testDir }): Promise<AdditionalResultIndexFields | undefined> => {
    const sourceRecord = options.sourceRecordsByResult.get(result);
    const sourceBundleDir = sourceRecord?.test_dir ?? sourceRecord?.task_dir;
    if (!isSafeRelativePath(sourceBundleDir)) {
      return undefined;
    }

    const sourceBundlePath = path.join(options.sourceBaseDir, sourceBundleDir);
    const testBundlePath = path.join(testDir, 'test');
    if (existsSync(sourceBundlePath)) {
      cpSync(sourceBundlePath, testBundlePath, { recursive: true, force: true });
    }

    return {
      test_dir: toRelativeArtifactPath(options.outputDir, testBundlePath),
      eval_path: toRelativeArtifactPath(options.outputDir, path.join(testBundlePath, 'EVAL.yaml')),
      targets_path: toRelativeArtifactPath(
        options.outputDir,
        path.join(testBundlePath, 'targets.yaml'),
      ),
      ...(sourceRecord?.files_path || hasCopiedSubdir(testBundlePath, 'files')
        ? {
            files_path: toRelativeArtifactPath(
              options.outputDir,
              path.join(testBundlePath, 'files'),
            ),
          }
        : {}),
      ...(sourceRecord?.graders_path || hasCopiedSubdir(testBundlePath, 'graders')
        ? {
            graders_path: toRelativeArtifactPath(
              options.outputDir,
              path.join(testBundlePath, 'graders'),
            ),
          }
        : {}),
    };
  };
}

export function buildProjectionBundleFromExportedIndex(options: {
  readonly sourceFile: string;
  readonly outputDir: string;
  readonly cwd?: string;
  readonly includeRawContent?: boolean;
  readonly duplicatePolicy?: ExportDuplicatePolicy;
}): ProjectionBundle {
  const indexPath = path.join(options.outputDir, RESULT_INDEX_FILENAME);
  const indexRecords = readIndexArtifactEntries(indexPath);
  const emittedResults = loadManifestResults(indexPath);

  return buildProjectionBundle(emittedResults, {
    sourceFile: options.sourceFile,
    runId: deriveExportRunId(options.sourceFile),
    cwd: options.cwd,
    duplicatePolicy: options.duplicatePolicy,
    includeRawContent: options.includeRawContent,
    artifactRefStatus: 'emitted',
    indexRecords,
  });
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsExportCommand = command({
  name: 'export',
  description: 'Export a run workspace or run manifest into a per-test directory structure',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description:
        'Run workspace directory or run manifest to export (defaults to most recent in .agentv/results/)',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output directory (defaults to .agentv/results/export/<run-timestamp>/)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
    duplicatePolicy: option({
      type: optional(oneOf(['skip', 'update', 'error'])),
      long: 'duplicate-policy',
      description:
        'How to handle duplicate projection identities in the output: update (default), skip, or error',
    }),
    projectionBundle: flag({
      long: 'projection-bundle',
      description:
        'Write a local vendor-neutral projection_bundle.json for non-Phoenix adapters; no service calls',
    }),
    dryRun: flag({
      long: 'dry-run',
      description: 'Print deterministic projection bundle JSON without writing export artifacts',
    }),
    includeRawContent: flag({
      long: 'include-raw-content',
      description:
        'Include raw prompt, output, and tool payload content in the projection bundle (off by default)',
    }),
  },
  handler: async ({
    source,
    out,
    dir,
    duplicatePolicy,
    projectionBundle,
    dryRun,
    includeRawContent,
  }) => {
    const cwd = dir ?? process.cwd();
    const policy = (duplicatePolicy ?? 'update') as ExportDuplicatePolicy;
    const shouldWriteProjectionBundle = projectionBundle;
    const shouldDryRun = dryRun;
    const shouldIncludeRawContent = includeRawContent;

    try {
      const { sourceFile, results, indexRecords } = await loadExportSource(source, cwd);

      const outputDir = out
        ? path.isAbsolute(out)
          ? out
          : path.resolve(cwd, out)
        : deriveOutputDir(cwd, sourceFile);

      const buildBundle = () =>
        buildProjectionBundle(results, {
          sourceFile,
          runId: deriveExportRunId(sourceFile),
          cwd,
          duplicatePolicy: policy,
          includeRawContent: shouldIncludeRawContent,
          indexRecords,
        });

      if (shouldDryRun) {
        process.stdout.write(serializeProjectionBundle(buildBundle()));
        return;
      }

      await writeArtifactsFromResults(results, outputDir, {
        evalFile: sourceFile,
        runId: deriveExportRunId(sourceFile),
        duplicatePolicy: policy,
        additionalArtifacts: createExportBundleArtifactsWriter({
          outputDir,
          sourceBaseDir: path.dirname(sourceFile),
          sourceRecordsByResult: buildSourceRecordMap(results, indexRecords ?? []),
        }),
      });

      const bundlePath = shouldWriteProjectionBundle
        ? await writeProjectionBundle(
            buildProjectionBundleFromExportedIndex({
              sourceFile,
              outputDir,
              cwd,
              duplicatePolicy: policy,
              includeRawContent: shouldIncludeRawContent,
            }),
            outputDir,
          )
        : undefined;

      // Report exported test IDs
      console.log(`Exported ${results.length} test(s) to ${outputDir}`);
      if (bundlePath) {
        console.log(`Projection bundle written to ${bundlePath}`);
      }
      for (const result of results) {
        console.log(`  ${result.testId ?? 'unknown'}`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
