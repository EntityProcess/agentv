# Promptfoo Schema Parity Audit

Date: 2026-07-07

AgentV source: `d89518e96d332248b3c670d28032ca15cca1ef75`
Promptfoo source: `origin/main` at `786b2bdfe0099c823f1cee8ac93de2965be69771`

This audit compares AgentV authored eval YAML against Promptfoo's current config
surface. Sources inspected:

- AgentV schema/parser/validator:
  `packages/core/src/evaluation/validation/eval-file.schema.ts`,
  `packages/core/src/evaluation/yaml-parser.ts`,
  `packages/core/src/evaluation/validation/eval-validator.ts`,
  `skills-data/agentv-eval-writer/references/eval.schema.json`
- Promptfoo schema/types:
  `/home/entity/projects/promptfoo/promptfoo/src/types/index.ts`,
  `/home/entity/projects/promptfoo/promptfoo/src/validators/providers.ts`,
  `/home/entity/projects/promptfoo/promptfoo/src/util/config/load.ts`,
  `/home/entity/projects/promptfoo/promptfoo/site/static/config-schema.json`
- Product boundary docs:
  `AGENTS.md`, `STRATEGY.md`, `ROADMAP.md`,
  `.agents/product-boundary.md`, `.agents/conventions.md`,
  `CONCEPTS.md`, `apps/web/src/content/docs/docs/next/reference/promptfoo-parity.mdx`

No builds, tests, evals, or schema/runtime changes were run for this research task.

## Bottom Line

AgentV is already closest to Promptfoo where it matters most: `prompts x tests/vars x providers`,
assertion objects, provider `id`/`label`, `env`, `scenarios`, `default_test`,
`derived_metrics`, `output_path`, `nunjucks_filters`, and `evaluate_options`.

The largest remaining divergence is not capability, but authoring surface area.
AgentV still accepts several non-Promptfoo top-level and nested fields. Some are
intentional AgentV extensions, but several should be removed, moved, or explicitly
classified before they become durable public API.

Keep these as intentional AgentV exceptions:

- `environment` recipes at suite/test scope, including `file://` recipes.
- `ref://` composition for AgentV config-managed references.
- AgentV built-in providers and provider runtime details, behind clear Promptfoo
  export diagnostics when not directly executable by Promptfoo.
- AgentV run bundles, Dashboard, and result artifact fields.

Everything else should either align with Promptfoo directly or have an explicit
decision explaining why the extra AgentV surface is worth keeping.

## High-Confidence Follow-Ups

| Bead | Recommendation | Why |
| --- | --- | --- |
| `av-ibec` | Remove/hard-deprecate top-level eval YAML `experiment`; use `tags.experiment` or CLI `--experiment`. | `CONCEPTS.md` and docs already say there is no top-level `experiment`, but schema/parser still accept it. Promptfoo has no equivalent. |
| `av-sdit` | Add missing Promptfoo provider shapes: provider maps and `providers[].inputs`; document/export-gate AgentV-only provider `runtime`/`environment`/`hooks`. | Promptfoo `ProvidersSchema` accepts maps and `ProviderOptions.inputs`; AgentV docs claim this provider-layer parity but schema does not fully implement it. |
| `av-9j60` | Enforce native AgentV `snake_case` eval wire keys and translate at the Promptfoo boundary. | Promptfoo's established fields are `defaultTest`, `evaluateOptions`, `outputPath`, `derivedMetrics`, `nunjucksFilters`, etc.; AgentV's settled wire-format convention keeps native authored YAML in `snake_case`. Import/export/transpile must map to Promptfoo `camelCase` where required, and native AgentV validation should guide users away from accidental Promptfoo casing. |
| `av-sve2` | Move eval-level `defaults` and top-level `assert` toward Promptfoo-compatible slots (`default_test`, assertion `provider`, test/default options). | Promptfoo has `defaultTest` and assertion/test provider overrides, but no top-level `defaults` or suite-level `assert`. Keep `defaults.grader` only if deliberately config-level AgentV policy. |
| `av-n7ic` | Align `extensions` with Promptfoo's `file://path:function_name` contract or rename/document AgentV lifecycle hooks as AgentV-only. | AgentV validates `file://path:beforeAll`/`beforeEach`/`afterEach`/`afterAll` plus `agentv:agent-rules`; Promptfoo accepts extension function references. |
| `av-8h4l` | Prune or classify AgentV-only run-policy fields such as top-level `timeout_seconds`, `tests[].run`, and `tests[].execution`. | Promptfoo uses `evaluateOptions`, `tests[].options.repeat`, and assertion/test thresholds. AgentV has several overlapping run-policy paths. |
| `av-eniz` | Converge eval metadata and tags on Promptfoo-compatible `metadata` and `tags: Record<string,string>`. | AgentV exposes top-level `name`, `category`, `version`, `author`, `license`, `requires`, and allows tags as string/list or non-string record values. |
| `av-ij5o` | Clarify or deprecate AgentV-only authored assertion types, especially public `llm-grader`. | Conventions say public authored YAML should use `llm-rubric` for Promptfoo-compatible rubric checks, while schema still accepts `llm-grader`. |

## Divergence Table

| Field/path | AgentV behavior | Promptfoo equivalent | Recommendation | Sources |
| --- | --- | --- | --- | --- |
| `providers` | Accepts strings and objects with `id`, `label`, `config`, `runtime`, `prompts`, `transform`, `delay`, `env`, `environment`, `hooks`; rejects old `targets`. | `ProvidersSchema` accepts string, provider function, array items, provider maps, and `ProviderOptions` with `id`, `label`, `config`, `prompts`, `transform`, `delay`, `env`, `inputs`. | Modify. Add provider maps and `inputs`; keep `runtime`/provider-local overlays only as explicit AgentV extensions. | AgentV schema lines 663-700; Promptfoo `src/validators/providers.ts` lines 15-24, 80-91. |
| `targets` / `target` | Hard-rejected in authored eval YAML with migration to `providers`. Internal artifacts still use target vocabulary. | Promptfoo `UnifiedConfigSchema` still accepts `targets` as an alias and rewrites it to `providers`. | Keep AgentV rejection. This is a cleaner greenfield choice and already matches product vocabulary. | AgentV schema lines 984-995; Promptfoo `src/types/index.ts` lines 1318-1338; `CONCEPTS.md` lines 7-12. |
| Provider `label` vs `id` | `id` is backend/spec; `label` is stable AgentV identity. | Promptfoo provider options have both `id` and `label`; CLI matching checks id then label. | Keep. This is compatible and well documented. | `CONCEPTS.md` lines 7-15; Promptfoo load lines 134-180. |
| `defaults.provider` / `defaults.grader` | Eval YAML can select default candidate/grader providers. | No Promptfoo top-level `defaults`; Promptfoo uses `defaultTest.provider`, `tests[].provider(s)`, assertion `provider`, and CLI/runtime options. | Modify. Prefer Promptfoo-compatible slots in eval YAML; keep config-level `defaults.grader` only if intentional AgentV runner policy. | AgentV schema lines 882-891, 963-970; parser lines 1943-1965; Promptfoo test/assert lines 859-889, 709-735. |
| `graders` | Hard-rejected; graders are providers selected by defaults/options/assertion provider. | No separate Promptfoo `graders` list. | Keep rejection. | AgentV validator lines 291-344; `CONCEPTS.md` line 15. |
| `environment` | Inline or `file://` host/Docker testbed recipes at suite/test/provider scope. | No Promptfoo normal-eval equivalent. | Keep as AgentV extension. Export host/filesystem subset only; Docker should fail clearly until a faithful boundary exists. | AgentV schema lines 520-606, 1007; `CONCEPTS.md` lines 37-45; parity docs lines 81-82. |
| `ref://` / `refs` | `default_test` can resolve `ref://name` via `.agentv/config.yaml` refs. | Promptfoo supports file refs and JSON schema dereferencing, not AgentV `ref://`. | Keep as AgentV composition exception, but keep it field-local. | Parser lines 580-669; config loader refs search showed `ReferenceMap` in config-loader. |
| `experiment` | Top-level string accepted and normalized into run grouping. | No Promptfoo config field; Promptfoo has `tags` and `metadata`. | Remove-hard-deprecate. Use `tags.experiment` or CLI `--experiment`. | AgentV schema line 998; parser lines 1465-1467, 1911-1929; `CONCEPTS.md` lines 33-35; docs next experiments lines 207-210. |
| `tags` | Accepts array/list selection form or record with string/number/boolean values; map feeds run metadata. | `tags: Record<string,string>`. | Modify. Keep map form as canonical; decide whether selection list belongs in eval YAML. Normalize values to strings if retained. | AgentV schema lines 917-920; parser lines 1967-1994; Promptfoo `src/types/index.ts` lines 1162-1165. |
| `metadata` and top-level metadata fields | Validator knows `metadata`; schema also exposes top-level `name`, `category`, `version`, `author`, `license`, `requires`. | Promptfoo has top-level `metadata` and `description`; no top-level `name/category/version/author/license/requires`. | Modify. Move nonessential fields under `metadata` or remove; keep artifact-derived category/name outside Promptfoo-compatible authoring if needed. | AgentV schema lines 929-942; Promptfoo `src/types/index.ts` lines 1249-1250. |
| `default_test` | Inline object or `file://`/`ref://`; inherits vars/provider/providers/prompts/assert/options/threshold/metadata. | `defaultTest`, inline object or `file://`; inherits TestCase fields. | Keep native `snake_case`; map to/from Promptfoo `defaultTest` in import/export/transpile. Semantics mostly align; `ref://` remains AgentV composition sugar. | AgentV schema lines 742-759, 1006; Promptfoo lines 1201-1209. |
| `evaluate_options` | `budget_usd`, `max_concurrency`, `cache`, `delay`, `generate_suggestions`, `repeat`, `timeout_ms`, `max_eval_time_ms`, `filter_range`. | `evaluateOptions` with `cache`, `delay`, `generateSuggestions`, `suggestionsCount`, `maxConcurrency`, `repeat`, `timeoutMs`, `maxEvalTimeMs`, `filterRange`, plus internal/runtime fields. | Keep native `snake_case`; map to/from Promptfoo `evaluateOptions` in import/export/transpile. Add missing `suggestions_count` only if AgentV supports it; avoid top-level duplicates. | AgentV schema lines 761-773; validator lines 1761-1827; Promptfoo lines 259-304. |
| Wire-format casing | Promptfoo config uses camelCase fields such as `defaultTest` and `evaluateOptions`. | AgentV YAML, JSONL, artifacts, and CLI JSON use `snake_case`; internal TypeScript uses `camelCase`. | Keep settled AgentV boundary. Native AgentV eval YAML remains `snake_case`; Promptfoo import/export/transpile must translate to Promptfoo `camelCase` where required. | `.agents/conventions.md`; Promptfoo lines 259-304, 1201-1247. |
| Top-level `timeout_seconds` | Accepted/documented as optional per-case timeout. | Promptfoo uses `evaluateOptions.timeoutMs` for per provider/test timeout and `maxEvalTimeMs` for whole eval. | Remove/modify. Prefer `evaluate_options.timeout_ms`; reserve CLI/operator timeout flags for process control. | AgentV schema line 1002; docs next eval-files lines 180-183; Promptfoo lines 284-295. |
| Top-level `threshold` | Suite quality gate. | Promptfoo has assertion/test/defaultTest thresholds, not top-level suite threshold in `TestSuiteConfigSchema`. | Keep only as explicit AgentV CI gate or move to a future gate policy. Do not describe it as Promptfoo-compatible. | AgentV schema line 1005; parser lines 1897-1929; Promptfoo test/assert threshold lines 720-724, 917-918. |
| Top-level `assert` | Suite assertions appended to each test unless skipped. | Promptfoo puts inherited assertions in `defaultTest.assert`. | Modify/remove. Prefer `default_test.assert`. | AgentV schema lines 1017-1019; parser lines 672-685; Promptfoo lines 1201-1209. |
| `extensions` | Array of `file://path:beforeAll` hook refs plus AgentV `agentv:agent-rules`. | Array of `file://path:function_name` extension refs. | Modify or reclassify. Do not claim Promptfoo extension compatibility until the same string shape is accepted or exported. | AgentV schema lines 427-479, 1013; Promptfoo lines 1246-1247 and generated docs. |
| `providerPromptMap` / `provider_prompt_map` | Rejected with migration to `providers`. | Promptfoo supports `providerPromptMap` in resolved suite and prompt loading. | Keep rejection if product prefers explicit composition; document as deliberate Promptfoo divergence. | AgentV schema lines 952-961; Promptfoo `src/types/index.ts` lines 797-803 and load usage around 1012-1014. |
| Direct `input`, `expected_output`, `provider_output` | Rejected in authored YAML; users put data in vars and assertions. | Promptfoo tests can use `providerOutput`; expected data normally lives in assertion values or vars. | Mostly keep, but document `providerOutput` rejection as AgentV replay/deterministic-provider policy. | AgentV schema lines 943-948, 796-825; Promptfoo test lines 875-879. |
| `tests[].id` | Optional stable test identity used for run artifacts and selection. | Promptfoo `TestCaseSchema` has no explicit `id` field; metadata can carry arbitrary data. | Keep as AgentV artifact identity extension, but export should map or preserve via metadata if Promptfoo cannot validate it. | AgentV schema line 790; Promptfoo test lines 859-923. |
| `tests[].run` / `tests[].execution` | Per-test run overrides and execution controls such as repeat, budget, timeout, skip defaults. | Promptfoo uses `tests[].options.repeat`, `threshold`, and defaultTest/assertion structure. | Modify/remove unless a specific AgentV-only runner policy is documented. | AgentV schema lines 709-740, 803-805; validator lines 1320-1385. |
| Conversation fields (`turns`, `conversation_id`, `depends_on`, `mode`, `aggregation`, `window_size`) | AgentV-specific multi-turn/conversation orchestration. | No direct Promptfoo normal-eval equivalent in inspected schema. | Needs decision. Keep only if this is core to AgentV agent-workflow evals; otherwise push to examples/plugins or map through Promptfoo-compatible vars/prompts. | AgentV schema lines 807-815; Promptfoo test lines 859-923. |
| Assertions | AgentV accepts implemented Promptfoo overlap plus AgentV types (`script`, `field-accuracy`, `token-usage`, `execution-metrics`) and still accepts `llm-grader`. Unsupported Promptfoo trace assertions hard-error. | Promptfoo supports many assertion types, including `llm-rubric`, `agent-rubric`, `javascript`, `python`, `webhook`, trajectory types, and many NLP/security-specific types. | Keep subset with hard errors for unsupported Promptfoo types, but deprecate or justify `llm-grader` as authored YAML. Document AgentV-only assertion types as extensions. | AgentV schema lines 190-356; types lines 179-214; validator lines 2685-2744; Promptfoo lines 595-735. |
| SDK authoring | `defineAssertion()`/`defineScriptGrader()` create AgentV assertion/grader extensions. | Promptfoo custom code assertions use `javascript`, `python`, `webhook`, provider packages, and extension mechanisms. | Keep as AgentV extension, but avoid leaking SDK terminology into Promptfoo-compatible YAML examples unless the example needs AgentV-only scoring. | Parity docs lines 76-77; AgentV registry/discovery references inspected by `rg`. |

## Fields Already Correctly Removed

These should stay removed/rejected rather than reintroduced for Promptfoo parity:

- `target` / `targets` as authored AgentV YAML, despite Promptfoo's `targets`
  alias in `UnifiedConfigSchema`.
- `graders` as a separate top-level entity.
- `repeat`, `runs`, `early_exit`, and top-level `budget_usd`.
- `imports` as a wrapper/import table.
- `policy` and top-level `execution`.
- `preprocessors` / `postprocess` in favor of `transform`.
- `providerPromptMap` unless the product deliberately wants Promptfoo's provider
  to prompt-subset map.

## Open Product Decisions

1. Should `defaults.grader` exist in eval YAML, or only in project/provider
   config where AgentV owns provider-catalog policy?
2. Are AgentV conversation orchestration fields core authoring primitives, or
   should they be represented through Promptfoo-compatible prompts/tests/vars
   plus AgentV run artifacts?
3. Should top-level suite `threshold` become an explicit AgentV gate policy
   object later, or remain a minimal scalar CI gate?
