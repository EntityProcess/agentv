# 10. Remove eval dry-run mock execution

Date: 2026-06-28

## Status

Accepted

## Context

`agentv eval --dry-run` replaced the selected eval target with a synthetic mock
target. That avoided live provider spend, but it still ran normal graders and
reported normal quality verdicts against fake candidate output. Deterministic
graders then failed for the right technical reason while presenting a confusing
product signal: users saw quality failures from an execution mode that was not a
real candidate run.

The useful product needs are still valid:

- cheap schema and configuration validation before CI or live runs;
- no-live-provider grader validation against known candidate output;
- deterministic replay of expensive target output;
- dry-run or preview behavior for unrelated import/export tooling.

Those needs do not require a mock candidate hidden behind eval execution.

## Decision

Remove eval execution dry-run mock target behavior. `agentv eval run` does not
expose `--dry-run`, `--dry-run-delay`, `--dry-run-delay-min`, or
`--dry-run-delay-max`, and Dashboard eval launch requests do not send an eval
`dry_run` field.

Use these existing workflows instead:

- `agentv validate` for YAML/schema/configuration checks without executing
  targets or graders.
- Oracle or reference targets, usually implemented with the `cli` provider, for
  no-live-provider quality validation with known-good candidate output.
- Imported transcripts and replay fixtures for frozen candidate output where
  graders should run fresh against recorded artifacts.

Unrelated dry-run and preview flags outside eval execution remain valid, such as
results export dry-run, import preview/dry-run flows, package-manager dry-runs,
and target/provider-specific internal testing controls.

## Consequences

Positive:

- Quality verdicts come from real, oracle, reference, or frozen candidate
  output, not from a fake mock answer.
- Cheap validation has a clearer command: `agentv validate`.
- The eval target selection path is simpler because selected targets are always
  resolved from eval or target configuration.
- Dashboard launch UX no longer offers a control that could produce misleading
  quality failures.

Negative:

- Users who used `agentv eval --dry-run` for quick plumbing checks must switch
  to `agentv validate` or define an explicit mock/reference target.
- Example docs need to avoid using dry-run as a shorthand for no-provider eval
  quality checks.

## Alternatives Considered

- **Keep dry-run but suppress quality verdicts.** Rejected. A run that executes
  graders but hides quality output would introduce another special case in the
  artifact contract.
- **Make dry-run return `expected_output`.** Rejected. That would blur candidate
  output with reference data and turn a plumbing flag into an implicit oracle
  feature.
- **Add a dedicated oracle target feature.** Rejected for now. The `cli` provider
  already composes into oracle/reference targets without new core primitives.
- **Keep only delay options for future tests.** Rejected. The delay knobs existed
  for the removed mock execution path.

## Non-Goals

- Removing dry-run behavior from results export, import, package managers, or
  other non-eval-execution tools.
- Removing provider-specific testing controls such as VS Code target
  configuration dry-run behavior.
- Adding new oracle-target schema.
