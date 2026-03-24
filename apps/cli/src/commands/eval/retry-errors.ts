import type { EvaluationResult } from '@agentv/core';

import {
  loadLightweightResults,
  loadManifestResults,
  resolveResultSourcePath,
} from '../results/manifest.js';

/**
 * Load test IDs from an index/results source that have executionStatus === 'execution_error'.
 */
export async function loadErrorTestIds(jsonlPath: string): Promise<readonly string[]> {
  const resolvedPath = resolveResultSourcePath(jsonlPath);
  const ids = loadLightweightResults(resolvedPath)
    .filter((result) => result.executionStatus === 'execution_error')
    .map((result) => result.testId);

  return [...new Set(ids)];
}

/**
 * Load results from an index/results source that do NOT have executionStatus === 'execution_error'.
 * These are the "good" results that should be preserved when merging retry output.
 */
export async function loadNonErrorResults(jsonlPath: string): Promise<readonly EvaluationResult[]> {
  const resolvedPath = resolveResultSourcePath(jsonlPath);
  return loadManifestResults(resolvedPath).filter(
    (result) => result.testId && result.executionStatus !== 'execution_error',
  );
}
