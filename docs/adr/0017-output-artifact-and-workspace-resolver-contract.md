# 17. Output/artifact contract + workspace resolver (provenance vs acquisition)

Date: 2026-07-02

## Status

Proposed. Part of the eval-authoring restructure — see
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
   + fractional). `llm-rubric` maps its verdict to one `assertion_result` per criterion.
   Default judge = skeptical evidence-by-path (opt-out via explicit `prompt`); judge
   pinning via `grader_target`. Evidence stays in `grading.json`.
5. **Bundle layout / naming**: machine files move under per-run **`.internal/`**
   (`index.jsonl`, `progress.json`, `events.jsonl`, `bundle.json`); run root stays clean
   (`summary.json` + per-case dirs). Rename the reference field `manifest_path` →
   `index_path` (file stays `index.jsonl`, JSONL for append/stream/query). Reserve
   "manifest"/`bundle.json` for the frozen config.
6. **Merge `timing.json` into `metrics.json`** (sections: duration/tokens/cost always;
   execution/trajectory when a trace exists); drop `timing_path`, keep one `metrics_path`.
7. **Analytics = one pure `Build()`** (margin-lab shape) producing the `Summary` with
   pass@k; add promptfoo-shaped `named_scores`/`derived_metrics` on rows.

## Decision — workspace resolver (provenance vs acquisition)

Cross-framework convergent rule (SWE-bench, Terminal-bench, margin, lm-eval, Inspect):
**the case declares WHAT (identity + pin); the harness resolves WHERE-FROM via a
selectable backend. Nobody puts acquisition in the task.**

1. **Eval declares provenance ONLY**: `vars.workspace.repos: [{ path, repo, commit
   (base_commit alias), sparse?, ancestor? }]`. Remove the tangled acquisition fields
   (`type`/`local`, `resolve`, `clone.depth`, `clone.filter`, per-repo `resolver`).
2. **Acquisition = harness resolver in machine config (`$AGENTV_HOME/config.yaml`),
   keyed on `repo`**, ordered backends: (1) local checkout auto-adopt via origin-match
   → `git clone --reference`; (2) bare mirror clone-cache (`--reference`, shared objects);
   (3) snapshot artifact (WTG `download-release-deps` reframed); (4) remote clone;
   (5) *future* Docker image (SWE-bench/margin/Inspect — same identity key, new backend;
   adopt Inspect's `image`/`build`/`x-local` distinction + per-config init caching).
3. **`--reference` (mirror cache) is the workhorse**: shallow-speed WITH full history, so
   deep `base_commit` pins never break — retires the `--depth`/`--filter` debate. Keep
   `sparse` for content selection.
4. **Materialization is declarative harness logic, not a user hook**; hooks run after it.
   Resolver config is machine-local, orthogonal to eval and target YAML. Targets carry no
   repos.

New backends plug in without touching the eval schema because all resolve the same pin.

### Note: SWE-bench `FAIL_TO_PASS` / `PASS_TO_PASS`

`FAIL_TO_PASS`/`PASS_TO_PASS` are two lists of test IDs shipped with each SWE-bench
dataset row. The distinction (fix-tests vs regression-tests) matters only at
*dataset-construction* time; at *run* time it collapses to "**run these named tests; pass
iff all pass**". So it is **too domain-specific for a core primitive, and needs no
dedicated SDK recipe** — it is plainly a workspace-`cwd` **`code-grader`**: the grader runs
the repo's tests in the workspace and its exit code is the verdict (exactly margin's
`tests/test.sh` 0/1/2 model). The two lists are just data the grader's command consumes
(inline, or from `vars`/`metadata`). Combined with the Docker-image acquisition backend
(#5), this is how AgentV runs SWE-bench natively — same `repo`+`commit` provenance, no
schema change, no new grader type.

## Consequences

- Refines ADR-0011/0012 (bundle layout, `index_path`, timing→metrics merge, `.internal/`);
  0011/0012 marked accordingly.
- Opik export (`av-bv4.6`) and the Dashboard (`av-2s7`) consume the new bundle → re-gate on
  this contract.
- Codemod handles bundle-field renames and drops the tangled repo-acquisition fields.
