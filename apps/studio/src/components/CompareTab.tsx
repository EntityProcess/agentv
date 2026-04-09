/**
 * Cross-model comparison matrix component.
 *
 * Displays a grid of experiment (columns) x target (rows) cells,
 * each showing pass rate, average score, and test counts. Color-coded
 * by performance: green (>80%), yellow (50-80%), red (<50%).
 * Cells are expandable to show per-test-case breakdown.
 *
 * Used in both unscoped and project-scoped views.
 */

import { useState } from 'react';

import type { CompareCell, CompareResponse, CompareTestResult } from '~/lib/types';

interface CompareTabProps {
  data: CompareResponse | undefined;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
}

export function CompareTab({ data, isLoading, isError, error }: CompareTabProps) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError && error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load comparison data: {error.message}
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">No comparison data available</p>
        <p className="mt-2 text-sm text-gray-500">
          Run evaluations with different experiment and target combinations to see a comparison
          matrix.
        </p>
      </div>
    );
  }

  const { experiments, targets, cells } = data;

  // If there is only one experiment and one target, the matrix is trivial
  if (experiments.length <= 1 && targets.length <= 1) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-lg text-gray-400">Not enough variation to compare</p>
        <p className="mt-2 text-sm text-gray-500">
          The comparison matrix requires at least 2 experiments or 2 targets. Currently there{' '}
          {experiments.length === 1 ? 'is 1 experiment' : `are ${experiments.length} experiments`}{' '}
          and {targets.length === 1 ? '1 target' : `${targets.length} targets`}.
        </p>
      </div>
    );
  }

  // Build a lookup map for cells
  const cellMap = new Map<string, CompareCell>();
  for (const cell of cells) {
    cellMap.set(JSON.stringify([cell.experiment, cell.target]), cell);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-gray-800/60 ring-1 ring-emerald-500/60" />
          <span className="text-emerald-400">80%+</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-gray-800/60 ring-1 ring-amber-500/60" />
          <span className="text-amber-400">50–80%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-gray-800/60 ring-1 ring-red-500/60" />
          <span className="text-red-400">&lt;50%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-gray-700" />
          No data
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              {experiments.map((exp) => (
                <th key={exp} className="px-4 py-3 text-center font-medium text-gray-400">
                  {exp}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {targets.map((target) => (
              <CompareRow
                key={target}
                target={target}
                experiments={experiments}
                cellMap={cellMap}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareRow({
  target,
  experiments,
  cellMap,
}: {
  target: string;
  experiments: string[];
  cellMap: Map<string, CompareCell>;
}) {
  return (
    <tr className="transition-colors hover:bg-gray-900/30">
      <td className="px-4 py-3 font-medium text-gray-200">{target}</td>
      {experiments.map((exp) => {
        const cell = cellMap.get(JSON.stringify([exp, target]));
        return (
          <td key={exp} className="px-2 py-2">
            {cell ? (
              <CompareMatrixCell cell={cell} />
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-700 px-3 py-4 text-gray-600">
                --
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function passRateRingClass(rate: number): string {
  if (rate >= 0.8) return 'ring-emerald-500/60';
  if (rate >= 0.5) return 'ring-amber-500/60';
  return 'ring-red-500/60';
}

function passRateTextClass(rate: number): string {
  if (rate >= 0.8) return 'text-emerald-400';
  if (rate >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

function CompareMatrixCell({ cell }: { cell: CompareCell }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(cell.pass_rate * 100);
  const avgPct = Math.round(cell.avg_score * 100);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={`w-full rounded-lg bg-gray-800/60 px-3 py-3 text-center ring-1 transition-colors hover:bg-gray-700/60 ${passRateRingClass(cell.pass_rate)}`}
      >
        <div className="flex items-center justify-center">
          <span
            className={`text-lg font-semibold tabular-nums ${passRateTextClass(cell.pass_rate)}`}
          >
            {pct}%
          </span>
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {cell.passed_count}/{cell.eval_count} pass | avg {avgPct}%
        </div>
      </button>

      {expanded && <TestCaseBreakdown tests={cell.tests} />}
    </div>
  );
}

function TestCaseBreakdown({ tests }: { tests: CompareTestResult[] }) {
  return (
    <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-800 bg-gray-950/80 p-2">
      <div className="mb-1 text-xs font-medium text-gray-500">Test Cases</div>
      <div className="space-y-0.5">
        {tests.map((t) => (
          <div key={t.test_id} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs">
            <span className={t.passed ? 'text-emerald-400' : 'text-red-400'}>
              {t.passed ? '\u2713' : '\u2717'}
            </span>
            <span className="flex-1 truncate text-gray-300" title={t.test_id}>
              {t.test_id}
            </span>
            <span className="tabular-nums text-gray-500">{Math.round(t.score * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <div className="animate-pulse">
        <div className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <div className="h-4 w-48 rounded bg-gray-800" />
        </div>
        {['sk-1', 'sk-2', 'sk-3'].map((id) => (
          <div key={id} className="flex gap-4 border-b border-gray-800/50 px-4 py-6">
            <div className="h-4 w-24 rounded bg-gray-800" />
            <div className="h-16 w-32 rounded bg-gray-800" />
            <div className="h-16 w-32 rounded bg-gray-800" />
            <div className="h-16 w-32 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
