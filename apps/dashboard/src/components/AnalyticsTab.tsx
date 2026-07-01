/**
 * Analytics tab — cross-model comparison view.
 *
 * Two modes:
 *   1. Aggregated (default)  — `(experiment, target)` matrix, one cell per pair.
 *   2. Per run               — individual runs are first-class; users select
 *                              2+ runs to render a side-by-side comparison.
 *
 * Styling matches the rest of AgentV Dashboard: dark gray surfaces
 * (`bg-gray-900` / `border-gray-800`), cyan accents for interactive elements,
 * emerald/yellow/red tones for pass rates. Reuses `PassRatePill` for pass-rate
 * rendering and the same table patterns as `ExperimentsTab` / `TargetsTab`.
 *
 * Backend contract:
 *   - `GET /api/compare`                → { cells, runs? }
 *
 * To extend with a new mode: add a value to `ViewMode`, a button in the mode
 * toggle, and a new body component in the content switch. Hooks in any new
 * sub-component must stay single-instance inside the mode switch so React's
 * hook order does not change across renders.
 */

import { useMemo, useState } from 'react';

import { aggregateQualityCount, executionErrorCount } from '~/lib/result-summary';
import type { CompareCell, CompareResponse, CompareRunEntry, CompareTestResult } from '~/lib/types';

import { AnalyticsCharts } from './AnalyticsCharts';
import { PassRatePill } from './PassRatePill';

interface AnalyticsTabProps {
  data: CompareResponse | undefined;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  /** Project scope. Undefined for the unscoped (root) compare view. */
  projectId?: string;
  /** Read-only mode. Reserved for surfaces that disable mutating actions. */
  readOnly?: boolean;
}

type ViewMode = 'aggregated' | 'per-run';

// ── Top-level container ─────────────────────────────────────────────────

export function AnalyticsTab({ data, isLoading, isError, error, projectId }: AnalyticsTabProps) {
  const [mode, setMode] = useState<ViewMode>('aggregated');

  const runsCount = data?.runs?.length ?? 0;
  const underlyingHasData = data && data.cells.length > 0;

  return (
    <div className="space-y-4">
      <Header mode={mode} onModeChange={setMode} runsCount={runsCount} />

      {isLoading && <LoadingSkeleton />}
      {!isLoading && isError && error && (
        <ErrorPanel message={`Failed to load comparison data: ${error.message}`} />
      )}
      {!isLoading && !isError && !underlyingHasData && <EmptyState />}
      {!isLoading && !isError && underlyingHasData && data && (
        <>
          {mode === 'aggregated' && <AggregatedView data={data} projectId={projectId} />}
          {mode === 'per-run' && <PerRunView data={data} />}
        </>
      )}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({
  mode,
  onModeChange,
  runsCount,
}: {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  runsCount: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-white">Analyze runs</h2>
        <p className="mt-1 text-sm text-gray-400">
          Study one experiment against another, or pit individual runs head-to-head.
        </p>
      </div>
      <ModeToggle mode={mode} onChange={onModeChange} runsCount={runsCount} />
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
  runsCount,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  runsCount: number;
}) {
  const perRunDisabled = runsCount === 0;
  return (
    <div
      role="tablist"
      aria-label="Comparison view mode"
      className="inline-flex items-center rounded-lg border border-gray-800 bg-gray-900/50 p-1"
    >
      <ModeButton active={mode === 'aggregated'} onClick={() => onChange('aggregated')}>
        Aggregated
      </ModeButton>
      <ModeButton
        active={mode === 'per-run'}
        onClick={() => onChange('per-run')}
        disabled={perRunDisabled}
        title={perRunDisabled ? 'No runs available' : undefined}
      >
        Per run
        {runsCount > 0 && (
          <span className="ml-1.5 rounded bg-gray-800 px-1.5 py-0.5 text-xs tabular-nums text-gray-400">
            {runsCount}
          </span>
        )}
      </ModeButton>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-gray-800 text-cyan-400 shadow-sm'
          : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600 disabled:hover:text-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

// ── Aggregated (matrix) view ────────────────────────────────────────────

function AggregatedView({ data, projectId }: { data: CompareResponse; projectId?: string }) {
  const { experiments, targets, cells } = data;

  // Hooks must run on every render regardless of the early-return below,
  // so this memo is declared before any conditional return. When you add a
  // new hook-using sub-path here, keep it above the guard.
  const cellMap = useMemo(() => {
    const map = new Map<string, CompareCell>();
    for (const cell of cells) {
      map.set(`${cell.experiment}::${cell.target}`, cell);
    }
    return map;
  }, [cells]);

  if (experiments.length <= 1 && targets.length <= 1) {
    return (
      <Notice
        headline="Not enough variation to compare"
        body={`The aggregated matrix requires at least 2 experiments or 2 targets. Currently ${experiments.length} experiment(s) and ${targets.length} target(s).`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Legend />
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-400">
                <span className="text-xs uppercase tracking-wider">Target ↓ / Experiment →</span>
              </th>
              {experiments.map((exp) => (
                <th key={exp} className="px-4 py-3 font-medium text-gray-300">
                  {exp}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {targets.map((target) => (
              <AggregatedRow
                key={target}
                target={target}
                experiments={experiments}
                cellMap={cellMap}
              />
            ))}
          </tbody>
        </table>
      </div>
      <AnalyticsCharts data={data} projectId={projectId} />
    </div>
  );
}

function AggregatedRow({
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
        const cell = cellMap.get(`${exp}::${target}`);
        return (
          <td key={exp} className="px-4 py-3">
            {cell ? <MatrixCell cell={cell} /> : <EmptyCell />}
          </td>
        );
      })}
    </tr>
  );
}

function MatrixCell({ cell }: { cell: CompareCell }) {
  const [expanded, setExpanded] = useState(false);
  const avgPct = Math.round(cell.avg_score * 100);
  const qualityCount = aggregateQualityCount(cell);
  const errors = executionErrorCount(cell);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="group flex w-full flex-col gap-1 rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2 text-left transition-colors hover:border-gray-700 hover:bg-gray-900/70"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <PassRatePill rate={cell.pass_rate} />
        <div className="flex items-center gap-2 text-xs tabular-nums text-gray-500">
          <span>
            <span className="text-emerald-400">{cell.passed_count}</span>
            <span className="text-gray-600"> / </span>
            <span>{qualityCount}</span>
          </span>
          <span className="text-gray-700">·</span>
          <span>avg {avgPct}%</span>
          {errors > 0 && (
            <>
              <span className="text-gray-700">·</span>
              <span className="text-amber-400">{errors} errors</span>
            </>
          )}
        </div>
      </button>
      {expanded && <TestBreakdown tests={cell.tests} />}
    </div>
  );
}

function EmptyCell() {
  return <div className="text-center text-gray-600">—</div>;
}

function TestBreakdown({ tests }: { tests: CompareTestResult[] }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
        Test cases
      </div>
      <ul className="space-y-1">
        {tests.map((t) => {
          const isError = t.execution_status === 'execution_error';
          return (
            <li key={t.test_id} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  isError ? 'bg-amber-400' : t.passed ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              <span className="flex-1 truncate text-gray-300" title={t.test_id}>
                {t.test_id}
              </span>
              <span
                className={`tabular-nums ${
                  isError ? 'text-amber-400' : t.passed ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {isError ? 'error' : `${Math.round(t.score * 100)}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Per-run view ────────────────────────────────────────────────────────

function PerRunView({ data }: { data: CompareResponse }) {
  const runs = data.runs ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showingCompare, setShowingCompare] = useState(false);

  const toggleSelect = (runId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectedRuns = useMemo(() => runs.filter((r) => selected.has(r.run_id)), [runs, selected]);

  if (runs.length === 0) {
    return <Notice headline="No runs yet" body="Run an evaluation to populate the per-run view." />;
  }

  if (showingCompare && selectedRuns.length >= 2) {
    return <PerRunCompareView runs={selectedRuns} onBack={() => setShowingCompare(false)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-gray-400">
        <span>
          <span className="font-medium text-gray-300">{runs.length}</span> run
          {runs.length === 1 ? '' : 's'} — select two or more to compare side-by-side
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="w-10 px-3 py-3" aria-label="Select" />
              <th className="px-4 py-3 font-medium text-gray-400">Timestamp</th>
              <th className="px-4 py-3 font-medium text-gray-400">Experiment</th>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Tests</th>
              <th className="px-4 py-3 font-medium text-gray-400">Pass Rate</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Avg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {runs.map((run) => (
              <PerRunRow
                key={run.run_id}
                run={run}
                checked={selected.has(run.run_id)}
                onToggle={() => toggleSelect(run.run_id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-cyan-900/50 bg-gray-900/95 px-4 py-3 shadow-xl backdrop-blur"
        >
          <div className="text-sm text-gray-300">
            <span className="font-semibold tabular-nums text-cyan-400">{selected.size}</span>{' '}
            selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={selected.size < 2}
              onClick={() => setShowingCompare(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
            >
              Compare {selected.size}
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PerRunRow({
  run,
  checked,
  onToggle,
}: {
  run: CompareRunEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  const avgPct = Math.round(run.avg_score * 100);
  const qualityCount = aggregateQualityCount(run);
  const errors = executionErrorCount(run);
  const subLabel = runSubLabel(run.run_id);

  return (
    <tr
      className={`transition-colors ${
        checked ? 'bg-cyan-950/20 hover:bg-cyan-950/30' : 'hover:bg-gray-900/30'
      }`}
    >
      <td className="px-3 py-3 align-middle">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer rounded border-gray-700 bg-gray-900 text-cyan-500 accent-cyan-500 focus:ring-cyan-500"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select run ${run.run_id}`}
        />
      </td>
      <td className="px-4 py-3 align-middle" title={run.run_id}>
        <div className="font-medium text-gray-200 tabular-nums">
          {formatTimestamp(run.started_at)}
        </div>
        {subLabel && <div className="text-xs text-gray-500">{subLabel}</div>}
      </td>
      <td className="px-4 py-3 align-middle text-gray-300">{run.experiment}</td>
      <td className="px-4 py-3 align-middle text-gray-300">{run.target}</td>
      <td className="px-4 py-3 align-middle text-right tabular-nums text-gray-400">
        <div>{qualityCount}</div>
        {errors > 0 && <div className="text-xs text-amber-400">{errors} errors</div>}
      </td>
      <td className="px-4 py-3 align-middle">
        <PassRatePill rate={run.pass_rate} />
      </td>
      <td className="px-4 py-3 align-middle text-right tabular-nums text-gray-400">{avgPct}%</td>
    </tr>
  );
}

function PerRunCompareView({
  runs,
  onBack,
}: {
  runs: CompareRunEntry[];
  onBack: () => void;
}) {
  // Collect all test ids across selected runs (stable order: first run's order, then any extras)
  const testIds = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const run of runs) {
      for (const t of run.tests) {
        if (!seen.has(t.test_id)) {
          seen.add(t.test_id);
          order.push(t.test_id);
        }
      }
    }
    return order;
  }, [runs]);

  const testLookup = useMemo(() => {
    return runs.map((run) => {
      const m = new Map<string, CompareTestResult>();
      for (const t of run.tests) m.set(t.test_id, t);
      return m;
    });
  }, [runs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-cyan-400 transition-colors hover:text-cyan-300"
        >
          <span aria-hidden>←</span> Back to runs
        </button>
        <span className="text-sm text-gray-500">
          {runs.length} runs · {testIds.length} tests
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-900/80 px-4 py-3 font-medium text-gray-400 backdrop-blur">
                Test case
              </th>
              {runs.map((run) => (
                <th key={run.run_id} className="px-4 py-3 align-bottom">
                  <RunColumnHeader run={run} />
                </th>
              ))}
            </tr>
            <tr className="border-t border-gray-800/50 bg-gray-900/30">
              <th className="sticky left-0 z-10 bg-gray-900/80 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 backdrop-blur">
                Pass rate
              </th>
              {runs.map((run) => (
                <th key={run.run_id} className="px-4 py-2">
                  <PassRatePill rate={run.pass_rate} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {testIds.map((tid) => (
              <tr key={tid} className="transition-colors hover:bg-gray-900/30">
                <td className="sticky left-0 z-10 bg-gray-950/70 px-4 py-3 font-medium text-gray-200 backdrop-blur">
                  {tid}
                </td>
                {testLookup.map((lookup, idx) => {
                  const t = lookup.get(tid);
                  const runId = runs[idx].run_id;
                  if (!t) {
                    return (
                      <td key={runId} className="px-4 py-3 text-center text-gray-600">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={runId} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {t.execution_status === 'execution_error' ? (
                          <>
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            <span className="tabular-nums text-amber-400">error</span>
                          </>
                        ) : (
                          <>
                            <span
                              aria-hidden
                              className={`h-1.5 w-1.5 rounded-full ${
                                t.passed ? 'bg-emerald-400' : 'bg-red-400'
                              }`}
                            />
                            <span
                              className={`tabular-nums ${
                                t.passed ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {Math.round(t.score * 100)}%
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunColumnHeader({ run }: { run: CompareRunEntry }) {
  return (
    <div className="min-w-[140px] space-y-1">
      <div className="text-sm font-medium text-gray-200 tabular-nums" title={run.run_id}>
        {formatTimestamp(run.started_at)}
      </div>
      <div className="text-xs text-gray-500">
        {run.experiment} · {run.target}
      </div>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-gray-500" role="note">
      <LegendSwatch className="bg-emerald-400" label="80%+" />
      <LegendSwatch className="bg-yellow-400" label="50–80%" />
      <LegendSwatch className="bg-red-400" label="< 50%" />
      <LegendSwatch className="bg-gray-700" label="no data" />
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}

function EmptyState() {
  return (
    <Notice
      headline="No comparison data yet"
      body="Run evaluations with different experiment and target combinations to populate this view."
    />
  );
}

function Notice({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
      <p className="text-lg text-gray-300">{headline}</p>
      <p className="mt-2 text-sm text-gray-500">{body}</p>
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

// ── Helpers ─────────────────────────────────────────────────────────────

/** Format an ISO timestamp for row / column display. */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${h}:${mi}`;
  } catch {
    return iso;
  }
}

/**
 * Derive a sub-label shown below the formatted timestamp in the per-run
 * compare view. Returns `null` when the run id is a plain timestamp —
 * the common case where the sub-label would just repeat what the
 * formatted timestamp already shows, adding visual noise.
 *
 * Run ids are built by `buildRunId` in `apps/cli/src/commands/inspect/
 * utils.ts` and optionally wrapped with `remote::` by
 * `encodeRemoteRunId` in `apps/cli/src/commands/results/remote.ts`, so
 * the shape is one of:
 *   - `2026-04-01T10-00-00-000Z`                   → null
 *   - `remote::2026-04-01T10-00-00-000Z`           → "remote"
 *
 * The full run id stays available via the `title` attribute on the
 * timestamp cell so keyboard / pointer users can always recover it.
 */
function runSubLabel(runId: string): string | null {
  const parts = runId.split('::');
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join(' · ');
}
