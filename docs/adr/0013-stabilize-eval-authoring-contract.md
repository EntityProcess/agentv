# 13. Stabilize eval authoring around experiment, tests, and gate

Date: 2026-07-01

## Status

Accepted

Supersedes the eval-authoring placement portions of
[ADR 0002](0002-keep-harbor-benchmark-execution-behind-runner-boundary.md),
[ADR 0006](0006-separate-experiments-from-eval-definitions.md), and
[ADR 0009](0009-keep-benchmark-schema-on-existing-primitives.md) that moved the
run label out of top-level `experiment`, introduced `policy` as the preferred
runtime wrapper, or treated authoring `tags` as a first-class eval-selection
surface.

Complements [ADR 0012](0012-finalize-run-artifact-layout.md), which keeps
`experiment` as run metadata rather than a result path namespace.

## Context

AgentV's eval YAML needs to stay small enough for humans and agents to author
reliably while still supporting repo-native workspaces, real targets, repeat
runs, gating, and Dashboard comparison.

Recent same-week proposals tried a few competing names:

- removing top-level `experiment` in favor of `policy` or derived labels;
- adding or preserving top-level `tags` as another grouping primitive;
- renaming `tests` / `test_id` to `cases` / `case_id`;
- keeping scalar `threshold` as the CI gate.

Those proposals made the contract less direct. Public peer systems also support
keeping `experiment` as the grouping concept: Vercel `agent-eval` names
experiment config files and result groups as experiments, while Convex Evals
stores and aggregates runs by experiment. Promptfoo also keeps the authored
collection as `tests` while describing each item as a test case; AgentV's test
objects have richer workspace and harness semantics, but the suite-file ->
`tests[]` -> test-case hierarchy is still close enough that renaming the public
field would create more churn than clarity. In contrast, `tags` is usually a
many-valued classification or annotation mechanism, not the single condition
being compared. Agentskills' skill-eval examples call `with_skill` and
`without_skill` configurations, which is useful language for that project but
does not justify replacing AgentV's existing Dashboard and result vocabulary.

AgentV already displays and queries run groups as experiments in Dashboard,
results APIs, compare flows, and CLI `--experiment`. Renaming that axis now
would create churn without simplifying the product.

## Decision

The preferred eval authoring contract is:

```yaml
name: code-generation-quality
experiment: with-skills
target: copilot-sdk
evaluate_options:
  repeat:
    count: 3
    strategy: pass_any
    early_exit: false
  budget_usd: 5
default_test:
  threshold: 0.8
gate:
  min_test_pass_rate: 0.95
  max_execution_errors: 0
tests:
  - id: fizzbuzz
    input: Write FizzBuzz in Python
    assertions:
      - type: contains
        value: "fizz"
```

`name` is the optional top-level suite display name. When omitted, AgentV should
derive the display name from the eval file basename by removing the `.eval.yaml`
suffix, for example `code-generation-quality.eval.yaml` becomes
`code-generation-quality`. Suite `name` is metadata for display and reporting;
it must not drive run identity, experiment grouping, case selection, gating,
artifact routing, cache keys that should track executable behavior, or result
comparison semantics. Source identity belongs to `eval_path` and run metadata,
not to the display name.

`experiment` remains the optional top-level string run/result grouping label.
It names the condition being measured, such as `baseline`, `candidate`,
`with-skills`, or `without-skills`. It is not a runtime-policy object, not a
separate artifact type, and not a storage path namespace. It should not repeat
the suite name, category, target, provider, or model; those are separate
dimensions in run metadata.

Top-level `description` is not part of the preferred eval authoring contract.
Existing files that contain it may be read as legacy display metadata, but it
must be ignored for run identity, experiment grouping, case selection, gating,
artifact routing, cache keys that should track executable behavior, and result
comparison semantics.

`target` remains the system under test. Do not rename it to `agent`; AgentV
targets can be agents, model providers, gateways, replay targets, CLI wrappers,
transcript providers, or future service wrappers.

`evaluate_options` is the preferred home for runner-level execution controls.
This follows promptfoo's separation between test definitions and evaluation
runner options while keeping AgentV's field names in snake_case. The v1 preferred
surface is intentionally small: `repeat`, `budget_usd`, and optional timeout
fields when a suite needs a finite cap. Omitted timeout fields mean unlimited by
default. Concurrency remains an operator/project/target setting, not authored
eval YAML.

`default_test` is the preferred home for inherited per-test defaults. The first
default worth standardizing is `threshold`, because it is a per-test score cutoff
used to classify individual results, not a suite-level release gate. Additional
defaults such as inherited assertions may be added only when implementation work
defines clear merge and override rules.

`tests` remains the preferred authored collection name, and each authored test
case uses `id`. AgentV may use "case" or "test case" in prose when describing an
individual row, but the wire contract remains `tests[]` because that matches the
existing AgentV surface and the common suite-file -> tests -> test-case hierarchy
in peer declarative eval tools.

`test_id` remains the preferred flattened identity field where a record is not
already scoped to one test case, including `index.jsonl`, Dashboard/API
payloads, gate command input, and other result rows. CLI filters continue to use
`--test-id`.

`gate` replaces scalar `threshold` in the preferred schema. Gate is a top-level
suite/run policy that evaluates the completed run. It is not an assertion and
not a per-test inline field. The v1 built-in surface is intentionally small:

```yaml
gate:
  min_test_pass_rate: 0.95
  max_execution_errors: 0
  command: ["bun", "./gates/case-policy.ts"]
  timeout_ms: 60000
```

The executable gate command receives structured completed-run JSON on stdin and
emits structured JSON with `passed`, optional `failures`, and optional
`warnings`. Non-zero exit, invalid JSON, or timeout is recorded as a gate
execution error distinct from assertion or grader failures.

Top-level eval authoring `tags` are removed from the preferred contract. Do not
teach `tags` as a first-class eval YAML grouping or selection field. Use
repo paths, categories, eval file organization, `experiment`, `target`, and
explicit case metadata for durable identity and filtering needs.

Mutable Dashboard or result annotations may still use tags as result metadata,
for example a local `tags.json` sidecar on a run bundle. Those tags are user
annotations over completed results, not authored eval inputs, and they must not
be confused with eval YAML schema.

## Compatibility

This ADR defines the preferred contract. Implementation work must still make an
explicit compatibility decision for existing shipped fields:

- `tests` remains the preferred authored collection name.
- `tests[].id` remains the preferred authored test-case identifier.
- `test_id` remains the preferred flattened result/API/gate identity field.
- `--test-id` remains the preferred CLI filter for selecting authored test
  cases.
- Top-level `repeat`, `budget_usd`, and timeout fields should remain readable
  during migration, with `evaluate_options` preferred in new docs.
- Top-level `threshold` should remain readable during migration, with
  `default_test.threshold` preferred in new docs.
- Existing result tags and Dashboard tag mutation are out of scope for eval YAML
  removal. They remain a result-annotation feature unless a separate ADR removes
  them.

## Consequences

Positive:

- AgentV keeps the same experiment vocabulary across CLI, Dashboard, run
  metadata, compare, and peer-framework comparisons.
- The eval YAML contract is flatter and easier for coding agents to author.
- Tags stop competing with path/category and experiment grouping.
- Gating becomes a clear release-policy step over completed run artifacts rather
  than a scalar hidden among runtime knobs.

Negative:

- Older ADRs and examples that mention `policy`, top-level `tags`, `cases`, or
  scalar `threshold` need cleanup or explicit supersession notes.
- Implementations need compatibility readers until current users and run
  artifacts have migrated.
- Teams that used eval authoring tags for ad hoc grouping need to move that
  grouping to paths, metadata, or result annotations.

## Non-Goals

- Implementing the parser, artifact, CLI, or Dashboard migration in this ADR.
- Removing mutable Dashboard/result tags.
- Adding a `benchmark` top-level wrapper.
- Adding per-case `gate` fields.
- Replacing `target` with `agent`.
- Renaming `grader` to `scorer`.
- Introducing a separate `experiment.yaml` artifact.
