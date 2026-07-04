# 16. promptfoo-superset eval authoring contract

Date: 2026-07-02

## Status

Accepted (2026-07-02). Anchor decision for the eval-authoring restructure — see
`docs/plans/promptfoo-aligned-eval-restructure.md` §1–§2, §11.1. **Supersedes the
eval-authoring portions of [ADR 0013 (stabilize eval authoring)](0013-stabilize-eval-authoring-contract.md)
and [ADR 0013 (experiment as tags.experiment)](0013-experiment-is-metadata-expressed-as-tags-experiment.md)**;
multi-turn is carved out to [ADR 0015](0015-multi-turn-conversation-execution-vs-evaluation.md);
the output/artifact contract to [ADR 0017](0017-output-artifact-and-workspace-resolver-contract.md).

Status note (2026-07-04): implementation settled the grader vocabulary after
this ADR was accepted. Current authored executable graders use `type: script`.
`llm-rubric` is the promptfoo-compatible free-form rubric judge. Structured and
multi-criteria rubric judging uses `g-eval` where itemized rubric semantics are
needed. `grading.json` exposes `assertion_results` plus `score`, `verdict`, and
`evidence`; do not teach `grading.json.assertions[]` as the current artifact
contract.

## Context

AgentV's eval-authoring surface diverged from industry primitives. We are re-basing
it on promptfoo (the lowest-common-denominator eval config) so that **any promptfoo
config, mechanically snake_cased, is a valid AgentV eval with equivalent semantics**,
and AgentV extensions layer on top (repo-native workspaces, agentic judges, gate,
multi-turn). This ships as a **major version with hard deprecation** — nothing is in
production, so removed keys are deleted (not aliased) and a one-shot codemod migrates
existing files.

## Decision

Governing principle: **prefer promptfoo's name/shape where functionally equivalent;
keep AgentV's only where its semantics are genuinely better.**

1. **`assert` is canonical** (per-test and `default_test`); `assertions` removed.
   Promptfoo type names adopted (`contains`/`equals`/`regex`/`is-json`/`icontains`/
   `contains-all|any`/`starts-with`/`similar`/`latency`/`cost`/`webhook`/`javascript`/
   `python`/`assert-set`). `composite` removed → `assert-set`.
2. **LLM judge vocabulary follows semantics.** `llm-rubric` is the
   promptfoo-compatible free-form rubric judge. Bare-string `assert` entries and
   structured AgentV rubric criteria desugar to grouped `g-eval` assertions when
   AgentV needs itemized, multi-criteria rubric semantics. Old `rubric`/`rubrics`
   assertion type names are removed. Agentic evidence-gathering judges stay an
   AgentV extension rather than being forced into `llm-rubric`.
   Structured AgentV rubric criteria are preserved, not flattened into a single
   text blob: criteria objects keep `weight`, `operator`, `required`,
   `score_ranges`, and `min_score`. Artifact assertion rows are the generic
   AgentV grader contract: `grading.json.assertion_results[]` holds flattened
   assertion evidence, and nested grader entries keep their own
   `assertion_results[]` breakdown with score, verdict, and evidence.
   Deterministic graders usually emit one row, while multi-aspect graders emit
   one row per authored check or result unit. Structured rubric criteria
   therefore populate one assertion row per criterion so the Dashboard can show
   criterion-level evidence, using the same mechanism as script graders, field
   accuracy, execution metrics, and tool trajectory.
3. **Grader execution**: `javascript` in-process (Bun `import`), `python` subprocess,
   `script` = the subprocess power tool (workspace-`cwd`, arbitrary language).
   `javascript` is NOT desugared to `script`.
4. **`metric` is the named-score field** (nunjucks-templated); grader `name` becomes
   display-only. Add `named_scores` + `derived_metrics`.
5. **`targets` is the canonical system-under-test** axis (promptfoo target/`ProviderOptions`
   object shape + AgentV extensions). `provider`/`apiId` = the **backend** kind (never a
   SUT). No runtime top-level `providers` alias (would overload the backend term); the
   codemod/conversion remaps promptfoo `providers:` → `targets:`.
6. **Prompts + vars plus direct `input`**: adopt top-level `prompts` (string/chat-array/file/
   fn, nunjucks `{{vars}}`) for prompt matrices, while keeping `input` as the
   supported direct-task shorthand for one-prompt suites. When `prompts` is
   present, tests supply matrix data through `vars`; `tests[].input` and
   `tests[].input_files` are mutually exclusive with top-level `prompts`.
   `input_files` remains supported for direct task suites.
7. **Templating**: nunjucks for BOTH vars and env (promptfoo-native), via the `nunjucks`
   package. `{{ var }}` = eval-time vars (array-var expansion, `nunjucks_filters`, autoescape
   off, render-then-parse for chat arrays); `{{ env.VAR }}` = config-time env, rendered at
   load-time before validation (defaults via `{{ env.VAR | default('x') }}`). One engine,
   phase-separated by render pass + the `env` namespace — **no `${ENV}` sigil**. Replaces
   `${{ ENV }}`. Rationale beyond superset-compat: `{{ env.VAR }}` **does not collide with
   runtime shell `${VAR}`** — CLI-target commands can carry `$VAR`/`${VAR}` that must reach
   the shell at runtime untouched; a `${ENV}` config sigil would clobber them.
8. **Optional test `id`**, layered identity: content identity = `test_id` (content hash,
   derived when unauthored); governance/trend identity = an author `tag`/`metadata` key
   (Dashboard keys comparison on this); display label = `description` → vars → `Test #n`.
9. **Keep AgentV where better**: first-class `expected_output` as passive gold/reference
   data (DeepEval-aligned; not moved into `vars`, and not sent to target prompts
   unless the author separately places it in `vars`). A specific grader may use
   it as a strict target, semantic reference, structured expected object, or
   supporting context, but the field itself is not an active assertion.
   `repeat: { count, strategy, early_exit }` (map promptfoo
   `repeat:int` → `count`+`pass_all`); executable `gate` release policy (alongside per-test
   `threshold`); `imports`/`select`; `depends_on`. `experiment` is authored as `tags.experiment` — a plain tag with **no structural privilege** (not a bucket/field/storage path; not a privileged grouping key; tags alphabetical; default compare key is a user preference). `--experiment X` = sugar for `--tag experiment=X`. Its **value** is auto-defaulted to the eval/suite name when unset so runs are always groupable (ADR-0009 derivation) — a default value, not a privileged key (ADR-0017).
10. **Workspace repo provisioning is a declarative FIELD, not an extension.**
    `workspace.repos: [{ path, repo, commit (base_commit alias), sparse?, ancestor? }]` is
    declared per-test (overridable) / at suite level, and the **harness materializes it
    (harness-owned resolver, ADR 0017) BEFORE any hook or the target runs.** The *common
    case* is not a hand-rolled per-eval hook (ordering + reproducibility + declarative
    provenance). **But acquisition is pluggable** (ADR 0017 pt5): custom acquisition is
    first-class via a registered custom backend or a `beforeAll` escape hatch, and the
    built-in acquisition may itself be a swappable plugin — this is the correction of an
    earlier over-absolute "not an extension" claim; provenance stays a declarative field,
    acquisition stays extensible. `workspace.scope` (`suite` or `attempt`) is the portable
    workspace lifetime field.
    **Extensions are for pluggable non-provisioning setup only**: promptfoo lifecycle
    (`beforeAll`/`afterAll`/`beforeEach`/`afterEach`), running *after* materialization —
    e.g. `agentv:agent-rules` (stage skills/hooks/agents) and custom `file://` hooks.
    Removed: `on_run_complete`, `preprocessors` (→ `extensions`).
11. **Scope**: `similar` ships with a configured embeddings provider, `llm-rubric` ships
    as the free-form rubric judge, and `g-eval` covers structured or multi-criteria
    rubric judging. Exotic promptfoo assertions
    (`context-*`/`moderation`/…) and `redteam` are **future scope** —
    treated as unrecognized fields, not stubbed. Superset holds over the *implemented*
    surface.

Removed (hard): `assertions`, `composite`, `eval_cases`,
`workspace.hooks` (→ `extensions`), `on_run_complete`, `preprocessors`, `${{ ENV }}`,
top-level `budget_usd`, scalar top-level `threshold`, grader `name`-as-metric, the
`z.never()` rejection stubs. **Kept** as declarative fields: `workspace.repos` (provenance),
`workspace.scope`, `workspace.docker`, `workspace.template`, direct-suite
`input`, and direct-suite `input_files`.

## Consequences

- Reverses ADR-0013 (`assertions`-only, no `assert`). Both 0013 files marked superseded.
- A one-shot codemod migrates existing eval files and hard-errors on removed keys with a
  message pointing at the replacement.
- promptfoo authors get a near-drop-in contract (snake_case); AgentV keeps repo/agent
  differentiation as documented extensions.
- FizzBuzz/SWE-bench-style test grading needs no new assertion primitive -- a
  workspace-`cwd` `script` grader runs the tests (see ADR 0017 note on SWE-bench
  `FAIL_TO_PASS`/`PASS_TO_PASS`).
