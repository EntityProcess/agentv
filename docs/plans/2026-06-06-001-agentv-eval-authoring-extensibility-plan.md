# AgentV Eval Authoring Extensibility Plan

Date: 2026-06-06

## Goal

Reduce eval-authoring ceremony without turning AgentV's core YAML schema into a benchmark-specific kitchen sink, and run private competitor/DX analysis against peer TypeScript eval frameworks using concrete converted evals.

The clean path is:

1. Keep AgentV runtime primitives small.
2. Add only one likely schema primitive where AgentV currently loses source meaning: rubric criterion operators.
3. Use private conversion artifacts to prove the DX and feature-parity gaps before adding public examples.
4. Make reusable authoring templates and plugin examples generate ordinary AgentV YAML, scripts, assertions, providers, and docs.
5. Treat benchmark/package-specific fields as documented patterns or import/export adapters, not core schema.

## Context

Prior research on `av-r0s` found that AgentV already has the right low-level composition points for benchmark-style evals:

- Arbitrary per-test `metadata` is accepted in `packages/core/src/evaluation/validation/eval-file.schema.ts`.
- Lifecycle hooks receive `case_metadata` in `packages/core/src/evaluation/workspace/script-executor.ts`.
- Custom assertions are discovered from `.agentv/assertions/` in `packages/core/src/evaluation/registry/assertion-discovery.ts`.
- Custom graders are discovered from `.agentv/graders/` in `packages/core/src/evaluation/registry/grader-discovery.ts`.
- `agentv create` already scaffolds evals, assertions, and providers in `apps/cli/src/commands/create/commands.ts`.
- The lightweight SDK contract lives in `packages/eval/src/assertion.ts`.

The main ceremony problem is not that the schema cannot represent tasks. It is that users must repeatedly hand-write the same layout, provenance metadata, adapter scripts, and integration glue.

The user clarified that Phoenix, promptfoo, and Braintrust examples should not start as public AgentV examples. They are competitor-analysis and DX/feature-parity artifacts. They should live in a private EntityProcess repo named `wtg-ai-prompts-experiment`, with Beads tracking the research/conversion work from AgentV's coordination checkout.

`WTG.AI.Prompts` remains a read-only reference source. Do not push framework-parity artifacts there. It is still useful context because:

- It already depends on AgentV in `package.json`.
- Its `README.md` documents AgentV as the normal evaluation workflow.
- Its `CONTRIBUTING.md` places eval files under `evals/{plugin}/`.
- Its repo purpose is reusable agent plugins plus evaluation tests, which matches private DX/parity analysis better than public AgentV examples.

## External Patterns

Use these as design references, not as feature mandates:

- Margin and Terminal-Bench: filesystem-native benchmark packaging, conventional task files, setup scripts, scoring scripts, and immutable artifacts. AgentV should document and template this shape instead of adding `workspace`, `oracle`, `variants`, or `expected_artifacts` as broad core fields.
- Pi coding agent: skills and extensions separate agent-facing procedural guidance from runtime code. Its docs show skills as portable `SKILL.md` directories with scripts/assets, and extensions as typed runtime hooks. AgentV should copy the progressive-disclosure authoring pattern for eval builders.
- Composio Agent Orchestrator: swappable TypeScript plugin interfaces for narrow responsibilities. Its plugin-slot model is useful as a boundary pattern, but AgentV should avoid a general orchestrator plugin host until concrete runtime extension gaps appear.
- Phoenix: official TypeScript packages (`@arizeai/phoenix-client`, `@arizeai/phoenix-evals`, `@arizeai/phoenix-otel`) make it a good private export/conversion target for result and trace integration.
- promptfoo: Node package and JavaScript assertion/provider hooks make it a good private conversion target, especially for YAML matrix configs and JS assertion migration.
- Braintrust: TypeScript SDK and `Eval(data, task, scores)` model make it a good private conversion target for dataset/task/score loops, experiment metadata, trial counts, and hosted result upload.

Primary references checked:

- https://github.com/Margin-Lab/evals
- https://github.com/harbor-framework/terminal-bench
- https://pi.dev/docs/latest/skills
- https://pi.dev/docs/latest/extensions
- https://composiohq-agent-orchestrator.mintlify.app/concepts/architecture
- https://github.com/ComposioHQ/agent-orchestrator
- https://arize-ai.github.io/phoenix/index.html
- https://www.promptfoo.dev/docs/usage/node-package/
- https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/
- https://www.braintrust.dev/docs/reference/sdks/typescript/2.2.0/typescript
- `/home/entity/projects/tsoyang-org-wiki/ai-research-wiki/concepts/agentv-eval-authoring-extensibility.md`

## Recommendation

### 1. Run private source-backed conversion studies before public templates

Clone or reuse local checkouts for peer frameworks and inspect current source, not only docs:

- `promptfoo/promptfoo`
- `braintrustdata/braintrust-sdk`
- `Arize-ai/phoenix`
- `WiseTechGlobal/WTG.AI.Prompts`

For each peer, convert one or two existing AgentV eval examples into that framework's native shape or a wrapper/export script. These conversions should live in a private repo first because they are competitor-analysis artifacts and may include DX/friction notes that should not be published as AgentV marketing examples.

The output should answer:

- Which AgentV primitives map cleanly?
- Which mappings require ceremony?
- Which peer framework features should AgentV copy, document, or ignore?
- Which AgentV features are hard for peers to represent?
- Which gaps justify schema/core changes versus templates/import-export helpers?

Source-backed findings from the initial code analysis:

- promptfoo config loading is YAML/JSON first and normalizes `targets` to `providers`; its Node API exposes `evaluate(testSuite, options)`. Its JS/Python assertion hooks can approximate AgentV simple rubrics and code checks, but they do not receive AgentV's full code-grader payload with workspace, file changes, trace summary, cost, duration, and structured criteria by default.
- promptfoo can mirror simple AgentV rubric examples with `llm-rubric` and script assertions. AgentV `tool-trajectory` is the largest parity gap because promptfoo trace/trajectory assertions depend on promptfoo trace conventions rather than AgentV `Message[].toolCalls`; a custom provider/metadata adapter is required.
- Braintrust TypeScript `Eval(name, { data, task, scores })` maps cleanly to AgentV's case/task/score model. The lossy point is that AgentV rich assertion arrays with evidence/verdict/type become Braintrust score metadata unless a deeper adapter is built.
- Phoenix TypeScript is split across dataset creation, experiment running, evaluators, and OTel. It is strong for persisted datasets/experiments and traces, but less direct for local YAML wrapping because normal `runExperiment` flow expects a Phoenix dataset/server round trip.
- AgentV already has a Phoenix adapter package, but its support matrix is intentionally narrow and deterministic. Private experiments should use that as evidence, not widen public scope prematurely.

### 2. Add a small authoring-template layer, not a runtime plugin platform

Extend the existing `agentv create` scaffolding into reusable templates:

- `agentv create eval --template swe-task`
- `agentv create eval --template terminal-task`
- `agentv create eval --template promptfoo-adapter`
- `agentv create eval --template braintrust-export`
- `agentv create eval --template phoenix-export`

The first implementation can stay static and local, similar to the current `EVAL_TEMPLATES` object in `apps/cli/src/commands/create/commands.ts`. Do not introduce remote template registries, package installation, trust prompts, or plugin loading yet.

Acceptance shape:

- Templates generate normal `.eval.yaml`, `.cases.jsonl`, `.agentv/assertions/*.ts`, `.agentv/graders/*.ts`, and README snippets.
- Generated YAML remains valid under the current schema.
- The generated files teach provenance and workspace conventions by example.
- Users can delete or modify the generated files without depending on hidden runtime behavior.

Only promote private findings into public AgentV examples after the private conversion artifacts prove the examples are useful and non-sensitive.

### 3. Add one schema primitive: rubric criterion operator

`financial-research-agent/scripts/generate-eval-from-dexter.ts` currently parses Dexter rubric operators and then rewrites them into prose because AgentV rubric items have no operator field. This is real data loss.

Add optional `operator` to rubric criteria only after a focused design bead:

- Internal TypeScript: `operator?: 'must' | 'should' | 'may' | 'must_not' | 'should_not'`
- YAML wire format: `operator: must_not`
- Backward compatible: omitted operator preserves existing behavior.
- Initial graders may use it only as structured context, not as a new scoring mode.

Do not add broad `benchmark_source`, `provenance`, `oracle`, `variants`, or `expected_artifacts` fields in the same work.

### 4. Document benchmark provenance as a pattern

Add docs that show how to model external benchmark metadata without schema expansion:

- Put frozen source/provenance in `metadata`.
- Put heavy setup in lifecycle hooks.
- Put expected artifacts in workspace files and verify them through code graders or file-change assertions.
- Put source task packs next to generated AgentV YAML when an eval repo needs auditability.

Likely docs locations:

- `apps/web/src/content/docs/docs/evaluation/eval-files.mdx`
- `apps/web/src/content/docs/docs/evaluation/eval-cases.mdx`
- `apps/web/src/content/docs/docs/graders/custom-assertions.mdx`
- `apps/web/src/content/docs/docs/graders/custom-graders.mdx`

### 5. Add TypeScript SDK integration examples as private examples first

Add private examples, not core adapters, for:

- Phoenix: export AgentV results/traces into Phoenix using the TS packages.
- promptfoo: convert promptfoo-style YAML or JS assertions into ordinary AgentV evals/assertions where feasible.
- Braintrust: export AgentV cases/results into Braintrust's TypeScript `Eval(data, task, scores)` shape.

These should initially live in `WTG.AI.Prompts` or another explicitly private repo. Only promote to AgentV `examples/features/`, docs, or CLI import/export commands after at least one private example proves useful and the competitive analysis is scrubbed.

## Proposed Work Breakdown

### Bead A: research(private): analyze peer TypeScript eval frameworks against AgentV examples

Scope:

- Source-level analysis of promptfoo, Braintrust, and Phoenix TypeScript SDK/code paths.
- Select one or two representative AgentV evals for conversion.
- Record concrete file references, conversion sketches, DX friction, and parity gaps.

Why first:

- It prevents premature public templates.
- It makes Beads prove the right issue with concrete artifacts.

### Bead B: repo(private): create EntityProcess/wtg-ai-prompts-experiment

Scope:

- Create a private GitHub repo under `EntityProcess` named `wtg-ai-prompts-experiment`.
- Add a minimal README that marks the repo private/internal and says `WTG.AI.Prompts` is read-only reference input.
- Add an initial directory skeleton for framework-parity experiments.

### Bead C: examples(private): mirror AgentV evals across peer frameworks

Scope:

- Add private promptfoo, Braintrust, and Phoenix versions of selected AgentV evals in `EntityProcess/wtg-ai-prompts-experiment`.
- Keep artifact names and README notes clear that this is private DX/feature-parity analysis.
- Include verification commands that can run without publishing results.
- Do not push or write to `WTG.AI.Prompts`.

Target repo:

- `EntityProcess/wtg-ai-prompts-experiment`
- GitHub: https://github.com/EntityProcess/wtg-ai-prompts-experiment

Target layout, adapted from WTG.AI.Prompts read-only analysis:

```text
framework-parity/
  README.md
  agentv-source/
    grader-conformance.eval.yaml
    trace-evaluation.eval.yaml
  promptfoo/
    promptfooconfig.yaml
    assertions/
      grader-conformance.js
      trace-evaluation.js
  braintrust/
    grader-conformance.eval.ts
    trace-evaluation.eval.ts
  phoenix/
    trace-evaluation.dataset.ts
    trace-evaluation.experiment.ts
  fixtures/
    grader-conformance.fixtures.yaml
    traces/
      trace-summary-cases.jsonl
  scripts/
    run-promptfoo.mjs
    run-braintrust.ts
    run-phoenix.ts
```

This subtree should be clearly marked private/internal and should not be mirrored into public AgentV examples until findings are scrubbed.

Initial AgentV evals to mirror:

- `examples/showcase/grader-conformance/` for promptfoo and Braintrust because it is fixture-driven and scorer-centric.
- `examples/features/trace-evaluation/` for Phoenix because it exercises trace/span evaluation concepts.
- `examples/features/tool-trajectory-simple/evals/dataset.eval.yaml` is a secondary candidate if the goal shifts toward tool-use parity.

Placement constraints:

- `WTG.AI.Prompts` requires evals under `evals/{plugin}/`, but this experiment repo is separate and should use a simpler `framework-parity/` root unless it deliberately mirrors WTG's layout later.
- Do not add marketplace entries; marketplace registration is for real plugins, not private analysis artifacts.
- Runtime outputs should stay under ignored `.agentv/results/framework-parity/...` or repo-local ignored `results/`.
- Keep WTG snippets synthetic unless a specific private-code eval is needed.

### Bead D: docs(evals): document reusable benchmark authoring patterns

Scope:

- Add a docs page or section for SWE/Terminal-Bench-style evals.
- Show `metadata` provenance, lifecycle hooks, workspace setup, code graders, and artifact checks.
- Include a short "fields not in core schema" table explaining when to use metadata/scripts instead.

Why first:

- It addresses most av-r0s findings with zero runtime surface.
- It gives eval repo authors an immediate path.

### Bead E: feat(cli): add static eval authoring templates

Scope:

- Extend `agentv create eval --template ...` with static templates.
- Start with `swe-task`, `terminal-task`, and `sdk-adapter`.
- Keep templates inside the CLI package; no plugin host or registry.

Files likely touched:

- `apps/cli/src/commands/create/commands.ts`
- `apps/cli/src/templates/`
- CLI tests for create output, if existing coverage pattern supports it.

### Bead F: docs(examples): promote sanitized TypeScript SDK examples only after private proof

Scope:

- Add public docs/examples only after private artifacts are scrubbed.
- Make each example explicit about what is a one-way export, import helper, or assertion migration.
- Exclude competitor DX critique from public AgentV examples.

Files likely touched:

- `examples/features/sdk-*` or new sibling example directories.
- `apps/web/src/content/docs/docs/integrations/` if an integrations section exists or is added.

### Bead G: feat(schema): preserve rubric criterion operators

Scope:

- Add optional rubric criterion `operator`.
- Preserve snake_case wire convention.
- Update parser/schema/types, docs, examples, and focused tests.
- Regenerate finance eval from Dexter without lossy prose rewriting.

Files likely touched:

- `packages/core/src/evaluation/validation/eval-file.schema.ts`
- `packages/core/src/evaluation/loaders/grader-parser.ts`
- `packages/core/src/evaluation/types.ts`
- `apps/web/src/content/docs/docs/evaluation/eval-files.mdx`
- `plugins/agentv-dev/skills/agentv-eval-builder/` if schema guidance changes.

### Bead H: cleanup(eval-repos): make generated benchmark packs auditable

Scope:

- Split frozen source packs from executable AgentV YAML in `swe-evals`.
- Preserve Dexter source operator/provenance in `financial-research-agent`.
- Add regeneration/readme notes and drift checks where useful.

This is eval-repo cleanup, not AgentV core work.

## Non-Goals

- Do not add a general runtime plugin manager.
- Do not add remote template installation.
- Do not add benchmark-specific core fields for every peer framework concept.
- Do not make AgentV a Phoenix/Braintrust competitor.
- Do not clone promptfoo's general LLM matrix/red-team feature surface into core.
- Do not publish competitor-analysis notes or WTG-specific artifacts in AgentV public examples.
- Do not push to `WTG.AI.Prompts`; use it only as read-only reference unless the user explicitly changes that.
- Do not create Beads before this plan is reviewed.

## Validation Plan

For docs-only work:

- Run docs link/check commands if the repo has a targeted docs verification script.
- Run `bun run validate:examples` if examples are changed.

For CLI template work:

- Add or update focused CLI tests for generated file names and valid YAML.
- Run `bun apps/cli/src/cli.ts create eval demo --template <name>` in a temp directory.
- Run `bun apps/cli/src/cli.ts validate <generated>.eval.yaml`.

For schema operator work:

- Add schema parser tests for omitted and present `operator`.
- Run a real eval or dry-run through an example that includes rubric operators.
- Confirm JSON/JSONL outputs remain snake_case at process boundaries.

For private conversion work:

- Run each converted eval through the peer framework where local dependencies and credentials allow.
- If a live run is not possible, run parser/typecheck/validation commands and document the blocker.
- Capture command output in the private repo, not in public AgentV docs.
- Verify that no WTG-specific or competitor-analysis files are added to the public AgentV repo.

## Open Questions

- Which AgentV evals should be mirrored first: one simple text/rubric eval plus one workspace/tool-trajectory eval, or only WTG-relevant prompt evals?
- Should promptfoo import/export be a CLI command later, or stay as documented conversion scripts until demand is proven?
- Should Phoenix/Braintrust integrations be examples only, or wrappers that consume AgentV JSONL output?

## Decision

Proceed as a plan, not a brainstorm, because the product question is now concrete: use private converted evals to measure peer-framework DX and feature parity, then feed only validated findings into AgentV templates/docs/schema Beads. A separate brainstorm would be useful only if the goal expands into AgentV's broader product positioning against Phoenix, promptfoo, Braintrust, and observability platforms.

## Created Beads

- `av-r0s.5` - EPIC: private framework parity experiments for AgentV eval DX
- `av-r0s.5.4` - examples(private): mirror AgentV evals in wtg-ai-prompts-experiment
- `av-r0s.5.1` - tooling(private): prototype promptfoo exporter for simple AgentV evals
- `av-r0s.5.2` - tooling(private): prototype Braintrust and Phoenix replay adapters
- `av-r0s.5.3` - docs(agentv): decide sanitized promotion path from private parity experiments
