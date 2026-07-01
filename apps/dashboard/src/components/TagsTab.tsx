/**
 * Tags table — groups runs across a selectable promptfoo tag key.
 *
 * A group-by `<select>` lists the tag keys present across all runs (union of
 * every row's `tags` map keys plus the synthetic `experiment` key), defaulting
 * to `experiment` so the tab behaves like the old Experiments tab on first
 * load. Selecting another key (`team`, `env`, ...) regroups the table by that
 * key's values. Each row links to the tag-value detail page.
 *
 * The table keeps the desktop column layout on mobile by using the same
 * overflow container + fixed minimum width pattern as other Dashboard summary
 * tables, so right-side metrics remain reachable instead of being clipped.
 */

import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import {
  DEFAULT_TAG_KEY,
  projectTagGroupsOptions,
  projectTagKeysOptions,
  tagGroupsOptions,
  tagKeysOptions,
} from '~/lib/api';
import { aggregateQualityCount, executionErrorCount } from '~/lib/result-summary';
import { tagKeyLabel } from '~/lib/tag-key-label';
import type { TagGroupSummary } from '~/lib/types';

import { PassRatePill } from './PassRatePill';

interface TagsTabProps {
  projectId?: string;
  /** Currently selected group-by tag key. Defaults to `experiment`. */
  tagKey: string;
  /** Called when the user picks a different group-by key. */
  onTagKeyChange: (key: string) => void;
}

export function TagsTab({ projectId, tagKey, onTagKeyChange }: TagsTabProps) {
  const { data: keysData } = useQuery(
    projectId ? projectTagKeysOptions(projectId) : tagKeysOptions,
  );

  const keys = keysData?.keys ?? [DEFAULT_TAG_KEY];

  // A `?key=` from the URL can name a key that isn't present in the fetched
  // list (e.g. a bookmarked link after the key was removed). Falling back keeps
  // the `<select>` on a real option and the table populated instead of showing
  // "No values found". Prefer `experiment` when available, else the first key.
  const keyIsKnown = keys.includes(tagKey);
  const effectiveKey = keyIsKnown
    ? tagKey
    : keys.includes(DEFAULT_TAG_KEY)
      ? DEFAULT_TAG_KEY
      : (keys[0] ?? DEFAULT_TAG_KEY);

  // Reflect the fallback back into the URL/parent state once the keys arrive.
  useEffect(() => {
    if (keysData && !keyIsKnown && effectiveKey !== tagKey) {
      onTagKeyChange(effectiveKey);
    }
  }, [keysData, keyIsKnown, effectiveKey, tagKey, onTagKeyChange]);

  const { data, isLoading } = useQuery(
    projectId ? projectTagGroupsOptions(projectId, effectiveKey) : tagGroupsOptions(effectiveKey),
  );

  const groups = data?.groups ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="tag-key-select"
          className="text-xs font-medium uppercase tracking-wider text-gray-500"
        >
          Group by
        </label>
        <select
          id="tag-key-select"
          value={effectiveKey}
          onChange={(e) => onTagKeyChange(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-200 focus:border-cyan-700 focus:outline-none"
        >
          {keys.map((key) => (
            <option key={key} value={key}>
              {tagKeyLabel(key)}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No values found for tag `{effectiveKey}`</p>
          <p className="mt-2 text-sm text-gray-500">
            Values will appear here once evaluations are run with a <code>{effectiveKey}</code> tag.
          </p>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-[760px] w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-400">{tagKeyLabel(effectiveKey)}</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Runs</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Targets</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Evals</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Execution Errors</th>
                <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
                <th className="px-4 py-3 font-medium text-gray-400">Last Run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {groups.map((group: TagGroupSummary) => {
                const qualityCount = aggregateQualityCount(group);
                const errors = executionErrorCount(group);
                return (
                  <tr key={group.name} className="transition-colors hover:bg-gray-900/30">
                    <td className="px-4 py-3">
                      {projectId ? (
                        <Link
                          to="/projects/$projectId/tags/$key/$value"
                          params={{ projectId, key: effectiveKey, value: group.name }}
                          className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          {group.name}
                        </Link>
                      ) : (
                        <Link
                          to="/tags/$key/$value"
                          params={{ key: effectiveKey, value: group.name }}
                          className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          {group.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                      {group.run_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                      {group.target_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                      <span className="text-emerald-400">{group.passed_count}</span>
                      <span className="text-gray-600"> / </span>
                      {qualityCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-400">
                      {errors > 0 ? errors : <span className="text-gray-600">0</span>}
                    </td>
                    <td className="px-4 py-3">
                      <PassRatePill rate={group.pass_rate} />
                    </td>
                    <td
                      className="px-4 py-3 text-gray-400"
                      title={formatTimestamp(group.last_run).full}
                    >
                      {formatTimestamp(group.last_run).date}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ts: string | undefined | null): { date: string; full: string } {
  if (!ts) return { date: 'N/A', full: 'N/A' };
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: 'N/A', full: 'N/A' };
    const full = d.toLocaleString();
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHour = Math.floor(diffMs / 3_600_000);
    let date: string;
    if (diffMin < 1) date = 'just now';
    else if (diffMin < 60) date = `${diffMin} min ago`;
    else if (diffHour < 24) date = `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    else date = d.toLocaleDateString();
    return { date, full };
  } catch {
    return { date: 'N/A', full: 'N/A' };
  }
}

function LoadingSkeleton() {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
      <div className="min-w-[760px] animate-pulse">
        <div className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <div className="h-4 w-48 rounded bg-gray-800" />
        </div>
        {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5'].map((id) => (
          <div key={id} className="flex gap-4 border-b border-gray-800/50 px-4 py-3">
            <div className="h-4 w-32 rounded bg-gray-800" />
            <div className="h-4 w-12 rounded bg-gray-800" />
            <div className="h-4 w-12 rounded bg-gray-800" />
            <div className="h-4 w-48 rounded bg-gray-800" />
            <div className="h-4 w-24 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
