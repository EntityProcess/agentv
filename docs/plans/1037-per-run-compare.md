# Per-run comparison with retroactive labelling — Issue #1037

## Goal
Let Studio users compare individual runs (by timestamp / run id) side-by-side,
independent of the current `(experiment, target)` aggregation. Optional labels
replace timestamps in compare headers.

## Data model

### Sidecar label file
- Path: `<run-dir>/label.json` next to `index.jsonl`
- Content: `{ "label": string, "updated_at": string }`
- Mutable, non-breaking, trivially reversible. Absent file = no label.

### Wire format extension (non-breaking)
Extend `CompareResponse`:
```ts
interface CompareRunEntry {
  run_id: string;          // existing run id (experiment::timestamp or timestamp)
  started_at: string;      // first record timestamp (fallback: manifest meta)
  experiment: string;
  target: string;
  label?: string;
  eval_count: number;
  passed_count: number;
  pass_rate: number;
  avg_score: number;
  tests: CompareTestResult[];
}

interface CompareResponse {
  experiments: string[];
  targets: string[];
  cells: CompareCell[];       // unchanged
  runs: CompareRunEntry[];    // NEW
}
```

Extend `RunMeta` with optional `label?: string`.

## Backend changes — apps/cli/src/commands/results/serve.ts

1. `handleCompare` — after building cells, also build per-run entries.
   Each run file → compute eval_count, passed_count, pass_rate, avg_score,
   tests (cap 100). Read sidecar label.
2. `handleRuns` — already enriches RunMeta; add label sidecar lookup.
3. New `handleRunLabel` (PUT/POST) — writes `label.json`. Unscoped and
   benchmark-scoped variants.
4. New `handleRunLabelDelete` (DELETE) — removes `label.json`.

## Frontend changes

### Types — apps/studio/src/lib/types.ts
Extend `CompareResponse`, add `CompareRunEntry`, add `label?` to `RunMeta`.

### API hooks — apps/studio/src/lib/api.ts
- `saveRunLabel(runId, label, benchmarkId?)` — PUT mutation
- `deleteRunLabel(runId, benchmarkId?)` — DELETE mutation
- Invalidate `['compare']`, `['runs']`, `['benchmarks', id, 'compare']`

### CompareTab redesign — apps/studio/src/components/CompareTab.tsx

**Aesthetic direction: Editorial data-terminal**
- Display font: Fraunces (variable serif with optical sizing) — for headings
- Data font: JetBrains Mono Variable — tabular numbers, run ids, deltas
- Body: Inter-free. Use system-ui sparingly for secondary text, or DM Sans
- Palette: off-black (#0a0a0b) base, warm ivory (#f4ecd8) text, signal
  accents (emerald #10b981, amber #f59e0b, rose #f43f5e). Hairline dividers
  in warm gray (#2a2622).
- Layout: Asymmetric header (big serif title + mode toggle right-aligned).
  Sharp hairline rules. Tabular number columns. Generous vertical rhythm.
- Motion: Staggered fade-in on mount (CSS `@keyframes` with animation-delay).
  Hover brings subtle shadow+translate on selectable rows. Mode toggle
  slides underline indicator.

**Modes:**
1. **Aggregated** (default) — existing matrix, re-skinned with the new
   aesthetic. Unchanged logic.
2. **Per run** — runs table sorted by timestamp desc with:
   - Selectable checkbox (multi-select)
   - Columns: `timestamp | label | experiment | target | tests | pass | avg`
   - Inline "Edit label" button → popover/inline input
   - Sticky footer: "Compare N selected" button (enabled when N ≥ 2)
   - Opening compare view renders a side-by-side table: one column per run,
     using label or formatted timestamp. Reuses `CompareMatrixCell` rendering
     logic for per-test breakdown.

## Validation plan

1. Unit-ish: typecheck, lint, build.
2. Backend e2e: `bun apps/cli/src/cli.ts results serve --port 9100` on a
   benchmark with ≥2 runs of the same (experiment, target). Hit
   `/api/compare` and verify `runs[]` present. Hit `PUT /api/runs/:id/label`
   and verify sidecar file is written.
3. Frontend visual: agent-browser with `--cdp 9222` on http://localhost:5173
   (or wherever studio dev runs). Screenshot aggregated mode, per-run mode,
   label edit, compare view. Iterate on design until polished.

## Out of scope
- Eval YAML schema changes
- CLI flags
- Multi-label / tag taxonomy
- Cross-project run compare
