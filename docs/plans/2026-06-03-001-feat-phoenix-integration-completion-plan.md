---
title: "feat: Complete the AgentV Phoenix integration"
type: "feat"
status: "active"
date: "2026-06-03"
---

# feat: Complete the AgentV Phoenix integration

## Summary

Complete AgentV's Phoenix integration as two intentionally bounded surfaces: a first-class Phoenix OTLP observability preset for normal `agentv eval` runs, and a Phoenix dataset/experiment adapter that keeps AgentV eval YAML and AgentV scoring semantics authoritative. The current `@agentv/phoenix-adapter` package should stay repo-local/private until real AgentV execution, deterministic parity, documentation, and release-readiness criteria are satisfied.

---

## Problem Frame

PR #1279 added the initial repo-local `packages/phoenix-adapter` package. It proves that AgentV-authored eval suites can be normalized through `@agentv/core`, converted into Phoenix dataset payloads, and run through a Phoenix experiment with deterministic CODE evaluator support for `contains`, `regex`, `equals`, and `is-json`.

The integration is not yet complete from a user perspective. It has no AgentV CLI surface, no Phoenix OTLP backend preset, no publishable package posture, no real AgentV target execution inside Phoenix experiments, incomplete deterministic parity, large unsupported `llm-grader` / `code-grader` / trace-family gaps, and only a narrow CI smoke. Full dry-run currently reports 97 suites / 405 tests / 93 passed suites / 4 failed suites, with 217 unsupported entries across 122 distinct unsupported features.

---

## Requirements

### Integration contract

- R1. Define Phoenix integration as two complementary surfaces: OTLP trace export from normal AgentV eval runs, and a dataset/experiment adapter for AgentV-authored eval suites.
- R2. Keep AgentV eval YAML as the source of truth for test discovery, case normalization, assertion parsing, interpolation, and metadata handling.
- R3. Keep AgentV scoring authoritative for AgentV-specific semantics unless a Phoenix-native evaluator is explicitly proven equivalent and documented.
- R4. Preserve AgentV's lightweight-core/plugin-extensibility boundary: do not reimplement workspace lifecycle, Docker sandboxing, target matrices, trials, or custom assertion discovery inside Phoenix unless a concrete need later justifies it.

### User-facing behavior

- R5. Users can export AgentV eval traces to Phoenix through a documented `phoenix` OTel backend preset.
- R6. Users can understand what the Phoenix adapter supports, what it reports as unsupported, and how unsupported features affect scores/status.
- R7. Phoenix experiment runs should execute real AgentV targets, or clearly declare a dry-run/reference mode that does not claim target parity.
- R8. Repeated Phoenix adapter runs should avoid confusing dataset duplication and should preserve stable AgentV identifiers in Phoenix metadata.

### Evaluator parity

- R9. Deterministic assertion parity covers `contains`, `contains-any`, `contains-all`, `icontains`, `icontains-any`, `icontains-all`, `starts-with`, `ends-with`, `regex`, `equals`, and `is-json`.
- R10. Deterministic scoring handles or explicitly declines `weight`, `required`, `min_score`, and `negate` semantics.
- R11. `llm-grader` and `rubrics` support is designed around AgentV prompt/schema parity first, with Phoenix-native model evaluator reuse considered only where semantics remain clear.
- R12. Trace and metric graders are supported only after Phoenix traces can be associated with AgentV test cases through stable trace IDs/spans.

### Release and verification

- R13. The repo-local/private package remains private until release and install expectations are met.
- R14. If the package becomes publishable, release/version/publish scripts include it and package metadata exposes the intended CLI/API surface.
- R15. Full dry-run structural parity is either green or has explicitly documented exclusions before it becomes a blocking CI gate.
- R16. Live Phoenix verification covers both OTLP export and at least one experiment path before the integration is documented as complete.

---

## Key Technical Decisions

- KTD1. **Treat Phoenix as observability plus experiment surface, not an alternate AgentV runtime:** Phoenix experiments can host runs and evaluations, but AgentV-specific YAML semantics, target execution, and scorer contracts should remain centralized in AgentV. This prevents duplicating complex runtime behavior in `packages/phoenix-adapter`.
- KTD2. **Ship Phoenix OTLP preset before expanding adapter depth:** A `phoenix` backend preset gives users immediate value with normal `agentv eval` runs and uses existing OTel infrastructure in `packages/core/src/observability/otel-exporter.ts` and `apps/cli/src/commands/eval/run-eval.ts`.
- KTD3. **Keep `@agentv/phoenix-adapter` private until real execution exists:** The package currently synthesizes task output in `packages/phoenix-adapter/src/phoenix/run-experiment.ts`; publishing before real AgentV execution risks users mistaking plumbing validation for true eval parity.
- KTD4. **Prefer reusing AgentV evaluator logic over parallel adapter implementations:** The current adapter has its own deterministic evaluator implementation in `packages/phoenix-adapter/src/evaluators/deterministic.ts`; future work should reduce semantic drift by sharing or wrapping core grader behavior where feasible.
- KTD5. **Make unsupported semantics visible and conservative:** Unsupported evaluator families should remain visible in reports and metadata. Scores should not overstate quality when unsupported assertions are present.
- KTD6. **Use Phoenix trace IDs only after spans are available:** Phoenix trace-based evaluators are best planned around post-run evaluation so AgentV can fetch spans by trace ID and translate them into `TraceSummary`-like data for `tool-trajectory`, `execution-metrics`, `latency`, `cost`, and token usage graders.

---

## High-Level Technical Design

```mermaid
flowchart TB
  A[AgentV eval YAML] --> B[@agentv/core loader]
  B --> C[Normalized AgentV suite]
  C --> D[Phoenix dataset payload]
  D --> E[Phoenix experiment]
  E --> F[AgentV target execution]
  F --> G[AgentV-authored scores and metadata]
  F --> H[OTLP spans to Phoenix]
  H --> I[TraceId / span lookup]
  I --> J[Trace and metric graders]
  G --> K[Phoenix evaluation results]
  J --> K
```

The integration should have two stable entry paths. Normal `agentv eval` runs export traces directly to Phoenix through OTel. The adapter path converts AgentV suites into Phoenix datasets and experiments, then runs AgentV targets/scorers while recording Phoenix experiment artifacts. The adapter should not become a second YAML parser, target runner, or sandbox system.

---

## Scope Boundaries

### In scope

- Phoenix OTel backend preset and documentation.
- Support matrix and integration contract documentation.
- Deterministic assertion parity for AgentV's common built-in deterministic primitives.
- Real AgentV target execution inside Phoenix experiments.
- LLM/rubric support where AgentV scorer semantics stay authoritative.
- Trace-based grader support after trace IDs and spans are reliably wired.
- Release-readiness changes if the package is later approved for publishing.

### Deferred to Follow-Up Work

- Phoenix-native equivalents for every AgentV custom/plugin evaluator.
- Native Phoenix implementation of AgentV workspace lifecycle, Docker workspace setup, target matrices, and trials.
- Dashboard-specific Phoenix UI beyond linking/exporting existing Phoenix artifacts.
- Auto-opening issues from this plan; proposed issue bodies can be used later if requested.

### Outside this integration's identity

- Replacing AgentV's local result JSONL/artifact model with Phoenix as the sole results store.
- Making Phoenix a required dependency for normal AgentV eval execution.
- Adding provider-specific Phoenix config knobs that can be solved by existing OTel environment variables or plugin/wrapper patterns.

---

## Implementation Units

### U1. Document the Phoenix integration contract

- **Goal:** Establish a user-facing and contributor-facing contract for what the Phoenix integration is, what it supports today, and what “complete” means.
- **Requirements:** R1, R2, R3, R4, R6, R13.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/content/docs/docs/integrations/phoenix.mdx`
  - `apps/web/src/content/docs/docs/evaluation/running-evals.mdx`
  - `packages/phoenix-adapter/README.md`
  - `packages/phoenix-adapter/docs/support-matrix.md`
  - `packages/phoenix-adapter/docs/e2e-verification.md`
  - `skills-data/agentv-eval-writer/SKILL.md`
  - `skills-data/agentv-eval-writer/references/config-schema.json`
- **Approach:** Add a Phoenix integration doc that distinguishes OTLP export from dataset/experiment adapter mode. State that AgentV YAML and scoring remain authoritative. Update the support matrix so unsupported families are grouped by reason instead of appearing as a flat first-pass list.
- **Patterns to follow:** Existing Langfuse integration docs in `apps/web/src/content/docs/docs/integrations/langfuse.mdx`; OTel CLI docs in `apps/web/src/content/docs/docs/evaluation/running-evals.mdx`.
- **Test scenarios:**
  - Validate that docs include local Phoenix endpoint setup, API-key setup, project routing, privacy warning for content capture, adapter dry-run command, live experiment command, and unsupported-family behavior.
  - Validate relative markdown links in new docs so the existing link checker can traverse them.
  - Validate skill/config schema references use snake_case wire keys for any config examples.
- **Verification:** A reader can tell when to use `--export-otel --otel-backend phoenix`, when to use the adapter, which evaluator families are supported, and why the adapter remains private.

### U2. Add a Phoenix OTel backend preset

- **Goal:** Allow normal AgentV eval runs to stream traces to Phoenix without using package-internal adapter commands.
- **Requirements:** R1, R5, R16.
- **Dependencies:** U1 for documentation alignment.
- **Files:**
  - `packages/core/src/observability/otel-exporter.ts`
  - `packages/core/src/observability/types.ts`
  - `apps/cli/src/commands/eval/run-eval.ts`
  - `apps/cli/src/commands/eval/commands/run.ts`
  - `packages/core/test/observability/otel-exporter.test.ts`
  - `apps/cli/test/commands/eval/run.test.ts`
- **Approach:** Extend `OTEL_BACKEND_PRESETS` with `phoenix`. Use `PHOENIX_COLLECTOR_ENDPOINT` when set and otherwise default to the local Phoenix OTLP traces endpoint. Add `Authorization: Bearer <PHOENIX_API_KEY>` when present and `x-project-name` when a Phoenix project name is configured. Keep generic `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` behavior intact.
- **Patterns to follow:** Existing `langfuse`, `braintrust`, and `confident` presets in `packages/core/src/observability/otel-exporter.ts`; CLI OTel option resolution in `apps/cli/src/commands/eval/run-eval.ts`.
- **Test scenarios:**
  - With no Phoenix env vars, selecting the `phoenix` preset resolves to the local Phoenix OTLP traces endpoint.
  - With `PHOENIX_COLLECTOR_ENDPOINT`, the preset uses the configured endpoint without appending duplicate path segments.
  - With `PHOENIX_API_KEY`, the preset emits bearer auth headers.
  - With a configured project name, the preset emits `x-project-name` and does not discard generic OTLP headers.
  - Unknown OTel backend behavior remains unchanged.
- **Verification:** `agentv eval ... --export-otel --otel-backend phoenix` can be documented as the primary observability path, with existing OTel export behavior unchanged for other backends.

### U3. Complete deterministic evaluator parity in the adapter

- **Goal:** Bring Phoenix adapter deterministic support up to AgentV's common deterministic assertion surface.
- **Requirements:** R2, R3, R9, R10, R15.
- **Dependencies:** U1.
- **Files:**
  - `packages/phoenix-adapter/src/evaluators/deterministic.ts`
  - `packages/phoenix-adapter/src/evaluators/registry.ts`
  - `packages/phoenix-adapter/src/evaluators/types.ts`
  - `packages/phoenix-adapter/test/evaluators/deterministic.test.ts`
  - `packages/phoenix-adapter/test/evaluators/registry.test.ts`
  - `packages/phoenix-adapter/docs/support-matrix.md`
- **Approach:** Add `contains-any`, `contains-all`, `icontains`, `icontains-any`, `icontains-all`, `starts-with`, and `ends-with`. Decide whether the adapter can call AgentV core deterministic graders directly; if not, mirror current semantics deliberately and add tests that compare expected outcomes against AgentV examples. Treat score-affecting fields (`weight`, `required`, `min_score`, `negate`) explicitly rather than silently ignoring them.
- **Execution note:** Add characterization tests for current supported deterministic types before expanding behavior so regressions are visible.
- **Patterns to follow:** Core deterministic factories in `packages/core/src/evaluation/registry/builtin-graders.ts`; current adapter shape in `packages/phoenix-adapter/src/evaluators/deterministic.ts`.
- **Test scenarios:**
  - `contains-any` passes when at least one configured string is present and fails when none are present.
  - `contains-all` passes only when every configured string is present.
  - `icontains` and `icontains-*` ignore case consistently.
  - `starts-with` and `ends-with` follow AgentV trimming behavior.
  - `negate` reverses pass/fail and score for deterministic assertions.
  - Missing or malformed assertion values produce fail/unsupported explanations that are visible in Phoenix metadata.
- **Verification:** The full dry-run unsupported report no longer lists extended deterministic string families as unsupported, and deterministic examples remain structurally green.

### U4. Make full dry-run structural parity actionable

- **Goal:** Resolve or explicitly exclude current full dry-run failures so the dry-run report can become a stronger regression signal.
- **Requirements:** R15.
- **Dependencies:** U1, U3.
- **Files:**
  - `packages/phoenix-adapter/src/parity/compare.ts`
  - `packages/phoenix-adapter/src/parity/report.ts`
  - `packages/phoenix-adapter/test/parity.test.ts`
  - `packages/phoenix-adapter/docs/e2e-verification.md`
  - `examples/features/matrix-evaluation/evals/dataset.eval.yaml`
  - `examples/features/prompt-template-sdk/evals/dataset.eval.yaml`
  - `examples/features/tool-trajectory-simple/evals/dataset.eval.yaml`
  - `examples/features/weighted-graders/evals/dataset.eval.yaml`
- **Approach:** Investigate the four known failures as source/baseline or loader-resolution issues, not Phoenix conversion crashes. Prefer fixing stale baselines or source references. If an eval intentionally diverges, encode a documented exclusion in adapter parity reporting rather than letting the full dry-run stay ambiguously red.
- **Patterns to follow:** Baseline parsing in `packages/phoenix-adapter/src/parity/baselines.ts`; e2e notes in `packages/phoenix-adapter/docs/e2e-verification.md`.
- **Test scenarios:**
  - Matrix evaluation dry-run reports the expected source/baseline relationship after drift is resolved or excluded.
  - Prompt-template SDK dry-run resolves prompt paths from the eval source context or documents a deliberate exclusion.
  - Tool-trajectory-simple baseline count matches normalized cases or is excluded with a clear reason.
  - Weighted-graders naming drift is resolved without accepting both `evaluator` and `grader` wire names as a new compatibility surface unless already shipped.
- **Verification:** Full dry-run exits successfully or reports only explicitly documented non-blocking exclusions.

### U5. Run real AgentV targets inside Phoenix experiments

- **Goal:** Replace synthetic adapter task outputs with actual AgentV target execution so Phoenix experiments represent real AgentV behavior.
- **Requirements:** R2, R3, R7, R8, R16.
- **Dependencies:** U1, U3, U4.
- **Files:**
  - `packages/phoenix-adapter/src/phoenix/run-experiment.ts`
  - `packages/phoenix-adapter/src/run/options.ts`
  - `packages/phoenix-adapter/src/run/run-suite.ts`
  - `packages/phoenix-adapter/src/agentv/load-spec.ts`
  - `packages/phoenix-adapter/src/phoenix/types.ts`
  - `packages/phoenix-adapter/test/phoenix-run-experiment.test.ts`
  - `packages/phoenix-adapter/test/agentv-execution.test.ts`
- **Approach:** Add an execution mode that invokes AgentV's programmatic evaluation/runtime for each Phoenix example. Preserve `agentv_test_id`, target, scores, assertions, duration, cost, token usage, and trace summary in Phoenix run/evaluation metadata. Keep dry-run/reference behavior separate and clearly named so it cannot be confused with live target parity.
- **Technical design:** Directional guidance only: Phoenix task receives a dataset example, resolves the AgentV test case by stable metadata, invokes AgentV execution, returns actual candidate output, and stores AgentV result metadata for the evaluator to log.
- **Patterns to follow:** Programmatic API in `packages/core/src/evaluation/evaluate.ts`; CLI orchestration in `apps/cli/src/commands/eval/run-eval.ts`; adapter payload metadata in `packages/phoenix-adapter/src/phoenix/datasets.ts`.
- **Test scenarios:**
  - Mock AgentV target returns a deterministic output and Phoenix task returns that output instead of synthesized assertion output.
  - AgentV scores/assertions are preserved in Phoenix evaluation metadata with snake_case boundary keys where serialized.
  - Missing target/configuration returns a clear run error and does not masquerade as an evaluator failure.
  - Dry-run mode remains network-free and does not invoke Phoenix or real targets.
- **Verification:** A live Phoenix smoke against a deterministic example creates Phoenix runs whose outputs match AgentV target outputs, not expected-output synthesis.

### U6. Support LLM graders and rubrics with AgentV-authoritative scoring

- **Goal:** Address the largest unsupported evaluator gap while preserving AgentV prompt/schema semantics.
- **Requirements:** R3, R6, R11, R16.
- **Dependencies:** U5.
- **Files:**
  - `packages/phoenix-adapter/src/evaluators/registry.ts`
  - `packages/phoenix-adapter/src/evaluators/types.ts`
  - `packages/phoenix-adapter/src/phoenix/run-experiment.ts`
  - `packages/phoenix-adapter/test/evaluators/llm-grader.test.ts`
  - `packages/phoenix-adapter/docs/support-matrix.md`
  - `packages/phoenix-adapter/docs/e2e-verification.md`
- **Approach:** First pass should run AgentV's `llm-grader` / `rubrics` path and log the resulting score, verdict, assertion details, and evidence into Phoenix evaluation metadata. Defer Phoenix-native model evaluator templates until exact semantic differences are understood and documented.
- **Patterns to follow:** AgentV LLM grader implementation in `packages/core/src/evaluation/graders/llm-grader.ts`; prompt assembly in `packages/core/src/evaluation/graders/llm-grader-prompt.ts`; Phoenix evaluator wrapper in `packages/phoenix-adapter/src/phoenix/run-experiment.ts`.
- **Test scenarios:**
  - Checklist rubric result preserves per-rubric assertions and evidence in Phoenix metadata.
  - Score-range rubric result preserves score, verdict, and details.
  - LLM grader provider failure is surfaced as an evaluation error with clear explanation.
  - Unsupported custom prompt modes remain visible if they cannot safely run in Phoenix adapter context.
- **Verification:** A small rubric eval can run through Phoenix with AgentV-equivalent grader scores and visible rubric evidence.

### U7. Add trace and metric grader support through Phoenix trace IDs

- **Goal:** Enable trace-derived AgentV graders once Phoenix experiment task spans can be associated with each example.
- **Requirements:** R3, R5, R12, R16.
- **Dependencies:** U2, U5.
- **Files:**
  - `packages/phoenix-adapter/src/phoenix/run-experiment.ts`
  - `packages/phoenix-adapter/src/phoenix/types.ts`
  - `packages/phoenix-adapter/src/evaluators/registry.ts`
  - `packages/phoenix-adapter/test/evaluators/trace-metrics.test.ts`
  - `packages/core/src/evaluation/trace.ts`
  - `apps/cli/src/commands/inspect/utils.ts`
- **Approach:** Evaluate trace-based graders after Phoenix spans are available. Use Phoenix evaluator context trace IDs to fetch spans, translate them into AgentV trace summary/metric inputs, then run or mirror AgentV trace-family graders. Start with one `tool-trajectory` happy path and one `execution-metrics` threshold before broadening.
- **Patterns to follow:** Trace summary logic in `packages/core/src/evaluation/trace.ts`; OTLP-derived trace parsing in `apps/cli/src/commands/inspect/utils.ts`; existing trace grader contracts in `packages/core/src/evaluation/graders/tool-trajectory.ts` and `packages/core/src/evaluation/graders/execution-metrics.ts`.
- **Test scenarios:**
  - A Phoenix trace with tool spans maps to expected tool-call counts and names.
  - A missing trace ID produces a clear unsupported/failed explanation rather than an empty pass.
  - Execution metrics can evaluate duration/token/cost fields only when the data is present.
  - Trace lookup latency or Phoenix API failure is surfaced as an evaluation error with retry/defer guidance.
- **Verification:** Trace-based adapter smoke demonstrates at least one `tool-trajectory` and one `execution-metrics` score generated from Phoenix-ingested span data.

### U8. Decide and implement package publishing posture

- **Goal:** Either intentionally keep the adapter private with clear repo-local usage, or make it publishable with complete release machinery.
- **Requirements:** R13, R14.
- **Dependencies:** U1, U3, U5; U6 if LLM/rubric support is part of the public promise.
- **Files:**
  - `packages/phoenix-adapter/package.json`
  - `package.json`
  - `scripts/release.ts`
  - `scripts/publish.ts`
  - `tsconfig.build.json`
  - `.github/workflows/validate.yml`
  - `packages/phoenix-adapter/README.md`
  - `packages/phoenix-adapter/test/publish-smoke.test.ts`
- **Approach:** Keep `@agentv/phoenix-adapter` private until the public contract is ready. If publishing is approved, remove `private`, add a package CLI/bin if needed, add `prepublishOnly`, include the package in release/publish scripts and build references, and add install smoke coverage.
- **Patterns to follow:** Release script package lists in `scripts/release.ts` and `scripts/publish.ts`; package metadata in `packages/core/package.json` and `packages/eval/package.json`.
- **Test scenarios:**
  - Private posture: release and publish scripts intentionally omit the adapter and README documents repo-local usage.
  - Publishable posture: release script updates adapter version with the other packages.
  - Publishable posture: publish script includes the adapter only after build and package metadata are complete.
  - Package install smoke imports the exported API and invokes the CLI help without relying on workspace-only paths.
- **Verification:** Maintainers can tell whether the adapter is private by policy or publishable by release machinery, with no half-published state.

---

## Phased Delivery

1. **Phase A: User-visible observability foundation** — U1 and U2. This gives users a supported Phoenix path through existing AgentV eval execution without overcommitting the adapter.
2. **Phase B: Adapter correctness foundation** — U3 and U4. This reduces semantic drift and makes dry-run parity useful as a guardrail.
3. **Phase C: Real experiment execution** — U5. This is the boundary where Phoenix experiments become trustworthy as AgentV eval runs.
4. **Phase D: High-value evaluator depth** — U6 and U7. Add LLM/rubric and trace/metric support after execution and trace identity are in place.
5. **Phase E: Release posture** — U8. Decide whether to publish only after the public promise is true.

---

## System-Wide Impact

- **CLI and docs:** Adding a Phoenix OTel preset changes the documented backend list and must not regress existing `langfuse`, `braintrust`, `confident`, custom OTLP, or `--otel-file` behavior.
- **Core observability:** Phoenix export should reuse existing OTel exporter architecture instead of adding Phoenix-specific SDK dependencies to normal eval execution.
- **Adapter package:** Moving from synthetic task outputs to real AgentV execution changes the adapter from a conversion smoke into an execution integration; tests and docs must make that boundary obvious.
- **Release process:** Publishing the adapter affects version synchronization, npm metadata, package install expectations, and CI validation.

---

## Risks & Dependencies

- **Phoenix API/version churn:** The adapter currently pins `@arizeai/phoenix-client` and `@arizeai/phoenix-evals`; trace/evaluator APIs may evolve. Mitigate by isolating Phoenix API calls under `packages/phoenix-adapter/src/phoenix/`.
- **Semantic drift from duplicated graders:** Adapter-local evaluator logic can diverge from AgentV core. Mitigate by wrapping core graders where feasible and adding parity tests when duplication remains.
- **False confidence from unsupported scoring:** Ignoring unsupported assertions in averages can make results look better than they are. Mitigate by making unsupported status explicit and conservative.
- **Live Phoenix test fragility:** CI may not have a Phoenix server. Mitigate with unit/contract tests in CI and optional live e2e documented separately.
- **Scope creep toward alternate runtime:** Workspace, matrix, Docker, trials, and custom plugin semantics are tempting to adapt natively. Keep those out unless a later issue proves they are required.

---

## Open Decisions

- **OD1. Public package timing:** Should `@agentv/phoenix-adapter` remain private until U5/U6 are complete, or be published earlier as experimental? Recommendation: keep private.
- **OD2. CLI surface:** Should users run a separate adapter CLI or an integrated `agentv phoenix` subcommand? Recommendation: begin with docs/root scripts while private; consider `agentv phoenix` only if the adapter becomes public.
- **OD3. LLM scorer authority:** Should Phoenix-native model evaluators ever be the primary score for AgentV-authored rubrics? Recommendation: AgentV-authoritative first, Phoenix-native only for documented optional comparisons.
- **OD4. Dataset idempotency:** Should repeated adapter runs append to stable datasets, upsert examples, or create timestamped datasets? Recommendation: stable dataset names with explicit experiment runs, plus documented cleanup behavior.

---

## Documentation and Operational Notes

- Add Phoenix setup to the docs site rather than only `packages/phoenix-adapter/README.md` so users can discover it alongside Langfuse and general OTel docs.
- Document privacy implications of `--otel-capture-content`; Phoenix traces may include prompts, outputs, and tool I/O when content capture is enabled.
- Keep `packages/phoenix-adapter/docs/e2e-verification.md` current whenever smoke or full dry-run expectations change.
- Do not run unrelated dashboard deployment setup while working on this integration plan or implementation. If dashboard deployment setup is ever needed for separate work, note that `scripts/setup-dashboard-deployment.sh` supports `--no-start`, not `--skip-install`.

---

## Sources & Research

- `packages/phoenix-adapter/**` — current adapter implementation, tests, support matrix, and e2e verification notes.
- `packages/core/src/observability/otel-exporter.ts` — existing OTel backend preset architecture and span export behavior.
- `apps/cli/src/commands/eval/run-eval.ts` and `apps/cli/src/commands/eval/commands/run.ts` — CLI OTel option parsing and exporter initialization.
- `scripts/release.ts` and `scripts/publish.ts` — current package versioning and npm publishing scope.
- `.github/workflows/validate.yml` — current Phoenix smoke in CI.
- `packages/core/src/evaluation/registry/builtin-graders.ts` and `packages/core/src/evaluation/graders/**` — AgentV evaluator semantics to preserve.
- Phoenix TypeScript experiments docs — `runExperiment`, `asExperimentEvaluator`, evaluator inputs, and `traceId` support.
- Phoenix evaluator docs — CODE and model-backed evaluator expectations.
- Phoenix OTel docs and endpoint FAQ — local endpoint, collector endpoint env vars, API key, shutdown lifecycle.
- Phoenix OTLP project routing release note — `x-project-name` header support.
