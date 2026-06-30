# 2. Keep Harbor benchmark execution behind a runner boundary

Date: 2026-06-17

## Status

Proposed

Superseded for eval authoring placement on 2026-06-30 by GitHub issue #1575 /
Bead `av-ogpn.1`: top-level `experiment:` is no longer an authored eval YAML
field. Use top-level `target` and `policy`; keep Harbor-specific runner options
behind adapter boundaries.

## Context

AgentV now has native workspace repository acquisition for custom evals, CI
gates, target comparisons, pooled workspaces, hooks, and Docker workspace cases.
That should remain generic infrastructure: `workspace.repos[].commit` is the
canonical checkout pin. SWE-Bench `base_commit` is upstream/import vocabulary
that adapters may translate into `commit`; it should not become the canonical
AgentV workspace field.

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

## Alignment with inline experiment runtime

The 2026-06-26 inline experiment decision keeps runtime binding inside the
single runnable `eval.yaml` artifact. Harbor execution should follow the same
split:

- AgentV eval YAML remains the authoring or selection surface for what benchmark
  suite is being evaluated.
- The inline `experiment:` block selects or pins the Harbor runner, candidate
  agent/model, run policy, and other runtime binding.
- Harbor-authored YAML remains Harbor's own config surface when the standard
  suite needs Harbor-specific task packaging or verifier settings.

This means the examples below show the desired logical fields, but new
runtime fields should be placed under `experiment:` unless they are genuinely
part of the benchmark suite identity. Do not put candidate agent/model binding
under `source` for new AgentV-native examples.

## Minimal future config surface

An AgentV eval suite should not gain a generic top-level `source` field just to
select Harbor. ADR 0009 keeps benchmark-shaped evals on existing primitives:
workspace setup belongs in `workspace`, runtime binding belongs in
`experiment`, and imported benchmark provenance belongs in metadata, sidecars,
or adapter manifests.

If a future Harbor adapter needs first-class selection in AgentV YAML, it should
be designed as a narrow runner/import selector after real usage, not as a broad
benchmark source schema. The corresponding inline experiment block still selects
how that suite runs:

```yaml
name: swebench-verified-codex

experiment:
  target: codex
  model: openai/gpt-5-mini
  runner:
    type: harbor
    options:
      opik:
        enabled: true
```

Do not combine Harbor suite selection with candidate binding in an invented
source block:

```yaml
# Avoid in eval.yaml
source:
  runner: harbor
  dataset: swebench-verified
  agent: codex
  model: openai/gpt-5-mini
```

Keep runtime binding in `experiment:` instead:

```yaml
name: swebench-verified

experiment:
  target: codex
  model: openai/gpt-5-mini
  runner:
    type: harbor
```

Keep runtime runner selection under `experiment.runner.type`, with runner knobs
under `experiment.runner.options`. Do not use `execution.runner` in new
eval-suite examples because top-level `execution:` is only a legacy alias for
old eval files. Do not repeat the runner discriminator as
`runner.harbor.options`; `type: harbor` already provides that namespace.

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
experiment runner is configured, a future adapter may infer Harbor execution
from an adapter-owned manifest or CLI flag, but this ADR does not add that
schema:

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
Harbor `agent`, `model`, and matrix behavior should come from inline
`experiment:` runtime fields or the referenced Harbor YAML until repeated usage
proves a shared AgentV flag is needed.

## Unsupported fields and non-goals

The Harbor runner mode should not add or interpret:

- Harbor `task.toml` as AgentV eval schema;
- `workspace.repos` rows for Harbor-owned suite task acquisition;
- `workspace.docker` verifier image fields for Harbor-owned suite execution;
- per-case SWE-Bench fields such as `test_patch`, `fail_to_pass_tests`, or
  `base_commit` as Harbor runner inputs;
- generic `extra_args` or arbitrary pass-through maps in the initial AgentV
  surface.
- generic top-level `source` as a replacement for AgentV `workspace` or
  metadata conventions.

These fields remain valid in native AgentV evals when authors compose their own
workspace, hooks, and graders. They are non-goals only for the Harbor-backed
standard-suite path.

## Implementation sequencing

1. Document the native-vs-Harbor boundary and commit alias rules.
2. Add a narrow Harbor runner/import selector only after repeated usage proves
   it is needed; keep inline `experiment.runner.type` and
   `experiment.runner.options`, with no changes to native workspace acquisition.
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
