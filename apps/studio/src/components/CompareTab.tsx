/**
 * Cross-model comparison view.
 *
 * Two modes:
 *   1. Aggregated (default)  — `(experiment, target)` matrix, one cell per pair.
 *   2. Per run               — individual runs are first-class; users select
 *                              2+ runs to render a side-by-side comparison,
 *                              and may attach retroactive tags to any run.
 *
 * Styling matches the rest of AgentV Studio: dark gray surfaces
 * (`bg-gray-900` / `border-gray-800`), cyan accents for interactive elements,
 * emerald/yellow/red tones for pass rates. Reuses `PassRatePill` for pass-rate
 * rendering and the same table patterns as `ExperimentsTab` / `TargetsTab`.
 *
 * Backend contract:
 *   - `GET /api/compare`                → { cells, runs? }
 *   - `PUT /api/runs/:runId/tags`       → replaces sidecar tags.json
 *   - `DELETE /api/runs/:runId/tags`    → removes sidecar
 *
 * To extend with a new mode: add a value to `ViewMode`, a button in the mode
 * toggle, and a new body component in the content switch. Hooks in any new
 * sub-component must stay single-instance inside the mode switch so React's
 * hook order does not change across renders.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { deleteRunTagsApi, saveRunTagsApi } from '~/lib/api';
import type { CompareCell, CompareResponse, CompareRunEntry, CompareTestResult } from '~/lib/types';

import { PassRatePill } from './PassRatePill';

interface CompareTabProps {
  data: CompareResponse | undefined;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  /** Benchmark scope. Undefined for the unscoped (root) compare view. */
  benchmarkId?: string;
  /** Read-only mode disables tag editing. */
  readOnly?: boolean;
}

type ViewMode = 'aggregated' | 'per-run';

// ── Top-level container ─────────────────────────────────────────────────

export function CompareTab({
  data,
  isLoading,
  isError,
  error,
  benchmarkId,
  readOnly,
}: CompareTabProps) {
  const [mode, setMode] = useState<ViewMode>('aggregated');
  const runsCount = data?.runs?.length ?? 0;

  return (
    <div className="space-y-4">
      <Header mode={mode} onModeChange={setMode} runsCount={runsCount} />

      {isLoading && <LoadingSkeleton />}
      {!isLoading && isError && error && (
        <ErrorPanel message={`Failed to load comparison data: ${error.message}`} />
      )}
      {!isLoading && !isError && (!data || data.cells.length === 0) && <EmptyState />}
      {!isLoading && !isError && data && data.cells.length > 0 && (
        <>
          {mode === 'aggregated' && <AggregatedView data={data} />}
          {mode === 'per-run' && (
            <PerRunView data={data} benchmarkId={benchmarkId} readOnly={readOnly ?? false} />
          )}
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
        <h2 className="text-xl font-semibold text-white">Compare runs</h2>
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

function AggregatedView({ data }: { data: CompareResponse }) {
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
            <span>{cell.eval_count}</span>
          </span>
          <span className="text-gray-700">·</span>
          <span>avg {avgPct}%</span>
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
        {tests.map((t) => (
          <li key={t.test_id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${t.passed ? 'bg-emerald-400' : 'bg-red-400'}`}
            />
            <span className="flex-1 truncate text-gray-300" title={t.test_id}>
              {t.test_id}
            </span>
            <span className={`tabular-nums ${t.passed ? 'text-emerald-400' : 'text-red-400'}`}>
              {Math.round(t.score * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Per-run view ────────────────────────────────────────────────────────

function PerRunView({
  data,
  benchmarkId,
  readOnly,
}: {
  data: CompareResponse;
  benchmarkId?: string;
  readOnly: boolean;
}) {
  const runs = data.runs ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showingCompare, setShowingCompare] = useState(false);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);

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
              <th className="px-4 py-3 font-medium text-gray-400">Tags</th>
              <th className="px-4 py-3 font-medium text-gray-400">Experiment</th>
              <th className="px-4 py-3 font-medium text-gray-400">Target</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Tests</th>
              <th className="px-4 py-3 font-medium text-gray-400">Pass rate</th>
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
                editing={editingRunId === run.run_id}
                onStartEdit={() => setEditingRunId(run.run_id)}
                onEndEdit={() => setEditingRunId(null)}
                benchmarkId={benchmarkId}
                readOnly={readOnly}
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
  editing,
  onStartEdit,
  onEndEdit,
  benchmarkId,
  readOnly,
}: {
  run: CompareRunEntry;
  checked: boolean;
  onToggle: () => void;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  benchmarkId?: string;
  readOnly: boolean;
}) {
  const avgPct = Math.round(run.avg_score * 100);
  const canEdit = !readOnly && run.source !== 'remote';
  const tagsBtnRef = useRef<HTMLButtonElement>(null);
  const tags = run.tags ?? [];
  const runLabel = tags[0] ?? run.run_id;

  // Restore focus to the tags trigger button once the inline editor closes,
  // so keyboard users don't lose their place in the table.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing) {
      tagsBtnRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <>
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
            aria-label={`Select run ${runLabel}`}
          />
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="font-medium text-gray-200 tabular-nums">
            {formatTimestamp(run.started_at)}
          </div>
          <div className="text-xs text-gray-500 tabular-nums" title={run.run_id}>
            {shortenRunId(run.run_id)}
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          {canEdit ? (
            <button
              ref={tagsBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className={
                tags.length > 0
                  ? 'inline-flex flex-wrap items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-gray-800/60'
                  : 'rounded-md border border-dashed border-gray-700 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:border-cyan-800 hover:text-cyan-400'
              }
              aria-label={tags.length > 0 ? 'Edit tags' : 'Add tags'}
            >
              {tags.length > 0 ? (
                tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300"
                  >
                    {t}
                  </span>
                ))
              ) : (
                <>+ tags</>
              )}
            </button>
          ) : tags.length > 0 ? (
            <div className="inline-flex flex-wrap items-center gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </td>
        <td className="px-4 py-3 align-middle text-gray-300">{run.experiment}</td>
        <td className="px-4 py-3 align-middle text-gray-300">{run.target}</td>
        <td className="px-4 py-3 align-middle text-right tabular-nums text-gray-400">
          {run.eval_count}
        </td>
        <td className="px-4 py-3 align-middle">
          <PassRatePill rate={run.pass_rate} />
        </td>
        <td className="px-4 py-3 align-middle text-right tabular-nums text-gray-400">{avgPct}%</td>
      </tr>
      {editing && (
        <tr className="bg-gray-950/80">
          <td colSpan={8} className="px-4 py-3">
            <TagsEditor
              runId={run.run_id}
              currentTags={tags}
              benchmarkId={benchmarkId}
              onClose={onEndEdit}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Inline chip-based tag editor.
 *
 * Local state: a `string[]` staged edit of the run's tags. Chips show the
 * current staged tags; an input at the end accepts new tags (commit with
 * Enter or comma, delete the last chip with Backspace on an empty input).
 * Save persists the whole array; Cancel / Escape discards.
 *
 * The backend's `writeRunTags` handles deduplication, length limits, and
 * control-character rejection, so we only lightly normalize in the UI
 * (trim + skip duplicates already in the staged array).
 */
function TagsEditor({
  runId,
  currentTags,
  benchmarkId,
  onClose,
}: {
  runId: string;
  currentTags: string[];
  benchmarkId?: string;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const saveMut = useMutation({
    mutationFn: () => saveRunTagsApi(runId, tags, benchmarkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compare'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      if (benchmarkId) {
        qc.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'compare'] });
        qc.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'runs'] });
      }
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const clearMut = useMutation({
    mutationFn: () => deleteRunTagsApi(runId, benchmarkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compare'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      if (benchmarkId) {
        qc.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'compare'] });
        qc.invalidateQueries({ queryKey: ['benchmarks', benchmarkId, 'runs'] });
      }
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const busy = saveMut.isPending || clearMut.isPending;
  const hasChanges =
    tags.length !== currentTags.length || tags.some((t, i) => t !== currentTags[i]);

  const commitInput = () => {
    const trimmed = input.trim();
    if (trimmed === '') return;
    if (tags.includes(trimmed)) {
      setInput('');
      return;
    }
    setTags([...tags, trimmed]);
    setInput('');
    setErr(null);
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Tag run</span>
        <span className="text-xs text-gray-500">
          Multi-valued. Enter or comma adds; Backspace removes the last chip.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              disabled={busy}
              className="text-cyan-500 transition-colors hover:text-cyan-200 disabled:opacity-50"
              aria-label={`Remove tag ${t}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[140px] bg-transparent text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none disabled:opacity-50"
          placeholder={tags.length === 0 ? 'e.g. baseline, v2-prompt, slow' : 'Add tag…'}
          value={input}
          onChange={(e) => {
            setErr(null);
            setInput(e.target.value);
          }}
          maxLength={60}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commitInput();
            } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
              e.preventDefault();
              setTags(tags.slice(0, -1));
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          onBlur={commitInput}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
        {currentTags.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              clearMut.mutate();
            }}
            disabled={busy}
            className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-400 transition-colors hover:border-red-800 hover:bg-red-950/30 hover:text-red-300 disabled:opacity-50"
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          disabled={!hasChanges || busy}
          onClick={() => {
            if (busy || !hasChanges) return;
            saveMut.mutate();
          }}
          className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
        >
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs text-red-400">
          {err}
        </div>
      )}
    </div>
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
  const tags = run.tags ?? [];
  return (
    <div className="min-w-[140px] space-y-1">
      <div className="text-sm font-medium text-gray-200 tabular-nums" title={run.run_id}>
        {formatTimestamp(run.started_at)}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-md border border-cyan-900/60 bg-cyan-950/30 px-1.5 py-0.5 text-[0.7rem] font-medium text-cyan-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}
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

/** Abbreviate the run id for display (keeps the last segment). */
function shortenRunId(id: string): string {
  const parts = id.split('::');
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1];
    return tail.length > 22 ? `${tail.slice(0, 10)}…${tail.slice(-8)}` : tail;
  }
  return id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id;
}
