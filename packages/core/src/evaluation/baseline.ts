import type { EvaluationResult, GraderResult } from './types.js';

/**
 * Top-level fields to strip from baseline results.
 * Uses a denylist approach: new fields are auto-preserved.
 */
const STRIPPED_TOP_LEVEL_FIELDS = new Set([
  'requests',
  'trace',
  'workspacePath',
  'output',
  'beforeAllOutput',
  'beforeEachOutput',
  'afterAllOutput',
  'afterEachOutput',
  'fileChanges',
  // Promoted execution metrics (debug, not needed for regression comparison)
  'tokenUsage',
  'costUsd',
  'durationMs',
  'startTime',
  'endTime',
]);

/**
 * Fields to strip from grader results.
 */
const STRIPPED_EVALUATOR_FIELDS = new Set(['rawRequest', 'input']);

/**
 * Trims an evaluator result for baseline storage.
 * Strips debug/audit fields while preserving scoring data.
 * Recursively trims nested grader results (for composites).
 */
function trimEvaluatorResult(result: GraderResult): GraderResult {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (STRIPPED_EVALUATOR_FIELDS.has(key)) continue;
    if (key === 'scores' && Array.isArray(value)) {
      trimmed[key] = (value as GraderResult[]).map(trimEvaluatorResult);
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed as unknown as GraderResult;
}

/**
 * Trims an EvaluationResult for baseline storage.
 * Strips large debug/audit fields (denylist approach) while preserving
 * all fields needed for regression comparison (scores, assertions, etc.).
 *
 * Returns a new object — the input is not mutated.
 */
export function trimBaselineResult(result: EvaluationResult): EvaluationResult {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (STRIPPED_TOP_LEVEL_FIELDS.has(key)) continue;
    if (key === 'scores' && Array.isArray(value)) {
      trimmed[key] = (value as GraderResult[]).map(trimEvaluatorResult);
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed as unknown as EvaluationResult;
}
