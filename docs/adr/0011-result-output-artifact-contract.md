# 11. Result output artifact contract is run-centric and manifest-first

Date: 2026-06-30

## Status

Accepted

Extends:

- [ADR 0006](0006-separate-experiments-from-eval-definitions.md), which keeps
  experiment runtime inline in eval YAML.
- [ADR 0008](0008-normalized-transcript-artifact-contract.md), which defines
  raw and normalized transcript sidecars.
- [ADR 0009](0009-eval-path-result-identity-and-default-experiment.md), which
  keeps result identity in `index.jsonl` rows and uses `default` as the fallback
  result experiment.

Updated by [ADR 0012](0012-finalize-run-artifact-layout.md), which makes
artifact-format v2 runs direct children of `.agentv/results/` and treats
`experiment` as run metadata rather than path identity.

## Context

AgentV needs a result output contract that works for local runs, CI gates,
Dashboard inspection, static reports, comparisons, repeated attempts, imported
suites, manual prepare/grade attempts, and downstream adapters. The contract
must remain portable across repositories and machines without requiring a
hosted database or an external observability system.

Several pressures make directory-derived semantics brittle:

- A single CLI invocation can run multiple targets or imported suites.
- Repeated attempts can create multiple attempts for one case.
- Two suites can reuse the same test ID.
- Dashboard and compare tools need dynamic filters across experiment, target,
  variant, source eval, attempt, status, score, and metadata.
- Result bundles can be copied, combined, published, imported, or projected into
  another storage location.
- Future schema evolution should add row fields or sidecars without requiring a
  directory migration.

The product direction also keeps AgentV-owned run bundles, traces, transcripts,
datasets, experiments, indexes, and Git-backed artifacts outside Phoenix and
other hosted systems. AgentV can correlate with external traces through safe
metadata, but AgentV's run bundle remains the source of truth.

## Decision

An AgentV result output is a run-centric bundle with this root contract:

```text
.agentv/results/<run_id>/
  summary.json
  index.jsonl
  tags.json                 # optional mutable overlay
  <case-or-allocation>/
    summary.json            # optional case aggregate, especially repeats
    test/                   # optional generated test bundle
    run-1/
      result.json
      grading.json
      metrics.json
      timing.json
      transcript.jsonl
      transcript-raw.jsonl
      outputs/
        answer.md             # when target output exists
        file_changes.diff     # when workspace file changes exist
```

`run-N/result.json` uses AgentV-owned status fields: `execution_status` carries
the attempt execution classification and `verdict` carries the grader verdict.
It does not export external runner status enums.

`summary.json` and `index.jsonl` are complementary:

- `summary.json` owns aggregate run metadata and rollups: counts, pass rate,
  score summaries, duration, token/cost totals, writer metadata, and run-level
  display fields. Run listings, CI summaries, and quick Dashboard cards should
  use it.
- `index.jsonl` owns row-level truth: one row per result, attempt, or
  case-level aggregate, with identity fields, filter metadata, status, scores,
  and explicit run-relative paths to sidecars. Dashboard detail routing,
  compare/trend tooling, rerun lookup, and adapters should use it.

This is not redundant storage. It avoids forcing aggregate consumers to scan
every row and avoids forcing row consumers to reverse-engineer case details from
aggregate summaries.

`index.jsonl` is the canonical row index for a run. It is the discovery path for
ordinary per-case sidecars through explicit fields such as `result_dir`,
`summary_path`, `grading_path`, `metrics_path`, `timing_path`,
`transcript_path`, `transcript_raw_path`, `answer_path`, `output_path`,
`file_changes_path`, `test_dir`, `eval_path`, `targets_path`, `files_path`, and
`graders_path` when those artifacts exist.

`artifact_pointers` remain an offload indirection for large detached payload
bytes. They are not the discovery path for ordinary sidecars that live in the
run tree.

Dashboard search indexes, SQLite caches, static HTML reports, comparison
outputs, and vendor-neutral projection bundles are rebuildable projections over
`summary.json`, `index.jsonl`, and sidecars. They must not become the canonical
source for run identity or artifact discovery.

## Directory Paths Are Allocation

The `.agentv/results/<run_id>/` path is storage allocation. It gives AgentV a
predictable place to write and discover completed bundles, but the path does
not define semantic truth.

The experiment label remains AgentV's run grouping metadata. Users can label
conditions such as `baseline`, `candidate`, `with_skills`, or `without_skills`,
and tools can use that label for grouping and comparison. However, readers must
use row and summary metadata for semantics. If a run is copied under a different
folder, combined with another run, synced to a results branch, or imported from
another machine, the manifest fields still carry the truth.

AgentV must not use a semantic `experiments/<name>/...` or
`.agentv/results/<experiment>/<run_id>/` folder hierarchy as the source of
truth. A repository may keep eval YAML files under a directory named
`experiments/`, but that is user-owned organization for ordinary eval files. It
does not define result identity, runtime behavior, or Dashboard routing.

`result_dir` is also allocation. It should stay readable when possible, but it
can be suffixed or otherwise allocated to avoid collisions. The public row
identity is the manifest data, not the directory spelling.

## Row Metadata Owns Filtering

Experiment, target, variant, attempt, source eval, source target, imported suite
metadata, repeat policy results, execution status, and artifact path fields
belong in result rows because consumers need to filter after the run is written.

This supports:

- multi-target runs where one bundle contains rows for several candidates;
- repeated attempts where one logical case has multiple attempt records;
- imported suites where source suite metadata differs from wrapper eval
  metadata;
- Dashboard filters and detail routing without pre-splitting folders for every
  view;
- comparison tools that group by experiment, target, variant, attempt, or eval
  path;
- adapter projections that can evolve by preserving unknown fields and adding
  new sidecar path fields;
- future schema evolution where a new metadata dimension does not require a
  directory migration.

The row contract follows AgentV's wire-format convention: on-disk fields are
`snake_case`, and TypeScript internals translate at the boundary.

## Margin Evals Alignment

This aligns with Margin Evals' manifest-first and run-centric lessons:

- completed runs should have a portable bundle that can be copied or published;
- row manifests should carry enough metadata to reconstruct views and exports;
- dashboards and search tables should be projections, not the source of truth;
- directory layout should be convenient for humans without becoming the query
  model.

AgentV does not copy Margin Evals' exact layout. AgentV keeps its own
`summary.json` plus `index.jsonl` split, AgentV transcript sidecars,
`run-N/` artifact attempt folders, generated test bundles, Git-backed result
branch model, and optional detached `artifact_pointers`.

## Consequences

Positive:

- A run bundle remains inspectable with ordinary file tools.
- Dashboard, reports, compare, trend, and adapters can share one canonical
  contract.
- Copying or publishing a run does not destroy semantics.
- New filter dimensions can be added as row fields instead of directory
  migrations.
- Derived indexes can be deleted and rebuilt from canonical artifacts.

Negative:

- Readers must parse `index.jsonl` instead of relying on folder names.
- Docs and examples must teach the summary/index split clearly.
- Some directory names may look meaningful but remain non-authoritative, which
  requires discipline in Dashboard and adapter code.

## Alternatives Considered

### Semantic experiment folder hierarchy

Rejected. A hierarchy such as
`experiments/<experiment>/<target>/<variant>/<attempt>/...` makes simple cases
look organized, but it turns every new filter dimension into a storage decision.
It also breaks down for multi-target runs, imported suites, repeated attempts,
manual grading, combined bundles, and copied result repositories.

### Single aggregate manifest only

Rejected. A single `summary.json` with embedded row data would force row
consumers to parse and rewrite a large aggregate document. It would also make
append-mostly result sync and streaming row readers worse.

### Row index only

Rejected. A run list should not need to stream every row and hydrate sidecars to
show total tests, pass rate, duration, and cost. `summary.json` is the cheap
aggregate entrypoint.

### Database as source of truth

Rejected. SQLite, search tables, Dashboard caches, and hosted backends are
useful projections, but AgentV's zero-infra local and CI path needs portable
files as the canonical contract.

## Non-Goals

- Defining a new hosted results store.
- Replacing the normalized transcript contract.
- Projecting AgentV-owned runs, transcripts, datasets, experiments, or indexes
  into Phoenix.
- Requiring a semantic `experiments/` directory.
- Preserving Dashboard discovery for older `.agentv/results/<experiment>/<run_id>/`
  bundles after artifact-format v2. ADR 0012 hard-deprecates that layout for new
  v2 run discovery.
- Freezing every possible row field. This ADR defines ownership and discovery;
  field additions remain additive and versioned.

## References

- Strategy: [STRATEGY.md](../../STRATEGY.md)
- Roadmap: [ROADMAP.md](../../ROADMAP.md)
- Product boundary: [.agents/product-boundary.md](../../.agents/product-boundary.md)
- Technical conventions: [.agents/conventions.md](../../.agents/conventions.md)
- Public docs: [Result Artifact Contract](../../apps/web/src/content/docs/docs/reference/result-artifacts.mdx)
