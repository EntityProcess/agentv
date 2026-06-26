---
title: "feat: Separate experiments from eval definitions"
type: feat
date: 2026-06-23
origin: docs/adr/0006-separate-experiments-from-eval-definitions.md
---

# feat: Separate experiments from eval definitions

## Summary

AgentV should separate eval task definitions from experiment run definitions.
Eval YAML stays the canonical authoring layer for prompts, datasets, assertions,
and task fixtures. Experiments become first-class committed files that select the
agent or target under test, model, harness options, setup injection, run knobs,
and case filter.

This should ship in phases. Phase 1 adds the non-breaking foundation:
experiment contract types, default experiment resolution, and artifact
attribution by resolved experiment name. Later phases move runtime controls out
of `eval.yaml execution`, teach the CLI to run experiment matrices, and record
full experiment provenance and fingerprints in run bundles.

## Problem Frame

Today `experiment` is a string label passed through
`packages/core/src/evaluation/evaluate.ts`, `packages/core/src/evaluation/run-artifacts.ts`,
`packages/core/src/evaluation/results-repo.ts`, and
`packages/core/src/evaluation/trace-envelope.ts`. Runtime choices are still
scattered across CLI flags, TypeScript config, `.agentv/config.yaml`, and
`eval.yaml execution`.

That makes it hard to review A/B variants such as `baseline` versus
`agents-md`, because the variable under test can be hidden inside the eval
definition. The desired model is:

- Eval equals what is tested.
- Experiment equals how and with what it is run.
- Setup that changes the agent's environment belongs to the experiment.
- Existing eval-only repositories keep working through a default experiment
  fallback.

## Requirements

- R1. Existing `eval.yaml` files validate and run without modification.
- R2. Experiment wire config uses `snake_case`; TypeScript types use
  `camelCase`.
- R3. `config.yaml` can point at a default experiment, with no pointer falling
  back to the current `default` experiment label.
- R4. `agentv eval --experiment <label>` keeps working as a label.
- R5. `agentv eval --experiment <path>` can resolve a YAML or TypeScript
  experiment file.
- R6. Experiment config reuses existing target names and target matrices instead
  of embedding a new provider schema.
- R7. Workspace setup and skill injection are modeled as experiment setup steps.
- R8. Run artifacts record the resolved experiment name immediately and later
  record full config provenance and fingerprint.
- R9. Documentation and examples migrate incrementally; no bulk repo migration
  happens in Phase 1.

## Public Reference Alignment

Vercel `agent-eval` supplies the strongest public precedent for this split:
eval fixtures describe the task, and experiments describe agent, model, scripts,
runs, early exit, timeout, sandbox, and setup. AgentV should adopt that
vocabulary and directory convention while preserving AgentV-owned YAML evals,
LLM-judge assertions, workspace fixtures, and portable run artifacts.

Anthropic Skills reinforces the value of baseline versus with-skill comparisons
and pass-rate deltas. Hugging Face Datasets provides the lowest-common
denominator vocabulary for datasets, records, splits, and features. OpenInference
provides trace and span vocabulary for external observability correlation. These
references should inform field names and docs, but none should become a required
runtime dependency for this change.

## Key Decisions

- KTD1. The canonical committed experiment directory is `experiments/`.
- KTD2. YAML is the canonical experiment authoring path; TypeScript is the
  escape hatch for dynamic setup.
- KTD3. `experiments.default` in `.agentv/config.yaml` is the preferred default
  pointer. A top-level `default_experiment` compatibility key can be accepted
  while docs teach the nested form.
- KTD4. Experiment `target` and `targets` refer to existing AgentV target names
  and target refs. Provider settings stay in `targets.yaml`.
- KTD5. Legacy `eval.yaml execution` remains valid for released fields while
  examples migrate. The prerelease `execution.trials` field is hard-removed
  with no alias; repeat/run-count placement belongs to experiments.
- KTD6. AgentV adopts Vercel's experiment structure, not the package dependency,
  until a direct adapter has a smaller, reviewed boundary.
- KTD7. Full experiment fingerprints should include the experiment file contents,
  selected eval source, setup-relevant fields, scripts, repeat config, timeout,
  sandbox, and target references.

## Experiment Contract

Wire shape, shown in YAML:

```yaml
name: baseline
target: codex-gpt5
targets:
  - codex-gpt5
  - name: copilot-gpt55
    use_target: copilot
agent: codex
model: openai/gpt-5.5
agent_options:
  reasoning_effort: high
evals: "agent-042-*"
scripts:
  - build
  - script: bun test
    timeout_seconds: 120
repeat:
  count: 3
  strategy: pass_at_k
  cost_limit_usd: 2.00
early_exit: false
timeout_seconds: 900
sandbox: auto
workspace:
  mode: temp
setup:
  - script: bun install
  - script: cp skills/default/AGENTS.md AGENTS.md
```

Internal TypeScript shape:

```ts
interface ExperimentConfig {
  name?: string;
  target?: string;
  targets?: readonly ExperimentTargetRef[];
  agent?: string;
  model?: string;
  agentOptions?: Record<string, unknown>;
  evals?: string | readonly string[];
  scripts?: readonly ExperimentScript[];
  repeat?: {
    count: number;
    strategy: 'pass_at_k' | 'mean' | 'confidence_interval';
    costLimitUsd?: number;
  };
  runs?: number;
  earlyExit?: boolean;
  timeoutSeconds?: number;
  sandbox?: 'auto' | 'docker' | 'vercel';
  workspace?: Record<string, unknown>;
  setup?: readonly ExperimentSetupStep[];
  sourcePath?: string;
}
```

`agent` is a harness label for Vercel alignment. AgentV execution should prefer
`target` or `targets` for actual provider resolution so this does not create a
parallel provider registry.

## CLI Behavior

Default resolution order for `agentv eval`:

- Explicit `--experiment <label-or-path>`.
- `.agentv/config.yaml` `experiments.default`.
- `.agentv/config.yaml` `default_experiment`, accepted as a compatibility alias.
- `agentv.config.ts` `experiments.default` or `defaultExperiment`, if present.
- Current implicit `default` label.

Path-like experiment values load an experiment file. Label-like values remain
labels. If a loaded experiment has `name`, the name is the run namespace;
otherwise AgentV derives the name from the file basename.

Later CLI phases should add:

- `agentv eval --experiment experiments/baseline.yaml`.
- `agentv eval --experiment baseline` resolving `experiments/baseline.yaml`
  before falling back to a label.
- `agentv eval --experiments "experiments/*.yaml"` for matrices.
- Experiment `evals` filters AgentV case IDs. When no eval paths are provided,
  file discovery uses `.agentv/config.yaml eval_patterns` or AgentV's default
  eval patterns.

## Migration Strategy

Phase 1 is additive. It introduces experiment config loading and default
resolution without changing how eval execution applies targets or workspace
settings.

Phase 2 moves examples to committed `experiments/default.yaml` files while
leaving existing `eval.yaml execution` fields in place.

Phase 3 applies experiment runtime fields in the runner: target selection, eval
filters, timeout, repeat/runs, early exit, sandbox/workspace mode, setup steps,
and scripts.

Phase 4 warns when new eval files use experiment-owned `execution` fields and
documents the replacement.

Phase 5 removes or hard-errors only for a future major or same-week unreleased
surface where compatibility is not required.

## Artifact Impact

Existing artifact writers already accept an experiment label. Phase 1 should
continue writing the resolved experiment name to `summary.json`, `index.jsonl`,
trace envelopes, and results repository paths.

Later artifact work should add:

- `experiment_config_path` for the committed file.
- `experiment_fingerprint` for cache and comparison invalidation.
- Redacted `experiment_config` metadata for small safe fields.
- `setup` and `scripts` provenance as references, not large inline payloads.

`artifact_pointers` must remain reserved for detached large payload bytes. Normal
experiment sidecars should use explicit path fields.

## Implementation Units

### U1. ADR and Implementation Plan

Files:

- `docs/adr/0006-separate-experiments-from-eval-definitions.md`
- `docs/plans/2026-06-23-002-experiments-separation-plan.md`

Approach:

Capture the eval-versus-experiment decision, Vercel alignment, dependency
boundary, compatibility strategy, and phased rollout.

Verification:

- Human review for vocabulary and product boundary.

### U2. Experiment Contract and Loader

Files:

- `packages/core/src/evaluation/experiment.ts`
- `packages/core/src/index.ts`
- `packages/core/src/evaluation/config.ts`
- `packages/core/src/evaluation/loaders/config-loader.ts`

Approach:

Add a narrow experiment wire contract, normalization to camelCase, YAML and
TypeScript experiment loading, and default experiment config parsing. Keep the
loader independent of runner behavior.

Test Scenarios:

- YAML experiment with `agent_options`, `early_exit`, `timeout_seconds`, setup,
  `repeat`, and scripts normalizes to camelCase.
- TypeScript experiment default export loads and normalizes.
- Invalid `repeat.count`, `runs`, `timeout_seconds`, or `sandbox` fails with a
  targeted error.
- `.agentv/config.yaml` parses `experiments.default`.
- `.agentv/config.yaml` accepts top-level `default_experiment`.

### U3. CLI Default Experiment Resolution

Files:

- `apps/cli/src/commands/eval/run-eval.ts`
- `apps/cli/src/commands/eval/result-layout.ts`

Approach:

Resolve the experiment before run directory creation. Explicit labels keep
working. Path-like values load experiment files and derive the run label from
`name` or basename. If no experiment is configured, the current `default` label
is preserved.

Test Scenarios:

- `agentv eval evals/foo/eval.yaml` still writes under
  `.agentv/results/default/<timestamp>/`.
- Configured `experiments.default: experiments/default.yaml` with `name:
  baseline` writes under `.agentv/results/baseline/<timestamp>/`.
- `--experiment smoke` writes under `.agentv/results/smoke/<timestamp>/`.
- `--experiment experiments/smoke.yaml` uses the file's `name` when present.
- Missing path-like experiment values fail clearly.

### U4. Runner Field Application

Files:

- `apps/cli/src/commands/eval/run-eval.ts`
- `packages/core/src/evaluation/evaluate.ts`
- `packages/core/src/evaluation/yaml-parser.ts`
- `packages/core/src/evaluation/loaders/config-loader.ts`
- `packages/core/src/evaluation/validation/experiment-file.schema.ts`

Approach:

Apply experiment fields in precedence order: CLI overrides, explicit experiment,
legacy eval `execution` for still-supported fields, project config defaults.
Reuse existing target resolution and workspace setup paths. Move setup-owned
behavior out of eval docs before adding warnings. Do not retain
`execution.trials`; experiments are the only public input path for run counts.

Test Scenarios:

- Experiment `target` selects an existing target from `targets.yaml`.
- Experiment `targets` drives matrix evaluation.
- Experiment `evals` selects case IDs; eval file discovery still comes from
  positional paths, configured `eval_patterns`, or default eval patterns.
- Experiment setup runs before agent execution and can inject an `AGENTS.md`
  file.
- Legacy `eval.yaml execution.target` still works when no experiment target is
  configured.

### U5. Artifact Provenance and Fingerprint

Files:

- `packages/core/src/evaluation/run-artifacts.ts`
- `packages/core/src/evaluation/results-repo.ts`
- `packages/core/src/evaluation/trace-envelope.ts`
- `apps/cli/src/commands/eval/artifact-writer.ts`

Approach:

Extend artifact metadata with safe experiment provenance and a fingerprint. The
fingerprint should cover experiment config, selected eval source content, and
fields that affect execution.

Test Scenarios:

- Two experiments with different setup steps produce different fingerprints.
- Changing an eval prompt changes the fingerprint.
- Redacted config metadata excludes obvious secret fields.
- Historical artifacts without fingerprints still read.

### U6. Docs and Examples Migration

Files:

- `apps/web/src/content/docs/`
- `examples/`
- `CONCEPTS.md`

Approach:

Document eval versus experiment authoring. Add at least one example with
`eval.yaml` plus `experiments/default.yaml`, and one A/B pair such as baseline
versus with-skill.

Test Scenarios:

- Docs examples use `snake_case` wire fields.
- Example default experiment runs without explicit `--experiment`.
- Existing examples continue to run through the compatibility path except
  prerelease `execution.trials`, which is migrated to experiments in this PR.

## Phase 1 Scope

The first PR originally targeted U1, U2, and U3. Owner review expanded this
branch to include native U4/U5 support for experiment resolution, eval
selection, run knobs, setup/scripts, target reuse, artifact provenance, and the
pre-stable hard removal of `execution.trials`.

The branch now applies `setup`, `scripts`, `repeat`, `runs`, `early_exit`,
`timeout_seconds`, `target`, `targets`, and `evals` to execution behavior. Matrix
execution via multiple experiment files remains a later phase.

## Non-Goals

- Do not replace AgentV's engine with `@vercel/agent-eval`.
- Do not bulk-edit all examples in the first PR.
- Do not remove or error on released legacy `eval.yaml execution` fields in this
  branch. `execution.trials` is intentionally excluded because it is prerelease
  and has moved to experiments.
- Do not add a new provider schema inside experiments.
- Do not implement experiment matrix execution in Phase 1.
- Do not project AgentV experiments into Phoenix or another external store.

## Verification Plan

Phase 1 targeted checks:

- `bun test packages/core/test/evaluation` for loader and config coverage once
  tests exist.
- CLI-level test for default experiment run layout.
- A dry-run fixture using `experiments/default.yaml` to prove the resolved
  experiment name reaches artifacts.
- Existing eval-only dry-run fixture to prove fallback stays `default`.

Before PR readiness:

- Run the smallest targeted Bun test set covering changed loader and CLI
  behavior.
- Run TypeScript/package checks only if the touched packages require them or
  targeted tests expose type errors.

## Open Questions

- Should the public field be only `experiments.default`, or should
  `default_experiment` remain documented as a short alias?
- Should `agent` be purely descriptive in AgentV, or should it become a harness
  selector once non-target harness adapters exist?
- Should experiment setup reuse workspace hooks exactly, or have a smaller setup
  step schema that compiles into workspace hooks?
- Should experiment fingerprints be written in Phase 2 with no cache behavior, or
  wait until result reuse can consume them?
