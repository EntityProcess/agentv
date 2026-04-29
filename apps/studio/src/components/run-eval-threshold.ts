import { DEFAULT_PASS_THRESHOLD } from '~/lib/api';
import type { RunEvalRequest } from '~/lib/types';

interface BuildRunEvalRequestOptions {
  suiteFilter: string;
  testIds: string[];
  target: string;
  thresholdInput: string;
  studioThreshold?: number;
  workers: string;
  dryRun: boolean;
}

export function getThresholdFieldValue(
  thresholdInput: string,
  thresholdEdited: boolean,
  studioThreshold?: number,
): string {
  if (thresholdEdited) {
    return thresholdInput;
  }

  return getDefaultThresholdInputValue(thresholdInput, studioThreshold);
}

export function getDefaultThresholdInputValue(
  thresholdInput: string,
  studioThreshold?: number,
): string {
  if (thresholdInput) {
    return thresholdInput;
  }

  return String(studioThreshold ?? DEFAULT_PASS_THRESHOLD);
}

export function buildRunEvalRequest({
  suiteFilter,
  testIds,
  target,
  thresholdInput,
  studioThreshold,
  workers,
  dryRun,
}: BuildRunEvalRequestOptions): RunEvalRequest {
  const req: RunEvalRequest = {};

  if (suiteFilter.trim()) req.suite_filter = suiteFilter.trim();
  if (testIds.length > 0) req.test_ids = testIds;
  if (target) req.target = target;

  const resolvedThreshold = getDefaultThresholdInputValue(thresholdInput, studioThreshold);
  if (resolvedThreshold) req.threshold = Number.parseFloat(resolvedThreshold);

  if (workers) req.workers = Number.parseInt(workers, 10);
  if (dryRun) req.dry_run = true;

  return req;
}
