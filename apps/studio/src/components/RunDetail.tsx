/**
 * Run detail component showing per-eval breakdown with score bars.
 *
 * Groups results by category, then by suite within each category.
 * Category Breakdown is shown as a clean table with coloured pass-rate pills.
 * The All Evals table shows ERR badge instead of 0% for execution errors.
 */

import { Link } from '@tanstack/react-router';

import type { EvalResult } from '~/lib/types';

import { isPassing, useStudioConfig } from '~/lib/api';
import { ScoreBar } from './ScoreBar';
import { StatsCards } from './StatsCards';

interface RunDetailProps {
  results: EvalResult[];
  runId: string;
  projectId?: string;
}

interface SuiteStats {
  name: string;
  passed: number;
  failed: number;
  total: number;
  avgScore: number;
}

interface CategoryGroup {
  name: string;
  suites: SuiteStats[];
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
}

function buildCategoryGroups(results: EvalResult[], passThreshold: number): CategoryGroup[] {
  const categoryMap = new Map<
    string,
    Map<string, { passed: number; failed: number; total: number; scoreSum: number }>
  >();

  for (const r of results) {
    const cat = r.category ?? 'Uncategorized';
    const ds = r.suite ?? 'Uncategorized';
    if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
    // biome-ignore lint/style/noNonNullAssertion: map entry guaranteed by line above
    const dsMap = categoryMap.get(cat)!;
    const entry = dsMap.get(ds) ?? { passed: 0, failed: 0, total: 0, scoreSum: 0 };
    entry.total += 1;
    entry.scoreSum += r.score;
    if (isPassing(r.score, passThreshold)) entry.passed += 1;
    else entry.failed += 1;
    dsMap.set(ds, entry);
  }

  return Array.from(categoryMap.entries())
    .map(([catName, dsMap]) => {
      const suites = Array.from(dsMap.entries())
        .map(([dsName, stats]) => ({
          name: dsName,
          ...stats,
          avgScore: stats.total > 0 ? stats.scoreSum / stats.total : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const total = suites.reduce((s, d) => s + d.total, 0);
      const passed = suites.reduce((s, d) => s + d.passed, 0);
      const failed = suites.reduce((s, d) => s + d.failed, 0);
      const scoreSum = suites.reduce((s, d) => s + d.avgScore * d.total, 0);

      return {
        name: catName,
        suites,
        total,
        passed,
        failed,
        avgScore: total > 0 ? scoreSum / total : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Progress-bar pill: coloured fill proportional to rate, percentage text inside. */
function PassRatePill({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const fill = 'bg-gradient-to-r from-blue-400 to-blue-600';
  return (
    <div className="relative h-5 w-20 overflow-hidden rounded-full bg-gray-800">
      <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${pct}%` }} />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-white">
        {pct}%
      </span>
    </div>
  );
}

export function RunDetail({ results, runId, projectId }: RunDetailProps) {
  const { data: config } = useStudioConfig();
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  const total = results.length;
  const passed = results.filter((r) => isPassing(r.score, passThreshold)).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const categories = buildCategoryGroups(results, passThreshold);

  if (total === 0) {
    return (
      <div className="space-y-6">
        <StatsCards total={0} passed={0} failed={0} passRate={0} />
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="text-lg text-gray-400">No evaluations found</p>
          <p className="mt-2 text-sm text-gray-500">This run has no results yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StatsCards
        total={total}
        passed={passed}
        failed={failed}
        passRate={passRate}
        totalCost={totalCost > 0 ? totalCost : undefined}
      />

      {/* Category Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-400">Category Breakdown</h3>
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-2.5 font-medium text-gray-400">Category</th>
                <th className="px-4 py-2.5 font-medium text-gray-400">Pass Rate</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Passed</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Failed</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {categories.map((cat) => (
                <tr key={cat.name} className="transition-colors hover:bg-gray-900/30">
                  <td className="px-4 py-2.5 font-medium text-gray-200">{cat.name}</td>
                  <td className="px-4 py-2.5">
                    <PassRatePill rate={cat.total > 0 ? cat.passed / cat.total : 0} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">
                    {cat.passed}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-400">
                    {cat.failed > 0 ? cat.failed : <span className="text-gray-600">0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{cat.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* All Evals */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-400">All Evals</h3>
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 font-medium text-gray-400">Test ID</th>
                <th className="px-4 py-3 font-medium text-gray-400">Target</th>
                <th className="w-48 px-4 py-3 font-medium text-gray-400">Score</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Duration</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {results.map((result, idx) => {
                const isError = result.executionStatus === 'execution_error';
                const passing = isPassing(result.score, passThreshold);
                return (
                  <tr
                    key={`${result.testId}-${idx}`}
                    className="transition-colors hover:bg-gray-900/30"
                  >
                    {/* Status dot */}
                    <td className="px-4 py-3 text-center">
                      {isError ? (
                        <span className="text-base font-bold text-red-400">!</span>
                      ) : (
                        <span
                          className={`text-base font-bold ${passing ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {passing ? '✓' : '✗'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {projectId ? (
                        <Link
                          to="/projects/$projectId/evals/$runId/$evalId"
                          params={{ projectId, runId, evalId: result.testId }}
                          className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          {result.testId}
                        </Link>
                      ) : (
                        <Link
                          to="/evals/$runId/$evalId"
                          params={{ runId, evalId: result.testId }}
                          className="font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          {result.testId}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{result.target ?? '-'}</td>
                    <td className="px-4 py-3">
                      {isError ? (
                        <span className="inline-flex rounded-full bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-400">
                          ERR
                        </span>
                      ) : (
                        <ScoreBar score={result.score} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                      {result.durationMs != null
                        ? `${(result.durationMs / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                      {result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
