# 6. Keep experiment runtime inline in eval YAML

Date: 2026-06-26

## Status

Accepted

Supersedes: the 2026-06-23 proposal in this file to separate experiment files
from eval definitions.

## Context

AgentV needs a stable authoring contract for repo-native evals, run-time knobs,
suite composition, and portable result artifacts.

The previous proposal split experiments into separate committed artifacts such
as `experiment.yaml` or `experiments/default.yaml`. That proposal correctly
separated task definition from run-time configuration, but it introduced a
second runnable authoring surface before the shape had shipped. Because the
separate experiment surface was added this week and has not shipped to real
external consumers, AgentV can converge hard now instead of preserving a second
config model or migration alias.

The final design keeps the product boundary smaller:

- `eval.yaml` is the only runnable authoring artifact.
- `experiment:` is an inline run-time block inside `eval.yaml`.
- `tests:` is the composition, import, and selection surface.
- result bundles are written under `.agentv/results/<eval-name>/<timestamp>/`.

This keeps AgentV repo-native and zero-infra by default, avoids a new public
artifact type, and still lets wrapper evals run multiple imported suites with a
single parent run-time policy.

## Decision

AgentV will not have a separate experiment artifact surface.

Do not introduce or document:

- `experiment.yaml`
- `experiments/default.yaml`
- config pointers to external experiment files
- committed experiment files as the canonical authoring path

The only runnable authoring artifact is `eval.yaml` or another `*.eval.yaml`
file. Runtime controls live in an inline `experiment:` block:

```yaml
name: cargowise-sql-migration-codex

experiment:
  target: agent
  workers: 4
  threshold: 0.8
  repeat:
    count: 3
    strategy: pass_at_k
  timeout_seconds: 900
  budget_usd: 2.00
  setup:
    - command: ./scripts/install-skills.sh

tests:
  - include: ./evals/cargowise/database/*.eval.yaml
    import: suite
    select: "pr50857-*"

  - include: ./evals/cases/**/*.cases.yaml
    import: tests
```

`experiment:` is canonical for new eval YAML. `execution:` remains a legacy
alias only for already-existing eval files. Docs, examples, schema snapshots,
and new fixtures should use `experiment:`. New surfaces should not teach
`execution:` except when documenting compatibility for old eval files.

The old experiment runtime fields are ported into the parent eval file:

- target or target matrix
- workers
- thresholds
- repeat policy such as `count` and `pass_at_k`
- timeout
- budget
- runtime setup commands
- other run-time controls that do not define the task itself

Suite or case workspace fields remain task-owned when they define what is being
evaluated. Experiment setup remains parent-owned when it changes the candidate
or run condition being measured against the same task.

## Tests Import Surface

`tests:` is the only composition, import, and selection surface.

`include:` accepts direct paths and glob patterns. The file extension and
`import:` mode determine how the import is interpreted:

- `include: **/*.eval.yaml` imports eval suites.
- `include: **/*.cases.yaml` imports raw cases.
- `include: **/*.jsonl` imports raw cases.

`select:` filters imported test ids with one glob pattern or a list of glob
patterns. Imported tests run in deterministic order: resolved path first, then
the test order inside each resolved source.

`import: suite` preserves the imported suite task contract. That includes suite
metadata, `workspace`, shared `input`, shared `assertions`, and tests. The child
suite's `experiment:` block, or legacy `execution:` block, is ignored and
replaced by the parent eval's `experiment:` block.

`import: tests` imports only raw test entries. It intentionally drops shared
suite context such as workspace, shared input, and shared assertions. Use this
mode only when the imported file is a case corpus or when dropping suite context
is the desired behavior.

Parent suite-level task fields should not silently override imported suite task
fields. Explicit override syntax can be considered later if a concrete use case
needs it, but the default composition model must not merge task contracts in a
surprising way.

## WTG Motivation

The WTG database migration eval
`evals/cargowise/database/data-transformation-pr50857-e2e.eval.yaml` has
suite-level `execution`, `workspace`, `input`, and `assertions`.

When a wrapper eval imports it with `import: suite`, AgentV must preserve its
shared `workspace`, `input`, and `assertions` because those fields are part of
the task contract. Its `execution` block is the legacy spelling for child
runtime configuration. Under this decision, the child runtime block is treated
as child `experiment`/legacy `execution` and ignored in favor of the parent
wrapper eval's `experiment:`.

This is the motivating distinction:

- task context from imported suites is preserved;
- child runtime policy from imported suites is replaced by the parent runtime
  policy;
- raw-case imports do not inherit suite context.

## Result Layout

The canonical writer path is:

```text
.agentv/results/<eval-name>/<timestamp>/...
```

There is no `.agentv/results/runs` segment in canonical writer output. There is
also no default nested suite segment when the result group is already the eval
name.

If a wrapper eval imports many suites, individual test artifacts retain source
suite metadata in manifests and index rows. AgentV should not add a redundant
directory segment by default only to represent source suite membership.

## Consequences

Positive:

- AgentV has one runnable YAML authoring surface instead of two.
- The schema stays easier for humans and AI agents to understand.
- Runtime fields still have a clear home without external experiment pointers.
- Wrapper evals can compose suites while applying one parent run policy.
- Same-week unshipped experiment-file work can be removed without carrying
  long-term compatibility aliases.

Negative:

- A parent eval that imports suites now carries both task composition and
  runtime policy in one file, so docs must explain the boundary clearly.
- Existing `execution:` examples need to migrate to `experiment:` over time,
  while the loader keeps `execution:` as a legacy alias for already-existing
  evals.
- Explicit task-context override syntax is deferred, so authors who need
  overrides must create a new suite or wait for a focused override design.

## Non-Goals

- Do not add separate `experiment.yaml` files or an `experiments/` convention.
- Do not add config pointers to external experiment files.
- Do not present committed experiment files as canonical docs examples.
- Do not make child suite runtime blocks participate in parent wrapper runtime
  selection.
- Do not silently override imported suite task fields from parent suite fields.
- Do not encode source suite membership by adding redundant default result path
  segments.

## References

- Strategy: [STRATEGY.md](../../STRATEGY.md)
- Roadmap: [ROADMAP.md](../../ROADMAP.md)
- Product boundary: [.agents/product-boundary.md](../../.agents/product-boundary.md)
- Technical conventions: [.agents/conventions.md](../../.agents/conventions.md)
