import { DEFAULT_PASS_THRESHOLD } from '~/lib/api';
import type { RunEvalRequest } from '~/lib/types';

interface BuildRunEvalRequestOptions {
  suiteFilter: string;
  testIds: string[];
  target: string;
  experiment: string;
  tags: string[];
  thresholdInput: string;
  studioThreshold?: number;
  workers: string;
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
  experiment,
  tags,
  thresholdInput,
  studioThreshold,
  workers,
}: BuildRunEvalRequestOptions): RunEvalRequest {
  const req: RunEvalRequest = {};

  if (suiteFilter.trim()) req.suite_filter = suiteFilter.trim();
  if (testIds.length > 0) req.test_ids = testIds;
  if (target) req.target = target;
  if (experiment.trim()) req.experiment = experiment.trim();
  if (tags.length > 0) req.tags = tags;

  const resolvedThreshold = getDefaultThresholdInputValue(thresholdInput, studioThreshold);
  if (resolvedThreshold) req.threshold = Number.parseFloat(resolvedThreshold);

  if (workers) req.workers = Number.parseInt(workers, 10);

  return req;
}
