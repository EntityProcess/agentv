# 9. Use eval_path identity and the default result experiment

Date: 2026-06-27

## Status

Accepted

Supersedes: result naming and storage-routing portions of
[ADR 0006](0006-separate-experiments-from-eval-definitions.md) that derive run
bundle names or per-case artifact paths from eval names, suite names, or wrapper
composition.

## Context

AgentV needs one simple result identity contract that works for direct eval
runs, imported evals, repeated attempts, Dashboard inspection, and downstream
tools that consume portable run bundles.

The previous same-week direction kept `eval.yaml` as the authored experiment
spec, but it still let result buckets and per-case paths be inferred from eval
or suite names. That creates unstable routing when a single CLI invocation runs
multiple eval files, imports suites with overlapping case IDs, or changes
display metadata without changing the task under evaluation.

Follow-up dogfood in bead `av-770` found a concrete bug in that direction:
multi-target AgentV runs stored different targets for the same `test_id` under
the same `<case>/run-N` sidecar directory. The second target overwrote the
first target's output, grading, timing, metrics, and case summary artifacts.
Related research in beads `av-74h` and `av-e49` compared Vercel `agent-eval`,
Vercel `next-evals-oss`, and Margin Evals. Those systems confirm that
frameworks can either encode model/variant in experiment names or keep run
manifests as the truth, but none requires AgentV to derive artifact paths from
suite names.

The final contract keeps authoring and storage separate:

- `eval.yaml` remains the authored experiment spec.
- a CLI invocation produces one timestamped run bundle;
- per-row source identity is stored in `index.jsonl`;
- `suite` and `name` remain display metadata only;
- path discovery comes from the run manifest, not from folder conventions.
- per-row sidecar directories are stable storage allocations, not semantic
  routing keys.

## Decision

One AgentV CLI invocation writes one run bundle under:

```text
.agentv/results/<experiment>/<timestamp>/
```

The result experiment bucket is selected in this order:

1. the explicit CLI `--experiment` value;
2. `eval.yaml` `experiment.name`;
3. `default`.

`default` is the canonical bucket when neither the CLI nor the eval file names
an experiment. AgentV does not derive default experiment names from filenames,
suite names, numbers of input eval files, or multi-eval wrapper shapes.

`eval.yaml` stays the authored experiment spec. Do not introduce
`experiment.yaml`, `experiments/default.yaml`, or `eval_root` for this pass.

Each row in `index.jsonl` is identified by:

```text
eval_path + test_id + target + variant
```

`eval_path` is the source eval file path relative to the repo root or run
source root. Dashboard and other readers should display this value as `Eval`.
They should also display `test_id`, `target`, and `variant` when present so
users can distinguish rows with overlapping test IDs.

`suite` and `name` are display metadata. They may help humans group or label
results, but they must not drive storage, routing, Dashboard detail selection,
rerun lookup, import identity, or artifact discovery.

`index.jsonl` is authoritative for all run-relative artifact paths. Per-row
directories are exposed with `result_dir`. Sidecar paths such as `task_dir`,
`summary_path`, `grading_path`, `metrics_path`, `transcript_path`,
`targets_path`, `files_path`, and `graders_path` are explicit manifest fields.
Consumers must use these fields instead of reconstructing paths from
`suite`, `name`, `test_id`, or `target`.

`result_dir` is an opaque run-local allocation. For newly written artifacts, the
preferred allocation is a deterministic row directory directly under the
timestamp:

```text
.agentv/results/<experiment>/<timestamp>/
  index.jsonl
  summary.json
  <row_id>/run-1/
  <row_id>/run-2/
```

There is no required `rows/` parent directory. `row_id` should be stable,
filesystem-safe, compact, and readable enough for humans to scan, for example:

```text
<safe_test_id>--<short_hash>
```

The visible `test_id` prefix is only a convenience. The hash input must include
the collision-prone row fields available at write time: `eval_path` or source
eval identity, `suite` label, `test_id`, `target`, and `variant`. `eval_path`
or equivalent source identity is what prevents duplicate suite names from
colliding; the suite label alone is never a uniqueness boundary. If future row
identity gains another axis, that axis must be included in the hash before it
can affect sidecar allocation.

This row-id allocation is intentionally simpler than conditional path
disambiguation. It avoids special cases for same `test_id` across suites,
duplicate suite labels, multi-target runs, and target variants. Existing run
bundles remain readable because `index.jsonl` already records explicit
run-relative paths; any consumer that infers `<case>/run-N` paths instead of
following `index.jsonl` is depending on an implementation detail and should be
fixed.

Reference alternatives considered:

- Vercel `agent-eval` expands model arrays into experiment paths such as
  `<config>/<model>/<timestamp>/<case>/run-N`. This works for
  model-as-experiment publication but fragments one multi-target invocation and
  lets provider names with slashes become path hierarchy.
- Vercel `next-evals-oss` uses one experiment file per model and `--agents-md`
  variant, then pairs variants during export. AgentV should allow that style by
  experiment naming for published baselines, but not require it for ordinary
  multi-target runs.
- Margin Evals writes one output run directory with result manifests and
  instance artifacts, without an AgentV-style experiment bucket. That validates
  manifest-first storage, but dropping AgentV's experiment bucket is a larger
  semantic change than this bug fix needs.

## Consequences

- A direct run such as `agentv eval evals/a.eval.yaml evals/b.eval.yaml`
  produces one timestamped bundle unless the user explicitly runs separate CLI
  commands.
- The default no-config path is stable:
  `.agentv/results/default/<timestamp>/`.
- Renaming a suite or display name does not move prior results or change
  Dashboard routing identity.
- Multiple eval files can share the same `test_id` and suite display name as
  long as their `eval_path` values differ.
- Import, rerun, Dashboard, comparison, and export tools can load a run from
  `index.jsonl` without needing source checkout conventions.
- Multi-target and variant runs do not need to become multiple experiments just
  to avoid sidecar collisions.
- New sidecar paths may not resemble the case hierarchy, which is acceptable
  because `index.jsonl` is the contract for discovery and display.

## Non-Goals

- Defining an `experiment.yaml` artifact.
- Adding `eval_root`.
- Hashing eval paths into default experiment names.
- Creating automatic `multi-eval` experiment names.
- Making `result_dir` a semantic folder contract.
- Adding a `rows/` directory segment without a concrete implementation need.
- Removing compatibility readers for older run bundles in this ADR.
