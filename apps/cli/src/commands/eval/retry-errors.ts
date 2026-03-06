import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { EvaluationResult } from '@agentv/core';

/**
 * Load test IDs from a JSONL results file that have executionStatus === 'execution_error'.
 */
export async function loadErrorTestIds(jsonlPath: string): Promise<readonly string[]> {
  const ids: string[] = [];
  const rl = createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<EvaluationResult>;
      if (parsed.executionStatus === 'execution_error' && parsed.testId) {
        ids.push(parsed.testId);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return [...new Set(ids)];
}

/**
 * Load results from a JSONL file that do NOT have executionStatus === 'execution_error'.
 * These are the "good" results that should be preserved when merging retry output.
 */
export async function loadNonErrorResults(jsonlPath: string): Promise<readonly EvaluationResult[]> {
  const results: EvaluationResult[] = [];
  const rl = createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<EvaluationResult>;
      if (!parsed.testId || parsed.score === undefined) continue;
      if (parsed.executionStatus !== 'execution_error') {
        results.push(parsed as EvaluationResult);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}
