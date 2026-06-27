# 6. Keep experiment runtime inline in eval YAML

Date: 2026-06-26

## Status

Accepted

Supersedes: the 2026-06-23 proposal in this file to separate experiment files
from eval definitions.

Partially superseded by
[ADR 0009](0009-eval-path-result-identity-and-default-experiment.md) for result
experiment bucket precedence, result row identity, and run bundle path naming.

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
- A directory named `experiments/` may be used as a user-owned repo convention
  for wrapper eval YAML files, but it does not create a separate experiment
  artifact type or schema-significant path.

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
file. A project may place wrapper eval files under an `experiments/` directory
when their main job is to bind runtime policy over reusable suites, but those
files are still ordinary eval YAML files. AgentV must not infer behavior from
that directory name. Runtime controls live in an inline `experiment:` block:

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

tests:
  - include: ./evals/cargowise/**/*.eval.yaml
    type: suite
    run:
      threshold: 1.0
      repeat:
        count: 2
        strategy: pass_all
    select:
      test_ids:
        - pr50857-*
        - pr51200-online-*
      tags:
        - sql-migration
        - review
      metadata:
        type:
          - e2e
          - regression
        priority: high

  - include: ./evals/cases/**/*.cases.yaml
    type: tests
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
- other run-time controls that do not define the task itself

Suite or case workspace fields remain task-owned when they define what is being
evaluated.

## Contract Layers

Parent-versus-child is not the main composition rule. Contract ownership is:

| Layer | AgentV fields | Owner in `type: suite` composition |
| --- | --- | --- |
| Task data | `tests`, case `metadata`, `expected_output` | Imported child suite |
| Task prompt | `input`, `input_files`, shared prompt defaults | Imported child suite |
| Task environment | `workspace`, `workspace.repos[]`, templates, workspace hooks | Imported child suite |
| Scoring | `assertions`, graders, expected references | Imported child suite |
| Run policy | `experiment`, CLI target flags, workers, repeat, gates, budget | Parent wrapper eval or CLI |
| Target runtime | selected target config and `targets[].hooks` | Selected target |

`workspace` can influence what an agent perceives through tools, but it is not
prompt input. `input` is what the agent is told; `workspace` is what the agent
can act on; `assertions` are how AgentV judges the result; `experiment` is how
the run is bound, repeated, compared, and gated.

This framing removes the apparent "child wins except experiment" exception.
Child suites own task contracts. Parent wrapper evals and CLI flags own run
contracts.

## Lifecycle Ownership

`experiment:` owns evaluation policy, not lifecycle mutation. Commands that
prepare or reset files, dependencies, repos, or runner-specific configuration
must stay with the lifecycle surface that actually owns that work:

- `workspace.hooks` prepare or reset the workspace under test. Dependency
  installs, builds, fixture generation, case resets, and repo seeding belong
  here.
- `targets[].hooks` prepare the target runner or provider variant. Agent
  discovery files, provider-specific config, and target-specific harness setup
  belong here.
- `experiment:` selects runtime policy: target or target matrix, workers,
  repeat strategy, threshold, timeout, budget, sandbox/runtime knobs, and result
  identity.

This differs from external experiment formats that allow generic scripts on the
experiment object. AgentV keeps those scripts in workspace or target hooks so a
multi-file command such as `agentv eval a.eval.yaml b.eval.yaml` remains a batch
of independent eval-suite runs, rather than one implicit wrapper experiment with
shared mutable setup.

## Tests Import Surface

`tests:` is the only composition, import, and selection surface.

`include:` accepts direct paths and glob patterns. Include entries are
structurally identified by the `include` field, so their `type:` field can use
the ordinary AgentV wire-format discriminator without ambiguity:

- `include: **/*.eval.yaml` imports eval suites.
- `include: **/*.cases.yaml` imports raw cases.
- `include: **/*.jsonl` imports raw cases.

`select:` filters imported cases with the same general selection shape used by
old experiment suite selection. `select.test_ids` filters by test id and maps
directly from old `suites[].select.test_ids`; values may be a string or list of
strings and use existing glob semantics where currently supported.
`select.metadata` filters against each imported test's effective case
`metadata`, after suite-level arbitrary `metadata:` inheritance, top-level suite
`tags`, and case-level `metadata:` merge. Values may be scalars or lists.
`select.tags` is shorthand for filtering effective case `metadata.tags`, with a
string or list of strings. Do not add a separate `case_types` field; use
`select.metadata.type` for case type selection.

Effective case tags are:

```text
dedupe(suite.tags + suite.metadata.tags + case.metadata.tags)
```

For example, this case has effective case tags `cargowise`, `database`,
`sql-migration`, and `review`:

```yaml
tags: [cargowise, database]
metadata:
  tags: [sql-migration]
tests:
  - id: case-1
    metadata:
      tags: [review]
```

Suite tags stay suite identity metadata for discovery and reporting, but they
also flow into effective case tags so `select.tags` can operate on one case-level
view:

```yaml
tags: [cargowise]
tests:
  - id: case-1
```

In that example, `case-1` matches `select.tags: cargowise`.

Imported tests run in deterministic order: resolved path first, then the test
order inside each resolved source.

`type: suite` preserves the imported suite task contract. That includes suite
metadata, `workspace`, shared `input`, shared `assertions`, and tests. The
parent eval still owns one run bundle and one runtime policy. Child suite
`experiment:` blocks are ignored when imported with `type: suite`; they do not
fall back into the parent run. Scoped runtime overrides that the parent wants
to apply to imported tests live in `tests[].run`.

A parent eval that imports any child eval suite with `type: suite` must not
define top-level `workspace`. The wrapper owns runtime policy, not task
environment. Imported child suites keep their own `workspace`, including
`workspace.repos[]`, templates, hooks, and isolation. If the parent should own
workspace context, import raw cases with `type: tests` or shorthand paths
instead of importing an eval suite.

`type: tests` imports only raw test entries. It intentionally drops shared
suite context such as workspace, shared input, and shared assertions. Use this
mode only when the imported file is a case corpus or when dropping suite context
is the desired behavior.

Suite files still support raw-case shorthand imports. A string-valued `tests`
field or a string entry inside the `tests` list is equivalent to an include
entry with `type: tests`:

```yaml
tests: ./cases.yaml
```

```yaml
tests:
  - ./cases/*.cases.yaml
  - include: ./suites/*.eval.yaml
    type: suite
```

The shorthand is only for raw case files or directories. Importing another eval
suite must use object form with `include:` and `type: suite`, so authors cannot
accidentally drop or preserve suite context without saying which behavior they
want.

Do not use `import:` or `kind:` for `tests:` include entries.

Parent suite-level task fields should not silently override imported suite task
fields. Explicit override syntax can be considered later if a concrete use case
needs it, but the default composition model must not merge task contracts in a
surprising way.

If a parent eval defines `workspace` and imports child eval suites with
`type: suite`, AgentV should reject the file during validation and loading.
That removes the ambiguous parent-child workspace merge question from the
authoring model. A parent eval may still define `workspace` when it imports raw
cases with `type: tests`, because those raw cases intentionally use parent
suite context.

If a parent eval has no `experiment:` and imports child suites that do have
`experiment:` blocks, child runtime still does not fall back into the parent
run. AgentV should warn because authors often expect the child runtime to be
used. The correct choices are to run the child suite directly, add a parent
`experiment:` block, or pass CLI runtime flags.

Wrapper evals that import multiple suites with distinct shared workspace
contracts should fail fast or require per-test isolation, separate runs, or an
explicit future composition mode. Shared workspace setup is safe when one suite
owns the task contract; it is not a place for implicit parent-child or
child-child workspace merging.

## Runtime Overrides

The parent `experiment:` block is the default runtime policy for the whole eval.
Some evals need stricter or looser policy for a selected group of tests, such as
`pass_at_k` for stochastic agentic tasks and `pass_all` for hard regression
gates. AgentV supports scoped runtime overrides for scoring and scheduling
policy without creating separate experiment files.

Runtime override precedence is:

```text
test.run > tests[].run > parent experiment
```

Group-level overrides live beside `include`, `type`, and `select`:

```yaml
tests:
  - include: ./evals/flaky-agentic/**/*.eval.yaml
    type: suite
    select:
      tags: [agentic]
    run:
      repeat:
        count: 3
        strategy: pass_at_k

  - include: ./evals/regression/**/*.eval.yaml
    type: suite
    select:
      tags: [must-pass]
    run:
      threshold: 1.0
      repeat:
        count: 2
        strategy: pass_all
```

Case-level overrides use the same `run:` key:

```yaml
tests:
  - id: critical-case
    input: "..."
    run:
      threshold: 1.0
      repeat:
        count: 1
```

Initial scoped override fields should focus on result interpretation and
scheduling:

- `threshold`
- `repeat`
- `timeout_seconds`
- `budget_usd`

Fields that change the candidate or system under test, such as `target` and
`targets`, should remain at the parent `experiment:` level unless a later ADR
accepts narrower per-group semantics. Workspace mutation stays in
`workspace.hooks`; runner setup stays in `targets[].hooks`. Keeping
candidate-changing knobs out of scoped overrides preserves comparable
experiment groups and avoids silently mixing different systems under one result
group.

## WTG Motivation

The WTG database migration eval
`evals/cargowise/database/data-transformation-pr50857-e2e.eval.yaml` has
suite-level `execution`, `workspace`, `input`, and `assertions`.

When a wrapper eval imports it with `type: suite`, AgentV must preserve its
shared `workspace`, `input`, and `assertions` because those fields are part of
the task contract. Its `execution` block is the legacy spelling for child
runtime configuration. Under this decision, the child runtime block is treated
as child `experiment`/legacy `execution`: scoped defaults such as threshold,
repeat policy, timeout, and budget can follow the imported tests, while
candidate-changing fields must be supplied by the parent wrapper eval's
`experiment:`.

This is the motivating distinction:

- task context from imported suites is preserved;
- child runtime policy from imported suites contributes scoped defaults only
  where a parent runtime policy does not override them;
- raw-case imports do not inherit suite context.

## Result Layout

The canonical writer path is:

```text
.agentv/results/<eval-name>/<timestamp>/...
```

There is no `.agentv/results/runs` segment in canonical writer output. There is
also no default nested suite segment when the result group is already the same
eval suite being run directly.

If a wrapper eval imports another suite with `type: suite`, test artifacts from
that imported suite are nested under the imported suite identity:

```text
.agentv/results/<wrapper-eval-name>/<timestamp>/<imported-suite-name>/<test-id>/...
```

The suite segment is required for imported suites because wrapper evals can
compose many suites with overlapping test IDs, and the directory tree should
remain inspectable without reading every manifest row. Test artifacts from tests
owned directly by the wrapper eval can still live directly under `<test-id>`.
All cases should also retain source suite metadata in manifests and index rows.

The result namespace remains `experiment` in artifacts and Dashboard. AgentV
should not introduce a separate authored `run_group` field. For better DX,
Dashboard and reports may derive display-only runtime source labels such as
`inline experiment`, `CLI`, `defaults`, or `mixed`, and may show the top-level
eval file plus imported suites. Those labels are explanations over existing
primitives, not new configuration surface.

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
- Wrapper evals need diagnostics so authors understand that parent workspace is
  invalid with `type: suite` imports and child experiment blocks are ignored.

## Non-Goals

- Do not add separate `experiment.yaml` files.
- Do not make `experiments/` a schema-significant directory or separate
  artifact type; it may only be a repo layout convention for ordinary wrapper
  eval YAML files.
- Do not add config pointers to external experiment files.
- Do not present committed non-eval experiment files as canonical docs examples.
- Do not make child suite runtime blocks participate in parent wrapper runtime
  selection.
- Do not add an authored `run_group` field.
- Do not implicitly merge parent and child workspaces for `type: suite` imports.
- Do not silently override imported suite task fields from parent suite fields.
- Do not encode source suite membership by adding redundant default result path
  segments.

## References

- Strategy: [STRATEGY.md](../../STRATEGY.md)
- Roadmap: [ROADMAP.md](../../ROADMAP.md)
- Product boundary: [.agents/product-boundary.md](../../.agents/product-boundary.md)
- Technical conventions: [.agents/conventions.md](../../.agents/conventions.md)
