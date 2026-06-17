# ADR: Keep Harbor benchmark execution behind a runner boundary

Date: 2026-06-17

Status: Proposed

## Context

AgentV now has native workspace repository acquisition for custom evals, CI
gates, target comparisons, pooled workspaces, hooks, and Docker workspace cases.
That should remain generic infrastructure: `workspace.repos[].commit` is the
canonical checkout pin, and `workspace.repos[].base_commit` is only a
SWE-Bench-friendly alias for the same value.

Harbor owns benchmark-grade execution for standard suites such as SWE-Bench
Verified, Multi-SWE-Bench, Terminal-Bench, and suites with Harbor-specific
Docker or Compose adapters. Those suites carry runtime contracts that should not
be copied into AgentV core: task packaging, verifier images, adapter flags,
result artifacts, and Opik upload behavior.

## Decision

AgentV should support Harbor-backed benchmark execution as a runner boundary,
not as new AgentV task schema.

AgentV core should own:

- native workspaces and generic repo acquisition;
- AgentV run bundle writing and result import;
- CI gates and comparisons over imported metrics;
- links from AgentV results to Harbor jobs and Opik traces.

Harbor should own:

- benchmark dataset acquisition and task packaging;
- suite-specific runtime adapters and verifier images;
- Harbor `task.toml` files and Harbor YAML config;
- Opik trace upload through Harbor when enabled.

## Minimal future config surface

The AgentV eval file should select Harbor with a nested runner config:

```yaml
name: swebench-verified-codex

execution:
  runner: harbor
  harbor:
    dataset: swebench-verified
    agent: codex
    model: openai/gpt-5-mini
    opik:
      enabled: true
```

For a Harbor-authored YAML file, use `config` instead of `dataset`:

```yaml
execution:
  runner: harbor
  harbor:
    config: ./harbor/swebench-verified.yaml
```

The first implementation should accept exactly one Harbor source selector:
`dataset` for a known Harbor dataset id, or `config` for an existing Harbor YAML
file. There should be no precedence rule between them. If both are set, fail
validation and ask the user to choose one.

Keep Harbor-specific options nested under `execution.harbor`. Do not add
top-level AgentV fields for Harbor task packaging, verifier images, task patches,
or Docker/Compose adapter settings. If a Harbor option becomes too specific to
standardize, users should put it in the referenced Harbor YAML file instead of
AgentV adding a pass-through field.

## CLI invocation strategy

Native evals continue to run with the existing command:

```bash
agentv eval evals/native.eval.yaml --target codex
```

Harbor-backed evals should use the same top-level entrypoint and dispatch based
on `execution.runner`:

```bash
agentv eval evals/swebench-harbor.eval.yaml
```

The Harbor runner should:

1. validate the nested Harbor config;
2. launch Harbor through its CLI or API;
3. record the Harbor job id in the AgentV run metadata;
4. wait for completion unless a future async mode is explicitly added;
5. import Harbor outputs into an AgentV run bundle;
6. evaluate AgentV gates against the imported results.

Importing an already-completed Harbor job can be a separate follow-up command:

```bash
agentv results import harbor --job <harbor-job-id>
```

Do not overload native `--target` semantics in the first Harbor runner slice.
Harbor `agent`, `model`, and matrix behavior should come from
`execution.harbor` or the referenced Harbor YAML until repeated usage proves a
shared AgentV flag is needed.

## Unsupported fields and non-goals

The Harbor runner mode should not add or interpret:

- Harbor `task.toml` as AgentV eval schema;
- `workspace.repos` rows for Harbor-owned suite task acquisition;
- `workspace.docker` verifier image fields for Harbor-owned suite execution;
- per-case SWE-Bench fields such as `test_patch`, `fail_to_pass_tests`, or
  `base_commit` as Harbor runner inputs;
- generic `extra_args` or arbitrary pass-through maps in the initial AgentV
  surface.

These fields remain valid in native AgentV evals when authors compose their own
workspace, hooks, and graders. They are non-goals only for the Harbor-backed
standard-suite path.

## Implementation sequencing

1. Document the native-vs-Harbor boundary and commit alias rules.
2. Add schema validation for optional `execution.runner` and
   `execution.harbor`, with no changes to native workspace acquisition.
3. Add a Harbor launch adapter that records job identity and status.
4. Add a Harbor result importer that maps rewards, exceptions, timings,
   artifacts, and Opik trace URLs into AgentV run bundles.
5. Apply existing AgentV gates and comparison primitives to imported Harbor
   results.
6. Add optional async job polling only after the synchronous path is proven.

## Consequences

Positive:

- Keeps AgentV core lightweight and generic.
- Preserves native workspace acquisition for custom and CI-oriented evals.
- Lets Harbor evolve benchmark adapters without AgentV schema churn.
- Gives AgentV a clear place to gate, compare, and display Harbor results.

Negative:

- Standard-suite users need Harbor installed or reachable.
- Harbor runner implementation cannot reuse all native `workspace` features.
- Some future CLI ergonomics may require a second decision after real usage.
