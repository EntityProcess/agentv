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

import { useRunLog, useStudioConfig } from '~/lib/api';
import { type CategoryTreeNode, buildCategoryTree } from '~/lib/category-tree';
import { findPhoenixExternalTraceUrl } from '~/lib/external-trace-link';
import { summarizeQuality } from '~/lib/result-summary';

import { PassRatePill } from './PassRatePill';
import { ResultTable } from './ResultTable';
import { StatsCards } from './StatsCards';

interface RunDetailProps {
  results: EvalResult[];
  runId: string;
  projectId?: string;
}

export function RunDetail({ results, runId, projectId }: RunDetailProps) {
  const { data: config } = useStudioConfig(projectId);
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const phoenixUrl = findPhoenixExternalTraceUrl(results);

  const total = results.length;
  const summary = summarizeQuality(results, passThreshold);
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const categoryTree = buildCategoryTree(results, passThreshold);
  const visibleCategories = visibleCategoryRows(categoryTree, expandedCategories);
  const toggleCategory = (category: string) => {
    setExpandedCategories((current) => ({ ...current, [category]: !current[category] }));
  };

  if (total === 0) {
    return (
      <div className="space-y-6">
        <StatsCards total={0} passed={0} failed={0} passRate={0} />
        <ExternalTraceLink href={phoenixUrl} />
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

      <ExternalTraceLink href={phoenixUrl} />

      {/* Category Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-400">Category Breakdown</h3>
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-[620px] w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-2.5 font-medium text-gray-400">Category</th>
                <th className="px-4 py-2.5 font-medium text-gray-400">Pass Rate</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Passed</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Failures</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">
                  Execution Errors
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {visibleCategories.map((cat) => {
                const expanded = expandedCategories[cat.name] === true;
                return (
                  <tr key={cat.name} className="transition-colors hover:bg-gray-900/30">
                    <td className="w-[18rem] max-w-[18rem] px-4 py-2.5 font-medium text-gray-200">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-4 shrink-0"
                          style={{ width: `${cat.depth * 16}px` }}
                        />
                        {cat.childCount > 0 ? (
                          <button
                            type="button"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-700 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200"
                            onClick={() => toggleCategory(cat.name)}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${cat.name}`}
                            aria-expanded={expanded}
                          >
                            {expanded ? '-' : '+'}
                          </button>
                        ) : (
                          <span className="h-5 w-5 shrink-0" />
                        )}
                        {projectId ? (
                          <Link
                            to="/projects/$projectId/runs/$runId/category/$category"
                            params={{ projectId, runId, category: cat.name }}
                            className="min-w-0 truncate text-cyan-400 hover:text-cyan-300 hover:underline"
                            title={cat.name}
                          >
                            {cat.label}
                          </Link>
                        ) : (
                          <Link
                            to="/runs/$runId/category/$category"
                            params={{ runId, category: cat.name }}
                            className="min-w-0 truncate text-cyan-400 hover:text-cyan-300 hover:underline"
                            title={cat.name}
                          >
                            {cat.label}
                          </Link>
                        )}
                        {cat.depth > 0 ? (
                          <span className="truncate text-xs font-normal text-gray-500">
                            {cat.name}
                          </span>
                        ) : null}
                        {cat.childCount > 0 ? (
                          <span className="shrink-0 text-xs font-normal text-gray-500">
                            {cat.childCount}
                          </span>
                        ) : null}
                      </span>
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

      <ResultTable
        results={results}
        runId={runId}
        projectId={projectId}
        passThreshold={passThreshold}
        title="All Evals"
      />

      <ConsoleLogSection runId={runId} projectId={projectId} />
    </div>
  );
}

function visibleCategoryRows(
  nodes: readonly CategoryTreeNode[],
  expanded: Record<string, boolean>,
): CategoryTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(expanded[node.name] ? visibleCategoryRows(node.children, expanded) : []),
  ]);
}

function ExternalTraceLink({ href }: { href?: string }) {
  if (!href) return null;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-200">External trace</h3>
          <p className="mt-1 text-sm text-gray-500">Phoenix</p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md border border-cyan-900/70 px-2.5 py-1 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-700 hover:bg-cyan-950/40 hover:text-cyan-200 hover:underline"
        >
          Open in Phoenix
        </a>
      </div>
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
