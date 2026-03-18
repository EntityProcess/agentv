import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { EvaluationResult } from '@agentv/core';

type RetryResultRecord = Partial<EvaluationResult> & {
  readonly test_id?: string;
  readonly execution_status?: string;
};

function getTestId(result: RetryResultRecord): string | undefined {
  return result.testId ?? result.test_id;
}

function getExecutionStatus(result: RetryResultRecord): string | undefined {
  return result.executionStatus ?? result.execution_status;
}

function toEvaluationResult(result: RetryResultRecord): EvaluationResult {
  if (result.testId !== undefined && result.executionStatus !== undefined) {
    return result as EvaluationResult;
  }

  return {
    ...result,
    testId: getTestId(result) ?? '',
    executionStatus: getExecutionStatus(result),
  } as EvaluationResult;
}

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
      const parsed = JSON.parse(trimmed) as RetryResultRecord;
      const executionStatus = getExecutionStatus(parsed);
      const testId = getTestId(parsed);
      if (executionStatus === 'execution_error' && testId) {
        ids.push(testId);
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
      const parsed = JSON.parse(trimmed) as RetryResultRecord;
      const testId = getTestId(parsed);
      const executionStatus = getExecutionStatus(parsed);
      if (!testId || parsed.score === undefined) continue;
      if (executionStatus !== 'execution_error') {
        results.push(toEvaluationResult(parsed));
      }
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}
