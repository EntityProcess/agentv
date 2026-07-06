# Promptfoo Fork/SDK Environment Parser Feasibility

Date: 2026-07-07
Bead: `av-ojyy`
Worker: `av-ojyy-promptfoo-fork-sdk`
Worktree: `/home/entity/projects/EntityProcess/agentv__worktrees/av-ojyy-promptfoo-fork-sdk`
Branch: `research/av-ojyy-promptfoo-fork-sdk`

## Executive Verdict

Do not fork Promptfoo, and do not make Promptfoo's evaluator the primary AgentV runtime.

The operator hypothesis is directionally useful for two narrow surfaces: Promptfoo's public package exports are good candidates for selective reuse of provider loading and assertion execution. It is not enough to replace AgentV's config/runtime surface. Promptfoo does not expose its YAML config resolver as a public package API, does not have an `environment` testbed primitive, and writes Promptfoo-shaped results through Promptfoo's own evaluator/storage model. AgentV's unique value - environment lifecycle, run bundles, transcripts, target/grader identity, Dashboard indexing, and provenance - still requires AgentV-owned orchestration.

Recommended path: keep AgentV's parser/runtime/artifact contract as primary, but wrap Promptfoo public SDK APIs where they reduce maintenance:

1. Use Promptfoo's public `loadApiProvider(s)` behind a narrow AgentV adapter for compatible LLM/custom providers.
2. Evaluate replacing or hardening AgentV's Promptfoo-compatible assertion implementation with Promptfoo's public `assertions.runAssertions` where output mapping and artifact needs fit.
3. Treat a second YAML parser as an AgentV-owned translator that reads Promptfoo-compatible YAML plus AgentV `environment`, then emits AgentV runtime structures and optional Promptfoo SDK inputs. Do not rely on private imports from Promptfoo's config loader unless upstream exports a supported resolver.

Forking Promptfoo would make AgentV track a fast-moving app surface and still require invasive changes in the exact areas AgentV cares about: schema, config loading, evaluator scheduling, result storage, environment setup, artifacts, and docs.

## Promptfoo Source State

Local Promptfoo clone inspected:

- Path: `/home/entity/projects/promptfoo/promptfoo`
- Local HEAD: `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`
- HEAD subject: `chore(deps): update modelaudit schema generator to v0.2.47 (#9635)`
- Local branch status during research: `main...origin/main [behind 238]`
- Existing local `origin/main`: `85aaf62c7c59c735961ac928c43490a83583a3de`
- Existing local `origin/main` subject: `chore(deps): update dependency knip to v6.20.0 (#9993)`

Freshness caveat: this research used the operator-provided local clone and existing local refs. I did not fetch Promptfoo's remote. Public web docs were not needed.

Promptfoo files inspected:

- `package.json`
- `src/index.ts`
- `src/contracts.ts`
- `src/contracts/index.ts`
- `site/docs/usage/node-api-reference.md`
- `src/util/config/load.ts`
- `src/types/index.ts`
- `src/types/providers.ts`
- `src/providers/index.ts`
- `src/providers/registry.ts`
- `src/providers/scriptBasedProvider.ts`
- `src/providers/scriptCompletion.ts`
- `src/providers/pythonCompletion.ts`
- `src/util/providerRef.ts`
- `src/node/evaluate.ts`
- `src/evaluate.ts`
- `src/evaluator.ts`
- `src/evaluator/runtime.ts`
- `src/evaluator/inMemoryStore.ts`
- `src/evaluatorHelpers.ts`
- `src/assertions/index.ts`
- `src/matchers/comparison.ts`
- `src/models/eval.ts`
- `src/node/evaluationStore.ts`
- `src/node/doEval.ts`
- `src/node/retry.ts`
- `src/commands/eval.ts`

AgentV files inspected:

- `AGENTS.md`
- `STRATEGY.md`
- `ROADMAP.md`
- `.agents/product-boundary.md`
- `.agents/workflow.md`
- `.agents/verification.md`
- `.agents/conventions.md`
- `.agents/publish.md`
- `CONCEPTS.md`
- `docs/adr/0016-promptfoo-superset-eval-authoring-contract.md`
- `docs/adr/0017-output-artifact-and-workspace-resolver-contract.md`
- `docs/adr/0018-coding-agent-target-runtime-contract.md`
- `docs/solutions/architecture-patterns/blend-promptfoo-margin-harbor-environment-recipes.md`
- `packages/core/src/evaluation/yaml-parser.ts`
- `packages/core/src/evaluation/types.ts`
- `packages/core/src/evaluation/evaluate.ts`
- `packages/core/src/evaluation/orchestrator.ts`
- `packages/core/src/evaluation/run-artifacts.ts`
- `packages/core/src/evaluation/loaders/environment-recipe.ts`
- `packages/core/src/evaluation/environment/host.ts`
- `packages/core/src/evaluation/environment/docker.ts`
- `packages/core/src/evaluation/environment/provenance.ts`
- `packages/core/src/evaluation/providers/targets.ts`
- `packages/core/src/evaluation/graders/promptfoo-assertions.ts`
- `apps/cli/src/commands/eval/artifact-writer.ts`

DeepWiki for `promptfoo/promptfoo` was used only for architecture orientation. Exact conclusions below are based on local source inspection.

## Exact Promptfoo SDK/API Surfaces Found

### Package Exports

Promptfoo package `package.json` exposes:

- `.` -> `./dist/src/index.js`
- `./contracts` -> `./dist/src/contracts/index.js`

`src/index.ts` publicly exports:

- `evaluate` from `src/node/evaluate.ts`
- `loadApiProvider`, `loadApiProviders` from `src/providers/index.ts`
- `assertions` namespace from `src/assertions/index.ts`
- `cache`, `guardrails`, `redteam`
- types from `src/types/index.ts`
- `ConfigResolutionError` from `src/util/config/load.ts`

It does not export `readConfig`, `combineConfigs`, or `resolveConfigs`. Those config-loading functions are internal/private from the package-export perspective.

### Loading/Parsing YAML Config

Internal functions in `src/util/config/load.ts`:

- `readConfig`: parses `.json`, `.yaml`, `.yml`, and JS configs, dereferences `$ref`, renders env templates, validates with `UnifiedConfigSchemaWithoutPrompts`, normalizes `targets` to `providers`, and handles defaults such as default prompt fallback.
- `combineConfigs`: merges multiple config files, including tags, description, providers, prompts, tests, scenarios, defaults, derived metrics, filters, `env`, `evaluateOptions`, `outputPath`, `commandLineOptions`, `extensions`, `redteam`, metadata, sharing, and tracing. The source warns that multiple configs plus extensions currently run all extensions across all configs rather than preserving per-origin extension scoping.
- `resolveConfigs`: CLI resolver returning `{ testSuite, config, basePath, commandLineOptions }`. It handles CLI/config merging, base paths, `defaultTest` refs, provider filtering, prompt/test/scenario reading, validation, and `cliState.config`.

Schema evidence in `src/types/index.ts`:

- `TestSuiteConfigSchema` includes `tags`, `description`, `providers`, `prompts`, `tests`, `scenarios`, `defaultTest`, `outputPath`, `sharing`, `nunjucksFilters`, `env`, `derivedMetrics`, `extensions`, `metadata`, `redteam`, `writeLatestResults`, and `tracing`.
- `UnifiedConfigSchema` adds `evaluateOptions`, `commandLineOptions`, optional `providers`, and optional `targets`, then refines exactly one of `targets` or `providers` and transforms `targets` to `providers`.
- There is no Promptfoo `environment` field.

Conclusion: Promptfoo has a real YAML resolver, but AgentV cannot depend on it as an SDK surface without using private imports, vendoring/copying it, forking, or getting an upstream public export.

### Resolving Providers

Public functions in `src/providers/index.ts`:

- `loadApiProvider(providerPath, context)`
- `loadApiProviders(providerPaths, options)`

Related internal/public-adjacent functions:

- `resolveProvider`
- `resolveProviderConfigs`
- `getProviderIds`

Provider contract in `src/types/providers.ts`:

- `ApiProvider` has `id()`, `callApi(prompt, context?, options?)`, optional `cleanup`, `config`, `label`, and metadata hooks.
- `CallApiContextParams` carries prompt, vars, original provider, test, traceparent, `evaluationId`, `testCaseId`, `testIdx`, `promptIdx`, and `repeatIndex`.
- `ProviderOptions` includes `id`, `label`, `config`, `prompts`, `transform`, `delay`, `env`, and `inputs`.

Provider loading behavior:

- Provider options merge top-level/config env and provider-specific `options.env`.
- Provider refs can be strings, functions, provider objects, arrays, maps, or `file://*.yaml|yml|json` refs.
- Provider config files are resolved and loaded.
- `src/util/providerRef.ts` treats only known provider-option keys specially. A provider object field named `environment` is not one of them. Putting `environment` under `config` preserves it for custom provider code.
- Registry entries in `src/providers/registry.ts` include many LLM providers and script/custom providers, including `exec`, Python, Ruby, Go, `openai:codex-sdk`, `anthropic:claude-agent-sdk`, `opencode`, and `openclaw`.

Conclusion: `loadApiProvider(s)` is a viable public SDK surface for selective AgentV reuse, especially for non-coding-agent LLM providers and custom providers. It is not enough to represent AgentV target identity and environment lifecycle by itself.

### Running Evals

Public API:

- `src/node/evaluate.ts` exports `evaluate(testSuite, options)`.
- It calls `evaluateWithSource(testSuite, { ...options, eventSource: 'library' })`.
- It returns an `Eval` record, which can produce Promptfoo summaries through `toEvaluateSummary()`.

Runtime behavior in `src/evaluate.ts` and `src/evaluator.ts`:

- `evaluateWithSource` expects an `EvaluateTestSuite` object. It does not parse a YAML file path.
- It loads providers via `loadApiProviders(testSuiteConfig.providers, { env })`.
- It processes prompts/tests, creates an `Eval` record, then calls internal evaluator orchestration.
- Internal evaluator runs extension hooks, provider calls, assertions, comparison assertions, output writers, and result storage.
- `EvaluateOptionsSchema` supports `cache`, `delay`, `generateSuggestions`, `suggestionsCount`, `maxConcurrency`, `progressCallback`, `repeat`, `showProgressBar`, `timeoutMs`, `maxEvalTimeMs`, `isRedteam`, `silent`, and `filterRange`.

Conclusion: `evaluate` is usable as a library if AgentV accepts Promptfoo's evaluator lifecycle and result model. It is not a direct fit for AgentV-owned environments, artifacts, transcripts, target/grader identity, or Dashboard indexing.

### Running Assertions

Public API:

- `src/index.ts` exports `assertions`.
- `src/assertions/index.ts` exports `runAssertion` and `runAssertions`.

Behavior:

- Supports deterministic and model-graded assertion types.
- Supports `file://` assertion values and JS/Python/Ruby/package custom functions.
- `runAssertions` aggregates assertion component results, named scores, tokens, and pass/score information.
- `select-best` and `max-score` are special comparison assertions handled later by the evaluator because they require multiple outputs.

Conclusion: assertion reuse is one of the strongest Promptfoo SDK opportunities. AgentV still needs an adapter to map Promptfoo grading results into AgentV `grading.json`, recursive `component_results`, named scores, thresholds, artifacts, and run-bundle summaries.

### Receiving Results Programmatically

Public-ish programmatic result path:

- `evaluate()` returns an `Eval`.
- `Eval.toEvaluateSummary()` returns Promptfoo summary shapes with prompts, results, stats, and version/timestamp.
- `EvaluateOptions.progressCallback` can observe progress during evaluation.

Internal/private result hooks:

- `src/evaluator/runtime.ts` defines `EvaluationStore`, `EvaluatorResultWriter`, and `EvaluatorRuntime`.
- `src/evaluator/inMemoryStore.ts` implements in-memory storage.
- `src/node/evaluationStore.ts` adapts Promptfoo's `Eval` DB model.

These runtime/store abstractions are not exported from the package root. A non-forked AgentV should not import them through private paths as a core dependency.

Conclusion: Promptfoo can return results programmatically, but the returned shape and storage lifecycle are Promptfoo's. AgentV would need post-processing to emit run bundles, and post-processing cannot recover all provenance/transcript details if AgentV did not control execution.

### Custom Providers, Assertions, and Extensions

Custom provider options:

- Provider `config` is arbitrary and passed to provider implementations.
- Custom JS/Python/Ruby providers can be loaded through file refs.
- `exec:` script provider invokes commands and passes prompt/options/context as arguments.
- Python provider processes `file://` refs in config and passes processed options/config to Python code.

Extension hooks:

- `src/evaluatorHelpers.ts` supports `beforeAll`, `beforeEach`, `afterEach`, `afterAll`.
- Hooks are `file://path:functionName` or legacy custom hook functions.
- Hooks receive hook-specific context and can mutate/effect run behavior.

Conclusion: Promptfoo extensions can run setup code, but they are untyped lifecycle hooks. They are not a good canonical representation for AgentV's testbed setup, cwd, Docker resources, setup provenance, or Dashboard-visible environment metadata. This matches existing AgentV ADR 0017 guidance.

## Can AgentV Use Promptfoo as a Library Without Forking?

Yes, but only behind narrow adapters.

Viable without fork:

- Use `loadApiProvider(s)` for compatible provider instantiation.
- Use Promptfoo `ApiProvider.callApi()` as a backend inside an AgentV target adapter.
- Use `assertions.runAssertions` for supported assertion types, then map results into AgentV grading artifacts.
- Use Promptfoo custom provider conventions for user-supplied providers, if AgentV clearly documents the subset and owns output normalization.

Not viable without fork or upstream change:

- Use Promptfoo's YAML parser as primary config resolver. It is not exported.
- Use Promptfoo evaluator as the primary scheduler while preserving AgentV environment lifecycle, per-attempt workspaces, transcript capture, artifacts, and Dashboard indexes.
- Use Promptfoo result storage as AgentV's source of truth.

AgentV would need to wrap before Promptfoo provider/assertion calls:

- Parse AgentV YAML, including `environment`.
- Expand AgentV matrix semantics and stable `test_id` identity.
- Prepare suite/test/case environment before target and grader execution.
- Resolve target identity (`targets[].id`) separately from backend/provider kind.
- Build Promptfoo-compatible provider/test/assertion inputs only for the portions delegated to Promptfoo.
- Inject cwd/workdir, env, metadata, trace context, sample/retry identity, and timeout/cancellation.

AgentV would need to wrap after Promptfoo calls:

- Normalize provider responses into AgentV result envelopes.
- Capture raw transcripts/logs and preserve external trace links.
- Run or map graders into AgentV recursive grading components.
- Write `.agentv/results/<run_id>/summary.json`.
- Write `<test-id>/sample-N/` sidecars.
- Write `.internal/index.jsonl`.
- Write environment provenance and environment artifacts.
- Update derived Dashboard indexes.
- Preserve target/grader identity for comparison and reruns.

Preservation verdict:

- Run bundles: require AgentV-owned writer.
- Transcripts: require AgentV-owned target/runtime wrappers, especially for coding agents.
- Environment artifacts: require AgentV-owned environment driver and provenance builder.
- Dashboard indexing: require AgentV-owned artifact/index schema.
- Target/grader identity: require AgentV parser/runtime to preserve AgentV names instead of Promptfoo provider labels alone.
- `environment` lifecycle: require AgentV-owned orchestration.

## Provider-Level `environment` YAML in Promptfoo Provider Config

The follow-up design is technically feasible as a custom provider convention:

```yaml
providers:
  - id: file://agentv-provider-wrapper.js
    config:
      command: ["codex", "exec"]
      environment: file://environment.yaml
```

or, in AgentV terms:

```yaml
targets:
  - id: codex-local
    provider: promptfoo-custom
    config:
      provider: file://agentv-provider-wrapper.js
      environment: file://environment.yaml
```

Mapping to Promptfoo:

- Promptfoo provider `config` is arbitrary, so `config.environment` naturally reaches custom providers.
- A top-level provider object field named `environment` is not part of Promptfoo `ProviderOptions` and should not be assumed stable.
- Promptfoo's built-in `exec:` provider does not prepare an environment. `scriptCompletion.ts` uses `config.basePath` as cwd, but does not interpret `config.environment`.
- A custom provider wrapper could read `config.environment`, prepare host/Docker state, set cwd/env, invoke a CLI, and return a Promptfoo provider response.

This is not enough to avoid top-level AgentV-owned environment runtime.

Problems with provider-local environment as the canonical testbed:

- It ties task substrate to target/provider identity. AgentV's ADR 0016/0018 boundary keeps targets as systems under test and environments as suite/test/case testbeds.
- It duplicates setup across a `prompts x tests x targets` matrix. If two candidate targets should run against the same prepared case, provider-local setup creates one setup per provider instead of one case environment shared across comparable targets.
- It does not naturally prepare the same workdir for candidate targets, script graders, deterministic checks, and environment artifacts.
- It makes grader behavior ambiguous. Candidate providers need the environment to run the agent in a repo; grader providers are often LLM judges and should not prepare or mutate the same testbed. Script graders usually need the resolved environment workdir after the candidate run, not a separate provider-local setup.
- It hides provenance inside provider code unless AgentV wraps and records it anyway.
- It cannot produce canonical Dashboard environment summaries, setup logs, hashes, redaction, Docker image/context metadata, or run-bundle paths unless AgentV owns those artifacts.
- It cannot guarantee environment setup order relative to Promptfoo lifecycle hooks unless AgentV owns orchestration.

When provider-local environment is useful:

- As an escape hatch for a custom provider whose backend truly owns a private external environment.
- As a compatibility wrapper for users bringing Promptfoo custom providers into AgentV.
- As a prototype path for CLI providers when artifacts are explicitly best-effort.

Provider-local vs suite/test-level:

- Provider-local is worse for matrix evals because it multiplies setup by target and mixes SUT identity with task substrate.
- Suite/test/case `environment` is better for repo-native evals because it prepares one comparable testbed per case, passes a typed cwd to targets and graders, and gives AgentV one provenance object to index and display.

Recommendation: support `config.environment` only as a provider-wrapper compatibility convention if needed. Do not replace AgentV's top-level/test-level `environment` lifecycle with provider-local environment.

## Flaky Attempts, Repeat, and Early Exit

Promptfoo can repeat evaluations, but it does not natively model AgentV's flaky eval semantics of "up to N attempts, pass if any attempt passes, and stop after the first pass."

Promptfoo source evidence:

- CLI supports `--repeat <number>` in `src/commands/eval.ts`.
- Schemas support `commandLineOptions.repeat` and `evaluateOptions.repeat` in `src/types/index.ts`.
- `src/node/doEval.ts` resolves repeat priority as CLI `repeat`, then `commandLineOptions.repeat`, then `evaluateOptions.repeat`, defaulting to 1.
- `src/evaluator.ts` expands repeats before execution. In `appendRunEvalOptionsForTestCase`, it loops `repeatIndex` from 0 to `options.repeat - 1`, appends run options for each var combination, and increments `nextTestIdx` after each repeat/var combination.
- Each run option carries `repeatIndex`, but repeats receive different `testIdx` values.
- `select-best` and `max-score` comparison assertions collect rows by `testIdx` through `readResultsByTestIdx(testIdx)`. Since repeats increment `testIdx`, comparison assertions do not naturally group repeated attempts of the same logical case.
- `--retry-errors` is a persisted-eval path for `ResultFailureReason.ERROR` rows only. `src/node/retry.ts` queries and retries ERROR rows, enables resume/retry mode so completed non-error pairs are skipped, and deletes old ERROR rows only after successful retry. It is not assertion-failure retry, logical pass-any aggregation, or early exit.

Least-bad implementation options if AgentV were a thin Promptfoo YAML parser/transpiler:

1. Pure Promptfoo config only: not sufficient.
   - You can set `repeat`, but Promptfoo will produce repeated rows.
   - You can add custom assertions or derived metrics after the fact, but they cannot prevent already-scheduled later attempts from running.
   - `select-best`/`max-score` compare sibling outputs with the same `testIdx`; Promptfoo repeats do not preserve a shared `testIdx` group.
   - No true early exit.

2. Promptfoo SDK/library plus AgentV scheduler wrapper: least-bad non-fork path.
   - AgentV owns an attempt loop around Promptfoo provider/assertion calls.
   - For each logical AgentV case, run one attempt at a time, grade it, write a sample artifact, and stop early for `pass_any` once an attempt passes.
   - This can use Promptfoo `loadApiProvider(s)` and `assertions.runAssertions`, but should not call Promptfoo `evaluate()` for the whole suite because Promptfoo expands repeat internally and schedules all attempts.
   - This preserves AgentV artifact shape and current `evaluate_options.repeat.count/strategy/early_exit` semantics.

3. Promptfoo fork patch: technically clean inside Promptfoo, but expensive.
   - Add a first-class `attempts` or structured `repeat` object with grouping identity, pass-any/pass-all aggregation, and early-exit scheduling.
   - Modify evaluator expansion so repeats share a logical-case id while attempts remain separately identifiable.
   - Modify scheduler to support early exit despite concurrency.
   - Modify result storage, summaries, comparison assertions, UI, CLI, and docs.
   - This is high-conflict upstream tracking surface and still does not solve AgentV environment/artifact needs without more fork work.

Conclusion: early exit requires AgentV-owned execution orchestration or a Promptfoo fork. It cannot be achieved by pure YAML transpilation to Promptfoo `repeat`.

## Fork Point Map

If AgentV forks Promptfoo, likely fork points are:

### Config Schema/Parser

Files:

- `src/types/index.ts`
- `src/util/config/load.ts`
- schema/doc generation such as `scripts/generateJsonSchema.ts` and site config docs

Changes needed:

- Add top-level/test-level `environment` and possibly structured `repeat`.
- Preserve AgentV `targets[].id` semantics rather than Promptfoo provider identity.
- Reject target/provider-level testbed fields if keeping AgentV boundaries.
- Resolve `file://environment.yaml`.
- Snapshot environment metadata in resolved configs.

Conflict risk: high. Promptfoo config shape and docs are central product surface.

### Provider Resolution

Files:

- `src/providers/index.ts`
- `src/util/providerRef.ts`
- `src/providers/registry.ts`
- provider docs

Changes needed:

- Preserve or map AgentV target IDs.
- Add first-class environment context to provider calls or provider options.
- Decide how candidate and grader providers receive cwd/env/workdir.
- Keep coding-agent providers isolated if using SDKs.

Conflict risk: medium to high. Promptfoo provider registry changes frequently as providers/models are added.

### Eval Runner/Scheduler

Files:

- `src/evaluator.ts`
- `src/evaluate.ts`
- `src/node/evaluate.ts`

Changes needed:

- Prepare environment before target execution and before ordinary lifecycle hooks.
- Support per-suite/per-test/per-case environment lifetime.
- Support AgentV attempts and early exit.
- Capture transcript events and provider logs.
- Keep target crashes from breaking artifact finalization.

Conflict risk: very high. This is the core runner.

### Assertion Runner

Files:

- `src/assertions/index.ts`
- assertion schemas in `src/types/index.ts`
- comparison matchers in `src/matchers/comparison.ts`

Changes needed:

- Map assertion output to AgentV recursive grading components.
- Ensure script graders run from `environment.workdir`.
- Preserve AgentV grader identity and artifacts.
- Possibly add or adapt AgentV-specific grader semantics.

Conflict risk: medium. Reusing this public API via adapter is preferable.

### Result Storage

Files:

- `src/models/eval.ts`
- `src/node/evaluationStore.ts`
- `src/evaluator/runtime.ts`
- `src/evaluator/inMemoryStore.ts`
- `src/util/output.ts`

Changes needed:

- Replace or augment Promptfoo DB/output storage with AgentV `.agentv/results/<run_id>/`.
- Write `summary.json`, `.internal/index.jsonl`, per-case/sample sidecars, environment artifacts, transcripts, and Dashboard indexes.
- Preserve run bundle as source of truth.

Conflict risk: very high. It changes product storage and UI assumptions.

### CLI and Docs

Files:

- `src/commands/eval.ts`
- `src/node/doEval.ts`
- site docs and JSON schema

Changes needed:

- Document AgentV `environment`, target identity, artifacts, and repeat semantics.
- Add or change CLI flags.
- Prevent confusion with Promptfoo `env`, `extensions`, and provider options.

Conflict risk: high. Promptfoo CLI and docs are active product surfaces.

## What a Second YAML Parser With `environment` Would Look Like

The viable design is an AgentV-owned parser/translator, not a thin call into Promptfoo's hidden config loader.

Input:

- Promptfoo-compatible YAML fields that AgentV supports: `prompts`, `tests`, `vars`, `assert`, `default_test`, `env`, `extensions`, `targets`/imported `providers`, transforms, tags, and evaluate options.
- AgentV-only `environment` at suite/test/case scope, inline or `file://`.

Output:

- AgentV runtime suite with:
  - stable `test_id`
  - AgentV `targets[].id` and backend `provider`
  - resolved `EnvironmentRecipe`
  - resolved repeat/attempt policy
  - grader configs
  - artifact and Dashboard metadata
- Optional Promptfoo SDK inputs:
  - provider specs passed to `loadApiProvider(s)`
  - assertion specs passed to `assertions.runAssertions`
  - prompt/test fragments when useful

Do not generate a complete Promptfoo config and call `evaluate()` as the primary path if AgentV needs environment lifecycle, early exit, artifacts, and transcripts.

Sidecar metadata:

- If AgentV imports a raw Promptfoo config, preserve original Promptfoo provider/test labels as metadata.
- Generate AgentV run-bundle sidecars for environment provenance, target identity, grader identity, and matrix expansion.
- Do not rely on Promptfoo output JSON as the authoritative bundle.

Code that could be deleted or reduced:

- Some duplicated Promptfoo deterministic assertion handling could be replaced by `assertions.runAssertions`, subject to output mapping and artifact tests.
- Some generic LLM provider adapters could be replaced or backed by Promptfoo `loadApiProvider(s)`.
- Some custom provider compatibility code could be reduced by accepting Promptfoo custom-provider shapes behind an adapter.

Code that must remain:

- `packages/core/src/evaluation/loaders/environment-recipe.ts`
- environment drivers under `packages/core/src/evaluation/environment/`
- `packages/core/src/evaluation/orchestrator.ts` attempt/environment/artifact orchestration
- `packages/core/src/evaluation/run-artifacts.ts`
- Dashboard index/run-bundle contract
- coding-agent target wrappers, transcripts, child-runner boundaries
- AgentV parser logic for `environment`, target identity, stable `test_id`, repeat aggregation, and artifact metadata

Estimate:

- Promptfoo key files for config/providers/assertions/evaluator/storage inspected total roughly 11k lines.
- AgentV evaluation YAML/parser/provider/grader/orchestrator/artifact files inspected total roughly 44k lines.
- The likely deletion/reuse opportunity is not the whole 44k. Most of that is AgentV-owned value: environments, artifacts, coding-agent providers, transcripts, Dashboard, and orchestration.
- Near-term deletion/reuse is probably hundreds to low-thousands of lines, mostly around assertion compatibility and generic provider plumbing. Larger deletion would require accepting Promptfoo's evaluator/storage model, which would lose AgentV product value.

## Option Comparison

### A. Fork Promptfoo and Add AgentV Environment/Artifacts

Pros:

- Direct access to Promptfoo YAML resolver, scheduler, assertion engine, provider registry, CLI, and UI assumptions.
- Could implement `environment`, structured attempts, and artifacts in one forked codebase.
- Promptfoo config compatibility becomes easier at parse time.

Cons:

- Highest maintenance cost.
- Local Promptfoo clone is already 238 commits behind existing local `origin/main`, showing active churn.
- Fork would touch high-conflict core files: schema/parser, provider registry, evaluator, storage, CLI, docs.
- AgentV would still need major custom code for environments, artifacts, transcripts, target/grader identity, and Dashboard.
- Provider and model registry churn would be ongoing merge work.
- AgentV would inherit Promptfoo baggage where ADRs intentionally diverge, such as provider identity semantics.

Verdict: not recommended.

### B. Use Promptfoo SDK for Config/Assertions/Providers While AgentV Owns Environment/Runtime/Artifacts

Pros:

- Best reuse story for public APIs: `loadApiProvider(s)` and `assertions.runAssertions`.
- Avoids fork.
- Lets AgentV keep environment, artifacts, Dashboard, target identity, and attempt orchestration.
- Can support Promptfoo custom providers and assertion types faster.

Cons:

- "Config" part is weaker than it sounds: Promptfoo's YAML resolver is private.
- AgentV still needs its own parser/translator for `environment` and stable identities.
- Calling Promptfoo `evaluate()` is not a fit for environment lifecycle or pass-any early exit.
- SDK adapters need careful result mapping.

Verdict: recommended only as selective SDK reuse, not as "Promptfoo SDK is primary runtime."

### C. Keep AgentV Parser/Runtime and Copy/Adapt Promptfoo-Compatible Surface Incrementally

Pros:

- Matches current AgentV ADRs and product boundary.
- Lowest risk for run bundles, Dashboard, environments, coding-agent transcripts, and early exit.
- Can still adopt Promptfoo public SDK APIs behind adapters where useful.
- Avoids depending on Promptfoo private config internals.

Cons:

- AgentV continues maintaining a compatibility parser surface.
- Needs ongoing triage of which Promptfoo fields/assertions/providers to support.
- Some duplication remains unless Promptfoo SDK adapters are prioritized.

Verdict: best default. Combine with selective pieces of B.

## Risks and Maintenance Costs

### Stable Enough to Depend On

- Package root `evaluate`, `loadApiProvider(s)`, and `assertions` are documented/public exports.
- `ApiProvider` shape is a practical compatibility contract.
- Promptfoo custom provider conventions are useful and likely to remain important.

### Risky/Internal

- `src/util/config/load.ts` resolver functions are private from the package-export perspective.
- `src/evaluator.ts` and scheduler internals are private.
- `src/evaluator/runtime.ts` custom store/writer abstractions are internal.
- Promptfoo DB/result storage models are product internals.
- Provider registry is high-churn.
- CLI flags and config docs are product surface and likely to conflict in a fork.

### Specific Upgrade Conflict Areas

- Schema evolution around `providers`/`targets`, config refs, redteam, tracing, and output settings.
- Provider registry additions/removals and provider option normalization.
- Evaluator scheduling, repeat handling, comparison assertions, resume/retry, and cache namespaces.
- Result storage migrations and UI summary shape.
- Node API docs and package export changes.

## Recommended Next Steps

1. Keep `environment` top-level/test-level in AgentV, not provider-local.
2. Do not fork Promptfoo.
3. Do not call Promptfoo `evaluate()` as AgentV's primary runtime.
4. Create a narrow Promptfoo provider-adapter spike using only public `loadApiProvider(s)`.
5. Create a Promptfoo assertion-adapter spike comparing AgentV's current `promptfoo-assertions.ts` behavior with `assertions.runAssertions`.
6. Create an upstream-facing research task or proposal for Promptfoo to export a supported config resolver. Treat this as optional; AgentV should not block on it.
7. Keep AgentV-owned attempt orchestration for `evaluate_options.repeat.count`, `pass_any`, `pass_all`, and `early_exit`.
8. If provider-level `config.environment` is supported later, document it as a custom-provider compatibility escape hatch, not the canonical AgentV testbed contract.

## Bottom Line

Promptfoo can reduce AgentV maintenance around providers and assertions. It cannot replace AgentV's config/runtime surface without either private imports or a fork, and a fork would concentrate maintenance exactly where upstream churn and AgentV divergence are highest.

The best answer is a B/C hybrid: AgentV remains the owner of YAML translation, environment lifecycle, execution orchestration, attempts, artifacts, transcripts, and Dashboard indexing; Promptfoo public SDK APIs are used opportunistically behind adapter boundaries.
