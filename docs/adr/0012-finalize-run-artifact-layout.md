# 12. Artifact layout v2 stores committed runs at the results root

Date: 2026-06-30

## Status

Accepted

Supersedes the experiment-parent result layout portions of
[ADR 0009](0009-eval-path-result-identity-and-default-experiment.md),
[ADR 0006](0006-separate-experiments-from-eval-definitions.md), and
[ADR 0011](0011-result-output-artifact-contract.md).

## Context

AgentV run bundles are the portable source of truth for Dashboard, reports,
compare/trend tooling, CI gates, and export adapters. The previous layout used
the experiment label as a parent directory:

```text
.agentv/results/<experiment>/<timestamp>/
```

That made a mutable grouping label look like storage identity. It also forced
Dashboard and trend discovery to infer experiment from ancestry when the run
summary should carry that metadata explicitly.

Artifact-format v2 phase 1 removes that path dependency. The active schema
direction also treats `experiment` as a string metadata/run-grouping label, not
as an object wrapper for runtime policy. Runtime fields such as `target`,
`runs`, `early_exit`, `timeout_seconds`, `budget_usd`, and `threshold` belong at
the eval root or target object as the schema defines them; this ADR does not
duplicate that schema migration.

## Decision

New committed local run bundles are written directly under the results root:

```text
.agentv/results/<run_id>/
  summary.json
  index.jsonl
  tags.json                 # optional mutable Dashboard tags
  <test-id>-<uuid>/
    summary.json
    test/
    run-1/
      result.json
      grading.json
      metrics.json
      timing.json
      transcript.jsonl
      transcript-raw.jsonl
      outputs/
```

`summary.json` is the run-level manifest/summary. It must include enough
metadata for Dashboard discovery without path inference, including `run_id`,
`experiment` when known, target/model/provider metadata when available,
timestamps, planned/completed counts, and aggregate stats.

`index.jsonl` remains the per-case result index. It is intentionally not renamed
to `manifest.jsonl` in this phase. Rows continue to use explicit run-relative
path fields such as `result_dir`, `summary_path`, `grading_path`,
`metrics_path`, `timing_path`, `transcript_path`, `transcript_raw_path`,
`answer_path`, and `test_dir`.

The top-level `.agentv/results/` namespace reserves dot-prefixed directories for
rebuildable or local state:

```text
.agentv/results/.indexes/
.agentv/results/.cache/
```

Discovery must skip dot-prefixed top-level directories. Existing non-run
namespaces such as `metadata`, `export`, and the removed `runs` namespace remain
reserved.

The per-case `run-1/`, `run-2/`, etc. folders stay in place. They are artifact
attempt/execution folders, not the primary comparison dimension. Repeated
stochastic evaluation should be represented by explicit sample metadata such as
`sample_index` and `sample_count`; infrastructure retries should be represented
separately with retry metadata such as `retry_index`, `retry_count`, and
`retry_reason` when that schema exists. Do not overload `run-N` names to mean
both samples and retries.

The results repository storage branch stores committed run bundles as
`runs/<run_id>/` and mutable metadata overlays as `metadata/runs/<run_id>/`.
That branch is already a results namespace, so it does not include the
`.agentv/results/` prefix.

## Compatibility

This is a hard deprecation of the old experiment-parent layout for
artifact-format v2. New writers do not create
`.agentv/results/<experiment>/<timestamp>/`, and Dashboard/result discovery is
not required to show those legacy bundles.

Users who need old runs to appear in v2 Dashboard views should regenerate or
re-export them into `.agentv/results/<run_id>/` with `experiment` recorded in
`summary.json` metadata. Small parser fallbacks may remain where existing tools
need them for explicit paths, but they are not the product contract.

## Consequences

Positive:

- A run id is the only committed run-bundle path identity.
- Experiment grouping is explicit metadata, so copied or re-exported bundles do
  not lose meaning when paths change.
- Dashboard and trend discovery can skip local cache/index namespaces without
  special-casing experiment names.
- Compare dimensions such as experiment, target, variant, samples, retries, and
  tags stay query metadata instead of storage hierarchy.

Negative:

- Old local result directories may disappear from v2 Dashboard discovery until
  regenerated or re-exported.
- Users cannot browse all runs for an experiment by opening one parent folder;
  they should use Dashboard filters, `summary.json.metadata.experiment`, tags,
  or CLI queries.

## Alternatives Considered

### Preserve legacy discovery during migration

Rejected. The product direction for v2 is hard deprecation. Keeping path
fallbacks as a supported discovery mode would keep experiment ancestry as an
implicit source of truth.

### Add `.agentv/results/runs/<run_id>/`

Rejected for this phase. The extra `runs/` segment is redundant in a directory
that already stores results and conflicts with the reserved local namespace
model.

### Rename `index.jsonl` to `manifest.jsonl`

Rejected for this phase. `index.jsonl` is already the wired row-level result
index across CLI, Dashboard, compare/trend, result repo sync, reports, and
adapters. `summary.json` now carries the run-level manifest role.

### Adopt Margin's full `internal/` layout now

Rejected for v2 phase 1. Margin's distinction between portable manifests,
samples, retries, and internal state remains useful, but this phase only moves
committed run bundles to `.agentv/results/<run_id>/` and reserves dot-prefixed
local namespaces for rebuildable state.

## Non-Goals

- Flattening or renaming per-case `run-N/` attempt folders.
- Completing the schema-v2 repeat naming migration. User-facing docs should
  prefer `pass_any` and `pass_all` when they mention repeat strategies, but that
  schema migration is tracked separately.
- Moving Dashboard/search indexes into a committed run bundle.
- Projecting AgentV-owned runs, transcripts, datasets, experiments, or indexes
  into Phoenix.
