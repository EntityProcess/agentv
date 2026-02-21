import type { EvaluationResult, EvaluatorResult } from './types.js';

/**
 * Top-level fields to strip from baseline results.
 * Uses a denylist approach: new fields are auto-preserved.
 */
const STRIPPED_TOP_LEVEL_FIELDS = new Set([
  'answer',
  'requests',
  'trace',
  'workspacePath',
  'output',
  'setupOutput',
  'teardownOutput',
  'fileChanges',
  'workspaceFingerprint',
]);

/**
 * Fields to strip from evaluator results.
 */
const STRIPPED_EVALUATOR_FIELDS = new Set(['rawRequest', 'evaluatorProviderRequest']);

/**
 * Trims an evaluator result for baseline storage.
 * Strips debug/audit fields while preserving scoring data.
 * Recursively trims nested evaluator results (for composites).
 */
function trimEvaluatorResult(result: EvaluatorResult): EvaluatorResult {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (STRIPPED_EVALUATOR_FIELDS.has(key)) continue;
    if (key === 'scores' && Array.isArray(value)) {
      trimmed[key] = (value as EvaluatorResult[]).map(trimEvaluatorResult);
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed as unknown as EvaluatorResult;
}

/**
 * Trims an EvaluationResult for baseline storage.
 * Strips large debug/audit fields (denylist approach) while preserving
 * all fields needed for regression comparison (scores, hits, misses, etc.).
 *
 * Returns a new object — the input is not mutated.
 */
export function trimBaselineResult(result: EvaluationResult): EvaluationResult {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (STRIPPED_TOP_LEVEL_FIELDS.has(key)) continue;
    if (key === 'scores' && Array.isArray(value)) {
      trimmed[key] = (value as EvaluatorResult[]).map(trimEvaluatorResult);
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed as unknown as EvaluationResult;
}
