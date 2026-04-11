# Plan: Filter compare views by tag (issue #1041)

## Context

PR #1040 landed retroactive multi-valued **tags** on run workspaces (sidecar
`tags.json`) and surfaced them as chips in both the Aggregated matrix and the
Per-run compare table. Tags currently only *display* — users who run a bunch
of experiments and tag a subset (`v2-prompt`, `baseline`, …) still have to
manually de-select runs to see how a tagged cohort did.

Issue #1041 closes that loop: a chip row above the compare view that filters
**both** modes to runs carrying at least one of the selected tags
(OR semantics). No schema changes, no tag management UI, no new CLI commands —
just filter.

One material refinement vs. the issue body: **client-side re-aggregation**
instead of re-fetching from the backend on filter change. That keeps the tag
chip list stable (built from the unfiltered response), avoids network
round-trips on every chip click, and makes the UI snappier. The backend
`?tags=` filter is still implemented for API consumers per the acceptance
signals.

## Approach

### 1. Backend — `apps/cli/src/commands/results/serve.ts`

`handleCompare` already iterates per-run metadata and reads
`tagsEntry = readRunTags(m.path)` after aggregation. Move that read to the
**top** of the per-run loop and early-continue when a `?tags=` filter is
provided and the run's tags don't intersect.

OR semantics (industry default). No schema change, one early continue,
covers both `cells[]`, `runs[]`, `experiments[]`, and `targets[]` because
they're all built from the same run loop.

```ts
// At the top of handleCompare, parse filter
const tagsParam = c.req.query('tags') ?? '';
const filterTags = new Set(
  tagsParam.split(',').map((t) => t.trim()).filter(Boolean),
);

// In the run loop, BEFORE loadLightweightResults:
const tagsEntry = readRunTags(m.path);
if (filterTags.size > 0) {
  const runTags = tagsEntry?.tags ?? [];
  if (!runTags.some((t) => filterTags.has(t))) continue;
}
```

Reuse `tagsEntry` later when building `runEntries` (it's already read, just
hoisted). The benchmark-scoped endpoint routes through the same handler via
`withBenchmark`, so it gets the same filter for free.

### 2. Frontend — `apps/studio/src/components/CompareTab.tsx`

Filter lives **inside** `CompareTab` (local state). Data fetching in the
route wrappers (`routes/index.tsx`, `routes/projects/$benchmarkId.tsx`) stays
unchanged — we do not thread filter state into the React Query key.

- New `filterTags: string[]` state in `CompareTab`.
- Derive `allTags` / `tagCounts` from **unfiltered** `data.runs` so chips
  stay visible even when the filter would otherwise remove them.
- Re-aggregate cells/runs client-side from the filtered subset. Safe because
  the server already exposes per-run totals (`eval_count`, `passed_count`,
  `avg_score`) in each `CompareRunEntry`, so we sum weighted averages per
  `(experiment, target)` bucket.
- Pass `filteredData` down to `AggregatedView` and `PerRunView` in place of
  `data` — they don't need to know about filtering.
- New `TagFilterBar` rendered above the content switch (only when
  `allTags.length > 0`). Click toggles a tag; "Clear" link appears when any
  filter is active. Styling uses the existing cyan chip pattern.
- **Empty state** when the filter yields zero runs: `Notice` component grows
  an optional `action` prop (small additive change) so the user can clear
  the filter from the notice.

### 3. Semantics decision

**OR** — the issue recommends it, it's what Langfuse / W&B / GitHub Issues
do, and it's the easier-to-explain option for v1. Noted in a header hint
under the chip row: _"Showing runs with any selected tag"_.

### 4. Out of scope (per issue non-goals)

- No URL query-string persistence (filter state is purely local).
- No tag management UI.
- No AND semantics toggle.
- No promoting `tag` to a matrix dimension.

## Files to modify

| File | Change |
|---|---|
| `apps/cli/src/commands/results/serve.ts` | Hoist `readRunTags` in `handleCompare`; add `?tags=` early-continue filter. |
| `apps/studio/src/components/CompareTab.tsx` | Add `filterTags` state, `TagFilterBar` sub-component, client-side re-aggregation, filter empty-state Notice. |
| `apps/cli/test/commands/results/serve.test.ts` | New test cases: `/api/compare` with no filter, with single tag, with multiple tags OR, with non-matching filter (empty result). |
| `apps/web/src/content/docs/docs/tools/studio.mdx` | Replace the PR #1040 "filter by tag is tracked as #1041" paragraph with a short note about the new chip row. |

## Files NOT modified

- `apps/studio/src/lib/api.ts` — no new query keys or API wrappers (filter is client-side).
- `apps/studio/src/lib/types.ts` — no new types.
- `apps/studio/src/routes/index.tsx` / `routes/projects/$benchmarkId.tsx` — no prop changes.

## Verification

### Unit tests
1. `bun run test` — all must pass.
2. New tests in `serve.test.ts` cover backend filter semantics:
   - Unfiltered `/api/compare` returns all runs.
   - `/api/compare?tags=baseline` returns only runs tagged `baseline`.
   - `/api/compare?tags=baseline,v2` returns runs with EITHER tag (OR).
   - `/api/compare?tags=nonexistent` returns empty `cells[]` / `runs[]`.
   - Experiments/targets lists narrow to match filtered runs.

### Manual end-to-end UAT (required, BLOCKING per AGENTS.md)

Set up a 4-run synthetic fixture with a mix of tags. Start studio from
source:

```bash
bun apps/cli/src/cli.ts studio --port 9100 --single <fixture-dir>
cd apps/studio && bun run build  # rebuild frontend before UAT
```

Use `agent-browser --cdp 9222` to drive these flows:

1. **Red (before):** On `main`, confirm no filter row is rendered above the
   compare view.
2. **Green (after):** On this branch:
   - Tag chip row appears above the mode toggle, listing all distinct tags
     with counts.
   - Clicking a tag narrows both the Aggregated matrix and the Per-run
     table.
   - OR semantics across multiple chips.
   - "Clear" resets chips, matrix returns to full dataset.
   - Filter with no matches shows the _"No runs match …"_ notice with a
     working "Clear filter" button.
   - Flip between Aggregated and Per-run while filter is active — filter
     persists.
   - Tag edits via `TagsEditor` still work with a filter active.
3. **Backend filter check:** `curl` against the API directly to verify OR
   semantics and counts.

### Build gates
- `bun run build`, `bun run typecheck`, `bun run lint` — all green.
- Pre-push hook (`prek`) runs everything automatically on push.

### Final review
Spawn a code-review subagent AFTER e2e passes (per AGENTS.md ordering).
