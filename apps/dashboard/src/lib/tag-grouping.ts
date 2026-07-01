/**
 * Client mirror of the server's tag grouping rules (`resolveTagGroupValue` /
 * `noKeyBucketLabel` in `apps/cli/src/commands/results/serve.ts`).
 *
 * The Tags-tab detail view filters the run list by the value a run contributes
 * for the selected key, and that value MUST match the label the server buckets
 * the run under — otherwise the `(no <key>)` group card shows a run_count that
 * the detail page can never reproduce (it would resolve to `''` and match
 * nothing). Keeping this resolution in one place guarantees the two agree.
 */

import type { RunMeta } from './types';

/** Bucket label for runs whose tags map does not carry the selected key. */
export function noKeyBucketLabel(key: string): string {
  return `(no ${key})`;
}

/**
 * Resolve the value a run contributes for a tag key, matching the server. For
 * the reserved `experiment` key we honour the lockstep fallback
 * (`run.experiment ?? run.run_tags?.experiment ?? 'default'`) so old runs
 * without a tags map still resolve. For any other key, missing/empty values map
 * to the same `(no <key>)` label the server emits.
 */
export function runTagValue(run: RunMeta, key: string): string {
  if (key === 'experiment') {
    return run.experiment ?? run.run_tags?.experiment ?? 'default';
  }
  const value = run.run_tags?.[key];
  return value === undefined || value === '' ? noKeyBucketLabel(key) : value;
}
