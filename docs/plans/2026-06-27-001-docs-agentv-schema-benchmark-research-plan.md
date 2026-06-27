---
title: "AgentV Schema Benchmark Research - Plan"
type: docs
date: 2026-06-27
topic: agentv-schema-benchmark-research
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
bead: av-2h9
---

# AgentV Schema Benchmark Research - Plan

## Goal Capsule

- **Objective:** Frame benchmark-informed requirements for AgentV eval schema
  authoring without implementing schema changes in this bead.
- **Product authority:** `STRATEGY.md`, `ROADMAP.md`,
  `.agents/product-boundary.md`, `CONCEPTS.md`,
  `docs/adr/0002-keep-harbor-benchmark-execution-behind-runner-boundary.md`,
  `docs/adr/0006-separate-experiments-from-eval-definitions.md`, and
  `docs/adr/0009-keep-benchmark-schema-on-existing-primitives.md`.
- **Decision summary:** Mature benchmark systems validate AgentV's existing
  primitives more than they justify new schema. Keep using `workspace`,
  `experiment`, target/workspace hooks, assertions, code graders,
  `tests[].metadata`, and run bundles. Do not add a top-level `source` field
  from this research. Do not rename `workspace.repos[].commit` to
  `base_commit`.

---

## Product Contract

### Summary

AgentV should make benchmark-shaped evals easier to author by documenting and
validating the existing lowest-common-denominator concepts: stable case ids,
multi-repo workspace setup, explicit runtime policy, expected/reference data,
hidden executable graders, repeat policy, result identity, and provenance in
metadata or sidecars.

The research did not find a mature external framework concept that AgentV needs
to absorb into core schema now. The main correction is product framing: AgentV's
multi-repo `workspace` is stronger than benchmark `source` vocabulary. A generic
`source` field would either duplicate operational repo setup or become metadata
with a special name.

### Key Decisions

- **No new core source field.** Do not add top-level `source` for this bead's
  findings. Use existing case metadata, source-owned sidecars, adapter
  manifests, and generated run artifacts for provenance.
- **Keep `workspace.repos[]` operational.** Repository acquisition, checkout
  refs, templates, hooks, and isolation stay under `workspace`, including
  multi-repo cases.
- **Keep `commit` canonical.** `workspace.repos[].commit` remains the
  self-evident checkout pin. `base_commit` is only an upstream SWE-bench import
  term or compatibility alias if an adapter needs it.
- **Keep inline `experiment:` canonical.** Runtime binding, targets, repeat
  policy, budgets, gates, and runner knobs stay in `experiment:`.
- **Keep external frameworks at boundaries.** Harbor, Margin, Braintrust,
  LangSmith, promptfoo, OpenAI Evals, Inspect, Hugging Face Datasets, and
  OpenInference inform adapters and docs, not AgentV-native object models.
- **Make composition explicit.** When a parent eval references child eval files,
  the parent should own/override child `experiment:`. It should not silently drop
  child `workspace`; retained, merged, remapped, or tests-only behavior must be
  explicit enough to prevent imported cases losing setup preconditions.

### Evidence Summary

Mature systems share the same conceptual spine, even when their concrete
formats differ:

| System | Useful observed concept | AgentV implication |
| --- | --- | --- |
| SWE-bench | Instances have `instance_id`, `repo`, `base_commit`, `problem_statement`, `patch`, `test_patch`, `FAIL_TO_PASS`, `PASS_TO_PASS`, and split-specific variants such as Verified difficulty. | Translate upstream ids and `base_commit` at import time; keep operational checkout refs in `workspace.repos[].commit` and hidden verifier data out of agent-visible input. |
| SWE-bench Verified | Human validation filters underspecified issues and unfair tests; annotations include difficulty and quality labels. | Preserve split, revision, and quality labels in metadata or manifests so results can be sliced without adding benchmark-specific fields. |
| Harbor | A task is instruction plus container environment plus test script; a dataset is a collection of tasks; a trial is an attempt; a job is a collection of trials. | Keep Harbor as a runner/import boundary and result source; do not copy Harbor task packaging into AgentV schema. |
| Harbor task format | `task.toml`, `instruction.md`, `environment/`, `solution/`, and `tests/` separate task metadata, environment, oracle solution, and verifier. | AgentV can model the same separation with workspaces, hooks, fixtures, expected output, and code graders. |
| Margin Lab evals | Suite directories use `suite.toml`, `case.toml`, `prompt.md`, `tests/test.sh`, optional `env/Dockerfile`, optional `oracle/solve.sh`, remote suite pins, resume semantics, and immutable run bundles. | Margin is the likely intended "Margin evals" reference; borrow hidden verifier/oracle separation and run-bundle discipline, not its config dialect. |
| Vercel `agent-eval` | Fixture directories combine `PROMPT.md`, hidden `EVAL.ts`, project files, experiment configs with `runs`, `earlyExit`, scripts, sandbox selection, and per-run transcript artifacts. | AgentV already has equivalent roles through workspace fixtures, code graders, `experiment.repeat`, gates, and run artifacts. |
| OpenAI Evals | Eval construction is dataset JSONL plus eval class/template registration; names encode eval, split, and version. | Importers should preserve dataset/split/version identity without adding a registry model. |
| Inspect | A `Task` combines dataset, solver, scorer, tools/agents, and optional sandboxing; Inspect Evals register entries include source repository URL and pinned commit metadata. | AgentV maps task/runtime/scorer concepts cleanly; source repo pins belong in `workspace.repos[]` only when AgentV materializes them. |
| Braintrust | Evaluations are data, task, and scores; experiments are immutable comparable records. | AgentV run bundles remain the immutable comparable record; no hosted backend required. |
| promptfoo | YAML combines prompts, providers, tests, assertions, imported test files, `defaultTest`, and matrix expansion. | Borrow import/default clarity, but keep repo-native target comparison in `experiment:` instead of prompt/provider matrices. |
| LangSmith | Offline evals use datasets/examples/reference outputs; experiments capture outputs, scores, and traces; online evals target runs/threads without references. | Keep expected/reference data distinct from run/trace evaluation and keep production monitoring out of core. |
| Hugging Face Datasets | Features, splits, dataset cards, typed columns, and dataset cards make corpus shape and provenance explicit. | Preserve corpus identity and columns in metadata/manifests when importing, without depending on Arrow or the Hub. |
| OpenInference | Span kinds and attributes standardize LLM, agent, tool, evaluator, token, and cost trace semantics. | Align trace metadata names where useful, but keep OpenInference as an observability/export boundary. |
| AgentV workspaces | AgentV can materialize multiple repositories into one eval workspace through `workspace.repos[]`. | Treat this as a differentiator to preserve; no surveyed benchmark framework provides a better core workspace model. |

Research ambiguity:

- "Harbor/Harbour" appears to refer to Harbor Framework; searches did not find
  a separate primary "Harbour" eval framework using the British spelling.
- "Margin evals" most plausibly refers to Margin Lab's `Margin-Lab/evals` and
  Marginlab public tracker work. No separate primary "Margin evals" standard
  was identified.
- DeepWiki was used as secondary repo-orientation support for
  `vercel-labs/agent-eval`, `openai/evals`, and
  `UKGovernmentBEIS/inspect_evals`; primary claims were checked against official
  docs, cloned repositories, or dataset cards.

## Requirements

### Existing Primitives

- R1. AgentV should continue to represent operational repository setup through
  `workspace.repos[]`, not through a generic source selector.
- R2. `workspace.repos[].commit` should remain canonical. `base_commit` should
  be treated as upstream/import vocabulary, not a canonical AgentV rename.
- R3. Runtime policy should stay in inline `experiment:`: targets, workers,
  budgets, repeat policy, gates, sandbox/runner knobs, and early-exit behavior.
- R4. Target and workspace hooks should remain the extension point for
  harness-specific setup that external frameworks encode in their own runner
  configs.
- R5. `expected_output`, assertions, and code graders should remain distinct:
  passive reference data, executable scoring, and hidden verification should
  not be collapsed.

### Provenance

- R6. Imported benchmark source identity should be represented with existing
  `tests[].metadata`, source-owned sidecars, adapter manifests, and generated
  run artifacts.
- R7. AgentV docs should recommend stable metadata keys for common imported
  facts such as source benchmark id, split, revision, upstream row id, repo URL,
  and curation labels, without making those keys new core schema.
- R8. Suite-level provenance should not require a new top-level field in this
  research. If a future bead adds suite-level metadata, it should do so as a
  general metadata capability, not as a benchmark-specific `source` block.
- R9. Hidden benchmark data such as SWE-bench `test_patch`, `FAIL_TO_PASS`, and
  oracle files should stay in metadata, sidecars, fixtures, or code graders and
  should not become agent-visible input by default.
- R10. Run artifacts should preserve enough compact provenance for audit,
  comparison, filtering, and rerun without bloating every result row.

### Composition and Imports

- R11. Parent evals that reference child evals should own the runtime
  `experiment:` for the parent run.
- R12. Child `experiment:` blocks should be ignored or overridden by parent
  composition unless an explicit nested-run feature is accepted later.
- R13. Child `workspace` setup should not be silently discarded. Full-suite
  imports should retain, merge, or explicitly remap workspace requirements.
- R14. A tests-only import mode may drop child workspace context, but it must be
  explicit because it changes case validity.
- R15. Workspace merge conflicts, path collisions, and incompatible isolation
  settings should fail loudly rather than producing ambiguous setup.

### Adapter Boundaries

- R16. Harbor-backed execution should remain a runner/import boundary as
  described in ADR 0002, with Harbor-owned task packaging and verifier details
  outside AgentV core.
- R17. Margin, promptfoo, Braintrust, LangSmith, OpenAI Evals, Inspect, and
  Hugging Face mappings should start as import/export adapters, examples, or
  docs recipes.
- R18. Adapter output should prefer ordinary AgentV YAML plus sidecars over
  pass-through maps, so humans and AI agents can inspect the generated evals.
- R19. Phoenix, OpenInference, Opik, Braintrust, and LangSmith links should stay
  correlation/export metadata; AgentV run bundles remain the source of truth.

## Recommended Schema Directions

1. **Make no schema change from this research.** The benchmark comparison
   supports AgentV's current primitives more than it supports new fields.
2. **Do not add top-level `source`.** It is redundant with either
   `workspace.repos[]` or existing metadata/manifest patterns.
3. **Do not rename `commit`.** Keep `workspace.repos[].commit`; translate
   SWE-bench `base_commit` at adapter boundaries when needed.
4. **Document composition semantics before implementing imports.** Parent evals
   should own runtime `experiment:`; child workspaces should be retained,
   explicitly remapped, or explicitly dropped through tests-only import.
5. **Canonicalize docs toward `experiment:`.** Existing examples that still
   teach `execution:` should be audited in a follow-up docs bead if that surface
   is still transitional.
6. **Write benchmark recipes using current primitives.** SWE-style native cases,
   Harbor-backed runs, Margin-style hidden verifiers, promptfoo-style test
   imports, and Braintrust/LangSmith data rows can all be described without new
   core schema.

## Explicit Non-Goals

- Do not implement schema changes in this bead.
- Do not add a top-level `source` field from this research.
- Do not rename `workspace.repos[].commit` to `base_commit`.
- Do not copy SWE-bench `patch`, `test_patch`, `FAIL_TO_PASS`, or
  `PASS_TO_PASS` into AgentV top-level schema.
- Do not make Harbor `task.toml`, Docker network policy, verifier environment,
  registry, or reward-file format AgentV-native schema.
- Do not make Margin Lab suite, agent-config, or eval-config files an AgentV
  config dialect.
- Do not rebuild Braintrust, LangSmith, promptfoo, OpenAI Evals, Inspect, or
  Hugging Face dataset registries inside AgentV.
- Do not make Phoenix, OpenInference, hosted traces, or hosted experiments the
  AgentV artifact source of truth.

## Compatibility and Migration Risks

- `execution:` appears in existing examples while ADR 0006 says `experiment:`
  is canonical. A follow-up docs/schema audit should decide whether this is
  legacy compatibility or next-tag cleanup.
- `repeat` and `runs` both appear in some external or local vocabulary. AgentV
  should keep `repeat` canonical unless a compatibility story requires aliases.
- Dropping child workspaces during eval composition can create false failures or
  false passes. Composition needs explicit modes and loud collision handling.
- Translating imported `base_commit` into `workspace.repos[].commit` may surprise
  SWE-bench users unless docs show the mapping directly.
- Provenance in free-form metadata can drift across adapters. Docs should
  recommend a small set of conventional keys even if core schema remains small.

## Open Questions

- OQ1. Which docs/examples should be hard-corrected from `execution:` to
  `experiment:` before the next tag?
- OQ2. Should AgentV eventually support a formal suite-level `metadata` field,
  and if so, should it be general-purpose rather than benchmark-specific?
- OQ3. What exact composition syntax should distinguish full-suite include from
  tests-only import?
- OQ4. When multiple child evals provide `workspace.repos[]`, should path
  collisions fail unconditionally, or should an explicit parent remap be
  allowed?
- OQ5. Which public recipe should come first: native SWE-style task,
  Harbor-backed standard suite, Margin-style hidden verifier, or promptfoo-style
  test import?

## Suggested Follow-Up Beads

- `docs(schema): canonicalize eval runtime docs and examples` - Audit
  `execution:` versus `experiment:`, `runs` versus `repeat`, and AI-facing
  eval-builder references.
- `design(schema): eval composition semantics` - Define full-suite include,
  tests-only import, workspace merge/remap, collision errors, and parent
  `experiment:` override behavior.
- `docs(evals): benchmark authoring recipes` - Add human and AI docs for
  SWE-bench-style, Harbor-backed, Margin-style, promptfoo-style, and
  Braintrust/LangSmith-style mappings using existing AgentV primitives.
- `adapter(research): import provenance smoke fixtures` - Convert a tiny
  SWE-bench Verified row and a promptfoo config into ordinary AgentV YAML to
  validate docs before implementation.

## Sources / Research

- AgentV strategy and roadmap: `STRATEGY.md`, `ROADMAP.md`.
- AgentV product boundary and conventions: `.agents/product-boundary.md`,
  `.agents/conventions.md`.
- AgentV vocabulary: `CONCEPTS.md`.
- Harbor runner boundary:
  `docs/adr/0002-keep-harbor-benchmark-execution-behind-runner-boundary.md`.
- Inline experiment decision:
  `docs/adr/0006-separate-experiments-from-eval-definitions.md`.
- Benchmark schema decision:
  `docs/adr/0009-keep-benchmark-schema-on-existing-primitives.md`.
- Current AgentV eval schema:
  `packages/core/src/evaluation/validation/eval-file.schema.ts`,
  `packages/core/src/evaluation/experiment.ts`,
  `packages/core/src/evaluation/result-row-schema.ts`,
  `packages/core/src/evaluation/run-artifacts.ts`.
- AI research wiki synthesis: `concepts/benchmark-provenance-workspace-patterns.md`,
  `concepts/minimal-eval-definition-schema.md`, `entities/swe-bench.md`,
  `entities/margin-evals.md`, `entities/vercel-agent-eval.md` in
  `tsoyang-org/ai-research-wiki`.
- SWE-bench dataset guide:
  https://www.swebench.com/SWE-bench/guides/datasets/
- SWE-bench Verified announcement:
  https://openai.com/index/introducing-swe-bench-verified/
- SWE-bench Verified dataset card:
  https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified
- Harbor core concepts: https://www.harborframework.com/docs/core-concepts
- Harbor task structure: https://www.harborframework.com/docs/tasks
- Harbor adapters guide:
  https://www.harborframework.com/docs/datasets/adapters
- Margin Lab evals repository: https://github.com/Margin-Lab/evals
- Vercel `agent-eval`: https://github.com/vercel-labs/agent-eval
- Vercel `agent-eval` source checks:
  `packages/agent-eval/src/lib/types.ts` and
  `packages/agent-eval/src/lib/results.ts` in
  https://github.com/vercel-labs/agent-eval
- OpenAI Evals build guide:
  https://github.com/openai/evals/blob/main/docs/build-eval.md
- Inspect AI docs: https://inspect.aisi.org.uk/
- Inspect Evals registry: https://ukgovernmentbeis.github.io/inspect_evals/
- Inspect Evals register schema example:
  https://github.com/UKGovernmentBEIS/inspect_evals/blob/main/register/example_eval.yaml
- Braintrust evaluation docs: https://www.braintrust.dev/docs/evaluate
- Braintrust evaluation quickstart:
  https://www.braintrust.dev/docs/evaluation-quickstart
- promptfoo configuration docs:
  https://www.promptfoo.dev/docs/configuration/guide/
- promptfoo test case docs:
  https://www.promptfoo.dev/docs/configuration/test-cases/
- LangSmith evaluation docs: https://docs.langchain.com/langsmith/evaluation
- LangSmith evaluation concepts:
  https://docs.langchain.com/langsmith/evaluation-concepts
- Hugging Face dataset features:
  https://huggingface.co/docs/datasets/en/about_dataset_features
- Hugging Face dataset cards: https://huggingface.co/docs/hub/en/datasets-cards
- OpenInference specification: https://arize-ai.github.io/openinference/spec/
- OpenInference semantic conventions:
  https://arize-ai.github.io/openinference/spec/semantic_conventions.html
