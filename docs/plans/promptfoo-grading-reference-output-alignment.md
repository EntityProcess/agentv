# Promptfoo Grading Reference Output Alignment Plan

Status: draft review summary. Beads are the source of truth for scope, owner locks, acceptance, and closure. This document is a human-reviewable sequencing aid for `av-kfik.28` and must not replace the child Bead descriptions or acceptance criteria.

## Summary

AgentV should align authored reference answers and grading artifacts with Promptfoo-compatible authoring while keeping AgentV run bundles as the artifact source of truth.

Finalized contract:

- Authored reference answers live in `vars.expected_output`.
- `vars.expected_output` is passive reference data and does not imply grading.
- Explicit `assert` entries own pass/fail.
- The Promptfoo-compatible low-friction pattern is a suite-level `default_test` / `defaultTest` `assert` entry with `type: llm-rubric` and `value` containing `{{ expected_output }}`.
- `llm-rubric` should parse Promptfoo-style judge output `{reason, pass, score}`.
- Public grading artifacts use aggregate `{pass, score, reason, graders[]}`.
- Each grader uses `{name, type, pass, score, reason, checks?}`.
- Checks use `{id?, text, pass, score?, reason, evidence?}`.
- Do not emit top-level `checks`, public `assertion_results`, a public `passed` alias, or a dynamic one-grader shortcut.

Wire formats remain `snake_case`; internal TypeScript remains `camelCase` with boundary translation.

Promptfoo evidence checked locally at clone commit `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`: `TestCaseSchema` includes `vars`, `providerOutput`, `assert`, `options`, `threshold`, and `metadata`, with no first-class `expectedOutput`; the default grading prompt asks judges for `{reason, pass, score}`; `defaultTest` merges `vars` and `assert` into tests.

## Bead Map

| Bead | Scope | Dependencies | Acceptance gates | Planned PR sequencing |
| --- | --- | --- | --- | --- |
| `av-kfik.28` | Parent epic for Promptfoo-compatible reference answers and public grading result contract. | Parent under `av-kfik`; coordinates `av-kfik.28.1` through `av-kfik.28.7`. | This plan PR records branch/PR/commit only; do not close the epic or child Beads from this PR. | Draft plan PR first. Implementation PRs follow child Bead order and keep Beads canonical. |
| `av-kfik.28.1` | Specify the final public grading result contract. | None inside this sub-epic. | Contract says aggregate `pass`, `score`, `reason`, always-present `graders[]`, nested `checks[]`, and no public legacy aliases. | First implementation/spec PR; blocks all artifact, SDK, parser, and dashboard work. |
| `av-kfik.28.2` | Migrate authored `expected_output` to `vars.expected_output` and reject normal authored top-level/test `expected_output`. | `av-kfik.28.1`; must avoid colliding with `av-kfik.27` input hard-deprecation and `av-kfik.15` broad codemod. | Parser/codemod/errors prove `vars.expected_output` is passive and explicit `assert` owns grading; examples use `default_test`/`defaultTest` `llm-rubric` with `{{ expected_output }}` where semantic grading is intended. | Stack after `av-kfik.15`, or proceed only on isolated expected-output parser/codemod paths that do not rewrite input fixtures/docs/examples already owned by `av-kfik.15`/`av-kfik.16`. |
| `av-kfik.28.3` | Parse Promptfoo-compatible `llm-rubric` judge output and normalize it into the new contract. | `av-kfik.28.1`. | Tests cover `{reason, pass, score}`, coercion/failure cases, optional `checks[]`, rubric arrays, and no public legacy fields. | Can proceed after `av-kfik.28.1` in non-overlapping grader/parser areas, using prompt/vars fixtures that do not touch input hard-deprecation migration. |
| `av-kfik.28.4` | Update SDK and script grader result APIs for `pass`/`reason`/`checks`. | `av-kfik.28.1`. | SDK schemas/helpers, script grader docs/examples, and tests use aggregate plus checks; internal APIs keep camelCase and translate at boundaries. | Can proceed after `av-kfik.28.1`; coordinate with `av-kfik.28.6` before artifact fixtures are regenerated. |
| `av-kfik.28.6` | Rewrite run artifacts, JSONL/result exports, validators, and samples to stable `graders[]`/`checks[]`. | `av-kfik.28.1`, `av-kfik.28.3`, `av-kfik.28.4`. | Artifact contract tests cover single grader, multiple graders, no checks, scored checks, and failed grader parse errors; public artifacts reject legacy `assertion_results`/`passed`-only shape. | Artifact PR after parser and SDK PRs. Keep sample regeneration separate from input/example migration unless stacked after `av-kfik.15`. |
| `av-kfik.28.5` | Update Dashboard artifact readers and grading UI. | `av-kfik.28.6`, `av-kfik.28.1`. | Dashboard reads aggregate and `graders[]`, renders nested `checks[]` only when present, has fixtures for single/multi/failed grader states, and publishes screenshot evidence to `agentv-private`. | Dashboard PR after `av-kfik.28.6`; do not ship UI fixture updates before artifact shape is stable. |
| `av-kfik.28.7` | Update docs, examples, result artifact reference, script grader docs, and Promptfoo parity matrix. | `av-kfik.28.2`, `av-kfik.28.3`, `av-kfik.28.4`, `av-kfik.28.5`. | Public docs state the current contract directly; examples validate; parity matrix says AgentV is compatible with Promptfoo `llm-rubric` value templating and extends results with checks; live provider plus real LLM grader dogfood is recorded. | Final docs/examples PR after implementation and dashboard PRs, and after `av-kfik.15`/`av-kfik.16` clear broad input/codemod/docs migration. |

## Sequencing Constraints

`av-kfik.13` owns multi-turn execution/evaluation and blocks `av-kfik.15`. Any expected-output migration that rewrites broad example or fixture surfaces should wait until `av-kfik.13` decisions are reflected in the hard-deprecation codemod path.

`av-kfik.27` has a draft input hard-deprecation PR and intentionally leaves many fixtures/examples failing until `av-kfik.15` migrates authored direct input to prompts plus vars. Grading-reference implementation must not compete with that PR by editing the same input migration surfaces unless it is deliberately stacked after `av-kfik.27` and coordinated through `av-kfik.15`.

`av-kfik.15` is the broad hard-deprecation codemod. `av-kfik.28.2` should stack after it for repo-wide YAML, example, and fixture rewrites, or stay narrowly scoped to expected-output parser/codemod logic with isolated prompt/vars fixtures.

`av-kfik.16` owns final docs, examples, and live dogfood for the broader Promptfoo restructure. `av-kfik.28.7` should land after the grading implementation PRs and coordinate with `av-kfik.16` so docs/examples describe the current contract directly and do not preserve migration rationale outside explicit migration docs or ADRs.

README stays out of scope for this plan except to keep Promptfoo comparison in parity/reference docs rather than expanding README.

## Validation And Dogfood Plan

Implementation workers should choose the smallest checks that prove their Bead acceptance criteria, but the full sub-epic needs:

- Unit, schema, parser, loader, and runtime tests for authored `vars.expected_output`, explicit `assert` ownership, rejection/migration of authored `expected_output`, and `default_test`/`defaultTest` inheritance.
- Artifact contract tests for aggregate `{pass, score, reason, graders[]}`, nested `checks[]`, and rejection of public `assertion_results`, `passed`, top-level `checks`, or one-grader dynamic shapes.
- SDK and script grader tests for aggregate-only results, checks with scores, checks without scores, and boundary translation between TypeScript internals and public wire format.
- Docs and examples validation after docs/examples migrate to prompts plus vars and current grading artifact vocabulary.
- Live provider plus real LLM grader dogfood for eval, grader, and artifact changes, using canonical `.agentv/results/<run_id>/` output and private evidence.
- Dashboard build and browser screenshot evidence published to `agentv-private` for Dashboard grading display changes.

Do not count mock targets, replay/frozen transcript runs, deterministic-only tests, or `agentv validate` as the live dogfood gate for grader/artifact changes.
