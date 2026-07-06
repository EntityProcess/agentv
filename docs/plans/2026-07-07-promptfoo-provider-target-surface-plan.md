---
title: Promptfoo Provider Target Surface Plan
type: feat
date: 2026-07-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: av-w545
execution: code
---

# Promptfoo Provider Target Surface Plan

## Goal Capsule

Plan a breaking AgentV authoring change that makes public YAML and SDK provider declarations Promptfoo-shaped, while preserving AgentV's internal runtime, environment, grader, and artifact model.

The recommendation is to adopt public `providers` entries with Promptfoo-style `id`, `label`, `config`, and provider option fields. Normalize that surface into AgentV's current internal target/runtime model. Do not revive a top-level `graders:` block.

## Executive Recommendation

If AgentV were starting fresh, the public authoring boundary should use Promptfoo-shaped `providers` instead of AgentV-specific `targets`. That is the authoring vocabulary users and coding agents are most likely to recognize, and it reduces translation when importing Promptfoo-style evals.

Make this a real breaking change:

- Canonical public YAML: `providers`, where `id` names the provider backend/spec and `label` names the stable selectable AgentV identity.
- Canonical public defaults: `defaults.provider` selects the default candidate provider, and `defaults.grader` selects the default grader provider.
- Canonical assertion override: model-graded assertions use `provider`, not `target`, for grader provider selection.
- Internal runtime: continue to use AgentV `TargetDefinition`, `ResolvedTarget`, `targetName`, `EvaluationResult.target`, run-bundle `target`, Dashboard target grouping, environment recipes, and artifact layout.
- Old `targets` should be migration-only input after the break, not a soft runtime alias. Ordinary authoring should hard-error with a migration message.
- Provider-local `environment` should be supported sugar over the existing AgentV environment chain, not the canonical place to define testbeds.

This preserves Promptfoo compatibility at the authoring edge without importing Promptfoo's historical alias baggage or weakening AgentV's repo-native execution semantics.

## Planning Questions

1. Should fresh AgentV public YAML use Promptfoo-shaped `providers`/`id`/`label`?

   Yes. Public YAML should use `providers`. In provider entries, `id` should mean provider backend/spec and `label` should mean the stable AgentV selection/result identity when present. This matches Promptfoo's shape and avoids the current inversion where AgentV `targets[].id` is the stable identity and `targets[].provider` is the backend.

2. What should canonical public config look like?

   Use `providers` everywhere users declare or select systems under test. Use `defaults.provider` for the default candidate and `defaults.grader` for the default grader. Use `default_test.options.provider`, `tests[].options.provider`, and assertion `provider` as Promptfoo-compatible grader-provider overrides for model-graded assertions.

3. What should remain internal AgentV terminology?

   Keep "target" in internal TypeScript, run artifacts, comparison indexes, Dashboard grouping, result rows, task bundles, and provider runtime interfaces until there is a separate artifact migration. A public provider entry normalizes into an internal target. The artifact field `target` remains the stable comparison key, populated from `label ?? id`.

4. How should config-level grader provider support work?

   Graders are providers selected for grading roles, not a separate block. `defaults.grader` names a provider from the same provider catalog. Assertion-level `provider` overrides it. Candidate and grader providers can live in the same `providers` list. A grader can be evaluated as a candidate by including it in the matrix and using another provider as its grader.

5. What migration mapping should exist?

   `targets[].id` maps to `providers[].label`; `targets[].provider` maps to `providers[].id`; `targets[].config` remains `providers[].config`; `defaults.target` maps to `defaults.provider`; `defaults.grader` remains `defaults.grader`; suite `target:` maps to one-entry `providers:` selection; suite `targets:` maps to `providers:`; assertion `target:` maps to assertion `provider:`.

6. Should old `targets` be accepted after the break?

   Use hard errors in normal loaders and validators, with exact migration guidance. Accept old `targets` only in the migration command/script. A soft alias would keep two mental models alive and undercut the purpose of the breaking change.

7. What Promptfoo behaviors should AgentV copy or diverge from?

   Copy the authoring shape, provider reference matching principles, shared candidate/grader provider pool, `default_test.options.provider` and assertion `provider` concept, and "id wins over label collision" behavior. Diverge by keeping AgentV environments, runtime modes, run artifacts, and Dashboard target semantics AgentV-owned; reject legacy `targets` as a runtime alias; and avoid accepting ambiguous provider aliases that AgentV cannot execute clearly.

## Promptfoo Source Findings

Promptfoo clone: `/home/entity/projects/promptfoo/promptfoo`

Local commit inspected: `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`

Local clone status: `main...origin/main [behind 238]`. Treat these findings as commit-pinned source evidence, not current upstream docs.

Key files:

- `src/types/providers.ts`: `ProviderOptions` supports `id`, `label`, `config`, `prompts`, `transform`, `delay`, `env`, and `inputs`. `ProviderConfig` can be a provider string, provider function, `ApiProvider`, `ProviderOptions`, or single-key provider options map. `ApiProvider` exposes `id(): string` plus optional `label`.
- `src/validators/providers.ts`: provider schemas accept string providers, functions, arrays, provider option objects, and provider option maps. `id` is required for provider option objects.
- `src/types/index.ts`: `UnifiedConfigSchema` accepts exactly one of top-level `providers` or `targets`, then transforms `targets` to `providers`. `EvaluateResult.provider` stores a pick of provider `id` and `label`.
- `src/util/config/load.ts`: config loading rewrites `targets` to `providers` and resolves CLI provider filters by exact `id`, exact `label`, then `id` suffix.
- `src/util/providerRef.ts`: provider references are normalized across string, function, object, map, and file forms. Single-key maps allow `{ "openai:gpt-4": { config, label } }`.
- `src/providers/index.ts`: provider loading renders provider IDs/config, loads strings/files/factories, and applies `options.label` to loaded providers.
- `src/evaluator.ts`: runtime builds prompt/provider combinations using `provider.label || provider.id()` as the provider key. It resolves model-graded assertion providers from the configured provider map before evaluation.
- `src/evaluator.ts`: repeat is expanded before execution. `appendRunEvalOptionsForTestCase` loops `repeatIndex` from `0` to `options.repeat - 1`, appends run options with that `repeatIndex`, and increments `testIdx` for each repeated var combination. Telemetry records `numRepeat: options.repeat || 1`.
- `src/types/index.ts` and `src/commands/eval.ts`: `repeat` exists on command-line/evaluate options, and the CLI exposes `--retry-errors`.
- `src/evaluator.ts` and `src/matchers/comparison.ts`: `select-best` and `max-score` are comparison assertions over rows grouped by the same `testIdx`. Repeat-created attempts have distinct `testIdx` values, so they do not naturally implement a logical "pass if any repeated attempt passes" gate.
- `src/util/eval/filterTests.ts`, `src/commands/eval.ts`, and `test/commands/eval.test.ts`: `--retry-errors` retries rows whose previous persisted result has `failureReason === ERROR`; assertion failures are explicitly excluded by the error retry filter.
- `src/matchers/providers.ts`: `getGradingProvider` resolves grader providers from assertion provider values, test/default provider options, provider type maps, and configured providers.
- `src/util/gradingProvider.ts`: `buildConfiguredProviderMap` indexes providers by `id()` first, then fills labels only when the label does not shadow an ID. Type-map grader providers can reference configured providers lazily.
- `src/util/provider.ts`: provider matching supports exact label, exact ID, wildcard, and legacy prefix matching.
- `test/types/index.test.ts`: covers `targets` alias transformation and both-present errors.
- `test/index.test.ts`: covers model-graded assertions using providers from the main `providers` list, candidate and grader providers sharing that list, provider type maps, ApiProvider pass-through, and no mutation of original provider configs.

Promptfoo lessons to copy:

- Make `providers` the public declaration key.
- Allow string refs and object entries.
- Use `id` for backend/spec and `label` for human/stable display identity.
- Let grader provider references point at the same configured provider pool.
- Prefer exact provider ID over label when collisions exist.
- Do not mutate authored provider configs while resolving runtime provider instances.

Promptfoo lessons to avoid:

- Do not accept `targets` as a long-lived runtime alias after a breaking AgentV migration.
- Do not copy broad provider prefix matching unless AgentV can make ambiguity impossible.
- Do not adopt Promptfoo's environment/testbed model over AgentV's repo-native environment recipes.

## AgentV Current Surface Findings

Key files:

- `packages/core/src/evaluation/validation/eval-file.schema.ts`: public schema currently rejects top-level `graders` with a hard error and accepts `targets`. LLM assertions use assertion `target` today for grader target override.
- `packages/core/src/evaluation/loaders/config-graph.ts`: top-level config graph supports `targets`, `defaults.target`, and `defaults.grader`; hard-errors `graders`; parses normalized target configs with `id`, `provider`, `runtime`, and `config`.
- `packages/core/src/evaluation/loaders/config-loader.ts`: suite target refs and inline target objects reject authored `label` and normalize target definitions. File references include `targets`.
- `packages/core/src/evaluation/providers/types.ts`: runtime provider interface and target definitions use `targetName`, `TargetDefinition`, provider `kind`, and AgentV runtime fields.
- `packages/core/src/evaluation/providers/targets.ts`: `normalizeTargetDefinition` already has a compatibility layer that can map authored `id`/`label`/`provider` into internal `name`, `label`, and provider kind.
- `packages/core/src/evaluation/providers/targets-file.ts`: `targets.yaml` requires top-level `targets` array and rejects `label`.
- `apps/cli/src/commands/eval/targets.ts`: CLI target selection, target file discovery, inline target refs, and matrix target selection are target-named.
- `apps/cli/src/commands/eval/commands/run.ts`: CLI exposes `--target`, `--targets`, and `--grader-target`.
- `apps/cli/src/commands/eval/run-eval.ts`: `defaults.grader` becomes `defaultGraderTarget`; target selection drives matrix rows and artifacts.
- `packages/core/src/evaluation/orchestrator.ts`: grader precedence is CLI `--grader-target`, then target-level `grader_target`, then config `defaults.grader`, then self-grade only for LLM-grader-capable targets.
- `packages/core/src/evaluation/run-artifacts.ts`: index entries use `target` as the stable result grouping key.
- `apps/cli/src/commands/eval/task-bundle.ts`: task bundles serialize selected target definitions to `targets.yaml` and preserve `targets_path`.
- `apps/cli/src/commands/eval/run-eval.ts`: current run-policy plumbing can build repeat/trials config from experiment/run overrides with `count`, `strategy`, `costLimitUsd`, and `earlyExit`.
- `packages/sdk/src/eval.ts`: SDK types expose `EvalTargetRef`, `EvalTargetConfig`, top-level `target`, and `targets`; lowering already handles snake_case boundaries.
- `apps/web/src/content/docs/docs/next/evaluation/running-evals.mdx`: current docs teach "a grader is just another target" via `defaults.grader`, no `graders:` block.
- `apps/web/src/content/docs/docs/v4.42.4/evaluation/running-evals.mdx`: versioned docs still include old `graders:` examples and need a docs-version decision.
- `apps/cli/src/templates/.agentv/targets.yaml`: template still uses ambiguous provider aliases that current validation rejects.
- `scripts/migrate-hard-deprecations.ts`: existing migration script can be extended or mirrored for YAML rewrites.
- `docs/plans/2026-06-23-001-feat-repeat-runs-flaky-evals-plan.md`: prior AgentV planning already separates attempt success frequency from assertion-level `pass_rate`, keeps one aggregate index row per case/target, and preserves per-attempt sidecars under case-local attempt directories.

Important current invariant: public YAML says `targets`, but run artifacts and Dashboard already depend on `target` as a stable comparison dimension. The provider-surface change should not force artifact consumers to migrate immediately.

## Proposed Public YAML

Project config with a provider catalog and defaults:

```yaml
providers:
  - id: codex-cli
    label: codex-host
    runtime: host
    config:
      command: ["codex", "exec", "--json"]

  - id: openai
    label: grader-gpt5-mini
    config:
      model: gpt-5-mini

defaults:
  provider: codex-host
  grader: grader-gpt5-mini
```

Eval file with a provider matrix:

```yaml
prompts:
  - file://prompts/fix-bug.md
  - file://prompts/add-test.md

providers:
  - codex-host
  - id: claude-cli
    label: claude-docker
    runtime: docker
    config:
      command: ["claude", "-p"]

default_test:
  options:
    provider: grader-gpt5-mini

tests:
  - vars:
      issue: "Repair the failing parser case"
      repo: "file://fixtures/parser"
    assert:
      - type: llm-rubric
        value: "The answer identifies the parser bug and includes a test."
      - type: llm-rubric
        value: "Judge with a stronger grader."
        provider: grader-gpt5
```

Provider-local environment overlay:

```yaml
providers:
  - id: cli
    label: repo-agent
    environment: file://environments/node-repo.yaml
    config:
      command: ["bun", "run", ".agentv/providers/repo-agent.ts", "{PROMPT}"]

environment: file://environments/default-case.yaml
```

Grader provider with its own environment:

```yaml
providers:
  - id: openai
    label: judge-with-tools
    environment: file://environments/grader-tools.yaml
    config:
      model: gpt-5-mini

defaults:
  grader: judge-with-tools
```

This lets CLI/custom providers prepare a cwd or run setup before invocation without moving all testbed setup into provider declarations.

## Internal Normalization Model

Add an authored-provider layer and lower it into existing target internals:

```ts
interface AuthoredProviderDefinition {
  id: string;              // public backend/spec, current targets[].provider
  label?: string;          // public stable identity, current targets[].id
  config?: JsonObject;
  runtime?: "host" | "profile" | "sandbox" | "docker";
  environment?: EnvironmentRef;
  prompts?: string[];
  transform?: string;
  delay?: number;
  env?: Record<string, string>;
}
```

Normalization:

- `publicProvider.id` -> internal `TargetDefinition.provider` or provider-spec parser input.
- `publicProvider.label ?? publicProvider.id` -> internal `TargetDefinition.name`, `ResolvedTarget.name`, `Provider.targetName`, `EvaluationResult.target`, and run-artifact `target`.
- `publicProvider.config` -> internal provider-specific config.
- `publicProvider.runtime` -> internal target runtime.
- `publicProvider.environment` -> provider-scoped environment overlay in the effective environment chain.
- Provider refs in `providers: ["codex-host"]`, `defaults.provider`, `defaults.grader`, `default_test.options.provider`, `tests[].options.provider`, and assertion `provider` resolve against `label` first for user intent, while preserving Promptfoo's collision rule that an exact provider ID cannot be shadowed by another provider's label.

Internal terms should stay target-named for now:

- `TargetDefinition`, `ResolvedTarget`, `targetName`, `graderTarget`, `fallbackTargets`.
- Result rows and index entries: `target`.
- Dashboard grouping and comparison UI: target.
- Task bundle internals may keep `targets.yaml` in v1 bundles, with a manifest field recording original provider-surface authoring.

## Config-Level Grader Provider Design

Grader selection should use one provider pool and role-based resolution:

1. CLI override: current `--grader-target`, renamed or aliased to `--grader-provider` in the breaking CLI surface.
2. Assertion override: `assert[].provider`.
3. Test override: `tests[].options.provider`.
4. Eval default: `default_test.options.provider`.
5. Project default: `defaults.grader`.
6. Target/provider-local default: keep internal `grader_target` only if needed for migration, but do not document it as the preferred public shape.
7. Self-grade fallback: only for LLM-grader-capable providers. Agent providers must still error without an explicit grader provider.

Candidate and grader providers in the same list:

- A provider can be used as a candidate when it is included in the matrix.
- The same provider entry can be used as a grader when referenced by `defaults.grader`, test options, or assertion `provider`.
- No `role: grader` is required for first implementation. Capability checks should decide whether a provider can grade.

Grading a grader:

- Include the grader provider as a candidate in `providers`.
- Select a different grader through `defaults.grader` or assertion `provider`.
- Artifacts should record the candidate target key and the grader provider key separately in metadata/traces, but preserve `target` as the candidate grouping key.

Provider type maps:

- Support Promptfoo-compatible type maps only when AgentV has multiple grader capabilities to route, for example `provider: { text: judge-text, embedding: judge-embedding }`.
- Do not require type maps in the first implementation if all AgentV model-graded assertions use text generation. Document as a later compatibility slice if deferred.

## Provider-Local Environment Design

Recommendation: support provider-level `environment` as first-class authored sugar over AgentV's existing environment execution chain, but do not make it the canonical testbed mechanism.

Canonical remains:

- Top-level, suite-level, test-level, or case-level `environment` for the workspace, repo materialization, fixtures, services, and shared setup for the case.
- Provider entries for provider backend/spec, identity, runtime, and provider-specific config.

Provider-local `environment` should mean:

- A provider-scoped overlay applied when invoking that provider for a matrix cell.
- It may provide cwd/setup/env needed by CLI/custom providers.
- It should not replace the case's canonical repo/testbed environment.
- It normalizes into an environment layer attached to the internal target/provider, not into a separate provider runtime concept.

Composition for `prompts x tests x providers`:

- Build one authored execution for each prompt/test/provider cell.
- Resolve the base environment from suite/test/case scope.
- Resolve the selected candidate provider.
- Compose `effective_environment = base_environment + provider.environment`.
- Prepare or reuse the resulting workspace for that cell, with provider overlay setup running after base setup.
- If two provider entries share the same effective environment hash, workspace reuse can be an optimization, not a semantic guarantee.

Conflict rules:

- `environment` may be a `file://` ref or inline environment object.
- Provider-local setup and cwd are allowed, because they are the use case.
- Provider-local repo materialization or services should be allowed only if the existing environment recipe supports deterministic composition and provenance. If composition is ambiguous, fail with a clear error instead of silently replacing the base testbed.
- Provider-local `environment` should not be accepted under Promptfoo-like `config` because AgentV needs to track it for provenance and workspace setup.

Grader provider environments:

- A grader provider can declare its own `environment`.
- That environment applies only to grader invocation, not candidate invocation.
- If the same provider is both candidate and grader, it uses the same provider-local environment recipe in two roles, but artifacts should record the role-specific invocation separately.
- Grader environment setup must not mutate the candidate workspace after candidate output is captured unless the grader explicitly runs in the same workspace by supported environment semantics.

Provenance:

- Run bundles should record each effective environment layer with scope, source path, digest, and resolved config.
- Task/eval bundles should copy provider-local environment files the same way they copy suite/test environment references.
- Index or manifest metadata should include `provider_environment_path` or an environment-chain metadata object, not only `targets_path`.
- Redaction rules from task-bundle source capture must apply to provider-local environment config and setup commands.

Why not reject provider-local environments:

- CLI/custom providers often need a cwd and setup that is provider-specific.
- Keeping that declaration next to the provider makes Promptfoo-shaped provider config more ergonomic.
- Rejecting it forces users to duplicate suite/test environments or hide provider setup in shell scripts.

Why not make it canonical:

- It can hide testbed differences inside provider entries, making provider comparisons less fair.
- Top-level/test/case `environment` is still the clearer place for shared repo fixtures and services.
- AgentV's artifact model already treats environment as part of case provenance, so provider-local environment should be an overlay in that model.

## Flaky Eval Run Policy

Recommendation: do not copy Promptfoo `repeat` as the canonical flaky-eval contract. AgentV should expose a native run-policy attempts field that models logical attempts, pass conditions, and early exit explicitly.

Canonical public YAML:

```yaml
providers:
  - codex-host

run_policy:
  attempts:
    max_attempts: 3
    pass_condition: any_pass
    early_exit: true

tests:
  - vars:
      issue: "Repair the failing parser case"
    assert:
      - type: llm-rubric
        value: "The fix is correct and includes a regression test."
```

Alternative shorthand, if the implementation wants to preserve existing naming:

```yaml
evaluate_options:
  repeat:
    count: 3
    strategy: pass_any
    early_exit: true
```

The cleaner long-term surface is `run_policy.attempts` because it says what AgentV is doing: attempting a logical provider/prompt/test execution more than once and then applying an explicit gate. Promptfoo's `repeat` means physical expansion, not an attempt gate.

Semantics:

- The logical unit is one provider x prompt x test case after vars expansion.
- `max_attempts` is the upper bound of physical attempts for that logical unit.
- `pass_condition: any_pass` passes the logical unit when any counted attempt passes.
- `early_exit: true` stops scheduling later attempts for that logical unit once the pass condition is already satisfied.
- Other useful pass conditions should stay explicit, for example `all_pass`, `success_rate_at_least`, and `mean_score_at_least`.
- Execution errors are not silently converted into assertion failures. They are counted separately and participate in the configured pass condition.
- This policy composes after provider selection and provider-local environment composition: each attempt executes the same provider/prompt/test logical unit with the same effective provider environment unless the policy explicitly permits per-attempt variation.

Promptfoo transpilation:

- AgentV can transpile `max_attempts: N` to Promptfoo `repeat: N` only as an approximation.
- Promptfoo can spend all N attempts and then a wrapper/post-processor can collapse the rows into an any-pass summary.
- Promptfoo cannot faithfully avoid later attempts after an early pass without an AgentV wrapper/scheduler outside Promptfoo's normal evaluator.
- Promptfoo `select-best` and `max-score` do not provide this behavior: they compare outputs with the same `testIdx`, while Promptfoo repeat assigns repeated attempts separate `testIdx` values in the inspected clone.
- Promptfoo `--retry-errors` is not assertion-failure retry and not pass-on-any retry. It retries prior persisted ERROR rows.

Artifact requirements:

- Preserve every physical attempt result as an attempt sidecar, including outputs, grading, metrics, transcript, timing, provider identity, grader provider identity, provider-local environment provenance, and cost.
- Mark attempts skipped by early exit as planned-but-skipped records, not missing data.
- Record the chosen/passing attempt when `pass_condition: any_pass` succeeds.
- Keep a logical aggregate row per provider/prompt/test in `index.jsonl` so Dashboard, trend, and compare views do not inflate case counts.
- Include summary fields such as `planned_attempts`, `total_attempts`, `executed_attempts`, `skipped_attempts`, `successful_attempts`, `failed_attempts`, `execution_error_attempts`, `attempt_success_rate`, `chosen_attempt`, and `repeat_gate` or `attempt_gate`.
- Dashboard summaries must distinguish "passed after early success" from "stable pass across all attempts" and must not display incomplete early-exit runs as if all attempts were executed.

Interaction with provider-level environments:

- Provider-local environment is part of the logical provider configuration and should remain stable across attempts by default.
- If an environment recipe uses `scope: attempt`, each physical attempt gets an isolated workspace.
- If the base environment uses shared workspace scope, early-exit skipping must still preserve provenance showing which setup layers were planned and which attempts were skipped.
- Grader provider environments apply per grading attempt. A skipped candidate attempt should not run a grader attempt.

## Breaking Migration Mapping

| Current AgentV | New public surface | Notes |
| --- | --- | --- |
| `targets:` | `providers:` | Hard error outside migration tool. |
| `targets: file://targets.yaml` | `providers: file://providers.yaml` | Also migrate file name recommendations and discovery. |
| `.agentv/targets.yaml` with `{ targets: [...] }` | `.agentv/providers.yaml` with `{ providers: [...] }` | Consider one release of discovery warning only if the breaking release needs smoother local bootstrapping. |
| `targets[].id` | `providers[].label` | Stable selection/result identity. |
| `targets[].provider` | `providers[].id` | Backend/spec identity. |
| `targets[].runtime` | `providers[].runtime` | AgentV extension field. |
| `targets[].config` | `providers[].config` | Preserve nested config. |
| `targets[].grader_target` | Prefer `defaults.grader`, test option, or assertion `provider` | Keep as migration-only or internal until removed. |
| `defaults.target` | `defaults.provider` | Candidate default. |
| `defaults.grader` | `defaults.grader` | Now resolves against provider labels/IDs. |
| Suite `target: foo` | `providers: [foo]` or `defaults.provider: foo` | Use `providers` when defining a matrix, defaults for catalog-level default. |
| Suite `targets: [foo, bar]` | `providers: [foo, bar]` | Matrix selection. |
| Inline `target: { id, provider }` | `providers: [{ label, id }]` | `id` and `provider` swap roles. |
| Assertion `target: judge` | Assertion `provider: judge` | Grader provider override. |
| CLI `--target foo` | `--provider foo` | Keep old flag only as hard-error or hidden migration diagnostic. |
| CLI `--targets path` | `--providers path` | Avoid name collision with Promptfoo only if command semantics are documented clearly. |
| CLI `--grader-target foo` | `--grader-provider foo` | Old flag can hard-error with guidance after break. |
| Result `target` | Result `target` | Preserve artifact contract. |
| `targets_path` | Keep for v1 bundle internals or add `providers_path` alias metadata | Avoid breaking existing artifact readers in the same change. |
| `evaluate_options.repeat.count` | `run_policy.attempts.max_attempts` | If adopting the cleaner run-policy surface; otherwise preserve as shorthand. |
| `evaluate_options.repeat.strategy: pass_any` | `run_policy.attempts.pass_condition: any_pass` | Keep naming explicit at the public boundary. |
| `evaluate_options.repeat.early_exit` | `run_policy.attempts.early_exit` | Enables per-logical-case scheduling stop after the gate is satisfied. |

Migration script responsibilities:

- Rewrite YAML keys and refs in examples, evals, templates, and docs snippets that are source-controlled.
- Swap `targets[].id` and `targets[].provider` into `providers[].label` and `providers[].id`.
- Rewrite assertion `target` to `provider` for model-graded assertions only.
- Rewrite `defaults.target` to `defaults.provider`.
- Rewrite repeat/trials config into `run_policy.attempts` if the breaking release adopts that cleaner run-policy surface.
- Rename `.agentv/targets.yaml` to `.agentv/providers.yaml` where safe.
- Leave run artifacts untouched.
- Print a manual-review warning for provider entries that already used `label`, removed `name`, `use_target`, `grader_target`, or ambiguous provider aliases.

## Implementation Phases

1. Schema and normalization

   Add authored provider schemas in `packages/core/src/evaluation/validation/eval-file.schema.ts`, `packages/core/src/evaluation/loaders/config-graph.ts`, and `packages/core/src/evaluation/loaders/config-loader.ts`. Normalize public provider definitions into existing `TargetDefinition` internals. Replace current hard error on top-level eval `providers` in `packages/core/src/evaluation/yaml-parser.ts`.

2. Provider file discovery and CLI selection

   Add `.agentv/providers.yaml` discovery while removing or hard-erroring `.agentv/targets.yaml` in normal authoring. Add `--provider`, `--providers`, and `--grader-provider` flags. Keep internal selection structs target-named unless the code becomes harder to understand than a local rename.

3. Grader provider resolution

   Implement `defaults.provider`, `defaults.grader`, `default_test.options.provider`, `tests[].options.provider`, assertion `provider`, and provider-list reference resolution. Preserve current agent-provider no-grader error.

4. Provider-local environment overlay

   Add `environment` to public provider definitions and normalize it into the environment chain. Update task bundle source capture, provenance metadata, and redaction for provider-local environment refs.

5. Native attempts run policy

   Add or normalize a native attempts policy with `max_attempts`, `pass_condition`, and `early_exit`. Preserve per-attempt artifacts, aggregate logical rows, skipped-attempt markers, and Dashboard honesty. Treat Promptfoo transpilation as lossy unless AgentV owns scheduling.

6. SDK and programmatic API

   Update `packages/sdk/src/eval.ts` to expose provider-shaped config types and lowering. Map old SDK target types only through migration helpers or breaking compile-time errors, depending on package versioning policy.

7. Migration tooling

   Extend `scripts/migrate-hard-deprecations.ts` or create a focused provider-surface migration script. Add tests for YAML rewrites and warnings. Consider a CLI `agentv convert --provider-surface` mode if this should be user-facing.

8. Docs, examples, and templates

   Update `CONCEPTS.md`, `AGENTS.md`, `.agents/product-boundary.md`, docs under `apps/web/src/content/docs/docs/next/`, examples under `examples/`, and CLI templates. Decide whether versioned docs are frozen or should receive warning callouts only.

9. Artifact and Dashboard compatibility

   Keep `target` as artifact and Dashboard grouping. Add optional metadata for source provider `id`, `label`, grader provider, provider environment provenance, and attempts policy if needed by UI.

## File, Test, and Docs Checklist

Core schema and loading:

- `packages/core/src/evaluation/validation/eval-file.schema.ts`
- `packages/core/src/evaluation/loaders/config-graph.ts`
- `packages/core/src/evaluation/loaders/config-loader.ts`
- `packages/core/src/evaluation/yaml-parser.ts`
- `packages/core/src/evaluation/providers/types.ts`
- `packages/core/src/evaluation/providers/targets.ts`
- `packages/core/src/evaluation/providers/targets-file.ts`
- `packages/core/src/evaluation/environment/*`

CLI and bundles:

- `apps/cli/src/commands/eval/commands/run.ts`
- `apps/cli/src/commands/eval/targets.ts`
- `apps/cli/src/commands/eval/run-eval.ts`
- `apps/cli/src/commands/eval/task-bundle.ts`
- `apps/cli/src/commands/eval/artifact-writer.ts`
- `apps/cli/src/utils/targets.ts`
- `apps/cli/src/templates/.agentv/*`
- `apps/cli/src/commands/validate/*`

SDK and published types:

- `packages/sdk/src/eval.ts`
- `packages/core/src/index.ts`
- Any exported config or target/provider type tests.

Artifacts and UI:

- `packages/core/src/evaluation/run-artifacts.ts`
- `packages/core/src/evaluation/result-row-schema.ts`
- `apps/cli/src/commands/compare/index.ts`
- Dashboard target filters and detail pages under `apps/web/src`

Tests:

- Config graph tests for `providers`, `defaults.provider`, `defaults.grader`, and hard-error old `targets`.
- YAML parser tests for provider refs, inline provider definitions, provider-local environment, assertion `provider`, and old assertion `target` migration errors.
- CLI tests for `--provider`, `--providers`, and `--grader-provider`.
- Orchestrator tests for grader-provider precedence and agent-provider no-grader failure.
- Task bundle tests for provider-local environment provenance and redaction.
- Attempts run-policy tests for `any_pass`, early exit skipped attempts, execution-error accounting, and Promptfoo-transpilation warnings if a transpiler exists.
- SDK lowering tests for provider-shaped config.
- Migration script tests for key rewrites and warning cases.

Docs/examples:

- `CONCEPTS.md`
- `AGENTS.md`
- `.agents/product-boundary.md`
- `.agents/verification.md`
- `apps/web/src/content/docs/docs/next/evaluation/*.mdx`
- `apps/web/src/content/docs/docs/next/graders/*.mdx`
- `apps/web/src/content/docs/docs/next/targets/*` renamed or redirected.
- `examples/features/readme-quickstart/*`
- Public changelog or migration guide for the breaking release.

## Risks

- `id` and `label` role reversal is easy to migrate incorrectly. Tests should pin representative before/after YAML.
- Keeping artifact `target` while public YAML says `providers` creates vocabulary tension, but changing artifacts in the same release is higher risk.
- Provider-local environment can make provider comparisons unfair if users hide different fixture setup in provider entries.
- Promptfoo `repeat` can look equivalent to AgentV attempts, but it cannot faithfully model early-exit any-pass scheduling or logical aggregate gates without AgentV-owned orchestration.
- CLI flag changes may confuse users because Promptfoo uses `providers` as the matrix list while AgentV also has a providers file path option.
- Existing docs and templates contain stale target and grader examples; partial docs migration will be worse than no migration.
- Public SDK breaking changes need package versioning and release-note coordination.

## Non-Goals

- Do not export AgentV run bundles, traces, or datasets into Phoenix or Promptfoo.
- Do not revive `graders:`.
- Do not redesign Dashboard result grouping away from `target` in this change.
- Do not change environment recipe semantics beyond provider-local composition.
- Do not treat Promptfoo `repeat` or `--retry-errors` as sufficient flaky-eval retry semantics.
- Do not add broad Promptfoo provider shorthand compatibility unless each shorthand maps cleanly onto an AgentV provider kind/config.
- Do not locally run full eval dogfood in this planning bead.

## Open Questions

- Should `.agentv/providers.yaml` be the only discovered catalog file after the break, or should `.agentv/targets.yaml` hard-error with a dedicated diagnostic when present?
- Should CLI path flag be `--providers` despite possible confusion with Promptfoo's provider list, or `--providers-file` for clarity?
- Should `defaults.provider` be allowed in eval YAML, project config only, or both?
- Should provider-local `environment` allow repo materialization fields, or only cwd/setup/env overlays in the first release?
- Should result metadata add `provider_id` and `provider_label` immediately, or defer until Dashboard has a concrete UI need?
- Should Promptfoo provider type maps be implemented in the first grader-provider slice or documented as unsupported compatibility work?
- Should `run_policy.attempts` replace current `evaluate_options.repeat` in the same breaking release, or should the new field be added as canonical while `evaluate_options.repeat` remains accepted as shorthand?
- Should attempt directories keep the existing `sample-N` naming used by current artifact tests, or migrate to `attempt-N`/`run-N` with a compatibility manifest?

## Verification Contract

This bead is research and planning only. No `bun install`, builds, tests, or evals are required or appropriate for this worker.

Implementation follow-up work must use focused local validation for touched code and live provider dogfood before marking ready when provider, grader, artifact, or eval execution behavior changes. GitHub Actions remains the broad merge gate.

## Definition of Done

- Plan document exists at `docs/plans/2026-07-07-promptfoo-provider-target-surface-plan.md`.
- Promptfoo findings cite the local commit and source paths.
- AgentV surfaces, migration mapping, grader provider design, provider-local environment design, implementation phases, and file/test/docs checklist are covered.
- Follow-up Beads exist for concrete implementation slices.
- `av-w545` has a Bead note pointing to this plan and remains in progress for coordinator review.
