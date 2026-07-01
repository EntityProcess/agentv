/**
 * Analytics charts section for the Compare (Analytics) tab.
 *
 * Renders a collapsible section below the aggregated matrix with a
 * baseline-target selector dropdown. When a baseline is selected,
 * the component fetches comparison data with delta / normalized-gain
 * fields and renders the following charts:
 *
 *   1. Normalized gain bar chart (horizontal bars, g per task × target)
 *   2. Negative delta table (tasks where non-baseline scored worse)
 *   3. Filterable score distribution histogram (experiment/category/time)
 *   4. Trend-over-time line chart (mean score per target over time)
 *
 * All charts use recharts styled with Tailwind-matching colors to
 * respect the Dashboard dark theme (gray-950 canvas, cyan accents,
 * emerald/red data tones).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { compareOptionsWithBaseline, projectCompareOptions } from '~/lib/api';
import {
  ALL_DISTRIBUTION_FILTER_VALUE,
  SCORE_DISTRIBUTION_TIME_PERIODS,
  type ScoreDistributionFilters,
  type ScoreDistributionTimePeriod,
  buildScoreDistributionModel,
} from '~/lib/score-distribution';
import type { CompareResponse, CompareRunEntry } from '~/lib/types';

// ── Color palette matching Dashboard DESIGN.md ────────────────────────────

const COLORS = {
  green: '#34d399', // emerald-400
  red: '#f87171', // red-400
  yellow: '#facc15', // yellow-400
  gray: '#4b5563', // gray-600
  cyan: '#22d3ee', // cyan-400
  gridLine: '#1f2937', // gray-800
  labelText: '#9ca3af', // gray-400
  tooltipBg: '#111827', // gray-900
  tooltipBorder: '#374151', // gray-700
};

// A set of distinguishable target colors for multi-target charts
const TARGET_COLORS = [
  '#22d3ee', // cyan-400
  '#34d399', // emerald-400
  '#facc15', // yellow-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#f472b6', // pink-400
  '#60a5fa', // blue-400
];

function targetColor(idx: number): string {
  return TARGET_COLORS[idx % TARGET_COLORS.length];
}

// ── Types ──────────────────────────────────────────────────────────────

interface AnalyticsChartsProps {
  /** Unfiltered compare response (no baseline). Used for tag heatmap, histogram, etc. */
  data: CompareResponse;
  /** Project scope. Undefined for unscoped root view. */
  projectId?: string;
}

// ── Main component ─────────────────────────────────────────────────────

export function AnalyticsCharts({ data, projectId }: AnalyticsChartsProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [baseline, setBaseline] = useState<string>('');
  const targets = data.targets;

  // Fetch compare data with baseline param when a baseline is selected
  const baselineQuery = useQuery(
    projectId
      ? projectCompareOptions(projectId, baseline || undefined)
      : compareOptionsWithBaseline(baseline || undefined),
  );
  const baselineData = baseline ? baselineQuery.data : undefined;

  // Trend data from existing runs (sorted by timestamp)
  const trendData = useMemo(() => buildTrendData(data.runs ?? []), [data.runs]);

  return (
    <div className="rounded-lg border border-gray-800">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-900/30"
      >
        <span className="text-sm font-medium text-gray-300">Analytics</span>
        <span className="text-xs text-gray-500">{collapsed ? '▸ Show' : '▾ Hide'}</span>
      </button>

      {!collapsed && (
        <div className="space-y-6 border-t border-gray-800 px-4 py-4">
          {/* Baseline selector */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="baseline-select"
              className="text-xs font-medium uppercase tracking-wider text-gray-500"
            >
              Baseline target
            </label>
            <select
              id="baseline-select"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">Select a baseline…</option>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {baseline && baselineQuery.isLoading && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}
          </div>

          {/* 1. Normalized gain bar chart */}
          {baseline && baselineData && (
            <NormalizedGainChart data={baselineData} baseline={baseline} />
          )}

          {/* 2. Negative delta table */}
          {baseline && baselineData && (
            <NegativeDeltaTable data={baselineData} baseline={baseline} />
          )}

          {/* 3. Score distribution histogram */}
          <ScoreDistribution data={data} />

          {/* 4. Trend over time */}
          {trendData.length > 1 && targets.length > 0 && (
            <TrendOverTime data={trendData} targets={targets} />
          )}

          {!baseline && (
            <p className="text-xs text-gray-500">
              Select a baseline target above to see gain and delta charts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-xl">
      {label && <div className="mb-1 font-medium text-gray-300">{label}</div>}
      {payload.map((p, i) => (
        <div key={`${p.name}-${i}`} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="tabular-nums text-gray-200">
            {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-400">{title}</h3>
      {children}
    </div>
  );
}

// ── 1. Normalized gain bar chart ───────────────────────────────────────

interface GainRow {
  experiment: string;
  target: string;
  g: number | null;
  delta: number;
}

function NormalizedGainChart({ data, baseline }: { data: CompareResponse; baseline: string }) {
  const rows = useMemo(() => {
    const result: GainRow[] = [];
    for (const cell of data.cells) {
      if (cell.target === baseline) continue;
      if (cell.delta === undefined) continue;
      result.push({
        experiment: cell.experiment,
        target: cell.target,
        g: cell.normalized_gain ?? null,
        delta: cell.delta,
      });
    }
    // Sort by absolute gain descending
    result.sort((a, b) => Math.abs(b.g ?? 0) - Math.abs(a.g ?? 0));
    return result;
  }, [data.cells, baseline]);

  if (rows.length === 0) {
    return (
      <ChartSection title="Normalized Gain (g)">
        <p className="text-xs text-gray-500">
          No gain data available. Ensure multiple targets exist.
        </p>
      </ChartSection>
    );
  }

  const chartData = rows.map((r) => ({
    name: `${r.target} · ${r.experiment}`,
    g: r.g ?? 0,
    isNull: r.g === null,
  }));

  return (
    <ChartSection title="Normalized Gain (g)">
      <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-3">
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 32)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 120, right: 20, top: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: COLORS.labelText, fontSize: 11 }}
              axisLine={{ stroke: COLORS.gridLine }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: COLORS.labelText, fontSize: 11 }}
              width={120}
              axisLine={{ stroke: COLORS.gridLine }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="g" name="Normalized Gain">
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={
                    entry.isNull
                      ? COLORS.gray
                      : entry.g > 0
                        ? COLORS.green
                        : entry.g < 0
                          ? COLORS.red
                          : COLORS.gray
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartSection>
  );
}

// ── 2. Negative delta table ────────────────────────────────────────────

function NegativeDeltaTable({ data, baseline }: { data: CompareResponse; baseline: string }) {
  const negatives = useMemo(() => {
    return data.cells
      .filter((c) => c.target !== baseline && c.delta !== undefined && c.delta < 0)
      .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  }, [data.cells, baseline]);

  if (negatives.length === 0) return null;

  return (
    <ChartSection title="Regressions vs. Baseline">
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">Experiment</th>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Avg Score</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Delta</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">g</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {negatives.map((cell) => (
              <tr
                key={`${cell.experiment}::${cell.target}`}
                className="transition-colors hover:bg-gray-900/30"
              >
                <td className="px-4 py-3 font-medium text-gray-200">{cell.experiment}</td>
                <td className="px-4 py-3 text-gray-300">{cell.target}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                  {Math.round(cell.avg_score * 100)}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-red-400">
                  {cell.delta?.toFixed(3)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-red-400">
                  {cell.normalized_gain !== undefined && cell.normalized_gain !== null
                    ? cell.normalized_gain.toFixed(3)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartSection>
  );
}

// ── 3. Score distribution histogram ────────────────────────────────────

const DEFAULT_DISTRIBUTION_FILTERS: ScoreDistributionFilters = {
  experiment: ALL_DISTRIBUTION_FILTER_VALUE,
  category: ALL_DISTRIBUTION_FILTER_VALUE,
  timePeriod: 'all',
};

function ScoreDistribution({ data }: { data: CompareResponse }) {
  const [filters, setFilters] = useState<ScoreDistributionFilters>(DEFAULT_DISTRIBUTION_FILTERS);
  const model = useMemo(() => buildScoreDistributionModel(data, filters), [data, filters]);

  useEffect(() => {
    setFilters((prev) => {
      const experimentStillAvailable =
        !prev.experiment ||
        model.experimentOptions.some((option) => option.value === prev.experiment);
      const categoryStillAvailable =
        !prev.category || model.categoryOptions.some((option) => option.value === prev.category);
      const timePeriodStillAvailable = prev.timePeriod === 'all' || model.hasTimestampedScores;
      if (experimentStillAvailable && categoryStillAvailable && timePeriodStillAvailable) {
        return prev;
      }
      return {
        experiment: experimentStillAvailable ? prev.experiment : ALL_DISTRIBUTION_FILTER_VALUE,
        category: categoryStillAvailable ? prev.category : ALL_DISTRIBUTION_FILTER_VALUE,
        timePeriod: timePeriodStillAvailable ? prev.timePeriod : 'all',
      };
    });
  }, [model.experimentOptions, model.categoryOptions, model.hasTimestampedScores]);

  const updateFilter = <K extends keyof ScoreDistributionFilters>(
    key: K,
    value: ScoreDistributionFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => setFilters(DEFAULT_DISTRIBUTION_FILTERS);
  const hasActiveFilters =
    filters.experiment !== ALL_DISTRIBUTION_FILTER_VALUE ||
    filters.category !== ALL_DISTRIBUTION_FILTER_VALUE ||
    filters.timePeriod !== 'all';
  const hasAnyScores = model.totalScores > 0;
  const emptyMessage = scoreDistributionEmptyMessage(model, filters);

  return (
    <ChartSection title="Score Distribution">
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <DistributionSelect
              id="score-distribution-experiment"
              label="Experiment"
              value={filters.experiment}
              onChange={(value) => updateFilter('experiment', value)}
              disabled={model.experimentOptions.length === 0}
            >
              <option value={ALL_DISTRIBUTION_FILTER_VALUE}>All experiments</option>
              {model.experimentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </DistributionSelect>
            <DistributionSelect
              id="score-distribution-category"
              label="Category"
              value={filters.category}
              onChange={(value) => updateFilter('category', value)}
              disabled={!model.categoryAvailable}
              help={
                model.categoryAvailable || !hasAnyScores
                  ? undefined
                  : 'Category metadata is not present in these compare results.'
              }
            >
              <option value={ALL_DISTRIBUTION_FILTER_VALUE}>All categories</option>
              {model.categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </DistributionSelect>
            <DistributionSelect
              id="score-distribution-time"
              label="Time period"
              value={filters.timePeriod}
              onChange={(value) => updateFilter('timePeriod', value as ScoreDistributionTimePeriod)}
              disabled={!model.hasTimestampedScores}
              help={
                model.hasTimestampedScores || !hasAnyScores
                  ? undefined
                  : 'Recent windows need run timestamps from compare data.'
              }
            >
              {SCORE_DISTRIBUTION_TIME_PERIODS.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </DistributionSelect>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800/70 pt-3 text-xs">
            <span className="tabular-nums text-gray-400">
              Showing <span className="text-gray-200">{model.filteredScores}</span> of{' '}
              <span className="text-gray-200">{model.totalScores}</span> scores
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-gray-500 underline-offset-2 transition-colors hover:text-gray-300 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {model.buckets.length > 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-3">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={model.buckets} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
                <XAxis
                  dataKey="range"
                  tick={{ fill: COLORS.labelText, fontSize: 11 }}
                  axisLine={{ stroke: COLORS.gridLine }}
                />
                <YAxis
                  tick={{ fill: COLORS.labelText, fontSize: 11 }}
                  axisLine={{ stroke: COLORS.gridLine }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Tests" fill={COLORS.cyan} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ScoreDistributionEmptyState message={emptyMessage} />
        )}
      </div>
    </ChartSection>
  );
}

function DistributionSelect({
  id,
  label,
  value,
  onChange,
  disabled,
  help,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wider text-gray-500"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
      >
        {children}
      </select>
      {help && <p className="text-xs leading-5 text-gray-500">{help}</p>}
    </div>
  );
}

function ScoreDistributionEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/20 px-4 py-8 text-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

function scoreDistributionEmptyMessage(
  model: ReturnType<typeof buildScoreDistributionModel>,
  filters: ScoreDistributionFilters,
) {
  if (model.totalScores === 0) {
    return 'No test scores are available in this comparison yet.';
  }
  if (filters.category && !model.categoryAvailable) {
    return 'Category metadata is not available in these compare results.';
  }
  return 'No scores match the selected distribution filters.';
}

// ── 4. Trend over time ─────────────────────────────────────────────────

interface TrendPoint {
  date: string;
  [target: string]: number | string;
}

function buildTrendData(runs: CompareRunEntry[]): TrendPoint[] {
  if (runs.length === 0) return [];

  // Group runs by date (day granularity) and target
  const dateMap = new Map<string, Map<string, { scoreSum: number; count: number }>>();
  for (const run of runs) {
    const date = run.started_at.slice(0, 10); // YYYY-MM-DD
    let targetMap = dateMap.get(date);
    if (!targetMap) {
      targetMap = new Map();
      dateMap.set(date, targetMap);
    }
    let entry = targetMap.get(run.target);
    if (!entry) {
      entry = { scoreSum: 0, count: 0 };
      targetMap.set(run.target, entry);
    }
    entry.scoreSum += run.avg_score;
    entry.count++;
  }

  // Convert to array sorted by date
  const sortedDates = [...dateMap.keys()].sort();
  return sortedDates.map((date) => {
    const row: TrendPoint = { date };
    const targetMap = dateMap.get(date);
    if (!targetMap) return row;
    for (const [target, entry] of targetMap) {
      row[target] = Math.round((entry.scoreSum / entry.count) * 1000) / 1000;
    }
    return row;
  });
}

function TrendOverTime({ data, targets }: { data: TrendPoint[]; targets: string[] }) {
  return (
    <ChartSection title="Score Trend Over Time">
      <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-3">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis
              dataKey="date"
              tick={{ fill: COLORS.labelText, fontSize: 11 }}
              axisLine={{ stroke: COLORS.gridLine }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: COLORS.labelText, fontSize: 11 }}
              axisLine={{ stroke: COLORS.gridLine }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: COLORS.labelText }} />
            {targets.map((target, idx) => (
              <Line
                key={target}
                type="monotone"
                dataKey={target}
                stroke={targetColor(idx)}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartSection>
  );
}
