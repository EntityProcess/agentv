import type { EvaluationResult } from '@agentv/core';

import { loadManifestResults, resolveResultSourcePath } from '../results/manifest.js';

async function loadRetrySourceResults(jsonlPath: string): Promise<readonly EvaluationResult[]> {
  return loadManifestResults(resolveResultSourcePath(jsonlPath));
}

/**
 * Escape micromatch glob metacharacters in a string so it matches literally.
 * Characters escaped: * ? [ ] { } ( ) ! @ # + |
 */
function escapeGlob(id: string): string {
  return id.replace(/[*?[\]{}()!@#+|\\]/g, '\\$&');
}

/**
 * Load test IDs from an index/results source that have executionStatus === 'execution_error'.
 */
export async function loadErrorTestIds(jsonlPath: string): Promise<readonly string[]> {
  const ids = (await loadRetrySourceResults(jsonlPath))
    .filter((result) => result.executionStatus === 'execution_error')
    .map((result) => result.testId);

  return [...new Set(ids)];
}

/**
 * Load test IDs that are fully completed (non-error) across ALL targets.
 * A test ID is only considered "completed" if every result for that ID is non-error.
 * This is conservative for matrix runs: if case-1 succeeded on target A but errored
 * on target B, case-1 is NOT excluded (it will re-run on both targets).
 */
export async function loadFullyCompletedTestIds(jsonlPath: string): Promise<readonly string[]> {
  const results = await loadRetrySourceResults(jsonlPath);
  const allIds = new Set<string>();
  const errorIds = new Set<string>();

  for (const result of results) {
    if (!result.testId) continue;
    allIds.add(result.testId);
    if (result.executionStatus === 'execution_error') {
      errorIds.add(result.testId);
    }
  }

  // Only IDs where every result is non-error
  return [...allIds].filter((id) => !errorIds.has(id));
}

/**
 * Build a micromatch negation pattern that excludes the given test IDs.
 * Escapes glob metacharacters in IDs to ensure literal matching.
 */
export function buildExclusionFilter(completedIds: readonly string[]): string {
  const escaped = completedIds.map(escapeGlob);
  return escaped.length === 1 ? `!${escaped[0]}` : `!{${escaped.join(',')}}`;
}

/**
 * Load results from an index/results source that do NOT have executionStatus === 'execution_error'.
 * These are the "good" results that should be preserved when merging retry output.
 */
export async function loadNonErrorResults(jsonlPath: string): Promise<readonly EvaluationResult[]> {
  return (await loadRetrySourceResults(jsonlPath)).filter(
    (result) => result.testId && result.executionStatus !== 'execution_error',
  );
}
