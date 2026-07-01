# 13. Experiment is metadata expressed as `tags.experiment`

Date: 2026-07-01

## Status

Accepted

Extends [ADR 0009](0009-eval-path-result-identity-and-default-experiment.md) and
builds on [ADR 0012](0012-finalize-run-artifact-layout.md), which established
that `experiment` is a mutable run-grouping label recorded in run metadata
rather than a storage-path segment. This ADR closes the `experiment.name`
source loop by giving evals a promptfoo-compatible way to author it.

## Context

AgentV already treats `experiment` as run-grouping metadata: it is written to
`summary.json.metadata.experiment` and each `index.jsonl` row, with provenance
in `runtime_source.experiment_namespace_source`. Until now an eval could only
influence the namespace through the CLI `--experiment` flag or by falling back
to the suite `metadata.name` / eval filename. There was no first-class,
in-eval way to label the experiment.

promptfoo — a widely used lowest-common-denominator eval contract — expresses
run labels through `tags: Record<string,string>` with no first-class
`experiment` field; the convention is a reserved `experiment` tag key. AgentV's
`tags`, by contrast, is a string **list** that drives selection through
`tagsMatch` / `select.tags` and the file-level `--tag` / `--exclude-tag`
filters. The two shapes collide: `tags: {experiment: v1}` (map) does not fit the
existing list shape.

This is the one remaining promptfoo-compat item after deciding to keep
`targets` (promptfoo natively accepts `targets` as a first-class, non-deprecated
alias for `providers`, so no provider/label aliasing is needed).

## Decision

Accept suite-level `tags` as a **union**: the existing string / string-list form
**or** a promptfoo-shaped `Record<string,string>` map. The forms are
additive and non-breaking.

- **List/string form** keeps its exact selection semantics. It continues to
  flow into `metadata.tags`, drive `tagsMatch` / `select.tags`, and back the
  file-level `--tag` / `--exclude-tag` AND-filters. Nothing about selection
  changes.
- **Map form** is promptfoo-shaped run metadata. It is surfaced on the parsed
  suite as `EvalSuiteResult.tags` and is **not** inherited as per-case selection
  tags. The reserved key `experiment` participates in namespace resolution.

The resolved tags map is merged across three layers with precedence
**CLI `--tag key=value` > project config `tags` > eval `tags`**.

`--tag` is dual-mode, mirroring the suite-level union at the CLI boundary:

- `--tag name` (no `=`) — a bare selection tag (existing file-filter behavior).
- `--tag key=value` (contains `=`) — a promptfoo-shaped run-tag entry.
  `--tag experiment=<name>` labels the experiment; `--tag experiment=` is an
  explicit empty value that clears the tag and falls back to the default.

The experiment namespace is resolved with precedence:

```text
--experiment (CLI)  >  tags.experiment  >  default (multi-eval / suite name / filename)
```

`experiment_namespace_source` gains a new `tags` value for provenance, joining
the existing `cli`, `eval_metadata`, `eval_filename`, `multi_eval`, and
`unknown` values. The `experiment_namespace` / `experiment_namespace_source`
contract is otherwise unchanged.

The resolved tags map is emitted to `summary.json.metadata.tags` and to each
`index.jsonl` row (mirroring promptfoo's `evals_to_tags`) so Dashboard
trend/compare can group by `tags.experiment`. Experiment stays metadata: there
is **no** path segment — post-[ADR 0012](0012-finalize-run-artifact-layout.md)
runs already write at the results root.

## Compatibility

Additive and non-breaking. Existing list-form `tags` and the `--tag` selection
filter behave exactly as before. A map-form `tags` on a named suite no longer
throws in metadata validation — the list form still feeds `metadata.tags`, and
the map form is carried separately.

## Consequences

Positive:

- Evals can author their experiment label inline in a promptfoo-compatible way.
- Run grouping is explicit, self-describing metadata on both the summary and
  every row, so Dashboard/compare can group without path inference.
- The `--tag key=value` surface matches promptfoo's shared vocabulary.

Negative:

- `--tag` is overloaded (selection vs metadata). The `=` split keeps this
  unambiguous in practice — selection tags are identifiers that do not contain
  `=` — but the two meanings must be documented together.
- `tags` now has two authored shapes. This is an intentional union to stay
  non-breaking; a future bead may split selection into its own `labels` field
  and make `tags` map-only to match promptfoo exactly.

## Alternatives Considered

### Add a separate CLI flag instead of overloading `--tag`

Rejected. `--tag key=value` is the promptfoo-aligned surface, and the `=` split
mirrors the same list-vs-map union already accepted at the suite level. A second
flag would fragment the vocabulary.

### Make `tags` map-only now and move selection to `labels`

Deferred, not rejected. This is the cleaner long-term shape and matches
promptfoo exactly, but it is a breaking change for every eval that uses list
`tags` for selection. It is noted here as a possible follow-up bead and is
explicitly out of scope.

### Store experiment as a path segment again

Rejected. [ADR 0012](0012-finalize-run-artifact-layout.md) already established
that experiment is mutable grouping metadata, not storage identity.

## Non-Goals

- No `provider` / `providers` alias — `targets` stays (promptfoo accepts it).
- No entry-shape aliasing (`id` / `label` / nested `config`); that belongs in
  the friendly-YAML → promptfooconfig converter, not the parser.
- No repo-wide rename and no run-artifact layout change.
- Splitting selection tags into a map-only `tags` + `labels` field.
