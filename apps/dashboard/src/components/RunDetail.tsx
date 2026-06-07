/**
 * Run detail component showing per-eval breakdown with score bars.
 *
 * Groups results by category, then by suite within each category.
 * Category Breakdown is shown as a clean table with coloured pass-rate pills.
 * The All Evals table shows ERR badge instead of 0% for execution errors.
 *
 * Data tables keep cells on one line and scroll horizontally on narrow
 * viewports. Add future columns by extending the table; the min-width keeps the
 * mobile behavior stable instead of clipping the right side.
 *
 * Also renders a collapsible "Run Log" section sourced from the run's
 * captured `console.log` file (served by `/api/runs/:id/log`). Hidden when no
 * log is available — e.g. for remote runs or local runs that completed before
 * the console-log capture feature shipped.
 */

import { useState } from 'react';

import { Link } from '@tanstack/react-router';

import type { EvalResult } from '~/lib/types';

import { isPassing, useRunLog, useStudioConfig } from '~/lib/api';
import { isExecutionError, summarizeQuality } from '~/lib/result-summary';
import { formatCategoryDisplay } from '~/lib/run-detail-context';

import { PassRatePill } from './PassRatePill';
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
  executionErrors: number;
  total: number;
  avgScore: number;
}

interface CategoryGroup {
  name: string;
  displayName: string;
  mutedDisplayName?: string;
  suites: SuiteStats[];
  total: number;
  passed: number;
  failed: number;
  executionErrors: number;
  avgScore: number;
}

function buildCategoryGroups(results: EvalResult[], passThreshold: number): CategoryGroup[] {
  const categoryMap = new Map<string, Map<string, EvalResult[]>>();

  for (const r of results) {
    const cat = r.category ?? 'Uncategorized';
    const ds = r.suite ?? 'Uncategorized';
    if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
    // biome-ignore lint/style/noNonNullAssertion: map entry guaranteed by line above
    const dsMap = categoryMap.get(cat)!;
    const entry = dsMap.get(ds) ?? [];
    entry.push(r);
    dsMap.set(ds, entry);
  }

  return Array.from(categoryMap.entries())
    .map(([catName, dsMap]) => {
      const suites = Array.from(dsMap.entries())
        .map(([dsName, suiteResults]) => {
          const stats = summarizeQuality(suiteResults, passThreshold);
          return {
            name: dsName,
            passed: stats.passed,
            failed: stats.failed,
            executionErrors: stats.executionErrors,
            total: stats.total,
            avgScore: stats.avgScore,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const total = suites.reduce((s, d) => s + d.total, 0);
      const passed = suites.reduce((s, d) => s + d.passed, 0);
      const failed = suites.reduce((s, d) => s + d.failed, 0);
      const executionErrors = suites.reduce((s, d) => s + d.executionErrors, 0);
      const qualityTotal = total - executionErrors;
      const scoreSum = suites.reduce((s, d) => s + d.avgScore * (d.total - d.executionErrors), 0);

      const display = formatCategoryDisplay(catName);

      return {
        name: catName,
        displayName: display.label,
        mutedDisplayName: display.mutedLabel,
        suites,
        total,
        passed,
        failed,
        executionErrors,
        avgScore: qualityTotal > 0 ? scoreSum / qualityTotal : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function RunDetail({ results, runId, projectId }: RunDetailProps) {
  const { data: config } = useStudioConfig(projectId);
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  const total = results.length;
  const summary = summarizeQuality(results, passThreshold);
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
        passed={summary.passed}
        failed={summary.failed}
        passRate={summary.passRate}
        executionErrors={summary.executionErrors}
        totalCost={totalCost > 0 ? totalCost : undefined}
      />

      {/* Category Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-400">Category Breakdown</h3>
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-[620px] w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-2.5 font-medium text-gray-400">Category</th>
                <th className="px-4 py-2.5 font-medium text-gray-400">Quality Pass Rate</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Passed</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">
                  Quality Failures
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">
                  Execution Errors
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {categories.map((cat) => {
                const label = (
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{cat.displayName}</span>
                    {cat.mutedDisplayName ? (
                      <span
                        className="truncate text-xs font-normal text-gray-500"
                        title={cat.mutedDisplayName}
                      >
                        {cat.mutedDisplayName}
                      </span>
                    ) : null}
                  </span>
                );

                return (
                  <tr key={cat.name} className="transition-colors hover:bg-gray-900/30">
                    <td className="w-[18rem] max-w-[18rem] px-4 py-2.5 font-medium text-gray-200">
                      {projectId ? (
                        <Link
                          to="/projects/$projectId/runs/$runId/category/$category"
                          params={{ projectId, runId, category: cat.name }}
                          className="flex min-w-0 text-cyan-400 hover:text-cyan-300 hover:underline"
                          title={cat.mutedDisplayName ?? cat.displayName}
                        >
                          {label}
                        </Link>
                      ) : (
                        <Link
                          to="/runs/$runId/category/$category"
                          params={{ runId, category: cat.name }}
                          className="flex min-w-0 text-cyan-400 hover:text-cyan-300 hover:underline"
                          title={cat.mutedDisplayName ?? cat.displayName}
                        >
                          {label}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <PassRatePill
                        rate={
                          cat.total - cat.executionErrors > 0
                            ? cat.passed / (cat.total - cat.executionErrors)
                            : 0
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">
                      {cat.passed}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-400">
                      {cat.failed > 0 ? cat.failed : <span className="text-gray-600">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-400">
                      {cat.executionErrors > 0 ? (
                        cat.executionErrors
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                      {cat.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* All Evals */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-400">All Evals</h3>
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-[760px] w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="w-[24rem] px-4 py-3 font-medium text-gray-400">Test ID</th>
                <th className="w-[12rem] px-4 py-3 font-medium text-gray-400">Target</th>
                <th className="w-48 px-4 py-3 font-medium text-gray-400">Quality Score</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Duration</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {results.map((result, idx) => {
                const isError = isExecutionError(result);
                const passing = isPassing(result.score, passThreshold);
                return (
                  <tr
                    key={`${result.testId}-${idx}`}
                    className="transition-colors hover:bg-gray-900/30"
                  >
                    {/* Status dot */}
                    <td className="px-4 py-3 text-center">
                      {isError ? (
                        <span className="text-base font-bold text-amber-400">!</span>
                      ) : (
                        <span
                          className={`text-base font-bold ${passing ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {passing ? '✓' : '✗'}
                        </span>
                      )}
                    </td>
                    <td className="w-[24rem] max-w-[24rem] px-4 py-3">
                      {projectId ? (
                        <Link
                          to="/projects/$projectId/evals/$runId/$evalId"
                          params={{ projectId, runId, evalId: result.testId }}
                          className="block truncate font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                          title={result.testId}
                        >
                          {result.testId}
                        </Link>
                      ) : (
                        <Link
                          to="/evals/$runId/$evalId"
                          params={{ runId, evalId: result.testId }}
                          className="block truncate font-medium text-cyan-400 hover:text-cyan-300 hover:underline"
                          title={result.testId}
                        >
                          {result.testId}
                        </Link>
                      )}
                    </td>
                    <td
                      className="w-[12rem] max-w-[12rem] truncate px-4 py-3 text-gray-400"
                      title={result.target ?? undefined}
                    >
                      {result.target ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      {isError ? (
                        <span className="inline-flex rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300">
                          Execution error
                        </span>
                      ) : (
                        <PassRatePill rate={result.score} />
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

      <ConsoleLogSection runId={runId} projectId={projectId} />
    </div>
  );
}

function ConsoleLogSection({ runId, projectId }: { runId: string; projectId?: string }) {
  const [open, setOpen] = useState(false);
  const { data: log, isLoading, error } = useRunLog(runId, projectId);

  // Hide the section entirely when no log was captured (remote runs, or
  // local runs from before this feature shipped). The 404 path resolves
  // to `null` in fetchText, distinct from `undefined` (loading).
  if (!isLoading && !error && log == null) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-900"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          Run Log
        </span>
        <span className="text-xs text-gray-500">
          {isLoading ? 'Loading…' : error ? 'Failed to load' : log ? `${log.length} chars` : ''}
        </span>
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-800 bg-black">
          {error ? (
            <div className="p-4 text-sm text-red-400">
              Failed to load run log: {(error as Error).message}
            </div>
          ) : (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-gray-200">
              {log ?? ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
