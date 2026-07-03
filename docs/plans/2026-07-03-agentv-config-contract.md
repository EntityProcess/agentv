---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: av-vrx8-research
execution: code
title: "AgentV composable config contract"
created_at: 2026-07-03
type: feature
bead: av-y7eq.1
---

# AgentV composable config contract

## Goal Capsule

- **Objective:** Give AgentV one clean config graph that works as project
  manifest, eval definition, and composable split-file config without copying
  Promptfoo's legacy naming baggage.
- **Core decision:** `.agentv/config.yaml` and `eval.yaml` use the same eval
  config graph for eval-definition fields. `.agentv/config.yaml` is the
  project-root manifest and can additionally carry project defaults and policy.
- **Primary Bead:** `av-y7eq.1`
- **Related Beads:** `av-y7eq`, `av-y7eq.8`
- **Non-goal:** Do not create separate competing schemas for project config and
  eval config unless a field is intentionally scoped to one context.

## Summary

AgentV should have one composable/decomposable config graph.

Small projects can keep everything in `.agentv/config.yaml`. Larger projects can
split any supported field into a `file://...` reference whose target file
contains that field's value. Both forms normalize to the same internal shape.

This follows Promptfoo's useful authoring posture without copying all Promptfoo
field names. Promptfoo commonly lets `promptfooconfig.yaml` contain providers,
prompts, tests, defaultTest, and run options directly, and also lets those fields
point at files. AgentV should do the same at the graph level while preserving
AgentV terms such as targets, graders, projects, and run bundles.

## Contract

### Config Graph

`.agentv/config.yaml` can technically contain every supported field that an
`eval.yaml` can contain:

```yaml
targets:
  - id: codex-local
    provider: codex-app-server
    runtime: host
    config:
      command: ["codex", "app-server"]
      model: gpt-5-codex

graders:
  - id: openai-grader
    provider: openai
    config:
      model: gpt-5-mini

tests:
  - id: smoke
    input: "Fix the failing test"

defaults:
  target: codex-local
  grader: openai-grader

execution:
  max_concurrency: 3
```

An `eval.yaml` is a focused, shareable slice of the same graph. It may contain
targets, graders, tests/evaluators, datasets, defaults, execution overrides, and
other eval-definition fields. `.agentv/config.yaml` is the project-root
manifest, so it may also own persistent project defaults and policy.

### Scope Distinction

The schemas should be shared where the field meaning is shared, but the file
roles are not identical:

| File | Role |
| --- | --- |
| `.agentv/config.yaml` | Project-root manifest. Provides automatic discovery, checked-in defaults, repo-local policy, result/artifact adjacency, and composition against global defaults. |
| `eval.yaml` | Portable eval slice. Good for sharing, one-off suites, examples, or benchmark-specific overrides. |
| `$AGENTV_HOME/config.yaml` | User/operator defaults across projects. May include project registry, default result locations, or global provider defaults. |

Do not pretend every field is valid in every context. Project identity,
Dashboard project registry, and persistent operator defaults belong in
`.agentv/config.yaml` or global config, not an eval slice. Eval-definition
fields should remain shared.

### Field References

Any supported config field can be decomposed into a direct `file://...` reference
whose target file contains that field's value:

```yaml
targets: file://targets.yaml
graders: file://graders.yaml
tests: file://tests.yaml

defaults:
  target: codex-local
  grader: openai-grader
```

Referenced array-valued fields contain a bare array:

```yaml
# .agentv/targets.yaml
- id: codex-local
  provider: codex-app-server
  runtime: host
  config:
    command: ["codex"]
```

```yaml
# .agentv/tests.yaml
- id: smoke
  input: "Fix the failing test"
```

Referenced object-valued fields contain a bare object:

```yaml
# .agentv/defaults.yaml
target: codex-local
grader: openai-grader
```

Do not introduce a separate `files:` or `imports:` table unless AgentV needs a
capability direct field references cannot express. The field being configured
names the value being loaded.

Do not accept wrapped forms such as `targets: [...]` inside a file already
loaded through `targets: file://targets.yaml`, or `tests: [...]` inside a file
loaded through `tests: file://tests.yaml`. The referenced file is the field
value.

### Target And Grader Fields

Target objects use:

| Field | Meaning |
| --- | --- |
| `id` | Stable AgentV identity for selection, artifacts, dashboard, and comparisons. |
| `provider` | Adapter/control boundary such as `codex-cli`, `codex-app-server`, `pi-rpc`, `claude-cli`, or `openai`. |
| `runtime` | Coding-agent execution placement: `host`, `profile`, or `sandbox`. |
| `config` | Provider-specific configuration such as `model`, `command`, timeouts, env, protocol, and provider knobs. |

Use `defaults.target` and `defaults.grader` for run defaults. Do not put
`grader_target` on targets.

Use `config.command` as a non-empty argv array for process-backed providers:

```yaml
config:
  command: ["codex-personal", "app-server"]
```

Do not add parallel `args`, `arguments`, `executable`, or `binary` fields in the
authored contract.

### Execution Policy

Use `execution.max_concurrency` for general eval parallelism:

```yaml
execution:
  max_concurrency: 3
```

Promptfoo evidence checked on 2026-07-03:

- DeepWiki for `promptfoo/promptfoo` reports general concurrency through
  `evaluateOptions.maxConcurrency`, `commandLineOptions.maxConcurrency`, and
  CLI `--max-concurrency` / `-j`.
- Local Promptfoo clone
  `/home/entity/projects/promptfoo/promptfoo` at
  `6bfc5a0c7f16f9c4717ac731d276b578e63d0769` verifies that `src/node/doEval.ts`
  resolves `maxConcurrency` from CLI, `commandLineOptions`, `evaluateOptions`,
  then default, and that Python `config.workers` is provider-specific in
  `src/providers/pythonCompletion.ts`.

Therefore, `workers` should not be AgentV's general run-policy field. Reserve it
for provider-specific config only when a provider truly manages worker
processes.

## Rejected Baggage

Do not include these in the greenfield authored contract:

- `label` or `name` as target identity.
- bare ambiguous provider aliases such as `provider: codex`.
- target-level `grader_target`.
- user-configurable `dashboard.app_name`.
- process field variants `executable`, `binary`, `args`, `arguments`.
- target-level `workers`, batching, retry, or subagent-dispatch controls.
- compatibility-only wrapper files for direct field refs.

## Implementation Notes

- Implement refs as field-level resolution before schema normalization.
- Keep wire-format keys `snake_case`; translate to internal TypeScript
  `camelCase` only at boundaries.
- Ensure inline and split forms produce identical normalized objects.
- Validation errors should point to the authored path, including the referenced
  file path when applicable.
- Public docs should show both inline and split-file forms, without presenting
  split files as mandatory.
- Migration text is unnecessary unless a later decision requires backward
  compatibility.

## Acceptance Criteria

- `.agentv/config.yaml` can inline targets, graders, tests/evaluators, defaults,
  and execution policy.
- `eval.yaml` can contain the same eval-definition fields and normalize through
  the same schema path.
- Any supported field can be a `file://...` ref whose file contains that field's
  value.
- Inline and split forms normalize identically.
- Context-scoped fields are validated according to file role, so project/global
  identity and registry fields do not accidentally become portable eval-slice
  fields.
- `execution.max_concurrency` is the general concurrency field.
- Removed Promptfoo/legacy baggage fields are rejected with focused errors.
