# Plan (DRAFT): Restructure AgentV eval authoring to clone promptfoo

Status: draft for review. Not started. No code changed.

Sources analyzed (all cloned locally, read-only):
- promptfoo v0.121.17 — `/home/christso/projects/promptfoo-clone` (authoring format — the thing we clone)
- Margin-Lab/evals — `/home/christso/projects/margin-lab-evals` (runner, I/O contracts, workspace, analytics)
- vercel-labs/agent-eval — `/home/christso/projects/vercel-agent-eval` (transcripts, agentic LLM graders, output JSON)
- AgentV today — `packages/core/src/evaluation/**`, `packages/sdk/**`, `docs/adr/**`

## 0. Goal, scope, non-goals

**Goal — AgentV's eval contract is a strict SUPERSET of promptfoo.** Adopt promptfoo's `promptfooconfig.yaml` authoring surface verbatim (field names + semantics), then layer AgentV's repo/agent value-adds on top. The success property is:

> **Any promptfoo config, mechanically snake_cased, is a valid AgentV eval that runs with equivalent semantics.** AgentV additionally accepts more (bare-string asserts, repo/fixture materialization via a built-in extension, `gate`, agentic judges, multi-turn, …) — all through promptfoo-native surfaces (`vars`, `extensions`), not new top-level concepts.

Two consequences of "superset":
- **Compatibility is one-way, and that is the design** — promptfoo ⊆ AgentV. AgentV extensions that promptfoo rejects (bare-string asserts, the built-in `agentv:workspace` extension, etc.) are the superset, not a defect.
- **snake_case caveat.** The superset is over *snake_cased* promptfoo. A literal camelCase promptfoo file needs a mechanical camel→snake transform to run (we ship that transform / importer). This is the one deliberate wire divergence.

Borrow runner/analytics from margin-lab and transcripts/agentic-graders from vercel-agent-eval.

**In scope.** The eval-file schema (`eval-file.schema.ts`), the parser/config layer, the assertion/grader vocabulary, the templating engine, the run/execution model, transcript normalization, and the output/analytics contract.

**Non-goals (this plan).** promptfoo `redteam`, promptfoo cloud `sharing`, and promptfoo's SQLite results DB. AgentV keeps the local `.agentv/results/<run_id>/` bundle + Dashboard per the Phoenix product boundary.

**Hard constraint.** Every conflict below is a reversal of an existing shipped AgentV decision (several are ADR-0013 decisions made within the last week). Each needs an explicit keep/replace call — that is section 2, and it's the part that needs your sign-off before any code moves.

---

## 1. Target authoring format — promptfoo, snake_cased

This is the format we are cloning. Field names are promptfoo's, mechanically snake_cased.

### 1.1 Top-level keys

| promptfoo (camelCase) | AgentV target (snake_case) | Notes |
|---|---|---|
| `description` | `description` | already exists |
| `tags` (`Record<string,string>`) | `tags` (map) | AgentV already moved here (`tags.experiment`) — **aligned** |
| `prompts` | `prompts` | **NEW top-level concept** (see 1.2) |
| `providers` / `targets` | `targets` (canonical); `provider` = backend field | plural matrix axis; `providers` accepted as compat alias (see 2.a) |
| `tests` | `tests` | keep; row shape changes (see 1.4) |
| `default_test` (`defaultTest`) | `default_test` | widen from threshold-only (see 1.5) |
| `scenarios` | `scenarios` | **NEW** (see 1.7) |
| `derived_metrics` (`derivedMetrics`) | `derived_metrics` | **NEW** (see 1.7) |
| `output_path` (`outputPath`) | *(map to fixed bundle)* | AgentV writes `.agentv/results/` — keep bundle, accept `output_path` as an extra export sink |
| `env` | `env` | provider env overrides |
| `nunjucks_filters` (`nunjucksFilters`) | `nunjucks_filters` | depends on templating decision (2.f) |
| `extensions` | `extensions` | **canonical lifecycle surface** (`beforeAll`/`afterAll`/`beforeEach`/`afterEach`). `on_run_complete`, `preprocessors`, `workspace.hooks` are REMOVED and fold into this (see 2.l) |
| `metadata` | `metadata` | exists |
| `evaluate_options` (`evaluateOptions`) | `evaluate_options` | widen (see 1.6) |
| `sharing`, `redteam`, `tracing` | — | out of scope / Phoenix boundary |

### 1.2 `prompts` (NEW — the biggest addition)

promptfoo separates **prompt templates** (top-level `prompts`) from **data rows** (`tests[].vars`). One test row is rendered through every prompt × every provider. AgentV today has no top-level prompt list — it puts a full message array in each `tests[].input`.

Forms to support (snake_cased where object keys appear):
- inline string with nunjucks: `"Convert to {{language}}: {{input}}"`
- file ref: `file://prompts.txt` (`---` separates multiple), `file://p.json`, `file://p.yaml`
- file + label: `{ id: file://prompts.txt, label: content_generation }`
- function prompt: `file://prompt.js:func` / `file://prompt.py:func`
- chat array: `[{ role, content }]`
- map form: `{ id: template }`

### 1.3 `providers` / `targets` (plural matrix)

promptfoo: `providers` is an **array**; the eval is the matrix `prompts × providers × tests`. `targets` is an accepted alias (promptfoo enforces exactly one of the two and normalizes `targets`→`providers`).

Forms: string id (`openai:chat:gpt-4o`), object `{ id, label, config, prompts, transform, delay, env }`, map form, function, and protocol providers (`http`, `exec:`, `file://…`, `python:`, `websocket:`, `echo`).

AgentV already has a rich target provider set (CLI/SDK/codex/copilot/claude/replay/transcript) and per-execution `targets: []`. The work is promoting `providers`/`targets` to a **top-level plural matrix axis** and reconciling with AgentV's `.agentv/targets.yaml` named-target registry (see 2.a).

### 1.4 `tests` / test case

promptfoo test row fields → snake_case:
`description`, `vars`, `provider`, `providers`, `prompts`, `provider_output` (`providerOutput`), `assert`, `assert_scoring_function` (`assertScoringFunction`), `options`, `threshold`, `metadata`.

Key shape changes vs AgentV today:
- add `vars` as the row's data (AgentV has `vars` already, but it's secondary to `input`)
- add `assert` as the canonical grader key (AgentV renamed this to `assertions` — conflict 2.c)
- `provider_output` short-circuits the provider call and grades a fixed output — AgentV has no equivalent
- promptfoo test `id`/`description` is optional; AgentV requires `id` (conflict 2.d)

### 1.5 `default_test` (widen)

promptfoo `default_test` is a full test-case-minus-description whose `vars`/`assert`/`options`/`threshold`/`metadata` merge into every row (and `file://` loadable). AgentV's `default_test` today is `{ threshold }` only. Widen it to the full promptfoo merge semantics, plus `options.disable_default_asserts` opt-out.

### 1.6 `evaluate_options` (widen)

promptfoo: `cache`, `delay`, `generate_suggestions`, `max_concurrency`, `repeat`, `timeout_ms` (per test), `max_eval_time_ms` (whole run), `filter_range`. AgentV has `{ budget_usd, max_concurrency }`. Superset them; reconcile `repeat` with AgentV's `repeat: { count, strategy, early_exit }` block and margin-lab's `samples_per_case` (conflict 2.g).

### 1.7 `scenarios`, `derived_metrics`, named metrics

- `scenarios`: `[{ description, config: [partialTest…], tests: [test…] }]` — cartesian of config groups × tests. **NEW** to AgentV.
- `derived_metrics`: `[{ name, value }]` where `value` is a math expression over named scores or a function. **NEW**.
- **named metrics**: promptfoo's `assert[].metric` (nunjucks-templated) feeds `named_scores`; `assert-set` groups sub-asserts under one metric. AgentV graders use `name` — conflict 2.e.

### 1.8 Assertions (`assert`)

Per-assertion fields → snake_case: `type`, `value`, `config`, `threshold`, `weight`, `provider`, `rubric_prompt` (`rubricPrompt`), `metric`, `transform`, `context_transform`.

promptfoo assertion **type** catalogue is large and flat, each with a `not-` variant, plus `assert-set`, `select-best`, `human`, `max-score`. AgentV has a smaller typed set (`contains`/`equals`/`regex`/`is-json`/`rubrics`/`llm-grader`/`code-grader`/`composite`/`tool-trajectory`/`field-accuracy`/`latency`/`cost`/`token-usage`/`execution-metrics`/`include`).

Proposed type mapping (this is the crux of conflict 2.c):

| promptfoo type | AgentV today | Plan |
|---|---|---|
| `contains`/`equals`/`regex`/`is-json`/`icontains`/`starts-with`/`contains-all`/`contains-any` | `contains`/`equals`/`regex`/`is-json` | adopt promptfoo names; add the missing string ops |
| `javascript` / `python` | `code-grader` | accept promptfoo `javascript`/`python`; keep `code-grader` as AgentV superset |
| `llm-rubric` / `model-graded-*` / `g-eval` / `factuality` | `llm-grader` / `rubrics` | adopt `llm-rubric` name; keep `llm-grader` (agentic) as extension |
| `assert-set` | `composite` | adopt `assert-set`; keep `composite` alias or deprecate |
| `similar` / `similar:*` | *(none)* | **NEW** — needs embeddings provider |
| `latency` / `cost` / `perplexity` / `word-count` | `latency` / `cost` / `token-usage` | align names |
| `trajectory:tool-used` / `:tool-sequence` / `:step-count` / `:goal-success` | `tool-trajectory` | map AgentV's single typed grader onto promptfoo's `trajectory:*` family |
| `webhook` / `classifier` / `moderation` / `guardrails` / `answer-relevance` / `context-*` | *(none)* | evaluate per-need; most are optional |
| — | `field-accuracy`, `execution-metrics`, `include` | AgentV-only extensions to preserve |

### 1.9 Datasets / CSV

promptfoo `tests: file://tests.csv` with magic columns (`__expected`, `__expectedN`, `__prefix`, `__suffix`, `__description`, `__provider_output`, `__metric`, `__threshold`, `__metadata:key`, `__config:…`) and the `assertionFromString` mini-DSL. AgentV has `imports`/`include`/`select` instead. Plan: support `file://…csv|json|jsonl|yaml|py:func` row loading + the `__expected` column DSL as the promptfoo-compatible dataset path; keep AgentV `imports`/`select` as the suite-composition path.

### 1.10 Templating

promptfoo renders `{{var}}` via **nunjucks** into prompt `raw`, `assert.value`, and `assert.metric`; array vars auto-expand into multiple rows; `_conversation` var auto-injected; custom filters via `nunjucks_filters`. AgentV uses `${{ ENV }}` substitution only. This is conflict 2.f — adopting nunjucks is required for true format parity.

---

## 2. Conflicts — RESOLVED by the naming principle

**Governing principle (owner decision).** Where a feature is functionally equivalent and semantically the same, **use promptfoo's name/shape** (e.g. `assert`, not `assertions`; `metric`, not `name`). **Keep AgentV's form only where its semantics are genuinely better** — e.g. AgentV's executable `gate` over promptfoo's scalar `threshold`, and AgentV's `repeat: { count, strategy, early_exit }` block over promptfoo's `repeat: <int>`.

**Deprecation policy: HARD (owner decision).** This ships as a **major version**. Renamed/replaced keys are *removed*, not aliased — no back-compat shims, no soft-deprecation window. `assertions` → removed (use `assert`); `composite` → removed (use `assert-set`); grader `name`-as-metric → removed (use `metric`); `eval_cases` → removed. A one-shot codemod migrates existing eval files; the parser hard-errors on removed keys with a message pointing at the new name.

Applying that principle, the decisions are below (D = decided, ▸ = still a judgment call, tracked in §8).

### 2.a `targets` first-class SUT; `provider` = harness/backend — SEMANTIC DEPARTURE
- **promptfoo (verified against source + history):** `providers` is the **original, canonical** field. `targets` is a **strict alias added 2024-05-09** (commit `102804f0`, the red-team feature) — `UnifiedConfigSchema` enforces "exactly one of `targets`/`providers`," then `transform`/`readConfig` do `providers = targets; delete targets`. So in promptfoo `targets` ≡ `providers` exactly; the "system-under-test" connotation is *conventional* (redteam domain), not schema-enforced.
- **AgentV's move is a deliberate re-canonicalization, not a mirror.** promptfoo's canonical is `providers` (LLM-endpoint framing). AgentV's domain (evaluating agents/apps) matches the red-team *"target = thing under test"* framing far better, so AgentV elevates `targets` to first-class canonical and demotes `provider` to "backend kind." Superset holds because AgentV still **accepts** `providers` and maps it onto `targets`. Net: we adopt promptfoo's target/`ProviderOptions` object *shape*, keep both top-level keys as input, and re-canonicalize on the name that fits agent-eval.
- **AgentV today:** top-level `target` (singular) is the SUT; `.agentv/targets.yaml` is a named registry; a target has a `provider` field naming the backend kind.
- **AgentV's better semantics (keep, and this is a deliberate departure):** do **not** treat `provider`==`target`. Layer them:
  - **`target` / `targets`** = first-class **system under evaluation** (agent/model being tested). Canonical name, and the matrix axis.
  - **`provider`** = the **harness or LLM backend** inside a target (`openai`/`anthropic`/`claude-code`/`cli`/`replay`/…) — never itself a SUT.
- **D — registry target = promptfoo target schema + AgentV extensions.** `.agentv/targets.yaml` entries adopt promptfoo's target/`ProviderOptions` object shape — `id`, `label`, `config`, `prompts`, `transform`, `delay`, `env` — extended with AgentV fields: `provider` (backend kind), `model`, `use_target`, `fallback_targets`, `grader_target`, `max_budget_usd`, `hooks`. A promptfoo `id: openai:gpt-4o` string decomposes to `{ provider: openai, model: gpt-4o }`.
- **D — superset mapping.** AgentV **accepts** top-level `providers` (promptfoo compat) and maps each entry onto a `targets` entry; canonical AgentV key is `targets`. A `targets` entry may be a registry name (string) or an inline promptfoo-shaped target object. `use_target`/`fallback_targets`/`max_budget_usd` stay as extensions.
- **Note vs 1.3:** §1.3 said "promote `providers`/`targets`"; the refinement is that **`targets` is canonical and `provider` is demoted to the backend field**, not a top-level synonym.

### 2.b Top-level `prompts` vs per-test `input` — ARCHITECTURAL
- **promptfoo:** prompt templates are top-level and shared; test rows carry only `vars`.
- **AgentV today:** each `tests[].input` is a full message array; no shared prompt list; `input` also supports file/image content items.
- **Conflict:** two different mental models of "what varies." Not functionally equivalent — additive, not a rename.
- **D — add promptfoo `prompts`, keep AgentV `input`:** Add top-level `prompts` (promptfoo semantics) for prompt/model benchmarking. Keep `tests[].input` as an AgentV extension (better semantics for repo/agent tasks where each test has its own conversation/attachments). Document both paths.

### 2.c `assert` vs `assertions`, and grader type names — NAMING (reverses ADR-0013)
- **promptfoo:** key is `assert`; types are `llm-rubric`, `javascript`, `python`, `assert-set`, `model-graded-*`.
- **AgentV today:** commit `d5514b9a` **removed** the `assert` alias and requires `assertions`; types are `llm-grader`, `code-grader`, `composite`, `rubrics`. ADR-0013 explicitly says it does NOT rename `grader`.
- **Conflict:** direct naming collision; functionally equivalent → principle says promptfoo wins.
- **D — `assert` is canonical; `assertions` REMOVED** (hard). Reverses ADR-0013; needs a superseding ADR.
- **D — adopt promptfoo type names where equivalent:** `javascript`/`python`, `assert-set` (over `composite`, removed), the string ops (`contains`/`equals`/`regex`/`is-json`/`icontains`/`contains-all`/`contains-any`/`starts-with`), `similar`, `latency`, `cost`, `webhook`.
- **D — keep AgentV grader types that have better/extra semantics** as first-class extension types (no promptfoo equivalent, or strictly richer): `code-grader` (workspace/target-aware superset of `javascript`/`python`), `tool-trajectory`, `execution-metrics`, `field-accuracy`, `include`.
- **D — consolidate the three LLM-judge types into one `llm-rubric`** (was §8.1). `rubrics` (multi-criteria, one judge call, operators/`score_ranges`) and `llm-grader` (agentic: `target`, `max_steps`, `preprocessors`) are **removed as type names** and folded into `llm-rubric` as optional fields:
  ```yaml
  type: llm-rubric
  value: string | (string | rubric_item)[]   # single (promptfoo) OR multi-criteria (AgentV: ONE judge call)
  target: <grader_target>                     # optional → agentic evidence-gathering judge (AgentV)
  max_steps: <int>                             # optional → agentic (AgentV)
  ```
  One promptfoo-named type; AgentV's better semantics (multi-criteria single call, structured `rubric_item` operators, agentic judge) survive as optional fields.

### 2.k `assert` short-form (bare strings → rubric) — how to handle it
- **AgentV today** (`grader-parser.ts:394`): bare strings in the `assertions` array are collected and unwrapped into **one** `rubrics` grader (`criteria: [strings]`, `weight = N`), evaluated in a single LLM call at equal weight. promptfoo has no bare-string form — every `assert` entry is an object, and multiple criteria are multiple `llm-rubric` asserts (one call each).
- **Better semantics = AgentV's:** grouping N criteria into one judge call is cheaper and more holistic than N separate calls. Keep the shorthand.
- **D — keep the bare-string shorthand, retarget it to `llm-rubric`:** bare strings in `assert` desugar to a single grouped `{ type: llm-rubric, value: [strings], weight: N }` (was `rubrics`; same grouping/weight/single-call behavior, now under the consolidated promptfoo-named type). Result:
  - `assert: ["is polite", "cites a source"]` → one `llm-rubric` with `value: [both]`, `weight: 2`.
  - `assert: [{type: contains, value: hi}, "is polite"]` → `contains(w=1)` + `llm-rubric(value:["is polite"], w=1)`.
  - promptfoo-style `assert: [{type: llm-rubric, value: "is polite"}]` works unchanged (import parity).
  This keeps AgentV's terse authoring + single-call economy while making the desugared type a promptfoo name. The explicit form `{ type: llm-rubric, value: [strings] }` is also accepted (same batching), so authors can pick terse or explicit.
- **This is the superset, not a divergence:** bare-string asserts are an AgentV extension on top of promptfoo. promptfoo ⊆ AgentV holds (every promptfoo `assert` is valid AgentV); AgentV simply accepts more. The only obligation: an "export to promptfoo" path must desugar bare strings to explicit `llm-rubric` objects first.

### 2.d Test `id` required vs optional
- **promptfoo:** `id`/`description` optional.
- **AgentV today:** `tests[].id` required; it's the flattened `test_id` result identity and `--test-id` CLI filter (ADR-0013).
- **Conflict:** promptfoo files won't have `id`; but the console log and Dashboard still need something to show and something stable to filter/compare on.
- **D — split the two jobs `id` does today:**
  - **Stable identity — `test_id`** (artifact dirs, `--test-id`, run-to-run Dashboard comparison). Required in the *result* contract; **derived** when not authored: slug of `description` if present, else short content hash of `(vars + prompt + assert)` → `test-<hash8>`. Deterministic across runs (editing a case yields a new id — correct, it's a different case). Always also carry ordinal **`test_index`**.
  - **Display label** (console + Dashboard render). Precedence, matching promptfoo's own UI: authored `id` → `description` → rendered `vars` (e.g. `language=French, input="Hello…"`) → `Test #<index>`.
  - Result: a promptfoo file with no `id` shows `language=French` in the log, groups cleanly in the Dashboard, and filters via the derived `test_id`. Authoring `id` sets both display and identity (AgentV's current behavior, still available).

### 2.e Named metrics: `metric` vs grader `name`
- **promptfoo:** `assert[].metric` (nunjucks-templated) names a score; `derived_metrics` computes over them; `assert-set` groups.
- **AgentV today:** graders carry `name`; no `derived_metrics`; aggregation via `weight`/`required`/`min_score`.
- **D — prefer promptfoo `metric`:** `metric` is the named-score field (nunjucks-templated); `name` becomes display-only/alias. Add `named_scores` + `derived_metrics` to the result contract. Keep `weight`/`required`/`min_score` as AgentV extensions (richer aggregation).

### 2.f Templating engine: nunjucks vs `${{ ENV }}`
- **promptfoo:** nunjucks `{{ }}` everywhere + array-var row expansion + custom filters.
- **AgentV today:** `${{ ENV_VAR }}` env substitution in target configs only.
- **Conflict:** different delimiters and capabilities; nunjucks is more capable and is the shared standard → principle says promptfoo wins.
- **D — two distinct sigils by resolution phase (no collision):**
  - **`{{ var }}`** — nunjucks, **eval-time** template vars, for `prompts`/`vars`/`assert.value`/`assert.metric`, + array-var row expansion + `nunjucks_filters` (promptfoo parity).
  - **`${ENV}`** — shell/Docker/k8s style, **config-time** env interpolation (target configs, etc.), **replacing `${{ ENV }}`** (hard change per §deprecation). Support `${ENV:-default}` like docker-compose.
  - Because `{{ }}` and `${ }` never overlap, the earlier `{{ }}`-vs-`${{ }}` collision is gone. Codemod rewrites `${{ X }}` → `${X}`.

### 2.g `repeat` block vs `samples_per_case` vs promptfoo `repeat:int`
- **promptfoo:** `evaluate_options.repeat` = integer (naive re-run).
- **AgentV today:** `repeat: { count, strategy: pass_any|pass_all|mean|confidence_interval, early_exit, cost_limit_usd }`.
- **margin-lab:** `samples_per_case` (int) → expands to N independent instances; pass@k computed in analytics.
- **D — keep AgentV `repeat` block (better semantics):** it is strictly more expressive than `repeat: <int>`. Map promptfoo's `repeat: <int>` → `repeat.count` with `strategy: pass_all`. Implement via margin-lab-style **instance expansion** (§4). This is an explicit "AgentV wins" case under the principle.

### 2.h Output store: bundle vs promptfoo SQLite
- **promptfoo:** SQLite `~/.promptfoo/promptfoo.db` + optional `output_path` file.
- **AgentV today:** `.agentv/results/<run_id>/` bundle (ADR-0011/0012) + Dashboard.
- **D — keep AgentV bundle (better semantics + product boundary):** aligns with margin-lab's on-disk `results.json` + per-instance dirs and the Phoenix boundary. Support promptfoo `output_path` (json/jsonl/csv/yaml) as an *export* view; optionally emit a promptfoo-compatible `EvaluateSummaryV3` for interop. Do not adopt the SQLite DB.

### 2.j `threshold` (per-test) + `gate` (release policy)
- **promptfoo:** scalar per-test/`default_test` `threshold` only; no release gate.
- **AgentV today:** per-test/`default_test` `threshold` **and** an executable `gate` (`min_test_pass_rate`, `max_execution_errors`, command over run JSON).
- **D — keep both:** adopt promptfoo `threshold` (same concept, per-test score cutoff) **and** keep AgentV `gate` (better semantics for release gating; no promptfoo equivalent). Different levels, both stay.

### 2.i AgentV-only fields promptfoo lacks (preserve, don't lose)
`gate` (executable release policy), `imports`/`include`/`select`, multi-turn (`mode: conversation`/`turns`/`aggregation`), `depends_on`/`on_dependency_failure`, `conversation_id`, `requires`, replay/transcript providers, code-grader SDK. **All preserved as documented AgentV extensions** (section 3). (Workspace, `on_run_complete`, `preprocessors` are handled by 2.l, not kept as-is.)

### 2.l Workspace is dataset + a built-in extension; NO new top-level concept; `on_run_complete` removed
- **Principle (owner decision):** don't invent a top-level `workspace:` block, and don't keep AgentV-specific lifecycle keys. Align maximally with promptfoo. Both reference frameworks agree workspace **is part of the dataset** — vercel: a case *is* a fixture dir; margin-lab: a case *is* a Docker image + tests.
- **D — one lifecycle surface: promptfoo `extensions`.** `beforeAll`/`afterAll`/`beforeEach`/`afterEach`. **Remove** `on_run_complete` (= `afterAll`), `preprocessors`, and `workspace.hooks` — they collapse into `extensions` (hard, major version).
- **D — workspace spec = dataset data (`vars`), not a schema block.** The repo/fixture spec rides as a `var` (per-test or `default_test`, `file://`-loadable). This is literally what your promptfoo parity example does (`workspace.yaml` + `vars`). No new concept; matches vercel (fixture=case) and margin (image=case).
- **D — ship a built-in, auto-registered, overridable extension `agentv:workspace`.** It does what the parity example hand-rolls (git materialization + mirror cache à la margin's image cache; optional docker isolation; per-case fixture copy à la vercel) — but in the box. It **validates** the `vars.workspace` shape (recovers the safety a schema block would give) and writes the materialized path back into `vars`/context so the target picks up `cwd` (cleaner than promptfoo's `PROMPTFOO_*` env side-channel).
- **D — isolation = the hook name in the extension reference (verified promptfoo mechanism).** promptfoo (`src/evaluatorHelpers.ts:633`) has `EXTENSION_HOOK_NAMES = {beforeAll, beforeEach, afterEach, afterAll}`: if the function named after the last `:` is exactly a hook name, it runs **only** at that phase; any other name = generic handler run at all phases. So:
  - `extensions: [agentv:workspace:beforeAll]` → **shared** workspace (materialize once for the run).
  - `extensions: [agentv:workspace:beforeEach]` → **per-case** workspace (context carries the test's `vars.workspace`).
  Isolation is expressed by *which hook you reference* — no `isolation:` enum needed. Registering both (or a generic `agentv:workspace`) makes the built-in dispatch across phases (beforeAll = shared base + mirror cache; beforeEach = clone/copy per case; afterEach = reset/clean).
- **Shape:**
  ```yaml
  targets: file://targets/reviewer.yaml
  extensions:
    - agentv:workspace:beforeAll        # shared; use :beforeEach for per-case
  default_test:
    vars:
      workspace:                        # dataset data, not a top-level block
        repos:
          - { path: ./CargoWise, repo: https://…/CargoWise.git, commit: 953adb9 }
  tests: file://cases.yaml              # a row may override vars.workspace (per-case fixture)
  ```
- **Import mapping:** a promptfoo `extensions: [file://mat.ts:beforeAll]` that materializes a dir maps 1:1 onto AgentV `extensions` (same hook semantics); the dir it builds becomes `vars.workspace` consumed by `agentv:workspace`.

---

## 3. AgentV-only features to preserve as extensions

These have no promptfoo equivalent and are AgentV's differentiation. Keep them, document them as extensions layered above the promptfoo-compatible core:

- **Repo/fixture materialization — via dataset `vars` + the built-in `agentv:workspace` extension, NOT a top-level `workspace:` block** (see 2.l). The materialization capability (git repos at pinned commits + mirror cache, docker isolation, per-case fixture copy) is preserved; only the *authoring surface* changes — it rides promptfoo's `vars` + `extensions`.
- **Executable `gate`** release policy (`min_test_pass_rate`, `max_execution_errors`, command receiving run JSON).
- **Agent target providers**: CLI/SDK/codex/copilot/claude/replay/transcript, `use_target` indirection, `fallback_targets`, `grader_target`.
- **Code-grader SDK** (`@agentv/sdk`): `define_assertion`/`define_code_grader`/`define_workspace_grader`/`define_vitest_workspace_grader`.
- **Multi-turn conversations**, `depends_on` DAG, `imports`/`select` suite composition.
- **Trajectory / execution-metrics / field-accuracy** graders.

Removed (folded into promptfoo `extensions`, see 2.l): top-level `workspace:` block, `workspace.hooks`, `on_run_complete`, `preprocessors`.

---

## 4. Runner & execution model — borrow margin-lab

Adopt margin-lab's scheduling shape (it's the cleanest of the three for repeats + variance + resumability):

- **Instance = unit of scheduling.** Expand `(prompt × provider × test × sample)` into flat **instances** at compile time. `samples_per_case`/`repeat.count` → `instance_key = "<test_id>#<sample_index>"` (margin-lab's `BuildInstanceKey`). This subsumes AgentV's current repeat handling and gives pass@k for free.
- **Lease-based worker pool** (`engine.Pool` shape): N workers claim pending instances via a store with lease + heartbeat + reaper, instead of a fixed goroutine fan-out. Benefits: crash-safe, resumable, and works identically for a future distributed store. `max_concurrency` → worker count.
- **Retry = infra-only.** Test failures are valid graded outcomes; only infra failures requeue (`retry_count`). Run is `completed` unless `infra_failed > 0`. Adopt this state machine (`domain.NextRunState`).
- **Per-instance hard timeout** covering setup+agent+grade (`instance_timeout_seconds`).
- **Caveat:** margin-lab's `fail_fast` is declared-but-inert — if we want fail-fast, we implement it (don't copy the dead field).

margin-lab's agent-server HTTP protocol is more than AgentV needs (AgentV already has CLI/SDK providers); borrow the *scheduling + state machine*, not the in-container HTTP host.

---

## 5. Transcripts & agentic graders — borrow vercel-agent-eval

### 5.1 Two-layer transcript (aligns with AgentV ADR-0008)
- Keep **raw** agent-native transcript (`transcript-raw.jsonl`) AND a **normalized** `transcript.json` with a canonical cross-agent **`tool_name` enum** (`file_read`/`file_write`/`file_edit`/`shell`/`web_fetch`/`web_search`/`glob`/`grep`/`list_dir`/`agent_task`/`unknown`) and a precomputed **`transcript_summary`** (`total_turns`, `tool_calls` map, `files_read`/`files_modified`, `shell_commands`, `web_fetches`, `errors`, `thinking_blocks`).
- **Inline the summary** into per-instance `result.json` for cheap trajectory assertions (feeds AgentV's `tool-trajectory`/`execution-metrics` graders directly).
- Per-agent parsers routed by agent id (vercel's `AGENT_PARSERS`).

### 5.2 Agentic LLM judge (evidence-by-path)
Borrow vercel's judge model, which is stronger than a prompt-stuffed rubric:
- The judge is a **re-invoked agent in the same workspace** that reads evidence **by path** (transcript file / final environment) rather than having the transcript stuffed into the prompt. Maps onto AgentV's existing `llm-grader`/`code-grader` with `target` + `max_steps`.
- Two **subjects**: `environment` (inspect final workspace state) and `transcript` (read the transcript) — matches AgentV workspace vs trace grading.
- **Framework-owned skeptical prompt**, tiny verdict contract `{ pass, score?, reason }` (author supplies only a criterion string). Adopt this as the default `llm-grader` prompt.
- **Judge pinning** knob: `grader_target` = `{ agent?, model }` with self-grade default. AgentV already has `grader_target`; formalize the `{model}`-required pinning for apples-to-apples comparison.
- **Gap to fix vs vercel:** they capture no token/cost — AgentV already does; keep it.

---

## 6. Output artifacts & analytics

- **Keep** `.agentv/results/<run_id>/` bundle (ADR-0011/0012). Reconcile field names with margin-lab's `results.json` `Summary` where useful.
- **Analytics = one pure function** (margin-lab's `runresults.Build`): given instances+results, produce a deterministic `Summary` with per-case **pass@k** (`pass_count`/`pass_rate` over samples), `status` breakdown, `usage` aggregation, and infra-failure taxonomy. AgentV currently lacks pass@k/variance — this fills it.
- Add promptfoo-shaped **`named_scores`** + **`derived_metrics`** to per-result rows (feeds Dashboard Tags/metrics tabs).
- Reference transcripts **by relative path** in the result row (vercel), never inline the full transcript.
- Optional promptfoo-compatible `EvaluateSummaryV3` export for interop.

---

## 7. Phasing

1. **Schema spike** — write the snake_cased promptfoo Zod schema alongside the existing one; land conflict decisions from §2 as an ADR (supersede/annotate ADR-0013). *No behavior change.*
2. **Templating** — introduce nunjucks + array-var expansion behind the new schema.
3. **Prompts × providers matrix + instance expansion** — compile step producing flat instances; adopt lease-based scheduler (§4).
4. **Assertion vocabulary** — promptfoo types + `assert`/`assert-set`/`metric`; keep AgentV graders as extensions; add `similar` (embeddings) if wanted.
5. **Transcript normalization + agentic judge** — canonical `tool_name` enum, `transcript_summary`, evidence-by-path judge, judge pinning (§5).
6. **Analytics** — pure `Build` summary with pass@k, `named_scores`, `derived_metrics` (§6).
7. **Datasets/CSV** — `file://…csv` + `__expected` DSL.
8. **Docs + migration** — dual-format support window; codemod old `assertions`→`assert` etc.; dogfood with live provider + real LLM grader (per `.agents/verification.md`).

Each phase is a reviewable PR; §2 decisions gate phase 1.

---

## 8. Remaining judgment calls

The naming principle + hard-deprecation + the **superset goal** resolve 2.a–2.k, including the old §8.1 and the shorthand. The superset goal also *tightens* what "parity" means: the schema must **accept and validate every promptfoo key/type** (else promptfoo ⊄ AgentV), even where implementation is phased. That reframes the leftovers:

1. **Assertion parity scope — reframed by superset.** The schema must *accept* the full promptfoo assertion type list (so any promptfoo config parses). Open question is only *implementation* order: which exotic graders (`context-*`, `moderation`, `guardrails`, `answer-relevance`, `classifier`, `g-eval`, `perplexity`, embeddings-backed `similar`) ship as working vs. accepted-but-`not_implemented` stubs at v-major. (Leaning: `similar` + string/js/py/rubric/latency/cost working at launch; rest accepted-and-stubbed, `log()`-warned, filled on demand.)
2. **Redteam — the one strict-superset tension.** promptfoo's `redteam:` block is part of its contract, so strict superset implies accepting it. But it's a large subsystem. Options: (a) **accept-and-ignore** the `redteam` key at schema level (parses, no-op + warning) to preserve superset parsing, defer execution; (b) exclude it entirely and declare redteam an explicit non-superset carve-out. (Leaning: (a) — accept the key so promptfoo files parse, defer behavior.)
3. **`code-grader` vs `javascript`/`python`** — accept promptfoo `javascript`/`python` (required for superset) as sugar desugaring to `code-grader`, or as distinct simpler types? Either satisfies superset. (Leaning: desugar.)

Everything else is decided; phase 1 (schema + superseding ADR + codemod + camel→snake importer) can start once these three are confirmed.
