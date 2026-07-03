# 17. Output/artifact contract + workspace resolver (provenance vs acquisition)

Date: 2026-07-02

## Status

Accepted (2026-07-02). Part of the eval-authoring restructure — see
`docs/plans/promptfoo-aligned-eval-restructure.md` §6, §11. **Refines/supersedes
[ADR 0011 (result output artifact contract)](0011-result-output-artifact-contract.md)
and [ADR 0012 (finalize run artifact layout)](0012-finalize-run-artifact-layout.md)**;
extends [ADR 0008 (normalized transcript)](0008-normalized-transcript-artifact-contract.md).
Companion to [ADR 0016](0016-promptfoo-superset-eval-authoring-contract.md).

## Context

We reviewed the output formats of promptfoo, margin-lab, vercel-agent-eval, and
agentskills, and the workspace-acquisition models of SWE-bench, margin, Harbor, and
Inspect AI (`docs/plans/…` §6, §11.1). Two decisions follow: the canonical result
bundle, and how a workspace is acquired.

## Decision — output/artifact contract (best-of-each, split, no DB)

1. **Split bundle is the single source of truth** (`.agentv/results/<run_id>/`); NO
   maintained consolidated single-file export (generate on demand if ever needed).
   3 of 4 references split; only promptfoo consolidates (for its DB/hosted model).
2. **Queryable aggregate ← margin-lab**: run-root `summary.json` is a rich `jq`-queryable
   `Summary` (run_id, status breakdown, per-case **pass@k**, per-instance summaries,
   usage, infra-failure taxonomy) — widen AgentV's current thin summary to this. Plus
   `index.jsonl` (one row per case) for streaming/line queries. No database.
3. **Transcript + metrics ← vercel**: two-layer transcript (raw + normalized) with a
   canonical cross-agent `tool_name` enum and precomputed `transcript_summary`, the
   summary **inlined into each result row** for cheap trajectory/metrics assertions;
   transcript referenced **by path**.
4. **Per-assertion grading ← agentskills**: `grading.json` = `assertion_results[{ text,
   passed, evidence }]` + `summary` counts, PLUS AgentV's superset — top-level **string
   `verdict` (`pass`|`fail`|`skip`)** + fractional **`score`** (not a boolean; needs skip
   + fractional). These rows are the generic AgentV grader evidence channel: every
   grader returns `assertions[]`; deterministic graders typically return one row,
   while multi-aspect graders return one row per distinct criterion/aspect. The
   artifact preserves both the flattened rows and each grader's nested rows.
   Default judge = skeptical evidence-by-path (opt-out via
   explicit `prompt`); judge pinning via `grader_target`. Evidence stays in
   `grading.json`.
5. **Bundle layout / naming**: machine files move under per-run **`.internal/`**
   (`index.jsonl`, `progress.json`, `events.jsonl`, `bundle.json`); run root stays clean
   (`summary.json` + per-case dirs). Rename the reference field `manifest_path` →
   `index_path` (file stays `index.jsonl`, JSONL for append/stream/query). Reserve
   "manifest"/`bundle.json` for the frozen config.
6. **Merge `timing.json` into `metrics.json`** (sections: duration/tokens/cost always;
   execution/trajectory when a trace exists); drop `timing_path`, keep one `metrics_path`.
7. **Analytics = one pure `Build()`** (margin-lab shape) producing the `Summary` with
   pass@k; add promptfoo-shaped `named_scores`/`derived_metrics` on rows.

### Multi-suite runs — one run_id, categorize by suite AND tags/experiment
Confirms ADR-0009 + ADR-0012 (not a new decision):
- **One `<run_id>` (one timestamp) per CLI invocation**, across any number of suite YAMLs — all suites' cases live under the single `<run_id>/` bundle. **Never a separate timestamp/folder per suite.** `runtime_source.kind = multi_eval` records the multi-suite invocation.
- **Identity = `eval_path` + `test_id`** (uuid-suffixed dir), so overlapping `test_id`s across suites don't collide. `suite`/`name` are **display/grouping metadata, not routing** (ADR-0009).
- **Categorize by BOTH, orthogonally** (each `index.jsonl` row carries both): **`suite`** (+`eval_path`) = structural origin; **`tags`** (map, incl **`experiment`**) = semantic/campaign grouping. `experiment` = the run/campaign bucket; `suite` = the intra-run structural group; the Dashboard groups by any tag key, and suite is another grouping dimension. Reports filter/group by either axis.

### Artifact filenames (locked — accuracy over cosmetic consistency)
- **`summary.json`** (run-root AND per-case) — the aggregate. Kept over margin's `results.json`: it's a *summary*, not the full results (those are the per-case dirs + `index.jsonl`); avoids the `results/<run_id>/results.json` stutter; symmetric at both levels (run aggregates cases, case aggregates samples); vercel-aligned. We match margin on the aggregate *concept/shape*, not the filename.
- Per-sample triad (distinct, all kept): **`result.json`** (what happened), **`grading.json`** (verdict = `assertion_results`+`verdict`+`score`), **`metrics.json`** (duration+tokens+cost+execution/trajectory; the `timing.json` merge).
- **`grading.json`** kept (not `grades.json`) — source-consistent with agentskills (whose file is `grading.json`), and "grading" names the grading *result*.

### Full results-tree layout (two levels — no per-run `.indexes`)
```
.agentv/results/
  .indexes/                 # CROSS-RUN derived catalogs (reserved, ADR-0012; rebuildable, not source of truth)
    runs.jsonl              #   one row per RUN         (run-level filtering/listing)
    cases.jsonl             #   one row per (RUN x CASE) (case-level cross-run filter/trend)
  .cache/                   # CROSS-RUN caches (reserved)
  <run_id>/                 # one run bundle (one CLI invocation, incl multi-suite)
    summary.json            #   queryable aggregate (root, human-facing)
    <test-id>/sample-1/ …   #   per-case detail + repeats (sample-N)
    .internal/              # PER-RUN machine files
      index.jsonl           #   one row per CASE (this run) — the per-run index lives HERE
      progress.json  events.jsonl  bundle.json
```
- Per-run index (rows = cases) = `<run_id>/.internal/index.jsonl`; **no separate per-run `.indexes`** — `.internal` already holds it. Cross-run catalog (rows = runs) = `.agentv/results/.indexes/runs.jsonl`. Names signal scope: `.internal` = one bundle; `.indexes`/`.cache` = across runs. Both dot-prefixed (skipped by discovery).
- **Cross-run filtering needs `cases.jsonl`, not just `runs.jsonl`.** `runs.jsonl` (one row/run) answers "which runs match"; **case-level cross-run** queries ("every `fizzbuzz` across runs", "failing cases with tag X over last 10 runs", "trend of `test_id` T") need one row per (run x case) → `.indexes/cases.jsonl`, rebuilt by concatenating every `<run_id>/.internal/index.jsonl` + run metadata. Join key for trends = the layered identity (content-hash `test_id` + author governance tag, ADR-0016 pt8). Both catalogs are derived/rebuildable; if JSONL scanning outgrows laptop scale, a rebuildable SQLite **view** is the escape hatch (optional adapter, never core — exploitbench pattern, Phoenix boundary intact).
- **margin-lab consistency & divergence:** matches on the *filesystem* substance — top-level queryable aggregate (`results.json`=`summary.json`), `internal/` machine folder (we dot-prefix `.internal/`), per-execution-unit dirs, one pure `Build()` for pass@k, `instance_key = test_id#sample_index`. **Divergences (deliberate):** (1) margin's *runner* uses a persistent **`RunStore` (in-memory / Postgres, NOT SQLite)** for scheduling + queries; **AgentV declines a store entirely** (laptop-first; resumability via `index.jsonl` + `--rerun-failed`). (2) hierarchical `<test-id>/sample-N/` vs margin's flat `instances/<case>#<sample>/`. (3) `timing`→`metrics` merge. The **rebuildable derived index/view** idea (JSONL `.indexes/`, optional SQLite escape hatch) is from **exploitbench** (`import`/`export` bijection), not margin — margin's store is the operational source during a run, not a filesystem-derived index. (Nuance: margin *can* rehydrate a run's completed-work state from its run-dir for **resume** — `LoadProgressSnapshot` + `loadSavedResumeBundle` + `carryForwardLocalCases` — but that's targeted carry-forward, not a general `import` that rebuilds the multi-run query DB from files; the memory store is ephemeral, the Postgres store persists independently. **AgentV follows exploitbench's model** — filesystem is source of truth, `.indexes/*.jsonl` are derived/rebuildable — with `--rerun-failed` reading `index.jsonl` from fs and no store to rehydrate.)
- **Dashboard default view is sensible, never odd/empty:** because `tags.experiment` is value-defaulted to the eval/suite name (always populated), the default view groups by `experiment` (real names, no "(none)" wall) or a recent-runs list; the grouping key is a user preference they can change, not the absence of a default.

### Run organization: cross-run index, repeat naming, experiment-as-tag
- **Cross-run index (rebuildable cache, not source of truth):** keep per-run `index.jsonl` (rows = cases); add a cross-run catalog `.agentv/results/.indexes/runs.jsonl` (already-reserved `.indexes/` namespace) — **one row per run** (run_id, timestamp, targets, `tags` incl experiment, aggregate pass@k). Derived by scanning `*/summary.json`, rebuildable, optional (Dashboard can glob summaries as fallback). JSONL (append per run), **not `index.json`**.
- **Repeat folder = `sample-N`, not `run-N`.** "run" is overloaded (`run_id` = the whole invocation). Rename `run-${attempt+1}` → `sample-1`, `sample-2`, … (matches margin `samples_per_case`/`sample_index`, pass@k, and AgentV's `repeat`; Inspect's `epoch` is the ML-jargon alt). Keep the metadata split: `sample_index` = repeats, `retry_index` = infra retries.
- **`experiment` has no *structural* privilege, but its *value* is auto-defaulted.** No storage dir (already `<run_id>/`), no top-level field (`tags.experiment`), no special schema; tag keys sort **alphabetically**; the default grouping/compare **key** is a user preference (any tag — AgentV blesses none). `--experiment X` = sugar for `--tag experiment=X`. **The one convenience:** the harness auto-populates the `experiment` tag's **value** when unset, deriving it from the eval/suite name (ADR-0009: `--experiment` > authored `tags.experiment` > eval/suite name). So every run always has a meaningful `experiment` value and is groupable — without the author setting anything. This is a default *value*, not a privileged *key*.

## Decision — workspace resolver (provenance vs acquisition)

Cross-framework convergent rule (SWE-bench, Terminal-bench, margin, lm-eval, Inspect):
**the case declares WHAT (identity + pin); the harness resolves WHERE-FROM via a
selectable backend. Nobody puts acquisition in the task.**

**Field (WHAT) and resolver (HOW) are orthogonal — both required, neither replaces the
other.** Analogy: `package.json` vs the package registry. `dependencies: {lodash: ^4}` is
the **field** (always declared); npm's registry/mirror/tarball resolution is **pluggable
acquisition** — you can point npm at a custom registry, but you don't delete `package.json`.
Likewise: the `workspace` field declares provenance; the resolver (built-in backends +
custom-backend plugin + `beforeAll` escape hatch) is the pluggable *how*. A custom backend
still reads the field to know which `repo`+`commit` to fetch. You only "don't need the
field" if you go full escape-hatch and forgo declarative provenance (not recommended).

### Naming: `workspace` (durable, locked)
Chosen over alternatives for longevity — it names the *what* (a working directory), not the
*how*: CI-standard (`GITHUB_WORKSPACE`), used by margin-lab, git/Cargo/Bazel/VS Code.
Rejected: `sandbox` (Inspect — connotes an isolation boundary, which is a *property* → the
`isolation`/`docker` fields, not the concept); `environment` (overloaded with env vars);
`testbed` (SWE-bench jargon).

### Final locked schema
```yaml
workspace:                    # suite-level default; tests[].workspace overrides per case
  repos:                      # PROVENANCE only (what to materialize)
    - path: ./CargoWise       # where it lands in the workspace
      repo: https://github.com/WiseTechGlobal/CargoWise.git   # canonical identity (join key)
      commit: 953adb9         # immutable SHA pin (base_commit accepted as input alias)
      sparse: [src/X]         # optional content selection
      ancestor: 1             # optional (nth-ancestor pin)
  scope: attempt              # suite (default) | attempt
  template: ./tmpl            # optional local scaffold
  docker: { image: ... }      # optional container env
```
**Never in this schema:** acquisition (resolver + backends → harness/machine config, keyed
on `repo`) and hooks (→ `extensions`). Keeping those out is what makes the schema durable —
new acquisition technology plugs in without touching it. `commit` is an immutable SHA
(reproducible); mutable refs are excluded.

1. **Eval declares provenance ONLY, in a declarative `workspace.repos` field** (per-test
   overridable / suite-level; NOT a `vars` blob and NOT an extension): `workspace.repos:
   [{ path, repo, commit (base_commit alias), sparse?, ancestor? }]`, plus `workspace.scope`
   (`suite` or `attempt`). Remove the tangled acquisition fields (`type`/`local`, `resolve`,
   `clone.depth`, `clone.filter`, per-repo `resolver`). The harness materializes this
   **before hooks** (ADR 0016 pt10).
2. **Acquisition = harness resolver in machine config (`$AGENTV_HOME/config.yaml`),
   keyed on `repo`**, ordered backends: (1) local checkout auto-adopt via origin-match
   → mirror cache; (2) configured local mirror; (3) custom command resolver returning
   a flat `{status,path}` acquisition source, including Git sources or static directory
   snapshots; (4) AgentV mirror cache and remote clone;
   (5) *future* Docker image (SWE-bench/margin/Inspect — same identity key, new backend;
   adopt Inspect's `image`/`build`/`x-local` distinction + per-config init caching).
3. **`--reference` (mirror cache) is the workhorse**: shallow-speed WITH full history, so
   deep `base_commit` pins never break — retires the `--depth`/`--filter` debate. Keep
   `sparse` for content selection.
4. **Materialization runs before hooks and reads the declared provenance**; ordinary user
   `beforeAll`/`beforeEach` hooks run *after* it. Resolver config is machine-local,
   orthogonal to eval and target YAML. Targets carry no repos.
5. **The resolver is PLUGGABLE — custom acquisition is first-class** (per the "plugins over
   built-ins" product guardrail). Two extension points beyond the built-in backends:
   (a) **register a custom acquisition backend** (a resolver plugin, config-level, keyed on
   `repo`) for a bespoke store/format — the recommended path; (b) a **`beforeAll` extension
   escape hatch** that materializes a fully author-owned workspace and reports its path
   (what the promptfoo parity example did). The built-in acquisition itself may be
   implemented as an auto-registered, ordered-first, **swappable** plugin over the same
   public interface — so the default is zero-config yet replaceable.

The invariants (not the mechanism) are what matter: provenance is declared as data;
acquisition runs before hooks and is keyed on the pin; built-ins ship. New backends —
built-in or user — plug in without touching the eval schema because all resolve the same pin.

### Note: SWE-bench `FAIL_TO_PASS` / `PASS_TO_PASS`

`FAIL_TO_PASS`/`PASS_TO_PASS` are two lists of test IDs shipped with each SWE-bench
dataset row. The distinction (fix-tests vs regression-tests) matters only at
*dataset-construction* time; at *run* time it collapses to "**run these named tests; pass
iff all pass**". So it is **too domain-specific for a core primitive, and needs no
dedicated SDK recipe** -- it is plainly a workspace-`cwd` **`script`** grader: the grader runs
the repo's tests in the workspace and its exit code is the verdict (exactly margin's
`tests/test.sh` 0/1/2 model). The two lists are just data the grader's command consumes
(inline, or from `vars`/`metadata`). Combined with the Docker-image acquisition backend
(#5), this is how AgentV runs SWE-bench natively — same `repo`+`commit` provenance, no
schema change, no new grader type.

### Cross-check: exploitbench (confirms + two borrowables)
exploitbench (security-exploit benchmark; AgentV research `entities/exploitbench.md`) **confirms** this contract: split filesystem run-tree is the source of truth (`job.json`/`score.json`/`cost.json`/`transcript.jsonl`/`tool_calls.jsonl`/`config_snapshot.yaml`); its SQLite is a **derived, rebuildable view** (`import`/`export` bijection), not required — validating our no-DB core (jq + `index.jsonl` is the query surface; a SQLite view stays an optional post-run adapter, Phoenix boundary intact). Docker images are pinned by `sha256:` digest at run start (reinforces resolver backend #5); `config_snapshot` = our `bundle.json`. **Borrow:** (1) a **`provenance`** field on result rows (`native`/`mock`/`replay`/`imported_from_*`) — durable, fits AgentV's replay/transcript/mock providers; adopt now. (2) **Eval-integrity / anti-reward-hacking — future scope**: run high-stakes graders in a fresh container with the workspace mounted **read-only**; an `audit` pass that re-grades from the stored transcript, scans for reward-hacking red flags, and verifies model identity (the provider served the requested model). "Post-hoc audit as part of benchmark validity."

## Consequences

- Refines ADR-0011/0012 (bundle layout, `index_path`, timing→metrics merge, `.internal/`);
  0011/0012 marked accordingly.
- Opik export (`av-bv4.6`) and the Dashboard (`av-2s7`) consume the new bundle → re-gate on
  this contract.
- Codemod handles bundle-field renames and drops the tangled repo-acquisition fields.
