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

The final contract keeps authoring and storage separate:

- `eval.yaml` remains the authored experiment spec.
- a CLI invocation produces one timestamped run bundle;
- per-row source identity is stored in `index.jsonl`;
- `suite` and `name` remain display metadata only;
- path discovery comes from the run manifest, not from folder conventions.

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
eval_path + test_id + target
```

`eval_path` is the source eval file path relative to the repo root or run
source root. Dashboard and other readers should display this value as `Eval`.
They should also display `test_id` and `target` so users can distinguish rows
with overlapping test IDs.

`suite` and `name` are display metadata. They may help humans group or label
results, but they must not drive storage, routing, Dashboard detail selection,
rerun lookup, import identity, or artifact discovery.

`index.jsonl` is authoritative for all run-relative artifact paths. Per-row
directories are exposed with `result_dir`. Sidecar paths such as `task_dir`,
`summary_path`, `grading_path`, `metrics_path`, `transcript_path`,
`targets_path`, `files_path`, and `graders_path` are explicit manifest fields.
Consumers must use these fields instead of reconstructing paths from
`suite`, `name`, `test_id`, or `target`.

`result_dir` is an opaque run-local allocation. It should stay readable when
that does not compromise uniqueness, but implementations may suffix or allocate
otherwise to avoid collisions. Its value is not the public identity of the row.

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

## Non-Goals

- Defining an `experiment.yaml` artifact.
- Adding `eval_root`.
- Hashing eval paths into default experiment names.
- Creating automatic `multi-eval` experiment names.
- Making `result_dir` a semantic folder contract.
- Removing compatibility readers for older run bundles in this ADR.
