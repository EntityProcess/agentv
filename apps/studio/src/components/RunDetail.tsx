/**
 * Run detail component showing per-eval breakdown with score bars.
 *
 * Groups results by category (from file path), then by suite within each category.
 * Categories are shown as collapsible sections with suite cards inside.
 */

import { Link } from '@tanstack/react-router';
import { useState } from 'react';

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

export function RunDetail({ results, runId, projectId }: RunDetailProps) {
  const { data: config } = useStudioConfig();
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  const total = results.length;
  const passed = results.filter((r) => isPassing(r.score, passThreshold)).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const categories = buildCategoryGroups(results, passThreshold);
  const hasMultipleCategories = categories.length > 1;

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

      {hasMultipleCategories ? (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-400">Categories</h3>
          {categories.map((cat) => (
            <CategorySection key={cat.name} category={cat} runId={runId} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Suites</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories[0]?.suites.map((ds) => (
              <SuiteCard key={ds.name} suite={ds} runId={runId} />
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">Test ID</th>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="w-48 px-4 py-3 font-medium text-gray-400">Score</th>
              <th className="px-4 py-3 font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Duration</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {results.map((result, idx) => (
              <tr
                key={`${result.testId}-${idx}`}
                className="transition-colors hover:bg-gray-900/30"
              >
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
                  <ScoreBar score={result.score} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={result.executionStatus} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategorySection({ category, runId }: { category: CategoryGroup; runId: string }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-gray-800">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-900/50"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="text-sm font-medium text-gray-200">{category.name}</span>
          <span className="text-xs text-gray-500">
            {category.suites.length} suite{category.suites.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-emerald-400">{category.passed} passed</span>
          {category.failed > 0 && <span className="text-red-400">{category.failed} failed</span>}
          <span className="text-gray-500">
            {category.passed}/{category.total}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {category.suites.map((ds) => (
              <SuiteCard key={ds.name} suite={ds} runId={runId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SuiteCard({ suite, runId }: { suite: SuiteStats; runId: string }) {
  return (
    <Link
      to="/runs/$runId/suite/$suite"
      params={{ runId, suite: suite.name }}
      className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-left transition-colors hover:border-gray-700"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200 truncate">{suite.name}</span>
        <span className="ml-2 text-xs text-gray-500">
          {suite.passed}/{suite.total}
        </span>
      </div>
      <div className="mt-2">
        <ScoreBar score={suite.avgScore} />
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        <span className="text-emerald-400">{suite.passed} passed</span>
        {suite.failed > 0 && <span className="text-red-400">{suite.failed} failed</span>}
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-gray-500">-</span>;

  const isSuccess = status === 'success' || status === 'completed';
  const isError = status === 'error' || status === 'failed';

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isSuccess
          ? 'bg-emerald-900/50 text-emerald-400'
          : isError
            ? 'bg-red-900/50 text-red-400'
            : 'bg-gray-800 text-gray-400'
      }`}
    >
      {status}
    </span>
  );
}
