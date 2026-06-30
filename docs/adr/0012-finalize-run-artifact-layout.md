# 12. Finalize run artifact layout at the timestamp bundle

Date: 2026-06-30

## Status

Accepted

Supersedes the target/variant folder fan-out portions of
[ADR 0009](0009-eval-path-result-identity-and-default-experiment.md) and
[ADR 0006](0006-separate-experiments-from-eval-definitions.md). Extends
[ADR 0011](0011-result-output-artifact-contract.md), which keeps result output
run-centric and manifest-first.

## Context

AgentV now treats the timestamped result directory as the run bundle boundary:

```text
.agentv/results/<experiment>/<timestamp>/
```

Earlier same-week decisions used target and variant folders below the timestamp
to avoid sidecar collisions in multi-target runs. The implementation has since
settled on allocated per-row result directories with readable test-id prefixes
and short hash suffixes. That allocation already solves collisions without
making target, model, variant, suite, or test IDs path dimensions.

The relevant implementation points are:

- `apps/cli/src/commands/eval/result-layout.ts` creates default run roots as
  `.agentv/results/<experiment>/<timestamp>/` and keeps `index.jsonl` as the
  manifest filename.
- `packages/core/src/evaluation/run-artifacts.ts` writes `summary.json`,
  `index.jsonl`, and per-result sidecars under allocated `result_dir` folders
  such as `<safe_test_id>--<short_hash>/run-1/`.
- `apps/cli/src/commands/results/manifest.ts`,
  `apps/cli/src/commands/results/serve.ts`, and
  `packages/core/src/evaluation/results-repo.ts` consume explicit manifest
  fields such as `result_dir`, `summary_path`, `grading_path`, `metrics_path`,
  and `transcript_path` instead of deriving sidecar locations from directory
  names.

## Decision

New AgentV runs write one run bundle at:

```text
.agentv/results/<experiment>/<timestamp>/
  summary.json
  index.jsonl
  tags.json                 # optional mutable overlay
  <allocated-result-dir>/
    summary.json
    test/                   # optional generated test bundle
    run-1/
      result.json
      grading.json
      metrics.json
      timing.json
      transcript.jsonl
      transcript-raw.jsonl
      outputs/
    run-2/
      ...
```

Do not add `target`, `model`, `variant`, or `cases` as required folders below
or above `<timestamp>`. Target, model, provider, variant, eval path, suite, and
test identity are metadata. They belong in root `summary.json.metadata` for
run-level facts and in `index.jsonl` rows for row-level filtering and artifact
discovery.

`index.jsonl` remains the filename for the run manifest/result index. The name
is established across CLI, Dashboard, result repo sync, compare, trend, and
adapter code. Renaming it would create churn without improving the contract.
Documentation should call it the run manifest or result index where that role is
clearer.

`result_dir` values are opaque run-local allocations. Writers should keep them
readable when possible, using a safe test-id or slug prefix plus a UUID/hash-like
suffix, but consumers must not parse identity from those names. Consumers must
resolve ordinary sidecars through explicit `index.jsonl` fields such as:

- `result_dir`
- `summary_path`
- `grading_path`
- `timing_path`
- `metrics_path`
- `transcript_path`
- `transcript_raw_path`
- `answer_path`
- `test_dir`

## Compatibility

Legacy bundles that already contain target-folder manifests remain readable.
Readers may discover nested `index.jsonl` files when a run root has no direct
manifest, and they must continue to honor legacy `index.jsonl` rows whose
explicit paths point into old target-folder layouts. Do not move old artifacts
as part of this decision.

When a root `index.jsonl` exists, it is the authoritative manifest for that run
directory. Nested target-folder manifests are legacy compatibility input, not a
new writer contract.

## Consequences

Positive:

- New run bundles have one obvious root manifest and summary.
- Dashboard and results-repo listings can use root `summary.json.metadata`
  fields such as `targets` without walking per-result rows for basic run facts.
- Multi-target and variant rows still avoid filesystem collisions through
  allocated result directories.
- Target/model comparisons stay a query over run and row metadata instead of a
  storage hierarchy.

Negative:

- Humans cannot browse target folders under a timestamp. They must use
  `summary.json`, `index.jsonl`, Dashboard filters, or compare tooling.
- Some accepted same-week ADR text now requires this superseding ADR for the
  final layout.

## Alternatives Considered

### Target or model folders under the timestamp

Rejected. Target/model folders make storage look semantic and encourage readers
to infer identity from paths. They also create needless nesting for the
single-target case and become awkward when target, provider, model, variant, and
runtime policy are all useful comparison dimensions.

### Target folders above the timestamp

Rejected. Moving target above timestamp fragments one run invocation into
multiple run roots and makes run-level summary metadata harder to define.

### A `cases/` parent folder

Rejected. `index.jsonl` already distinguishes control-plane files from
per-result sidecars. Adding `cases/` would be a cosmetic migration with no
current reader or writer need.

### Rename `index.jsonl`

Rejected. The file acts as the run manifest/result index, but the established
filename is portable and already wired through CLI, Dashboard, result repo, and
adapter code.

### Add `internal/` now

Rejected for artifact-format v1. A future artifact-format v2 migration may add
an `internal/` directory for machine-facing caches or implementation details,
but v1 keeps canonical files at the run root and per-result allocations under
explicit manifest paths.

## Non-Goals

- Moving or rewriting existing target-folder artifacts.
- Renaming `index.jsonl`.
- Defining a new result database or derived Dashboard index.
- Finalizing a full run-level model metadata schema. Root `summary.json.metadata`
  already carries `targets`; richer provider/model fields can be added
  additively when the Dashboard run-list work needs them.
