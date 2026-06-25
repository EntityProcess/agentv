# ADR: Treat experiments as persisted run profiles

Date: 2026-06-25

Status: Proposed

## Context

AgentV needs a coherent target-selection contract now that experiment files can
carry runtime settings. The immediate question is whether introducing
experiments means AgentV should stop allowing targets in eval YAML.

It should not. `EVAL.yaml` is the eval suite contract: task shape, prompts,
datasets, assertions, fixtures, case references, and any suite-local defaults
needed for the eval to run by itself. `cases.yaml` or JSONL case files are case
data. `.agentv/targets.yaml` is the target provider registry. Experiments are
persisted run profiles: a reviewable YAML form of the CLI choices used for a
run, including which target or targets were selected.

The reason to introduce experiments is not to replace `EVAL.yaml`. It is to
avoid hiding material run settings in an ephemeral CLI invocation or local
operator state. A run should record the selected target, repeat strategy,
timeout, setup, filters, and other runtime knobs so results can be reproduced,
compared, reviewed, and audited.

This decision narrows and clarifies
[ADR 2026-06-23](./2026-06-23-experiments-vs-eval-separation.md): experiments
are first-class run profiles, but eval-local defaults remain part of the suite
contract.

## Vocabulary

- Target provider registry: `.agentv/targets.yaml`, which defines reusable LLM,
  agent harness, or adapter targets.
- Eval suite: `EVAL.yaml`, `*.eval.yaml`, or equivalent suite files. A suite may
  reference external case data and may define fallback target selection needed
  for local self-running.
- Cases file: `cases.yaml`, JSONL, or another dataset file containing reusable
  cases. Cases should not define provider details.
- Experiment: a named, committed or generated run profile that persists CLI-like
  runtime settings for one or more eval suites.
- Run artifact: the portable result bundle. It is discovered through manifests
  such as `summary.json` and run-root `index.jsonl`, not by inferring semantics
  from physical folder depth.

## Decision

AgentV will keep target selection in `EVAL.yaml` as a fallback default. It will
not disable or remove eval-local targets.

The target-resolution precedence is:

1. CLI override, such as `--target`.
2. Experiment `target` or `targets`.
3. Eval suite fallback target selection, such as `execution.target` or
   `execution.targets`.
4. The target named `default`.

The higher-precedence source wins for the selected run. Lower-precedence sources
remain valid defaults but do not merge into the selected target set unless the
runtime explicitly defines a matrix behavior.

Case-level `execution.targets` is an applicability filter over the resolved
target set. It decides which selected targets a case should run against. It is
not a new target provider definition surface and should not override the
experiment or CLI target selection.

Experiments are optional. A simple eval suite should remain runnable with no
experiment file by using eval-local defaults or the target named `default`.
When a user supplies CLI flags without an experiment file, AgentV should still
persist the resolved run configuration in the run bundle so the material choices
are not lost.

Experiments may also persist eval suite file selection with `eval_suites`. This
field uses the same path, glob, directory, and negation syntax as positional
`agentv eval` arguments, and paths are resolved from the project root/current
working directory just like CLI arguments. Experiment `eval_cases` is the
case/test-id filter over the selected suites. Existing experiment `evals`
remains a legacy alias for `eval_cases`.

The eval-file selection precedence is:

1. CLI positional eval paths.
2. Experiment `eval_suites`.
3. Config/default discovery only for compatibility paths that already rely on
   experiment `evals` as a case filter.

The higher-precedence source chooses the eval files for the run. The lower
source does not merge in extra suites. Experiment `eval_cases` can still narrow
cases after either CLI paths or `eval_suites` select the files.

Run artifacts should model results as rows across the stable axes:

- experiment or run profile name
- eval suite
- case id
- resolved target
- attempt or repeat index, when applicable

Within a run workspace, AgentV should also use a human-readable physical layout
that matches those axes where it helps inspection:

- Single-target run: `<suite>/<case-id>/run-N/`
- Multi-target run: `<suite>/<case-id>/<target>/run-N/`

The `target` segment appears only when the same run selected multiple targets.
`run-1` is written even for a single execution so the layout does not fork
between normal and repeated cases. When no suite metadata exists, the artifact
writer may fall back to the historical `<case-id>/run-N/` layout for
compatibility.

This physical layout is not a discovery API. Dashboard and other readers must
continue to follow explicit manifest fields such as `artifact_dir`,
`summary_path`, `grading_path`, `metrics_path`, and `timing_path` instead of
deriving meaning from folder depth.

## Consequences

Positive:

- Evals stay self-runnable and easy to author.
- Experiments make CLI choices explicit, reviewable, and reproducible.
- Existing eval files and examples that define suite-level targets remain valid.
- A suite can default to an LLM target while another defaults to an agent harness
  target, and a shared experiment or CLI override can still select a different
  target when needed.
- AgentV avoids duplicating task definitions just to compare targets.

Negative:

- AgentV keeps more than one valid target source, so diagnostics must report
  which source won.
- The schemas and docs need to be precise about `target` versus `targets` and
  about suite-level defaults versus case-level filters.
- Existing code paths that treat CLI `--target default` as "no override" or
  that cannot select eval-local target aliases from CLI need cleanup.
- Artifact metadata needs a resolved run configuration even when no experiment
  file was supplied.

## Implementation Notes

Likely implementation follow-ups:

- Validate mutually exclusive `target` and `targets` where both would be
  ambiguous, especially in experiment files.
- Keep legacy top-level eval `target` as a compatibility alias, but document
  `execution.target` and `execution.targets` as the suite-level defaults.
- Treat CLI `--target default` as an explicit override to the target named
  `default`, not as an omitted override.
- Resolve target aliases and hook variants consistently when CLI or experiment
  selection references eval-local target entries.
- Persist resolved run settings in run bundle metadata or a `run_config`
  artifact even for raw CLI runs.
- Fix documentation that implies runtime choices belong only in experiments.
- Store artifacts under suite namespaces when suite metadata is available, and
  add the target namespace only for multi-target runs.
- Clarify that case-level `execution.targets` is a filter; if singular
  case-level `execution.target` is documented, either implement it or remove the
  documentation.

Suggested follow-up bead title:

`Clarify target precedence across CLI experiments and eval defaults`

## Non-Goals

- Do not remove `EVAL.yaml` target defaults.
- Do not make experiment files mandatory for local eval runs.
- Do not move provider definitions from `.agentv/targets.yaml` into experiments
  or eval suites.
- Do not make readers discover results by walking the physical artifact tree.
- Do not use experiments as a replacement for reusable case data files.

## References

- [ADR 2026-06-23: Separate experiments from eval definitions](./2026-06-23-experiments-vs-eval-separation.md)
- [STRATEGY.md](../../STRATEGY.md)
- [ROADMAP.md](../../ROADMAP.md)
