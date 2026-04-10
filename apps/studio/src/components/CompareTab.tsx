/**
 * Cross-model comparison view — "Editorial Data Terminal" aesthetic.
 *
 * Two modes:
 *   1. Aggregated (default)  — `(experiment, target)` matrix, one cell per pair.
 *   2. Per run               — individual runs are first-class; users select
 *                              2+ runs to render a side-by-side comparison,
 *                              and may attach a retroactive label to any run.
 *
 * The aesthetic is intentional: warm off-black background, antique gold rule
 * marks, serif display typography (Fraunces) paired with data-monospace
 * (JetBrains Mono). Styling is scoped to `[data-compare-root]` via an inline
 * <style> block so it does not bleed into other Studio surfaces.
 *
 * Backend contract:
 *   - `GET /api/compare`                → { cells, runs? }
 *   - `PUT /api/runs/:runId/label`      → writes sidecar label.json
 *   - `DELETE /api/runs/:runId/label`   → removes sidecar
 *
 * To extend with a new mode: add a value to `ViewMode`, a button in the mode
 * toggle, and a new body component in the content switch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { deleteRunLabelApi, saveRunLabelApi } from '~/lib/api';
import type { CompareCell, CompareResponse, CompareRunEntry, CompareTestResult } from '~/lib/types';

interface CompareTabProps {
  data: CompareResponse | undefined;
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  /** Benchmark scope. Undefined for the unscoped (root) compare view. */
  benchmarkId?: string;
  /** Read-only mode disables label editing. */
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

  return (
    <div data-compare-root className="compare-root relative isolate">
      <ScopedStyles />
      <Masthead mode={mode} onModeChange={setMode} hasRuns={(data?.runs?.length ?? 0) > 0} />

      <div className="compare-body">
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
    </div>
  );
}

// ── Masthead ────────────────────────────────────────────────────────────

function Masthead({
  mode,
  onModeChange,
  hasRuns,
}: {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  hasRuns: boolean;
}) {
  return (
    <header className="compare-masthead">
      <div className="compare-masthead-left">
        <div className="compare-eyebrow">
          <span className="compare-rule-mark" aria-hidden />
          Vol. IV · Side-by-side
        </div>
        <h1 className="compare-title">
          <span className="compare-title-word">Compare</span>
          <span className="compare-title-ornament">·</span>
          <em className="compare-title-italic">runs & rubrics</em>
        </h1>
        <p className="compare-kicker">
          Study one experiment against another, or pit individual runs head-to-head. Label any run
          to replace its timestamp in the columns below.
        </p>
      </div>
      <div className="compare-masthead-right">
        <div
          className="compare-mode-toggle"
          role="tablist"
          aria-label="Comparison view mode"
          data-mode={mode}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'aggregated'}
            className={`compare-mode-btn ${mode === 'aggregated' ? 'is-active' : ''}`}
            onClick={() => onModeChange('aggregated')}
          >
            <span className="compare-mode-num">01</span>
            <span className="compare-mode-label">Aggregated</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'per-run'}
            className={`compare-mode-btn ${mode === 'per-run' ? 'is-active' : ''}`}
            onClick={() => onModeChange('per-run')}
            disabled={!hasRuns}
            title={hasRuns ? undefined : 'No runs available yet'}
          >
            <span className="compare-mode-num">02</span>
            <span className="compare-mode-label">Per run</span>
          </button>
          <div className="compare-mode-indicator" aria-hidden />
        </div>
      </div>
    </header>
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
    <section className="compare-section compare-enter">
      <Legend />
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="compare-col-gutter" aria-hidden />
              <th className="compare-col-label">
                <span className="compare-smallcaps">Target ↓ / Experiment →</span>
              </th>
              {experiments.map((exp) => (
                <th key={exp} className="compare-col-head">
                  <span className="compare-col-head-text">{exp}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targets.map((target, rowIdx) => (
              <AggregatedRow
                key={target}
                rowIdx={rowIdx}
                target={target}
                experiments={experiments}
                cellMap={cellMap}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AggregatedRow({
  rowIdx,
  target,
  experiments,
  cellMap,
}: {
  rowIdx: number;
  target: string;
  experiments: string[];
  cellMap: Map<string, CompareCell>;
}) {
  return (
    <tr className="compare-row" style={{ animationDelay: `${rowIdx * 40}ms` }}>
      <td className="compare-col-gutter">
        <span className="compare-row-marker" aria-hidden />
      </td>
      <td className="compare-col-label">
        <span className="compare-target-name">{target}</span>
      </td>
      {experiments.map((exp) => {
        const cell = cellMap.get(`${exp}::${target}`);
        return (
          <td key={exp} className="compare-col-cell">
            {cell ? <MatrixCell cell={cell} /> : <EmptyCell />}
          </td>
        );
      })}
    </tr>
  );
}

function MatrixCell({ cell }: { cell: CompareCell }) {
  const [expanded, setExpanded] = useState(false);
  const passPct = Math.round(cell.pass_rate * 100);
  const avgPct = Math.round(cell.avg_score * 100);
  const tone = rateTone(cell.pass_rate);
  return (
    <div className="compare-cell-inner">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={`compare-cell-btn tone-${tone}`}
      >
        <div className="compare-cell-num-row">
          <span className="compare-cell-num">{passPct}</span>
          <span className="compare-cell-num-mark">%</span>
        </div>
        <div className="compare-cell-meta">
          <span>
            {cell.passed_count}/{cell.eval_count}
          </span>
          <span className="compare-dot" />
          <span>avg {avgPct}%</span>
        </div>
      </button>
      {expanded && <TestBreakdown tests={cell.tests} />}
    </div>
  );
}

function EmptyCell() {
  return <div className="compare-cell-empty">—</div>;
}

function TestBreakdown({ tests }: { tests: CompareTestResult[] }) {
  return (
    <div className="compare-breakdown">
      <div className="compare-breakdown-head">Test cases</div>
      <ul className="compare-breakdown-list">
        {tests.map((t) => (
          <li key={t.test_id} className={`compare-breakdown-row ${t.passed ? 'ok' : 'bad'}`}>
            <span className="compare-breakdown-glyph">{t.passed ? '●' : '◌'}</span>
            <span className="compare-breakdown-id" title={t.test_id}>
              {t.test_id}
            </span>
            <span className="compare-breakdown-score">{Math.round(t.score * 100)}%</span>
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
    <section className="compare-section compare-enter">
      <Legend />
      <div className="compare-runs-meta">
        <span className="compare-smallcaps">
          {runs.length} run{runs.length === 1 ? '' : 's'}
        </span>
        <span className="compare-dot-hair" />
        <span className="compare-hint">
          Select two or more runs, then compare them side-by-side. Click the label cell to retag.
        </span>
      </div>
      <div className="compare-table-wrap">
        <table className="compare-table compare-runs-table">
          <thead>
            <tr>
              <th className="compare-col-gutter" aria-hidden />
              <th className="compare-col-check" aria-label="Select" />
              <th className="compare-col-timestamp">
                <span className="compare-smallcaps">Timestamp</span>
              </th>
              <th className="compare-col-label-big">
                <span className="compare-smallcaps">Label</span>
              </th>
              <th className="compare-col-field">
                <span className="compare-smallcaps">Experiment</span>
              </th>
              <th className="compare-col-field">
                <span className="compare-smallcaps">Target</span>
              </th>
              <th className="compare-col-num">
                <span className="compare-smallcaps">Tests</span>
              </th>
              <th className="compare-col-num">
                <span className="compare-smallcaps">Pass</span>
              </th>
              <th className="compare-col-num">
                <span className="compare-smallcaps">Avg</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, idx) => (
              <PerRunRow
                key={run.run_id}
                run={run}
                rowIdx={idx}
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
        <output className="compare-stickybar">
          <div className="compare-stickybar-inner">
            <div className="compare-stickybar-count">
              <span className="compare-stickybar-num">{selected.size}</span>
              <span className="compare-stickybar-label">selected</span>
            </div>
            <div className="compare-stickybar-actions">
              <button type="button" className="compare-btn-ghost" onClick={clearSelection}>
                Clear
              </button>
              <button
                type="button"
                className="compare-btn-primary"
                disabled={selected.size < 2}
                onClick={() => setShowingCompare(true)}
              >
                <span>Compare {selected.size}</span>
                <span className="compare-btn-arrow" aria-hidden>
                  →
                </span>
              </button>
            </div>
          </div>
        </output>
      )}
    </section>
  );
}

function PerRunRow({
  run,
  rowIdx,
  checked,
  onToggle,
  editing,
  onStartEdit,
  onEndEdit,
  benchmarkId,
  readOnly,
}: {
  run: CompareRunEntry;
  rowIdx: number;
  checked: boolean;
  onToggle: () => void;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  benchmarkId?: string;
  readOnly: boolean;
}) {
  const passPct = Math.round(run.pass_rate * 100);
  const avgPct = Math.round(run.avg_score * 100);
  const tone = rateTone(run.pass_rate);
  const canEdit = !readOnly && run.source !== 'remote';

  return (
    <>
      <tr
        className={`compare-row compare-run-row ${checked ? 'is-selected' : ''}`}
        style={{ animationDelay: `${Math.min(rowIdx, 12) * 30}ms` }}
        tabIndex={0}
        onClick={(e) => {
          // Avoid toggling when clicking the label edit button or input
          const target = e.target as HTMLElement;
          if (target.closest('.compare-label-cell-btn') || target.closest('input')) return;
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td className="compare-col-gutter">
          <span className="compare-row-marker" aria-hidden />
        </td>
        <td className="compare-col-check">
          <label className="compare-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              aria-label={`Select run ${run.label ?? run.run_id}`}
            />
            <span className="compare-checkbox-box" />
          </label>
        </td>
        <td className="compare-col-timestamp">
          <span className="compare-timestamp-mono">{formatTimestamp(run.started_at)}</span>
          <span className="compare-runid-mono" title={run.run_id}>
            {shortenRunId(run.run_id)}
          </span>
        </td>
        <td className="compare-col-label-big">
          {canEdit ? (
            <button
              type="button"
              className={`compare-label-cell-btn ${run.label ? 'has-label' : 'no-label'}`}
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              aria-label={run.label ? 'Edit label' : 'Add label'}
            >
              {run.label ? (
                <span className="compare-label-text">{run.label}</span>
              ) : (
                <span className="compare-label-placeholder">+ label</span>
              )}
            </button>
          ) : run.label ? (
            <span className="compare-label-text">{run.label}</span>
          ) : (
            <span className="compare-label-placeholder-ro">—</span>
          )}
        </td>
        <td className="compare-col-field">
          <span className="compare-field-mono">{run.experiment}</span>
        </td>
        <td className="compare-col-field">
          <span className="compare-field-mono">{run.target}</span>
        </td>
        <td className="compare-col-num">
          <span className="compare-num-tabular">{run.eval_count}</span>
        </td>
        <td className="compare-col-num">
          <span className={`compare-num-tabular compare-num-tone-${tone}`}>{passPct}</span>
          <span className="compare-num-unit">%</span>
        </td>
        <td className="compare-col-num">
          <span className="compare-num-tabular">{avgPct}</span>
          <span className="compare-num-unit">%</span>
        </td>
      </tr>
      {editing && (
        <tr className="compare-label-editor-row">
          <td colSpan={9}>
            <LabelEditor
              runId={run.run_id}
              currentLabel={run.label}
              benchmarkId={benchmarkId}
              onClose={onEndEdit}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function LabelEditor({
  runId,
  currentLabel,
  benchmarkId,
  onClose,
}: {
  runId: string;
  currentLabel?: string;
  benchmarkId?: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(currentLabel ?? '');
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const saveMut = useMutation({
    mutationFn: () => saveRunLabelApi(runId, value, benchmarkId),
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
    mutationFn: () => deleteRunLabelApi(runId, benchmarkId),
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

  return (
    <div className="compare-label-editor">
      <div className="compare-label-editor-head">
        <span className="compare-smallcaps">Rename run</span>
        <span className="compare-hint-faint">
          Replaces the timestamp in compare column headers.
        </span>
      </div>
      <div className="compare-label-editor-body">
        <input
          ref={inputRef}
          type="text"
          className="compare-input"
          placeholder="e.g. baseline, v2-prompt, cold-start"
          value={value}
          onChange={(e) => {
            setErr(null);
            setValue(e.target.value);
          }}
          maxLength={120}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim() && !busy) saveMut.mutate();
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="compare-label-editor-actions">
          <button type="button" className="compare-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {currentLabel && (
            <button
              type="button"
              className="compare-btn-destructive"
              onClick={() => {
                if (busy) return;
                clearMut.mutate();
              }}
              disabled={busy}
            >
              Clear label
            </button>
          )}
          <button
            type="button"
            className="compare-btn-primary"
            disabled={!value.trim() || busy}
            onClick={() => {
              if (busy || !value.trim()) return;
              saveMut.mutate();
            }}
          >
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {err && <div className="compare-label-editor-err">{err}</div>}
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
    const maps: Array<Map<string, CompareTestResult>> = runs.map((run) => {
      const m = new Map<string, CompareTestResult>();
      for (const t of run.tests) m.set(t.test_id, t);
      return m;
    });
    return maps;
  }, [runs]);

  return (
    <section className="compare-section compare-enter">
      <div className="compare-backstrip">
        <button type="button" className="compare-btn-link" onClick={onBack}>
          ← Back to runs
        </button>
        <span className="compare-smallcaps">
          {runs.length} runs · {testIds.length} tests
        </span>
      </div>
      <div className="compare-table-wrap">
        <table className="compare-table compare-runs-compare-table">
          <thead>
            <tr>
              <th className="compare-col-gutter" aria-hidden />
              <th className="compare-col-testid">
                <span className="compare-smallcaps">Test case</span>
              </th>
              {runs.map((run) => (
                <th key={run.run_id} className="compare-col-run-head">
                  <RunColumnHeader run={run} />
                </th>
              ))}
            </tr>
            <tr className="compare-summary-row">
              <th className="compare-col-gutter" aria-hidden />
              <th className="compare-col-testid">
                <span className="compare-hint-faint">Pass rate</span>
              </th>
              {runs.map((run) => {
                const tone = rateTone(run.pass_rate);
                return (
                  <th key={`${run.run_id}-sum`} className="compare-col-run-head">
                    <div className={`compare-summary-pill tone-${tone}`}>
                      <span className="compare-summary-num">
                        {Math.round(run.pass_rate * 100)}%
                      </span>
                      <span className="compare-summary-frac">
                        {run.passed_count}/{run.eval_count}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {testIds.map((testId, idx) => (
              <tr
                key={testId}
                className="compare-row"
                style={{ animationDelay: `${Math.min(idx, 20) * 20}ms` }}
              >
                <td className="compare-col-gutter">
                  <span className="compare-row-marker" aria-hidden />
                </td>
                <td className="compare-col-testid">
                  <span className="compare-testid-mono" title={testId}>
                    {testId}
                  </span>
                </td>
                {testLookup.map((map, i) => {
                  const t = map.get(testId);
                  return (
                    <td key={`${runs[i].run_id}-${testId}`} className="compare-col-run-cell">
                      {t ? (
                        <div
                          className={`compare-runcell ${t.passed ? 'ok' : 'bad'}`}
                          title={`${Math.round(t.score * 100)}%`}
                        >
                          <span className="compare-runcell-glyph">{t.passed ? '●' : '◌'}</span>
                          <span className="compare-runcell-score">
                            {Math.round(t.score * 100)}%
                          </span>
                        </div>
                      ) : (
                        <span className="compare-runcell-missing">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunColumnHeader({ run }: { run: CompareRunEntry }) {
  return (
    <div className="compare-run-head">
      <div className="compare-run-head-top">
        {run.label ? (
          <span className="compare-run-head-label" title={run.run_id}>
            {run.label}
          </span>
        ) : (
          <span className="compare-run-head-timestamp" title={run.run_id}>
            {formatTimestamp(run.started_at)}
          </span>
        )}
      </div>
      <div className="compare-run-head-meta">
        <span>{run.experiment}</span>
        <span className="compare-dot-hair" />
        <span>{run.target}</span>
      </div>
      <div className="compare-run-head-subid" title={run.run_id}>
        {shortenRunId(run.run_id)}
      </div>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="compare-legend" role="note">
      <LegendSwatch tone="ok" label="80%+" />
      <LegendSwatch tone="warn" label="50–80%" />
      <LegendSwatch tone="bad" label="< 50%" />
      <LegendSwatch tone="none" label="no data" />
    </div>
  );
}

function LegendSwatch({ tone, label }: { tone: 'ok' | 'warn' | 'bad' | 'none'; label: string }) {
  return (
    <span className={`compare-legend-item tone-${tone}`}>
      <span className="compare-legend-swatch" aria-hidden />
      <span className="compare-legend-label">{label}</span>
    </span>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="compare-error">
      <div className="compare-error-eyebrow">Errata</div>
      <div className="compare-error-body">{message}</div>
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
    <div className="compare-notice">
      <div className="compare-notice-rule" aria-hidden />
      <h2 className="compare-notice-head">{headline}</h2>
      <p className="compare-notice-body">{body}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="compare-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="compare-skel-row" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="compare-skel-bar" />
          <div className="compare-skel-bar compare-skel-bar-sm" />
          <div className="compare-skel-bar compare-skel-bar-sm" />
        </div>
      ))}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function rateTone(rate: number): 'ok' | 'warn' | 'bad' {
  if (rate >= 0.8) return 'ok';
  if (rate >= 0.5) return 'warn';
  return 'bad';
}

/**
 * Format an ISO timestamp as a two-line mono-friendly string.
 * Returns the original string if parsing fails.
 */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} · ${h}:${mi}`;
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

// ── Scoped styles (Editorial Data Terminal aesthetic) ───────────────────

function ScopedStyles() {
  // The stylesheet is injected once per component mount via a <style> tag.
  // Scoped to `[data-compare-root]` so it does not leak into the rest of
  // Studio. Font imports are kept inside the block to avoid touching index.html.
  useEffect(() => {
    const id = 'compare-root-font-link';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,800;1,9..144,400;1,9..144,600&family=JetBrains+Mono:wght@400;500;700&family=Instrument+Sans:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  return <style>{STYLES}</style>;
}

const STYLES = `
[data-compare-root] {
  --cmp-bg: #0b0907;
  --cmp-bg-elev: #13110c;
  --cmp-bg-elev-2: #1a1712;
  --cmp-ink: #f6efe0;
  --cmp-ink-dim: #a89f89;
  --cmp-ink-faint: #6b6350;
  --cmp-rule: #2a2520;
  --cmp-rule-strong: #3e3830;
  --cmp-accent: #d4a84a;
  --cmp-accent-ink: #f5d47a;
  --cmp-ok: #a3e4b5;
  --cmp-ok-bg: rgba(132, 220, 148, 0.08);
  --cmp-ok-ring: rgba(132, 220, 148, 0.35);
  --cmp-warn: #f0c674;
  --cmp-warn-bg: rgba(240, 198, 116, 0.08);
  --cmp-warn-ring: rgba(240, 198, 116, 0.35);
  --cmp-bad: #f5a6a6;
  --cmp-bad-bg: rgba(245, 166, 166, 0.07);
  --cmp-bad-ring: rgba(245, 166, 166, 0.32);

  --cmp-font-display: "Fraunces", "Times New Roman", Georgia, serif;
  --cmp-font-data: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --cmp-font-body: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;

  position: relative;
  padding: 2.25rem 1.5rem 4rem;
  margin: -1rem -1rem 0;
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(212, 168, 74, 0.07), transparent 60%),
    radial-gradient(900px 500px at -10% 120%, rgba(120, 96, 40, 0.05), transparent 70%),
    var(--cmp-bg);
  color: var(--cmp-ink);
  font-family: var(--cmp-font-body);
  border-top: 1px solid var(--cmp-rule);
  border-bottom: 1px solid var(--cmp-rule);
  overflow: hidden;
}

[data-compare-root]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(rgba(246, 239, 224, 0.025) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.4;
  mix-blend-mode: screen;
}

[data-compare-root] .compare-body {
  position: relative;
  z-index: 1;
}

/* ── Masthead ───────────────────────────────────────────── */

[data-compare-root] .compare-masthead {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2rem;
  align-items: end;
  padding-bottom: 1.75rem;
  margin-bottom: 1.75rem;
  border-bottom: 1px solid var(--cmp-rule);
  z-index: 1;
}

[data-compare-root] .compare-masthead::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -4px;
  height: 1px;
  background: var(--cmp-rule);
}

[data-compare-root] .compare-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--cmp-font-data);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cmp-ink-dim);
  margin-bottom: 0.75rem;
}

[data-compare-root] .compare-rule-mark {
  display: inline-block;
  width: 28px;
  height: 1px;
  background: var(--cmp-accent);
  box-shadow: 0 0 8px rgba(212, 168, 74, 0.5);
}

[data-compare-root] .compare-title {
  font-family: var(--cmp-font-display);
  font-weight: 600;
  font-size: clamp(2.4rem, 4.5vw, 3.6rem);
  line-height: 0.95;
  letter-spacing: -0.02em;
  color: var(--cmp-ink);
  margin: 0;
  font-variation-settings: "opsz" 144;
}

[data-compare-root] .compare-title-word {
  display: inline-block;
}

[data-compare-root] .compare-title-ornament {
  display: inline-block;
  margin: 0 0.4rem;
  color: var(--cmp-accent);
  font-style: normal;
  transform: translateY(-0.1em);
}

[data-compare-root] .compare-title-italic {
  font-style: italic;
  color: var(--cmp-ink-dim);
  font-weight: 400;
}

[data-compare-root] .compare-kicker {
  max-width: 54ch;
  margin: 0.85rem 0 0;
  color: var(--cmp-ink-dim);
  font-size: 0.92rem;
  line-height: 1.55;
}

/* ── Mode toggle ────────────────────────────────────────── */

[data-compare-root] .compare-masthead-right {
  display: flex;
  align-items: end;
  justify-content: flex-end;
}

[data-compare-root] .compare-mode-toggle {
  position: relative;
  display: inline-flex;
  gap: 0;
  padding: 0.35rem;
  border: 1px solid var(--cmp-rule-strong);
  border-radius: 2px;
  background: var(--cmp-bg-elev);
}

[data-compare-root] .compare-mode-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 1rem 0.5rem;
  background: transparent;
  border: 0;
  color: var(--cmp-ink-dim);
  font-family: var(--cmp-font-body);
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 180ms ease;
  z-index: 1;
}

[data-compare-root] .compare-mode-btn:hover:not(:disabled) {
  color: var(--cmp-ink);
}

[data-compare-root] .compare-mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

[data-compare-root] .compare-mode-btn.is-active {
  color: var(--cmp-ink);
}

[data-compare-root] .compare-mode-num {
  font-family: var(--cmp-font-data);
  font-size: 0.68rem;
  color: var(--cmp-accent);
  opacity: 0.7;
}

[data-compare-root] .compare-mode-btn.is-active .compare-mode-num {
  opacity: 1;
}

[data-compare-root] .compare-mode-label {
  font-weight: 500;
}

[data-compare-root] .compare-mode-indicator {
  position: absolute;
  bottom: 0;
  left: 0.35rem;
  height: 2px;
  width: calc(50% - 0.35rem);
  background: var(--cmp-accent);
  box-shadow: 0 0 14px rgba(212, 168, 74, 0.6);
  transition: transform 320ms cubic-bezier(0.6, 0, 0.1, 1);
}

[data-compare-root] .compare-mode-toggle[data-mode="per-run"] .compare-mode-indicator {
  transform: translateX(100%);
}

/* ── Section + legend ───────────────────────────────────── */

[data-compare-root] .compare-section {
  position: relative;
}

[data-compare-root] .compare-enter {
  animation: compareEnter 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes compareEnter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

[data-compare-root] .compare-legend {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  margin-bottom: 1rem;
  padding: 0.55rem 0.85rem;
  border-left: 2px solid var(--cmp-accent);
  background: var(--cmp-bg-elev);
  font-size: 0.75rem;
  color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--cmp-font-data);
  letter-spacing: 0.08em;
}

[data-compare-root] .compare-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 1px;
  border: 1px solid currentColor;
  background: currentColor;
  opacity: 0.85;
}

[data-compare-root] .compare-legend-item.tone-ok { color: var(--cmp-ok); }
[data-compare-root] .compare-legend-item.tone-warn { color: var(--cmp-warn); }
[data-compare-root] .compare-legend-item.tone-bad { color: var(--cmp-bad); }
[data-compare-root] .compare-legend-item.tone-none {
  color: var(--cmp-ink-faint);
}
[data-compare-root] .compare-legend-item.tone-none .compare-legend-swatch {
  background: transparent;
  border: 1px dashed currentColor;
}

/* ── Runs meta strip ────────────────────────────────────── */

[data-compare-root] .compare-runs-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  color: var(--cmp-ink-dim);
  font-size: 0.8rem;
}

[data-compare-root] .compare-smallcaps {
  font-family: var(--cmp-font-data);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-hint {
  font-size: 0.82rem;
  color: var(--cmp-ink-dim);
  font-style: italic;
}

[data-compare-root] .compare-hint-faint {
  font-family: var(--cmp-font-body);
  font-size: 0.78rem;
  color: var(--cmp-ink-faint);
  font-style: italic;
}

[data-compare-root] .compare-dot-hair {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--cmp-ink-faint);
}

/* ── Tables ─────────────────────────────────────────────── */

[data-compare-root] .compare-table-wrap {
  position: relative;
  border: 1px solid var(--cmp-rule);
  background:
    linear-gradient(var(--cmp-bg-elev), var(--cmp-bg-elev));
  box-shadow: 0 1px 0 rgba(246, 239, 224, 0.04) inset;
  overflow-x: auto;
}

[data-compare-root] .compare-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--cmp-font-body);
  font-size: 0.88rem;
}

[data-compare-root] .compare-table thead tr {
  border-bottom: 1px solid var(--cmp-rule);
  background: rgba(246, 239, 224, 0.02);
}

[data-compare-root] .compare-table thead th {
  padding: 0.95rem 0.9rem 0.8rem;
  text-align: left;
  font-weight: 500;
  color: var(--cmp-ink-dim);
  vertical-align: bottom;
}

[data-compare-root] .compare-col-head {
  text-align: center;
}

[data-compare-root] .compare-col-head-text {
  font-family: var(--cmp-font-display);
  font-size: 1rem;
  font-style: italic;
  font-weight: 500;
  color: var(--cmp-ink);
  letter-spacing: 0.01em;
  display: inline-block;
  padding-bottom: 0.35rem;
  border-bottom: 1px dotted var(--cmp-accent);
}

[data-compare-root] .compare-table tbody tr {
  border-bottom: 1px solid rgba(42, 37, 32, 0.6);
  transition: background 180ms ease, transform 220ms ease;
}

[data-compare-root] .compare-table tbody tr:last-child {
  border-bottom: 0;
}

[data-compare-root] .compare-row {
  animation: rowEnter 440ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes rowEnter {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}

[data-compare-root] .compare-table tbody tr:hover {
  background: rgba(246, 239, 224, 0.035);
}

[data-compare-root] .compare-col-gutter {
  width: 18px;
  padding: 0;
  position: relative;
}

[data-compare-root] .compare-row-marker {
  display: block;
  width: 2px;
  height: 0;
  background: var(--cmp-accent);
  transform: translateX(6px);
  transition: height 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  position: absolute;
  top: 50%;
  left: 0;
  box-shadow: 0 0 10px rgba(212, 168, 74, 0.5);
}

[data-compare-root] .compare-table tbody tr:hover .compare-row-marker {
  height: 60%;
  transform: translate(6px, -50%);
}

[data-compare-root] .compare-run-row.is-selected .compare-row-marker {
  height: 70%;
  transform: translate(6px, -50%);
  background: var(--cmp-accent-ink);
}

[data-compare-root] .compare-col-label {
  padding: 1rem 1rem 1rem 0.25rem;
  white-space: nowrap;
}

[data-compare-root] .compare-target-name {
  font-family: var(--cmp-font-display);
  font-weight: 500;
  font-size: 1.02rem;
  color: var(--cmp-ink);
  letter-spacing: 0.005em;
}

[data-compare-root] .compare-col-cell {
  padding: 0.55rem 0.55rem;
  vertical-align: top;
  min-width: 140px;
}

/* ── Aggregated cells ───────────────────────────────────── */

[data-compare-root] .compare-cell-inner {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

[data-compare-root] .compare-cell-btn {
  width: 100%;
  padding: 0.85rem 0.9rem 0.75rem;
  background: var(--cmp-bg-elev-2);
  border: 1px solid var(--cmp-rule);
  border-left-width: 3px;
  color: var(--cmp-ink);
  cursor: pointer;
  text-align: center;
  font-family: var(--cmp-font-data);
  transition: background 180ms ease, border-color 180ms ease, transform 220ms ease;
  border-radius: 1px;
}

[data-compare-root] .compare-cell-btn:hover {
  background: rgba(246, 239, 224, 0.045);
  transform: translateY(-1px);
}

[data-compare-root] .compare-cell-btn.tone-ok { border-left-color: var(--cmp-ok); }
[data-compare-root] .compare-cell-btn.tone-warn { border-left-color: var(--cmp-warn); }
[data-compare-root] .compare-cell-btn.tone-bad { border-left-color: var(--cmp-bad); }

[data-compare-root] .compare-cell-num-row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15rem;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-cell-num {
  font-family: var(--cmp-font-display);
  font-size: 1.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

[data-compare-root] .compare-cell-btn.tone-ok .compare-cell-num { color: var(--cmp-ok); }
[data-compare-root] .compare-cell-btn.tone-warn .compare-cell-num { color: var(--cmp-warn); }
[data-compare-root] .compare-cell-btn.tone-bad .compare-cell-num { color: var(--cmp-bad); }

[data-compare-root] .compare-cell-num-mark {
  font-family: var(--cmp-font-data);
  font-size: 0.72rem;
  color: var(--cmp-ink-dim);
  letter-spacing: 0.05em;
}

[data-compare-root] .compare-cell-meta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.3rem;
  font-size: 0.7rem;
  color: var(--cmp-ink-dim);
  letter-spacing: 0.06em;
}

[data-compare-root] .compare-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--cmp-ink-faint);
}

[data-compare-root] .compare-cell-empty {
  padding: 1.45rem 0.5rem;
  text-align: center;
  border: 1px dashed var(--cmp-rule-strong);
  color: var(--cmp-ink-faint);
  font-family: var(--cmp-font-data);
}

[data-compare-root] .compare-breakdown {
  margin-top: 0.2rem;
  padding: 0.55rem 0.65rem;
  background: var(--cmp-bg);
  border: 1px solid var(--cmp-rule);
  max-height: 200px;
  overflow-y: auto;
}

[data-compare-root] .compare-breakdown-head {
  font-family: var(--cmp-font-data);
  font-size: 0.65rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--cmp-ink-faint);
  padding-bottom: 0.4rem;
  margin-bottom: 0.3rem;
  border-bottom: 1px solid var(--cmp-rule);
}

[data-compare-root] .compare-breakdown-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

[data-compare-root] .compare-breakdown-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.18rem 0.2rem;
  font-family: var(--cmp-font-data);
  font-size: 0.68rem;
  color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-breakdown-row.ok .compare-breakdown-glyph { color: var(--cmp-ok); }
[data-compare-root] .compare-breakdown-row.bad .compare-breakdown-glyph { color: var(--cmp-bad); }

[data-compare-root] .compare-breakdown-glyph {
  font-size: 0.75rem;
  line-height: 1;
}

[data-compare-root] .compare-breakdown-id {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-compare-root] .compare-breakdown-score {
  font-variant-numeric: tabular-nums;
  color: var(--cmp-ink-faint);
}

/* ── Per-run table ──────────────────────────────────────── */

[data-compare-root] .compare-runs-table .compare-col-check {
  width: 38px;
  padding-left: 0.35rem;
}

[data-compare-root] .compare-runs-table .compare-col-timestamp {
  width: 220px;
  padding: 0.85rem 0.9rem;
}

[data-compare-root] .compare-timestamp-mono {
  display: block;
  font-family: var(--cmp-font-data);
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--cmp-ink);
  font-variant-numeric: tabular-nums;
}

[data-compare-root] .compare-runid-mono {
  display: block;
  margin-top: 0.22rem;
  font-family: var(--cmp-font-data);
  font-size: 0.68rem;
  color: var(--cmp-ink-faint);
  letter-spacing: 0.04em;
}

[data-compare-root] .compare-col-label-big {
  min-width: 180px;
  padding: 0.85rem 0.9rem;
}

[data-compare-root] .compare-label-cell-btn {
  display: inline-block;
  padding: 0.3rem 0.55rem;
  background: transparent;
  border: 1px dashed var(--cmp-rule-strong);
  border-radius: 1px;
  color: var(--cmp-ink);
  cursor: pointer;
  font-family: var(--cmp-font-display);
  font-style: italic;
  font-size: 0.98rem;
  text-align: left;
  transition: all 180ms ease;
}

[data-compare-root] .compare-label-cell-btn:hover {
  border-color: var(--cmp-accent);
  background: rgba(212, 168, 74, 0.08);
}

[data-compare-root] .compare-label-cell-btn.has-label {
  border: 1px solid rgba(212, 168, 74, 0.4);
  background: rgba(212, 168, 74, 0.07);
  color: var(--cmp-accent-ink);
}

[data-compare-root] .compare-label-text {
  display: inline-block;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-compare-root] .compare-label-placeholder {
  color: var(--cmp-ink-faint);
  font-family: var(--cmp-font-data);
  font-style: normal;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

[data-compare-root] .compare-label-placeholder-ro {
  color: var(--cmp-ink-faint);
  font-family: var(--cmp-font-data);
}

[data-compare-root] .compare-col-field {
  padding: 0.85rem 0.9rem;
  white-space: nowrap;
}

[data-compare-root] .compare-field-mono {
  font-family: var(--cmp-font-data);
  font-size: 0.82rem;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-col-num {
  padding: 0.85rem 0.9rem;
  text-align: right;
  white-space: nowrap;
}

[data-compare-root] .compare-num-tabular {
  font-family: var(--cmp-font-data);
  font-variant-numeric: tabular-nums;
  font-size: 1.02rem;
  font-weight: 500;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-num-tone-ok { color: var(--cmp-ok); }
[data-compare-root] .compare-num-tone-warn { color: var(--cmp-warn); }
[data-compare-root] .compare-num-tone-bad { color: var(--cmp-bad); }

[data-compare-root] .compare-num-unit {
  font-family: var(--cmp-font-data);
  font-size: 0.7rem;
  color: var(--cmp-ink-faint);
  margin-left: 0.12rem;
}

/* Checkbox */

[data-compare-root] .compare-checkbox {
  position: relative;
  display: inline-block;
  width: 18px;
  height: 18px;
  cursor: pointer;
}

[data-compare-root] .compare-checkbox input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

[data-compare-root] .compare-checkbox-box {
  position: absolute;
  inset: 0;
  border: 1px solid var(--cmp-rule-strong);
  background: var(--cmp-bg);
  transition: all 180ms ease;
}

[data-compare-root] .compare-checkbox input:checked ~ .compare-checkbox-box {
  background: var(--cmp-accent);
  border-color: var(--cmp-accent);
  box-shadow: 0 0 12px rgba(212, 168, 74, 0.6);
}

[data-compare-root] .compare-checkbox input:checked ~ .compare-checkbox-box::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 0px;
  width: 5px;
  height: 10px;
  border-right: 2px solid var(--cmp-bg);
  border-bottom: 2px solid var(--cmp-bg);
  transform: rotate(45deg);
}

[data-compare-root] .compare-run-row {
  cursor: pointer;
}

[data-compare-root] .compare-run-row.is-selected {
  background: rgba(212, 168, 74, 0.05) !important;
}

[data-compare-root] .compare-run-row.is-selected td {
  color: var(--cmp-ink);
}

/* Label editor row */

[data-compare-root] .compare-label-editor-row {
  background: var(--cmp-bg) !important;
}

[data-compare-root] .compare-label-editor-row td {
  padding: 0;
}

[data-compare-root] .compare-label-editor {
  margin: 0 0 0 18px;
  padding: 0.85rem 1rem 1rem;
  border-left: 2px solid var(--cmp-accent);
  background: var(--cmp-bg-elev-2);
  animation: labelEditorIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes labelEditorIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

[data-compare-root] .compare-label-editor-head {
  display: flex;
  align-items: baseline;
  gap: 0.85rem;
  margin-bottom: 0.55rem;
}

[data-compare-root] .compare-label-editor-body {
  display: flex;
  gap: 0.65rem;
  align-items: stretch;
}

[data-compare-root] .compare-input {
  flex: 1;
  min-width: 0;
  padding: 0.55rem 0.75rem;
  background: var(--cmp-bg);
  border: 1px solid var(--cmp-rule-strong);
  color: var(--cmp-ink);
  font-family: var(--cmp-font-display);
  font-style: italic;
  font-size: 1rem;
  outline: none;
  transition: border-color 180ms ease, box-shadow 180ms ease;
  border-radius: 1px;
}

[data-compare-root] .compare-input:focus {
  border-color: var(--cmp-accent);
  box-shadow: 0 0 0 3px rgba(212, 168, 74, 0.15);
}

[data-compare-root] .compare-label-editor-actions {
  display: inline-flex;
  gap: 0.45rem;
}

[data-compare-root] .compare-label-editor-err {
  margin-top: 0.55rem;
  font-family: var(--cmp-font-data);
  font-size: 0.75rem;
  color: var(--cmp-bad);
}

/* Buttons */

[data-compare-root] .compare-btn-primary,
[data-compare-root] .compare-btn-ghost,
[data-compare-root] .compare-btn-destructive,
[data-compare-root] .compare-btn-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.05rem;
  font-family: var(--cmp-font-body);
  font-size: 0.8rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 1px;
  transition: all 200ms ease;
  white-space: nowrap;
}

[data-compare-root] .compare-btn-primary {
  background: var(--cmp-accent);
  color: var(--cmp-bg);
  border: 1px solid var(--cmp-accent);
  font-weight: 600;
}

[data-compare-root] .compare-btn-primary:hover:not(:disabled) {
  background: var(--cmp-accent-ink);
  border-color: var(--cmp-accent-ink);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(212, 168, 74, 0.25);
}

[data-compare-root] .compare-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

[data-compare-root] .compare-btn-arrow {
  font-family: var(--cmp-font-data);
  font-size: 0.95rem;
  line-height: 1;
}

[data-compare-root] .compare-btn-ghost {
  background: transparent;
  color: var(--cmp-ink-dim);
  border: 1px solid var(--cmp-rule-strong);
}

[data-compare-root] .compare-btn-ghost:hover:not(:disabled) {
  color: var(--cmp-ink);
  border-color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-btn-destructive {
  background: transparent;
  color: var(--cmp-bad);
  border: 1px solid rgba(245, 166, 166, 0.35);
}

[data-compare-root] .compare-btn-destructive:hover:not(:disabled) {
  background: rgba(245, 166, 166, 0.1);
  border-color: var(--cmp-bad);
}

[data-compare-root] .compare-btn-link {
  background: transparent;
  color: var(--cmp-accent-ink);
  border: 0;
  padding: 0.4rem 0;
  text-transform: none;
  letter-spacing: 0.01em;
  font-family: var(--cmp-font-display);
  font-size: 1rem;
  font-style: italic;
}

[data-compare-root] .compare-btn-link:hover {
  color: var(--cmp-accent);
}

/* Sticky action bar */

[data-compare-root] .compare-stickybar {
  position: sticky;
  bottom: 16px;
  margin-top: 1.25rem;
  z-index: 5;
  animation: stickyIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes stickyIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

[data-compare-root] .compare-stickybar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1.1rem;
  background:
    linear-gradient(var(--cmp-bg-elev-2), var(--cmp-bg-elev-2));
  border: 1px solid rgba(212, 168, 74, 0.4);
  box-shadow:
    0 20px 40px -12px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(212, 168, 74, 0.12),
    inset 0 1px 0 rgba(246, 239, 224, 0.03);
}

[data-compare-root] .compare-stickybar-count {
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
}

[data-compare-root] .compare-stickybar-num {
  font-family: var(--cmp-font-display);
  font-weight: 600;
  font-size: 2rem;
  color: var(--cmp-accent);
  line-height: 1;
}

[data-compare-root] .compare-stickybar-label {
  font-family: var(--cmp-font-data);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-stickybar-actions {
  display: inline-flex;
  gap: 0.55rem;
}

/* ── Per-run compare view ───────────────────────────────── */

[data-compare-root] .compare-backstrip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--cmp-rule);
}

[data-compare-root] .compare-runs-compare-table .compare-col-testid {
  position: sticky;
  left: 0;
  background: var(--cmp-bg-elev);
  padding: 0.85rem 0.9rem;
  border-right: 1px solid var(--cmp-rule);
  min-width: 280px;
  max-width: 360px;
  z-index: 2;
}

[data-compare-root] .compare-testid-mono {
  font-family: var(--cmp-font-data);
  font-size: 0.82rem;
  color: var(--cmp-ink);
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}

[data-compare-root] .compare-col-run-head {
  min-width: 180px;
  padding: 1rem 0.9rem;
  text-align: left;
  border-left: 1px dotted var(--cmp-rule);
}

[data-compare-root] .compare-run-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

[data-compare-root] .compare-run-head-top {
  font-family: var(--cmp-font-display);
  font-style: italic;
  font-size: 1.1rem;
  color: var(--cmp-ink);
  line-height: 1.2;
}

[data-compare-root] .compare-run-head-label {
  color: var(--cmp-accent-ink);
}

[data-compare-root] .compare-run-head-timestamp {
  font-family: var(--cmp-font-data);
  font-style: normal;
  font-size: 0.9rem;
  color: var(--cmp-ink);
  font-variant-numeric: tabular-nums;
}

[data-compare-root] .compare-run-head-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--cmp-font-data);
  font-size: 0.72rem;
  color: var(--cmp-ink-dim);
}

[data-compare-root] .compare-run-head-subid {
  font-family: var(--cmp-font-data);
  font-size: 0.65rem;
  color: var(--cmp-ink-faint);
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

[data-compare-root] .compare-summary-row {
  background: rgba(246, 239, 224, 0.015) !important;
  border-bottom: 2px solid var(--cmp-rule-strong) !important;
}

[data-compare-root] .compare-summary-row th {
  padding: 0.55rem 0.9rem 0.7rem;
  vertical-align: middle;
}

[data-compare-root] .compare-summary-pill {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--cmp-rule-strong);
  border-left-width: 3px;
  background: var(--cmp-bg);
  font-family: var(--cmp-font-data);
}

[data-compare-root] .compare-summary-pill.tone-ok { border-left-color: var(--cmp-ok); }
[data-compare-root] .compare-summary-pill.tone-warn { border-left-color: var(--cmp-warn); }
[data-compare-root] .compare-summary-pill.tone-bad { border-left-color: var(--cmp-bad); }

[data-compare-root] .compare-summary-num {
  font-weight: 600;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-summary-frac {
  font-size: 0.72rem;
  color: var(--cmp-ink-faint);
}

[data-compare-root] .compare-col-run-cell {
  padding: 0.5rem 0.9rem;
  border-left: 1px dotted rgba(42, 37, 32, 0.5);
}

[data-compare-root] .compare-runcell {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.28rem 0.55rem;
  border-radius: 1px;
  font-family: var(--cmp-font-data);
}

[data-compare-root] .compare-runcell.ok {
  background: var(--cmp-ok-bg);
  color: var(--cmp-ok);
}

[data-compare-root] .compare-runcell.bad {
  background: var(--cmp-bad-bg);
  color: var(--cmp-bad);
}

[data-compare-root] .compare-runcell-glyph {
  font-size: 0.68rem;
  line-height: 1;
}

[data-compare-root] .compare-runcell-score {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

[data-compare-root] .compare-runcell-missing {
  color: var(--cmp-ink-faint);
  font-family: var(--cmp-font-data);
}

/* ── Notices / errors / skeleton ────────────────────────── */

[data-compare-root] .compare-notice {
  position: relative;
  padding: 2rem 1.5rem 2rem 2.5rem;
  border: 1px solid var(--cmp-rule);
  background: var(--cmp-bg-elev);
}

[data-compare-root] .compare-notice-rule {
  position: absolute;
  left: 1rem;
  top: 2rem;
  width: 30px;
  height: 1px;
  background: var(--cmp-accent);
}

[data-compare-root] .compare-notice-head {
  font-family: var(--cmp-font-display);
  font-style: italic;
  font-size: 1.5rem;
  font-weight: 500;
  margin: 0 0 0.4rem;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-notice-body {
  margin: 0;
  color: var(--cmp-ink-dim);
  max-width: 60ch;
  line-height: 1.55;
}

[data-compare-root] .compare-error {
  padding: 1.3rem 1.5rem;
  border: 1px solid rgba(245, 166, 166, 0.35);
  background: rgba(245, 166, 166, 0.05);
  color: var(--cmp-bad);
}

[data-compare-root] .compare-error-eyebrow {
  font-family: var(--cmp-font-data);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--cmp-bad);
  margin-bottom: 0.4rem;
  opacity: 0.85;
}

[data-compare-root] .compare-error-body {
  font-family: var(--cmp-font-display);
  font-style: italic;
  font-size: 1.05rem;
  color: var(--cmp-ink);
}

[data-compare-root] .compare-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.5rem;
  border: 1px solid var(--cmp-rule);
  background: var(--cmp-bg-elev);
}

[data-compare-root] .compare-skel-row {
  display: flex;
  gap: 0.85rem;
  animation: skelPulse 1400ms ease-in-out infinite;
}

@keyframes skelPulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.75; }
}

[data-compare-root] .compare-skel-bar {
  height: 22px;
  flex: 1;
  background: linear-gradient(
    90deg,
    var(--cmp-rule) 0%,
    var(--cmp-rule-strong) 50%,
    var(--cmp-rule) 100%
  );
}

[data-compare-root] .compare-skel-bar-sm {
  flex: 0 0 120px;
}

/* Responsive tweaks */

@media (max-width: 820px) {
  [data-compare-root] .compare-masthead {
    grid-template-columns: 1fr;
    align-items: start;
  }
  [data-compare-root] .compare-masthead-right {
    justify-content: flex-start;
  }
  [data-compare-root] .compare-title {
    font-size: 2.2rem;
  }
}
`;
