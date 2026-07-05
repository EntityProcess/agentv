# 17. Output/artifact contract + environment recipe contract

Date: 2026-07-02

## Status

Accepted (2026-07-02). Part of the eval-authoring restructure — see
`docs/plans/promptfoo-aligned-eval-restructure.md` §6, §11. **Refines/supersedes
[ADR 0011 (result output artifact contract)](0011-result-output-artifact-contract.md)
and [ADR 0012 (finalize run artifact layout)](0012-finalize-run-artifact-layout.md)**;
extends [ADR 0008 (normalized transcript)](0008-normalized-transcript-artifact-contract.md).
Companion to [ADR 0016](0016-promptfoo-superset-eval-authoring-contract.md).

Amended (2026-07-05) by Bead `av-noh3.2.1`: the output/artifact contract remains
accepted, but the earlier workspace resolver naming and `workspace.repos`
authoring shape are superseded for coding-agent testbeds. AgentV now uses
`environment` as the public suite/test/case testbed recipe. `workspace` is no
longer a locked canonical public testbed term.

## Context

We reviewed the output formats of promptfoo, margin-lab, vercel-agent-eval, and
agentskills, and the testbed/acquisition models of SWE-bench, margin, Harbor,
and Inspect AI (`docs/plans/…` §6, §11.1). The active implementation scope is tracked in
Beads; PRs, ADRs, and plans summarize those Beads for review, but the Bead descriptions,
acceptance criteria, and notes remain the implementation source of truth.

Promptfoo evidence was checked locally at `/home/entity/projects/promptfoo/promptfoo`
commit `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`. Promptfoo's authored eval YAML is
the compatibility target where AgentV overlaps. Its result/export model is useful
inspiration, not AgentV's canonical artifact format: `EvaluateResult` carries
prompt/test/provider identity, `success`, `score`, `namedScores`, token usage, and a
full `gradingResult`; `GradingResult` carries `pass`, `score`, `reason`, optional
`componentResults`, and assertion metadata; `EvaluateSummaryV3`/`ResultsFile` wrap
results, prompts, stats, config, author, and variables. AgentV borrows the clean
aggregate grading vocabulary and component-breakdown idea, then writes them into a
filesystem/Git-native split run bundle instead of one consolidated DB/export file.
Two decisions follow: the canonical result bundle, and how a coding-agent
environment recipe is authored and materialized.

## Decision — output/artifact contract (best-of-each, split, no DB)

### Wire-format casing invariant

All AgentV-owned process-boundary and persisted artifact fields use `snake_case`.
This includes YAML authoring, JSON/JSONL run bundles, `.internal/index.jsonl`,
`summary.json`, `result.json`, `grading.json`, `metrics.json`, transcript
sidecars, CLI JSON output, Dashboard/API response bodies, gate stdin/stdout, and
adapter/export bundle fields.

Internal TypeScript APIs may use `camelCase`, but writers must translate to
`snake_case` at the boundary and readers must translate back at the boundary.
New AgentV-owned public fields must not be introduced in `camelCase`, and must
not ship dual `camelCase`/`snake_case` aliases unless an already-shipped external
compatibility surface requires a documented migration.

Opaque provider-native payloads are exempt only when they are preserved as native
evidence, such as `transcript-raw.jsonl`, provider metadata, or external
protocol payloads. AgentV wrappers around those payloads still use `snake_case`.

1. **Split bundle is the single source of truth** (`.agentv/results/<run_id>/`); NO
   maintained consolidated single-file export (generate on demand if ever needed).
   3 of 4 references split; only promptfoo consolidates (for its DB/hosted model).
2. **Queryable aggregate ← margin-lab**: run-root `summary.json` is a rich `jq`-queryable
   `Summary` (run_id, status breakdown, `pass_rate`, `pass_count`, `sample_count`,
   per-case `passed`/`pass_any` where applicable, per-instance summaries, usage, and
   infra-failure taxonomy) — widen AgentV's current thin summary to this. Reserve
   `pass_at_k`/pass@k vocabulary for explicit sampling metrics with a true `k`; do not
   use `pass_at_1` when the value actually means "any sample passed". Plus
   `.internal/index.jsonl` (one row per case) for streaming/line queries. No database.
3. **Transcript + metrics ← vercel**: two-layer transcript (raw + normalized) with a
   canonical cross-agent `tool_name` enum and precomputed `transcript_summary`, the
   summary **inlined into each result row** for cheap trajectory/metrics assertions;
   transcript referenced **by path**.
4. **Per-attempt grading sidecar**: `grading.json` is an AgentV-native public contract
   that keeps Promptfoo's aggregate grading vocabulary while preserving AgentV's richer
   nested breakdown. It exposes top-level `pass`, `score`, `reason`, optional
   `threshold`/`details`, and an always-present `graders[]` array. Each grader exposes
   `name`, `type`, `pass`, `score`, `reason`, optional `threshold`/`details`, and
   optional `checks[]`. Each check exposes `id?`, `text`, `pass`, optional `score`,
   `reason`, and optional `evidence` only when the evidence is distinct from `reason`.
   There are no public top-level `checks`, no dynamic single-grader shortcut, and no
   public `assertion_results`, `assertions`, `passed`-only aliases, or
   evidence-as-reason aliases. Authored YAML uses `assert`, `assert-set`, and
   `llm-rubric`; result artifacts describe evaluated graders and checks. Default judge =
   skeptical evidence-by-path (opt-out via explicit `prompt`); grader target selection
   flows through the config graph (`defaults.grader`) or assertion-level target
   selection, not a system-under-test target field. Evidence stays in `grading.json`.
5. **Bundle layout / naming**: machine files move under per-run **`.internal/`**
   (`index.jsonl`, `progress.json`, `events.jsonl`, `bundle.json`); run root stays clean
   (`summary.json` + per-case dirs). Rename the reference field `manifest_path` →
   `index_path` (file stays `index.jsonl`, JSONL for append/stream/query). Reserve
   "manifest"/`bundle.json` for the frozen config.
6. **Merge `timing.json` into `metrics.json`** (sections: duration/tokens/cost always;
   execution/trajectory when a trace exists); drop `timing_path`, keep one `metrics_path`.
7. **Analytics = one pure `Build()`** (margin-lab shape) producing status,
   count, usage, runtime, case, and failure summaries; add promptfoo-shaped
   `named_scores`/`derived_metrics` on rows.

### Multi-suite runs — one run_id, categorize by suite AND tags/experiment
Confirms ADR-0009 + ADR-0012 (not a new decision):
- **One `<run_id>` (one timestamp) per CLI invocation**, across any number of suite YAMLs — all suites' cases live under the single `<run_id>/` bundle. **Never a separate timestamp/folder per suite.** `runtime_source.eval_files` records the active eval files.
- **Identity = `eval_path` + `test_id`** (uuid-suffixed dir), so overlapping `test_id`s across suites don't collide. `suite`/`name` are **display/grouping metadata, not routing** (ADR-0009).
- **Categorize by BOTH, orthogonally** (each `index.jsonl` row carries both): **`suite`** (+`eval_path`) = structural origin; **`tags`** (map, incl **`experiment`**) = semantic/campaign grouping. `experiment` = the run/campaign bucket; `suite` = the intra-run structural group; the Dashboard groups by any tag key, and suite is another grouping dimension. Reports filter/group by either axis.

### Artifact filenames (locked — accuracy over cosmetic consistency)
- **`summary.json`** (run-root AND per-case) — the aggregate. Kept over margin's `results.json`: it's a *summary*, not the full results (those are the per-case dirs + `index.jsonl`); avoids the `results/<run_id>/results.json` stutter; symmetric at both levels (run aggregates cases, case aggregates samples); vercel-aligned. We match margin on the aggregate *concept/shape*, not the filename.
- Per-sample triad (distinct, all kept): **`result.json`** (what happened), **`grading.json`** (aggregate `pass`/`score`/`reason` plus `graders[]`/`checks[]`), **`metrics.json`** (duration+tokens+cost+execution/trajectory; the `timing.json` merge).
- **`grading.json`** kept (not `grades.json`) — source-consistent with agentskills (whose file is `grading.json`), and "grading" names the grading *result*.

### `grading.json` wire-format example
```json
{
  "pass": false,
  "score": 0.62,
  "reason": "The answer names the right API but misses the rollback condition.",
  "threshold": 0.8,
  "details": {
    "aggregation": "weighted_mean"
  },
  "graders": [
    {
      "name": "rubric",
      "type": "llm-rubric",
      "pass": false,
      "score": 0.62,
      "reason": "Two of three rubric checks passed.",
      "threshold": 0.8,
      "checks": [
        {
          "id": "api",
          "text": "Identifies the API used to publish result bundles.",
          "pass": true,
          "score": 1,
          "reason": "Correctly identifies the publish command."
        },
        {
          "id": "rollback",
          "text": "Explains when to roll back a failed publish.",
          "pass": false,
          "score": 0,
          "reason": "Mentions retrying but not rollback criteria.",
          "evidence": "The response says to rerun the command after any failure."
        }
      ]
    }
  ]
}
```

Summary and index guidance: use `pass_rate`, `pass_count`, and `sample_count` for run
and case aggregates; use `passed` for one execution outcome and `pass_any` when any
sample in a repeated case passed. Use `pass_at_k` only when the metric is an explicit
sampling metric with a real `k` and the calculation is documented on the summary row.
Index rows should stay lightweight: identity/outcome/named score/token usage fields
plus paths such as `result_path`, `grading_path`, `metrics_path`, `transcript_path`,
and `outputs_path`, not a full embedded grading tree.

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
- **margin-lab consistency & divergence:** matches on the *filesystem* substance — top-level queryable aggregate (`results.json`=`summary.json`), `internal/` machine folder (we dot-prefix `.internal/`), per-execution-unit dirs, one pure `Build()` for pass rates and explicit sampling metrics, `instance_key = test_id#sample_index`. **Divergences (deliberate):** (1) margin's *runner* uses a persistent **`RunStore` (in-memory / Postgres, NOT SQLite)** for scheduling + queries; **AgentV declines a store entirely** (laptop-first; resumability via `index.jsonl` + `--rerun-failed`). (2) hierarchical `<test-id>/sample-N/` vs margin's flat `instances/<case>#<sample>/`. (3) `timing`→`metrics` merge. The **rebuildable derived index/view** idea (JSONL `.indexes/`, optional SQLite escape hatch) is from **exploitbench** (`import`/`export` bijection), not margin — margin's store is the operational source during a run, not a filesystem-derived index. (Nuance: margin *can* rehydrate a run's completed-work state from its run-dir for **resume** — `LoadProgressSnapshot` + `loadSavedResumeBundle` + `carryForwardLocalCases` — but that's targeted carry-forward, not a general `import` that rebuilds the multi-run query DB from files; the memory store is ephemeral, the Postgres store persists independently. **AgentV follows exploitbench's model** — filesystem is source of truth, `.indexes/*.jsonl` are derived/rebuildable — with `--rerun-failed` reading `index.jsonl` from fs and no store to rehydrate.)
- **Dashboard default view is sensible, never odd/empty:** because `tags.experiment` is value-defaulted to the eval/suite name (always populated), the default view groups by `experiment` (real names, no "(none)" wall) or a recent-runs list; the grouping key is a user preference they can change, not the absence of a default.

### Run organization: cross-run index, repeat naming, experiment-as-tag
- **Cross-run index (rebuildable cache, not source of truth):** keep per-run `index.jsonl` (rows = cases); add a cross-run catalog `.agentv/results/.indexes/runs.jsonl` (already-reserved `.indexes` namespace) — **one row per run** (run_id, timestamp, targets, `tags` incl experiment, aggregate `pass_rate`/`pass_count`/`sample_count`, and explicit `pass_at_k` only when present). Derived by scanning `*/summary.json`, rebuildable, optional (Dashboard can glob summaries as fallback). JSONL (append per run), **not `index.json`**.
- **Repeat folder = `sample-N`, not `run-N`.** "run" is overloaded (`run_id` = the whole invocation). Rename `run-${attempt+1}` → `sample-1`, `sample-2`, … (matches margin `samples_per_case`/`sample_index`, explicit sampling metrics, and AgentV's `repeat`; Inspect's `epoch` is the ML-jargon alt). Keep the metadata split: `sample_index` = repeats, `retry_index` = infra retries.
- **`experiment` has no *structural* privilege, but its *value* is auto-defaulted.** No storage dir (already `<run_id>/`), no top-level field (`tags.experiment`), no special schema; tag keys sort **alphabetically**; the default grouping/compare **key** is a user preference (any tag — AgentV blesses none). `--experiment X` = sugar for `--tag experiment=X`. **The one convenience:** the harness auto-populates the `experiment` tag's **value** when unset, deriving it from the eval/suite name (ADR-0009: `--experiment` > authored `tags.experiment` > eval/suite name). So every run always has a meaningful `experiment` value and is groupable — without the author setting anything. This is a default *value*, not a privileged *key*.

## Decision — environment recipe contract

Cross-framework evidence from Bead `av-noh3.1` supports a different public
contract than this ADR's original `workspace` decision:

- Promptfoo local clone `/home/entity/projects/promptfoo/promptfoo` at commit
  `6bfc5a0c7f16f9c4717ac731d276b578e63d0769` has top-level `env` for
  provider/eval env overrides and `extensions` for lifecycle hooks; it has no
  typed testbed/environment primitive.
- Harbor local clone `/home/entity/projects/harbor-framework/harbor` at commit
  `a9148a9509a0bc0cbeb80375aa619bd5cdb5845c` models task environments with
  Docker image/resources/env/workdir and keeps agent setup separate from
  environment start.
- Terminal-Bench 2 clone `/tmp/agentv-terminal-bench-2` at commit
  `2fd12b88aafdd04a52c298e3940bcb189f9766d6` uses `task.toml`,
  `environment/Dockerfile`, `tests/test.sh`, and `solution/solve.sh`; Docker
  tasks commonly prepare `/app` by cloning/pinning repositories or copying
  challenge files.
- Margin clone `/home/entity/projects/Margin-Lab/evals` at commit
  `53fb2fd080689efaf7934573d8759d14fc1043e4` keeps case image/cwd separate
  from selected agent configuration.

AgentV combines promptfoo-compatible eval authoring with
Harbor/Terminal-Bench/Margin-style coding-agent environments:

```yaml
environment: file://.agentv/environments/local-python.yaml

targets:
  - id: codex
    provider: codex-cli
```

```yaml
# .agentv/environments/local-python.yaml
type: host
workdir: ./workspaces/bottle
setup:
  command: ./scripts/setup-workspace.sh
  args:
    repo: https://github.com/bottlepy/bottle.git
    commit: 0207a34f0c5716cd292dd4480253ad35d3da49f3
    path: ./workspaces/bottle
```

```yaml
environment:
  type: docker
  context: ./environment
  workdir: /app
  env:
    NODE_ENV: test

env:
  OPENAI_API_KEY: "{{ env.OPENAI_API_KEY }}"
```

1. **`environment` is the authored testbed recipe** at suite/test/case scope.
   It may be inline or loaded through a field-level `file://` reference. Shared
   `file://` recipes are the canonical reusable form.
2. **Initial recipe types are `host` and `docker`.** `host` prepares a local
   trusted-machine workdir. `docker` prepares a container-backed testbed using
   fields such as `context`, `dockerfile`, `image`, `workdir`, and future scoped
   resource/mount/secrets fields.
3. **`environment.workdir` defines cwd.** AgentV passes the resolved workdir to
   target providers and graders/test scripts unless a later scoped feature
   explicitly overrides it. Target configs may still expose provider-specific
   knobs, but the canonical testbed cwd comes from the environment recipe.
4. **`environment.setup` materializes testbed state.** Setup is declarative data
   plus a command and typed `args`: repos, archives, patches, generated
   fixtures, installed dependencies, services, and other case state. Setup runs
   before target execution and before ordinary promptfoo lifecycle hooks.
5. **Top-level `env` remains promptfoo-compatible.** It is for provider/eval env
   overrides and load-time `{{ env.VAR }}` rendering. Do not move it under
   `environment`. If `environment.env` is implemented, it means variables scoped
   to the host/docker testbed, not promptfoo env templating.
6. **Promptfoo `extensions` remain lifecycle hooks.** They can customize eval
   flow, but they are not the canonical testbed setup contract because hidden
   hook code is weaker for review, validation, sharing, and cwd semantics.
7. **Targets select agents/providers.** `targets[].id` is stable AgentV target
   identity, `targets[].provider` names the adapter/control boundary, and
   `targets[].runtime` remains placement/transport. Targets do not own
   Docker/testbed setup by default.
8. **`workspace` is not the public coding-agent benchmark contract.** The
   original `workspace.repos`, `workspace.scope`, `workspace.docker`, and
   `workspace.template` names are superseded where they meant authored testbed
   setup. Existing workspace-named code is migration debt when it models this
   same concept. The word may still appear for unrelated internal mutable
   directories, caches, or result/artifact paths, but not as a competing
   authored testbed primitive.

The invariants matter more than the mechanism: testbed setup is declared as
data; materialization precedes target execution and normal lifecycle hooks; cwd
is explicit; provider/target identity remains separate from testbed setup; and
run bundles can snapshot the resolved recipe, setup inputs, and resolved
workdir as provenance.

### Note: SWE-bench `FAIL_TO_PASS` / `PASS_TO_PASS`

`FAIL_TO_PASS`/`PASS_TO_PASS` are two lists of test IDs shipped with each SWE-bench
dataset row. The distinction (fix-tests vs regression-tests) matters only at
*dataset-construction* time; at *run* time it collapses to "**run these named tests; pass
iff all pass**". So it is **too domain-specific for a core primitive, and needs no
dedicated SDK recipe** -- it is plainly a **`script`** grader run from
`environment.workdir`: the grader runs the repo's tests and its exit code is the
verdict (exactly margin's `tests/test.sh` 0/1/2 model). The two lists are just
data the grader's command consumes (inline, or from `vars`/`metadata`). Combined
with Docker environment recipes, this is how AgentV runs SWE-bench-style tasks
natively: explicit testbed recipe, explicit cwd, no new grader type.

### Cross-check: exploitbench (confirms + two borrowables)
exploitbench (security-exploit benchmark; AgentV research `entities/exploitbench.md`) **confirms** this contract: split filesystem run-tree is the source of truth (`job.json`/`score.json`/`cost.json`/`transcript.jsonl`/`tool_calls.jsonl`/`config_snapshot.yaml`); its SQLite is a **derived, rebuildable view** (`import`/`export` bijection), not required — validating our no-DB core (jq + `index.jsonl` is the query surface; a SQLite view stays an optional post-run adapter, Phoenix boundary intact). Docker images are pinned by `sha256:` digest at run start; `config_snapshot` = our `bundle.json`. **Borrow:** (1) a **`provenance`** field on result rows (`native`/`mock`/`replay`/`imported_from_*`) — durable, fits AgentV's replay/transcript/mock providers; adopt now. (2) **Eval-integrity / anti-reward-hacking — future scope**: run high-stakes graders in a fresh container with the prepared environment mounted **read-only**; an `audit` pass that re-grades from the stored transcript, scans for reward-hacking red flags, and verifies model identity (the provider served the requested model). "Post-hoc audit as part of benchmark validity."

## Consequences

- Refines ADR-0011/0012 (bundle layout, `index_path`, timing→metrics merge, `.internal/`);
  0011/0012 marked accordingly.
- Opik export (`av-bv4.6`) and the Dashboard (`av-2s7`) consume the new bundle → re-gate on
  this contract.
- Codemod handles bundle-field renames and drops the superseded workspace
  repo-acquisition fields where they modeled authored testbed setup.
- `camelCase` in an AgentV-owned artifact or response is a contract bug, not a
  stylistic alternative.
