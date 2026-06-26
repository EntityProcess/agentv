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

## Alignment with experiment separation

The 2026-06-23 experiment/eval separation decision makes runtime binding an
experiment concern. Harbor execution should follow the same split:

- AgentV eval YAML remains the authoring or selection surface for what benchmark
  suite is being evaluated.
- AgentV experiment YAML selects or pins the Harbor runner, candidate
  agent/model, run policy, and other runtime binding.
- Harbor-authored YAML remains Harbor's own config surface when the standard
  suite needs Harbor-specific task packaging or verifier settings.

This means the examples below describe the desired logical fields, but new
runtime fields should be placed on an experiment unless they are genuinely part
of the benchmark suite identity. Do not put candidate agent/model binding in the
eval file for new AgentV-native examples.

## Minimal future config surface

An AgentV eval suite can select the benchmark source without copying Harbor's
task schema or claiming to be the runtime runner:

```yaml
name: swebench-verified

source:
  type: harbor
  dataset: swebench-verified
```

The corresponding experiment selects how that suite runs:

```yaml
name: swebench-verified-codex
target: codex-gpt5-mini
evals: evals/swebench-verified.eval.yaml
runner:
  type: harbor
  options:
    opik:
      enabled: true
```

For a Harbor-authored YAML file, use `config` instead of `dataset`:

```yaml
source:
  type: harbor
  config: ./harbor/swebench-verified.yaml
```

The first implementation should accept exactly one Harbor source selector:
`dataset` for a known Harbor dataset id, or `config` for an existing Harbor YAML
file. There should be no precedence rule between them. If both are set, fail
validation and ask the user to choose one.

Do not combine Harbor suite selection with candidate binding in the eval file:

```yaml
# Avoid in eval.yaml
execution:
  runner: harbor
  harbor:
    dataset: swebench-verified
    agent: codex
    model: openai/gpt-5-mini
```

Split that shape across the suite and experiment instead:

```yaml
# evals/swebench-verified.eval.yaml
name: swebench-verified
source:
  type: harbor
  dataset: swebench-verified
```

```yaml
# experiments/swebench-verified-codex.yaml
name: swebench-verified-codex
target: codex
model: openai/gpt-5-mini
evals: evals/swebench-verified.eval.yaml
runner:
  type: harbor
```

Keep Harbor suite source selection under `source` in the eval suite. Keep
experiment-side runner selection under `runner.type`, with runner knobs under
`runner.options`. The eval suite answers "where do these cases come from?"; the
experiment answers "how is this run executed?" Do not use `execution.runner` in
new eval-suite examples because that name collides with the experiment runner.
Do not repeat the runner discriminator as `runner.harbor.options`; `type:
harbor` already provides that namespace.

Do not add top-level AgentV fields for Harbor task packaging, verifier images,
task patches, or Docker/Compose adapter settings. If a Harbor option becomes too
specific to standardize, users should put it in the referenced Harbor YAML file
instead of AgentV adding a pass-through field.

If the Harbor integration later changes the eval source or experiment runner
schema, this ADR should be updated with the final shape. The boundary decision
is stable: Harbor runtime binding is not an eval-case schema extension.

## CLI invocation strategy

Native evals continue to run with the existing command:

```bash
agentv eval evals/native.eval.yaml --target codex
```

Harbor-backed evals should use the same top-level entrypoint. If no explicit
experiment runner is configured, AgentV may infer Harbor execution from
`source.type: harbor`:

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
Harbor `agent`, `model`, and matrix behavior should come from the experiment or
the referenced Harbor YAML until repeated usage proves a shared AgentV flag is
needed.

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
2. Add schema validation for eval-suite `source.type: harbor` and exactly one of
   `source.dataset` or `source.config`, plus experiment `runner.type` and
   `runner.options`, with no changes to native workspace acquisition.
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
