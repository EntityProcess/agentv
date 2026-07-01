# Dashboard "Tags" Tab — Brainstorm / Design

Status: brainstorm (decision-oriented, not a plan)
Date: 2026-07-01
Scope: rename the Dashboard "Experiments" tab to "Tags" and let the user pick which tag key drives grouping/comparison. `experiment` becomes one key in a promptfoo-shaped `tags` map rather than a privileged first-class concept.

---

## Operator decisions (2026-07-01) — supersede §2/§7 where they conflict

- **Remove the legacy manual `tags.json` chips entirely** rather than rename them to "Labels". There is only one tags concept: the promptfoo `tags` map. This deletes the manual `string[]` sidecar and all its surface: `tags.json` read/write, remote/pending tag sync, the editable-chips UI, the compare `?tags=` filter, and the `RunMeta.tags`/`remote_tags`/`pending_tags` + `RunFinalState.tags` + `CompareRunEntry.tags` wire fields. With the manual concept gone, the §2 naming collision disappears (no "Labels" rename, no `?tags=`→`?labels=`).
- **Phase 1 = Option A** (tag-key selector regrouping the table; `experiment` default key). Faceted filters and arbitrary-key compare grouping stay phase 2.

---

## 1. Problem statement & current behavior

Today the Dashboard has a first-class **Experiments** tab that groups runs purely on the per-row `experiment` **string**. A recently merged feature makes runs also write a promptfoo-shaped `tags` **map** (`Record<string,string>`, including an `experiment` key), but the Dashboard ignores that map entirely. The goal is to generalize: group/compare by *any* tag key (`experiment`, `team`, `env`, `model`, arbitrary user keys), with `experiment` as just the default-selected key.

Current wiring (verified):

- Tab declaration: `apps/dashboard/src/routes/index.tsx:48-53` (`{ id: 'experiments', label: '🧪 Experiments' }`), rendered at `index.tsx:368` (`{activeTab === 'experiments' && <ExperimentsTab />}`).
- Grouping table: `apps/dashboard/src/components/ExperimentsTab.tsx` — reads `data.experiments` (`ExperimentSummary[]`), rows keyed on `exp.name`, links to `/experiments/$experimentName` (lines 47-108).
- Detail view: `apps/dashboard/src/components/ExperimentDetail.tsx:48-51` — finds the summary by `entry.name === experimentName` and filters runs with `(run.experiment ?? 'default') === experimentName`. Grouping is on the run's `experiment` string, not tags.
- Routes: `apps/dashboard/src/routes/experiments/$experimentName.tsx` and `apps/dashboard/src/routes/projects/$projectId_/experiments/$experimentName.tsx`.
- Data loading: `apps/dashboard/src/lib/api.ts:201-204` (`experimentsOptions` → `GET /api/experiments`) and `api.ts:634-638` (`projectExperimentsOptions` → `GET {projectApiBase}/experiments`). Types `ExperimentSummary` / `ExperimentsResponse` at `apps/dashboard/src/lib/types.ts:356-370`.
- Server grouping: `handleExperiments` in `apps/cli/src/commands/results/serve.ts:2370-2432`. It reads only `r.experiment ?? 'default'` (`serve.ts:2390`) from lightweight records; the promptfoo `tags` map is never consulted. The compare handler is the same story — `handleCompare` groups on `r.experiment` at `serve.ts:2523-2527` and (importantly) already uses the *other* "tags" for filtering (see §2).

**The blocking data-plumbing fact:** the server groups off `LightweightResultRecord`, whose type (`apps/cli/src/commands/results/manifest.ts:310-325`) and loader (`loadLightweightResults`, `manifest.ts:327-346`) expose `experiment` but have **no `tags` field**. So even though each JSONL row carries a `tags` map on disk, the Dashboard's lightweight path drops it before `handleExperiments`/`handleCompare` ever see it. Any Tags-tab work that groups by an arbitrary key must first thread the `tags` map through this loader.

Artifact source of truth (verified in core):

- `summary.json` `metadata.tags` (`Record<string,string>`) is written via `aggregateRunDir` → `buildRunSummaryArtifact` in `packages/core/src/evaluation/run-artifacts.ts` (`tags` option threaded at `run-artifacts.ts:168,180,190`; round-tripped through `readRunSummaryMetadata` at `run-artifacts.ts:245-258`).
- Each `index.jsonl` row carries `experiment` (string) and `tags` (`Record<string,string>`): the `ResultIndexArtifact` type declares both at `run-artifacts.ts:477,479`, and `writePerTestArtifacts` writes each row with `experiment: options?.experiment` and `...(resolvedTags ? { tags: resolvedTags } : {})` at `run-artifacts.ts:2351-2371` (row push at `2369-2370`).
- Lockstep: the run-level `experiment` namespace is derived from the `tags` map's reserved `experiment` key (`run-artifacts.ts:435-439` — "The reserved key `experiment` feeds the experiment namespace"; `experiment_namespace_source: 'tags'` at `run-artifacts.ts:82,310`). The equality is actively enforced at run time by `syncTagsExperiment` (`apps/cli/src/commands/eval/run-eval.ts:~404-424`) with precedence resolved by `resolveExperimentNamespace` (CLI `--experiment` > `tags.experiment` > eval defaults, `run-eval.ts:~426-461`), so the top-level `experiment` field and `tags.experiment` stay equal. The Dashboard-side resolution should therefore read `record.experiment ?? record.tags?.experiment`.
- Confirmed drop point: neither `ResultManifestRecord` (`manifest.ts:25-76`) nor `LightweightResultRecord` (`manifest.ts:310-325`) declares `tags`, and the core row normalizer (`packages/core/src/evaluation/result-row-schema.ts:~189-221`) has no `tags` alias — the map is present in the raw JSONL but dropped by the CLI parse layer before any handler sees it. This is exactly the plumbing §4 must fix.

---

## 2. The "two tags" collision (must be resolved before any UI work)

There are **two unrelated concepts both named "tags"** in the Dashboard. This is the single biggest source of confusion for this feature and must be named apart in the UI.

| | promptfoo tags **map** | manual `tags.json` **chips** |
|---|---|---|
| Shape | `Record<string,string>` (e.g. `{experiment: "v2", team: "core", env: "ci"}`) | `string[]` (e.g. `["baseline", "flaky"]`) |
| Origin | Authored in eval/project config; resolved at run time; written into `summary.json`/`index.jsonl` | User-assigned in the Dashboard, stored in a per-run `tags.json` sidecar |
| Purpose | Structured facets to group/compare runs by (the subject of this brainstorm) | Free-form labels to filter/annotate runs |
| Server surface | Currently **ignored** by the Dashboard | `RunTagFields` / `readRunTagFields` (`serve.ts:1242-1249,1266-1299`); used as the `?tags=` OR-filter in `handleCompare` (`serve.ts:2503-2509`); surfaced on `RunMeta.tags`/`remote_tags`/`pending_tags` (`types.ts:45-52`) and `RunFinalState.tags` (`types.ts:66-69`) |
| Editability | Read-only (derived from config) | Editable + syncs to remote results repo |

**Recommended naming reconciliation:**

- Rename the new grouping concept to **"Tags"** in the tab, and consistently call the map keys **tag keys** and the values **tag values**. This is the promptfoo-native vocabulary and matches the map on disk.
- Rename the existing manual `string[]` sidecar concept in the **UI** to **"Labels"** (chips), even though the on-disk file stays `tags.json` and the wire fields stay `tags`/`remote_tags`/`pending_tags` for backward compatibility. Do the rename at the presentation layer only; do not churn the wire format.
  - Alternative if "Labels" is too invasive: keep calling them "tags" but always render them as removable chips on a run and never expose them in the Tags-tab grouping UI, so the two never appear in the same control. The map is "group by", the chips are "filter/annotate". This is weaker — the shared word will still confuse — so **prefer the "Labels" rename**.
- Document the distinction in `CONCEPTS.md` (map = "tags", chips = "labels/run labels") so future work doesn't re-collide them.

Open question for the operator: is renaming the sidecar chips to "Labels" acceptable, or is "tags" load-bearing in user muscle memory / docs? (See §7.)

---

## 3. Design options for the Tags tab

### Option A — Tag-key selector dropdown drives a single grouping table (recommended)
A dropdown at the top of the tab lists the tag keys present across all runs (union of every row's `tags` map keys, plus a synthetic `experiment`). Selecting a key regroups the existing table by that key's values. Default selection: `experiment`.

- Pros: smallest UI delta from today's Experiments table; one mental model ("group by this key"); reuses the entire existing table/detail/pass-rate layout; graceful for old runs (only `experiment` key appears).
- Cons: single-key only (no cross-tabulation); requires the server to enumerate available keys.

### Option B — Faceted multi-key filter + grouping
User picks a **group-by** key *and* optional **filter** facets (e.g. group by `model`, filter `env=ci`). Table shows the group-by values; facet chips narrow the population.
- Pros: powerful; matches how people actually slice eval results; composes with the existing `?tags=` label filter.
- Cons: much bigger UI + server surface; risk of over-building before we know users want cross-facet slicing (YAGNI). Better as a phase-2 layer on top of A.

### Option C — Keep "Experiments" as a pinned default view, add a general Tags view alongside
Two entry points: the familiar Experiments table (pinned to `tags.experiment`) plus a general Tags explorer.
- Pros: zero behavior change for existing users; lowest migration risk.
- Cons: contradicts the stated intent ("experiment stops being privileged"); two tabs doing nearly the same thing; more surface to maintain. Not recommended, but the "pin experiment as default key" idea is worth keeping — fold it into Option A.

### Option D — Matrix / pivot (tag-key × tag-key)
Render a pivot table crossing two keys (rows = `team`, cols = `env`) with pass-rate cells.
- Pros: strong for comparison-heavy users; natural extension of the existing compare grid.
- Cons: heaviest to build and hardest to make legible with sparse data; clearly out of scope for a first cut. Park it.

**Recommendation: ship Option A now**, structured so Option B's facet filter can layer on later without rework. Keep `experiment` as the default-selected key so the tab looks and behaves like today's Experiments tab on first load.

---

## 4. Data / API changes

**Thread the `tags` map through the lightweight loader (prerequisite for everything).**
- Add `readonly tags?: Record<string, string>` to `LightweightResultRecord` (`manifest.ts:310-325`) and populate it in `loadLightweightResults` (`manifest.ts:327-346`) from the parsed row's `tags` map. This is the load-bearing change; without it the server literally cannot group by any key.

**Generalize `handleExperiments` → `handleTags` (keep both routes during transition).**
- New endpoint `GET /api/tags` returns the list of available tag keys and their per-value summaries; accept `?key=<tagKey>` to select the grouping key (default `experiment`).
- Shape sketch:
  ```
  GET /api/tags            -> { keys: string[] }                     // for the dropdown
  GET /api/tags?key=team   -> { key: "team", groups: TagGroupSummary[] }
  ```
  where `TagGroupSummary` is essentially today's `ExperimentSummary` (`types.ts:356-366`) with `name` = the tag value.
- Implementation: reuse the `handleExperiments` aggregation loop (`serve.ts:2386-2429`) but key the map on `record.tags?.[key]` instead of `record.experiment`. For `key === 'experiment'`, fall back to `record.experiment ?? record.tags?.experiment ?? 'default'` so lockstep and old runs both resolve.
- Keep `GET /api/experiments` as a thin alias of `handleTags(key='experiment')` for one release so nothing breaks mid-migration; delete once the frontend cuts over.

**Available-keys enumeration.** `handleTags` (or a cheap `GET /api/tags`) walks every run's rows, unions `Object.keys(row.tags ?? {})`, always includes `experiment`, and returns a sorted key list for the dropdown. This is O(rows) but the loop already exists.

**Compare view.** `handleCompare` (`serve.ts:2434+`) groups cells on `[experiment, target]` (`serve.ts:2531`). To let compare group by an arbitrary key, add an optional `?group_key=` that swaps `experiment` for `row.tags?.[group_key]`. Out of scope for phase 1; note it as the natural phase-2 follow-on so the tab's "compare" affordance stays coherent. **Do not** conflate this with the existing `?tags=` param on `handleCompare` — that one filters on the manual **label** `string[]` (`serve.ts:2503-2509`), a different concept (see §2). Consider renaming that query param to `?labels=` when the UI rename lands.

**Backward compatibility (old runs with no tags map).**
- Rows/summaries written before the feature have no `tags` map but do have `experiment`. Under Option A the only key such runs contribute is `experiment` (via the fallback above); they simply don't appear under other keys. That's correct and needs no migration.
- `record.tags?.[key]` for a missing key groups those runs under a `default`/`(none)` bucket — decide whether to show or hide the "(none)" bucket (recommend: show it, labeled `(no <key>)`).

---

## 5. UI / UX sketch

- **Tab label:** `🏷️ Tags` replacing `🧪 Experiments` at `index.tsx:50`.
- **Tag-key selector:** a small `<select>` (or segmented control) at the top of the Tags tab, populated from `GET /api/tags` keys, defaulting to `experiment`. Changing it re-fetches `GET /api/tags?key=<key>` and reuses the existing table.
- **Grouping table:** same columns as `ExperimentsTab.tsx` (value name, runs, targets, evals, execution errors, pass rate, last run). Header first column label becomes the selected key (e.g. "Team", "Env") instead of hardcoded "Experiment".
- **Detail view:** generalize `ExperimentDetail` to a `TagValueDetail` that filters runs by `run.tags?.[key] === value` (with the `experiment` fallback). Note: `RunMeta` (`types.ts:23-64`) currently exposes `experiment?: string` but **not** the `tags` map, and `CompareRunEntry.tags` (`types.ts:405-424`) is the manual **label** array — so `RunMeta` needs a new field to carry the promptfoo map to the client (e.g. `run_tags?: Record<string,string>`, deliberately named to avoid colliding with the existing `tags: string[]`).
- **Empty state:** reword `ExperimentsTab.tsx:38-43` ("No experiments found…") to be key-aware ("No values found for tag `team`").
- **Labels (manual chips):** keep rendering on individual runs / RunList; do not surface them in the Tags grouping control (§2).

**Routing / URL changes.**
- Replace `/experiments/$experimentName` with `/tags/$key/$value` (and the project-scoped `/projects/$projectId_/tags/$key/$value`). Files: rename `routes/experiments/$experimentName.tsx` → `routes/tags/$key.$value.tsx` (TanStack Router flat-file convention; confirm the exact filename shape against the existing project route).
- Keep a redirect from the old `/experiments/:name` → `/tags/experiment/:name` for one release so bookmarked links survive.
- Tab state: today `activeTab` is derived from a `tab` search param (`index.tsx:243`); the selected tag key should live in the URL too (e.g. `?tab=tags&key=team`) so the view is shareable/refresh-safe.

---

## 6. Migration & backward-compat

- **Old runs (no tags map):** contribute only to the `experiment` key via fallback; no data migration, no backfill.
- **Lockstep `experiment` field:** top-level `experiment` stays equal to `tags.experiment` (kept in lockstep by the core resolver). The server's `experiment`-key resolution (`record.experiment ?? record.tags?.experiment`) is therefore always consistent; prefer `record.experiment` first so old runs keep working.
- **`experiment` remains the default key:** yes. On first load the Tags tab shows the same data the Experiments tab shows today, so the rename is non-surprising.
- **API transition:** ship `/api/tags` first, keep `/api/experiments` as an alias for one release, then remove it and the old routes/components in a cleanup PR. Avoid a flag-day where both frontend and server change atomically.
- **Wire-format rule:** all new keys are `snake_case` (`group_key`, `run_tags`); translate at the boundary only.

---

## 7. Risks, open questions, recommendation

**Risks**
- Naming collision (§2) is the top risk: if the manual `tags.json` chips and the promptfoo tags map are both called "tags" in the UI, users will be confused and the compare `?tags=` filter will look like it should filter the grouping map (it doesn't).
- Perf: enumerating tag keys and regrouping walks every run's rows on each key change. Fine at current scale; revisit if runs grow large (cache the key list, or compute all groupings server-side once).
- Over-building: faceted/pivot options (B/D) are tempting; resist until Option A ships and demand is real.

**Open questions**
1. Rename manual chips to **"Labels"** in the UI, or keep "tags"? (Drives §2 and the `?tags=`→`?labels=` param decision.) — recommend rename to Labels.
2. Show or hide the `(no <key>)` bucket for runs missing a selected key? — recommend show, clearly labeled.
3. Should `RunMeta` carry the full `tags` map to the client (new `run_tags` field), or should the detail view rely on the server filtering by key? — recommend a small `run_tags` field for client-side detail filtering, mirroring today's `experiment` approach.
4. Does compare need arbitrary-key grouping in phase 1, or is grouping-only enough? — recommend defer compare to phase 2.
5. Confirm TanStack flat-file route filename for `/tags/$key/$value` against the existing project-scoped route convention.

**Recommended approach & phasing**
- **Phase 1 (this feature):** Option A. (a) thread `tags` map through `LightweightResultRecord`/`loadLightweightResults`; (b) add `handleTags`/`GET /api/tags` (+key enumeration) with `/api/experiments` kept as alias; (c) add `run_tags` to `RunMeta`; (d) rename tab to Tags, add key selector, generalize table + detail + routes with an `experiment` redirect; (e) rename manual chips to "Labels" and update `CONCEPTS.md`. Default key = `experiment`, so day-1 behavior matches today.
- **Phase 2 (follow-on):** faceted filter (Option B) and arbitrary-key compare grouping (`?group_key=` on `handleCompare`), plus retiring the legacy `/api/experiments` alias and `?tags=`→`?labels=` param rename.

Rough scope: Phase 1 is a moderate change touching ~3 server functions, 1 core loader type, and ~5 frontend files (tab, table, detail, 2 route files) plus type additions. The riskiest single edit is threading the map through the lightweight loader; everything else is mechanical once the data is available.
