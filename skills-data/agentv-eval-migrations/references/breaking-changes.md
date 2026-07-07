# AgentV Eval YAML Breaking Changes From v4.42.4

This reference is for migrating eval YAML authored against AgentV v4.42.4 to
the current schema. It is intentionally migration-specific: each section states
the v4.42.4-era shape, the current shape, migration steps, verification, and
compatibility notes.

Evidence audited for this guide:

- v4.42.4 docs under `apps/web/src/content/docs/docs/v4.42.4/`.
- Current docs under `apps/web/src/content/docs/docs/next/`.
- v4.42.4 source from the local `v4.42.4` git tag.
- Current parser, validator, and schema code in `packages/core/src/evaluation/`.

Use the current clone as the final source of truth. Do not claim a migration is
required only because the current docs prefer a newer convention; require it
only when the current schema, validator, or loader rejects the old shape or the
old shape no longer means the same thing.

## Quick Migration Checklist

For a v4.42.4-era eval:

1. Move top-level `execution.target` to top-level `target`.
2. Move top-level `execution.targets` to top-level `targets`, and rename target
   object `name` to `id`.
3. Rename suite/test/turn `assertions` to `assert`.
4. If a test uses `tests[].execution.assertions` or
   `tests[].execution.evaluators`, rename that nested list to
   `tests[].execution.assert`; prefer top-level or per-test `assert` for normal
   grader authoring.
5. Replace `type: rubrics` or `type: rubric` with `type: llm-rubric` and move
   rubric arrays from `criteria`/`rubrics` to `value`.
6. Replace `type: code-grader` and `type: code-judge` with `type: script`.
7. Move repeat/trial policy from `execution.trials` to
   `evaluate_options.repeat`.
8. Move suite budget from `execution.budget_usd` to
   `evaluate_options.budget_usd`.
9. Move authored suite concurrency from `execution.workers` or
   `execution.max_concurrency` to `evaluate_options.max_concurrency`, or leave
   it to `--workers` / project config if it is operator policy.
10. Remove top-level `execution`; current eval YAML rejects it.
11. Move authored coding-agent testbed setup from public `workspace` fields to
    `environment`.
12. Remove `workspace.mode` and `workspace.path` from committed eval YAML.
    Use `--workspace-path` or `.agentv/config.local.yaml` for local static
    directories.
13. Move lifecycle hooks to top-level `extensions`.
14. Put reset policy and portable testbed setup under `environment`; keep
    provider environment overrides under top-level `env`.
15. Replace authored `preprocessors` and deprecated Promptfoo `postprocess`
    with `transform` at `default_test.options`, `tests[].options`, or the
    assertion that needs the shaped output.
16. Replace `type: skill-trigger` with `skill-used` or `not-skill-used`.
17. Replace `type: tool-trajectory` with Promptfoo-compatible `trajectory:*`
    assertions where there is a direct mapping.
18. Keep raw cases under `tests` / `tests: file://...`; run full eval suites
    directly with CLI multi-file selection and tags.
19. Move authored prompt input from top-level or `tests[].input` into
    `prompts` plus `tests[].vars.input`.
20. Move authored reference answers from sibling `expected_output` into
    `vars.expected_output`; add or keep an explicit assertion that consumes it.
21. Rewrite target env interpolation from `${{ NAME }}` to `{{ env.NAME }}`.
22. Remove `use_target`, `eval_cases`, `evalcases`, `providerPromptMap`, and
    `provider_prompt_map`; current AgentV rejects them.
23. Validate with `bun apps/cli/src/cli.ts validate <eval-file>`.

## Assertions Renamed To `assert`

### v4.42.4 Shape

v4.42.4 docs and schema used `assertions` for suite-level and per-test graders:

```yaml
assertions:
  - name: correctness
    type: llm-rubric
    prompt: ./graders/correctness.md

tests:
  - id: addition
    criteria: Correctly calculates 15 + 27 = 42
    input: What is 15 + 27?
    expected_output: "42"
    assertions:
      - type: contains
        value: "42"
```

v4.42.4 also accepted `execution.assertions`, `execution.evaluators`, and
case-level `evaluators` as legacy grader lists.

### Current Shape

Current eval YAML uses `assert`:

```yaml
assert:
  - name: correctness
    type: llm-rubric
    prompt: ./graders/correctness.md

tests:
  - id: addition
    input: What is 15 + 27?
    expected_output: "42"
    assert:
      - type: contains
        value: "42"
      - Correctly calculates the answer
```

Current `EvalFileSchema` has top-level `assert` and test-level `assert`; it
does not define top-level or test-level `assertions`. Current parser code reads
case `assert` and `execution.assert`; assertion template files are expected to
contain top-level `assert`.

### Migration Steps

- Rename top-level `assertions:` to `assert:`.
- Rename every test-level `assertions:` to `assert:`.
- Rename conversation turn `assertions:` to `assert:`.
- Rename assertion template files from:

  ```yaml
  assertions:
    - type: is-json
  ```

  to:

  ```yaml
  assert:
    - type: is-json
  ```

- Replace `evaluators:` with `assert:`.
- If a test had `execution.skip_defaults: true`, keep it; that flag still
  controls whether suite-level defaults are appended.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "assertions:|evaluators:" path/to/evals path/to/.agentv/templates
```

### Compatibility Notes

Result artifacts and grader stdout still contain `assertions` arrays. Do not
rename result JSON or script-grader output fields to `assert`; this migration is
for authored eval YAML and assertion template YAML.

`criteria` remains a valid optional case field, but it is no longer the
preferred way to express the whole semantic contract. Put actual grading checks
in `assert`, usually as plain strings.

## `criteria` Is Optional, Reference Answers Live In Vars

### v4.42.4 Shape

v4.42.4 docs treated `criteria` as required. Older AgentV YAML also allowed
`expected_output` as a sibling field on test cases:

```yaml
tests:
  - id: simple-eval
    criteria: Assistant correctly explains the bug and proposes a fix
    input: "Debug this function..."
    expected_output: The answer explains the root cause and fix.
```

### Current Shape

Current docs and schema make `criteria` optional. Authored graders live under
`assert`. Plain strings in `assert` become an `llm-rubric` check.
Promptfoo-aligned reference answers live in `vars.expected_output`, and only
affect grading when an explicit assertion consumes them.

```yaml
default_test:
  assert:
    - type: llm-rubric
      value: "Matches the reference answer: {{ expected_output }}"
prompts:
  - "{{ input }}"
tests:
  - id: simple-eval
    vars:
      input: "Debug this function..."
      expected_output: The answer explains the root cause and fix.
```

### Migration Steps

- If old `criteria` is the only grading contract, move or copy it into
  `assert` as one or more plain strings.
- Keep `criteria` only when multiple graders need shared context that is not
  itself the asserted checklist.
- Move `tests[].expected_output` or `default_test.expected_output` to
  `vars.expected_output`.
- Add or keep an explicit assertion strategy. Use `llm-rubric` with
  `{{ expected_output }}` for semantic reference-answer checks, or deterministic
  assertion `value: "{{ expected_output }}"` when the grader type compares a
  concrete value.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "expected_output:" path/to/evals
```

For any remaining `criteria`, confirm it is shared grader context and not a
duplicate of `assert`.

### Compatibility Notes

Current runtime still carries `EvalTest.criteria` internally because prompt
templates and custom graders can consume it. The breaking authoring change is
that workers should not depend on missing `assert` plus `criteria` to define
the whole grading contract for new migrated YAML.

## `skill-trigger` And `tool-trajectory` Replaced By Promptfoo Assertions

### v4.42.4 Shape

Older AgentV YAML used AgentV-specific skill and tool trajectory assertions:

```yaml
assert:
  - type: skill-trigger
    skill: csv-analyzer
    should_trigger: true
  - type: tool-trajectory
    mode: any_order
    minimums:
      search: 2
  - type: tool-trajectory
    mode: exact
    expected:
      - tool: search
        args:
          q: agentv
      - tool: fetch
```

### Current Shape

Current authored eval YAML uses Promptfoo-compatible assertions:

```yaml
assert:
  - type: skill-used
    value: csv-analyzer
  - type: trajectory:tool-used
    value:
      name: search
      min: 2
  - type: trajectory:tool-sequence
    value:
      mode: exact
      steps: [search, fetch]
  - type: trajectory:tool-args-match
    value:
      name: search
      args:
        q: agentv
      mode: partial
```

### Migration Steps

- Replace `type: skill-trigger`, `skill: X`, `should_trigger: true` with
  `type: skill-used`, `value: X`.
- Replace `type: skill-trigger`, `skill: X`, `should_trigger: false` with
  `type: not-skill-used`, `value: X`.
- Replace `type: tool-trajectory`, `mode: any_order`, and `minimums: { Tool: N }`
  with one `trajectory:tool-used` assertion per tool:

  ```yaml
  - type: trajectory:tool-used
    value:
      name: Tool
      min: N
  ```

- Replace `mode: in_order` or `mode: exact` plus `expected` tool steps with
  `trajectory:tool-sequence`:

  ```yaml
  - type: trajectory:tool-sequence
    value:
      mode: exact
      steps: [search, fetch]
  ```

- Move old `expected[].args` checks to `trajectory:tool-args-match`. Use
  `mode: exact` only for exact argument equality; otherwise use Promptfoo's
  partial argument matching.
- Do not carry old `max_duration_ms` per-tool latency checks under
  `trajectory:*`. There is no Promptfoo-compatible equivalent in AgentV yet;
  use a `script` assertion or track the behavior as future scope.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "skill-trigger|tool-trajectory" path/to/evals path/to/.agentv/templates
```

### Compatibility Notes

The runtime still has private compatibility classes and tests for older
helpers. That does not make `skill-trigger` or `tool-trajectory` valid authored
eval YAML. Normal Promptfoo-aligned eval files fail validation and parsing with
the replacement guidance above.

## Authored `input` Moved To `prompts` Plus Vars

### v4.42.4 Shape

Older AgentV eval YAML allowed top-level `input` and inline `tests[].input` as
the public task authoring surface:

```yaml
input: Read AGENTS.md before answering.

tests:
  - id: addition
    input: What is 15 + 27?
    assert:
      - type: contains
        value: "42"
```

### Current Shape

Current normal eval YAML uses top-level `prompts` rendered with
`default_test.vars` and `tests[].vars`:

```yaml
prompts:
  - - role: system
      content: "{{ system_instruction }}"
    - role: user
      content: "{{ question }}"

default_test:
  vars:
    system_instruction: Read AGENTS.md before answering.

tests:
  - id: addition
    vars:
      question: What is 15 + 27?
    assert:
      - type: contains
        value: "42"
```

### Migration Steps

- Replace simple top-level `input: <text>` with a prompt entry or
  `default_test.vars.system_instruction` rendered from a chat prompt.
- Replace simple `tests[].input: <text>` with `tests[].vars.input: <text>` and
  a top-level prompt such as `"{{ input }}"` or `"{{ vars.input }}"`.
- Replace message-array input with a top-level chat prompt entry. Move any
  per-row values into `tests[].vars` and render them from the message content.
- Replace `input_files` plus string input with a chat prompt content array that
  contains `{type: file, value: "{{ file_path }}"}` and a text block. Store file
  paths in `default_test.vars` or `tests[].vars`.
- Keep `input` only in external raw-case files imported through
  `tests: file://...` when preserving existing raw datasets.
  Do not copy that compatibility shape back into normal eval YAML.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "^[[:space:]]*input:|input_files:" path/to/evals
```

### Compatibility Notes

The runtime `EvalTest.input` representation remains internal after prompts are
rendered. External raw-case loaders may still ingest `input` rows for imported
datasets, but authored eval YAML now hard-errors on top-level `input` and inline
`tests[].input`.

## Top-Level `execution` Removed From Eval YAML

### v4.42.4 Shape

v4.42.4 docs used top-level `execution` for target selection, workers, error
tolerance, thresholds, budgets, trials, and suite-level graders:

```yaml
execution:
  target: azure-base
  workers: 4
  fail_on_error: false
  threshold: 0.8
  budget_usd: 2.00
  trials:
    count: 3
    strategy: pass_at_k

assertions:
  - type: contains
    value: READY
```

### Current Shape

Current eval YAML rejects top-level `execution`. Move run controls to their
dedicated fields:

```yaml
target: azure-base
threshold: 0.8
evaluate_options:
  max_concurrency: 4
  budget_usd: 2.00
  repeat:
    count: 3
    strategy: pass_any

assert:
  - type: contains
    value: READY
```

### Migration Steps

- `execution.target` -> top-level `target`.
- `execution.targets` -> top-level `targets`.
- `execution.threshold` -> top-level `threshold`.
- `execution.budget_usd` -> `evaluate_options.budget_usd`.
- `execution.workers` and `execution.max_concurrency` ->
  `evaluate_options.max_concurrency` when authored suite concurrency is part of
  the eval. If it is operator policy, use `--workers` or `.agentv/config.yaml`
  / `agentv.config.*` `execution.max_concurrency` instead.
- `execution.fail_on_error` has no current eval-YAML home. Treat it as
  operational policy; do not commit it into migrated eval YAML.
- `execution.cache` has no current eval-YAML home. Use project/operator config
  if cache policy is needed.
- Delete top-level `execution` after moving supported fields.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "^execution:|fail_on_error:|cache:" path/to/evals
```

### Compatibility Notes

Per-test `execution` still exists, but it is narrow: current schema allows
case-level `execution.assert`, `skip_defaults`, cache/fail fields, budget, and
threshold, while target selection belongs at top level or CLI. Do not keep
target selection under `tests[].execution.target` when migrating.

## Repeat Policy Replaces `trials`, `runs`, And `early_exit`

### v4.42.4 Shape

v4.42.4 used `execution.trials` with strategies such as `pass_at_k`:

```yaml
execution:
  trials:
    count: 3
    strategy: pass_at_k
    cost_limit_usd: 1.00
```

Some stale evals from later intermediate branches may instead have top-level
`runs`, `repeat`, or `early_exit`.

### Current Shape

Current authoring uses `evaluate_options.repeat`:

```yaml
evaluate_options:
  repeat:
    count: 3
    strategy: pass_any
    early_exit: true
    cost_limit_usd: 1.00
```

The shorthand is also accepted:

```yaml
evaluate_options:
  repeat: 3
```

### Migration Steps

- `execution.trials.count` -> `evaluate_options.repeat.count`.
- `execution.trials.strategy: pass_at_k` -> `pass_any`.
- `execution.trials.strategy: mean` -> `mean`.
- `execution.trials.strategy: confidence_interval` -> `confidence_interval`.
- `execution.trials.cost_limit_usd` -> `evaluate_options.repeat.cost_limit_usd`.
- Top-level `runs` -> `evaluate_options.repeat.count`.
- Top-level `repeat` -> `evaluate_options.repeat`.
- Top-level `early_exit` -> `evaluate_options.repeat.early_exit`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "trials:|pass_at_k|^runs:|^repeat:|^early_exit:" path/to/evals
```

### Compatibility Notes

Runtime types and some result artifacts still use the internal word `trials`.
Authored YAML should use `repeat`; produced executions are attempts.

## `experiment` Is A Label, Not A Runtime Container

### v4.42.4 Shape

v4.42.4 public eval docs did not use a top-level `experiment` object for eval
runtime policy; runtime policy lived mostly under top-level `execution`. Some
stale evals from later development snapshots may have an object like:

```yaml
experiment:
  target: codex
  model: gpt-5
  runs: 3
  timeout_seconds: 600
```

### Current Shape

Current schema accepts top-level `experiment` only as a non-empty string run
grouping label. Current docs also support promptfoo-shaped `tags.experiment`.

```yaml
experiment: with-skills
target: codex
timeout_seconds: 600
evaluate_options:
  repeat:
    count: 3
    strategy: pass_any
```

or:

```yaml
tags:
  experiment: with-skills
target: codex
```

### Migration Steps

- If `experiment` is an object, move runtime fields out:
  - target identity -> top-level `target` or `targets`
  - repeat/runs -> `evaluate_options.repeat`
  - budget -> `evaluate_options.budget_usd`
  - timeout -> top-level `timeout_seconds`
  - threshold -> top-level `threshold`
- Keep only a string label in `experiment`, or use `tags.experiment`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "^experiment:" path/to/evals
```

### Compatibility Notes

Do not describe a v4.42.4 eval as if `experiment:` was already the main runtime
object unless you verified that exact file or commit. For v4.42.4 migrations,
the common source shape is `execution:`.

## Workspace Lifetime: `isolation` To `scope`

### v4.42.4 Shape

v4.42.4 workspace docs used `isolation`:

```yaml
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: main
  hooks:
    after_each:
      reset: fast
  isolation: shared       # shared | per_test
```

### Current Shape

Current workspace docs and schema use `scope`:

```yaml
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: main
  hooks:
    after_each:
      reset: fast
  scope: suite            # suite | attempt
```

### Migration Steps

- `workspace.isolation: shared` -> `workspace.scope: suite`.
- `workspace.isolation: per_test` -> `workspace.scope: attempt`.
- If `isolation` is omitted, preserve behavior by omitting `scope` or setting
  `scope: suite`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "isolation:" path/to/evals
```

### Compatibility Notes

`scope: attempt` means a clean workspace for each resolved execution attempt:
prompt/target/test/repeat expansion. Docker configuration does not replace
workspace lifetime; use `workspace.scope` even when `workspace.docker` exists.

## Local Workspace Modes Removed From Eval YAML

### v4.42.4 Shape

v4.42.4 workspace docs allowed `mode` and `path`:

```yaml
workspace:
  mode: static            # pooled | temp | static
  path: /tmp/my-ws
```

### Current Shape

Current committed eval YAML must keep portable workspace setup under
`workspace` and put machine-local existing directories outside the eval:

```yaml
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: main
  scope: suite
```

One-off local binding:

```bash
bun apps/cli/src/cli.ts eval path/to/eval.eval.yaml --workspace-path /tmp/my-ws
```

Persistent local binding:

```yaml
# .agentv/config.local.yaml
execution:
  workspace_path: /tmp/my-ws
```

### Migration Steps

- Remove `workspace.mode`.
- Remove `workspace.path`, `workspace.static_path`, `workspace.static`, and
  `workspace.pool` if present.
- Convert portable setup to `workspace.template`, `workspace.repos`,
  `workspace.hooks.after_each.reset`, `workspace.env`, and `workspace.scope`.
- Put existing local paths in `--workspace-path` or `.agentv/config.local.yaml`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "workspace:|mode:|path:|static_path:|pool:" path/to/evals
```

Inspect matches manually because `repos[].path` is still valid.

### Compatibility Notes

Current project config intentionally strips `execution.workspace_path` from
committed `.agentv/config.yaml`; it is only supported in `config.local.yaml`.

## Workspace Hooks And Lifecycle Extensions

### v4.42.4 Shape

v4.42.4 workspace hooks allowed `command` and `script` fields, and docs used
workspace hooks for executable setup:

```yaml
workspace:
  hooks:
    before_all:
      script: ["bun", "run", "setup.ts"]
    after_each:
      command: ["bun", "run", "reset.ts"]
      reset: fast
```

### Current Shape

Current hook configs reject `script`; use `command`. Current docs prefer
top-level `extensions` for executable setup and keep
`workspace.hooks.after_each.reset` for reset policy:

```yaml
extensions:
  - file://scripts/setup.mjs:beforeAll

workspace:
  hooks:
    after_each:
      reset: fast
```

Legacy command hooks still parse for existing suites when they use `command`:

```yaml
workspace:
  hooks:
    before_all:
      command: ["bun", "run", "setup.ts"]
```

### Migration Steps

- Rename any hook `script:` field to `command:`.
- Prefer moving setup/fixture/build/install commands to top-level
  `extensions`.
- Keep `workspace.hooks.after_each.reset` for `none`, `fast`, or `strict`.
- Extension file references must use `file://path/to/hook.ts:beforeAll` style
  and a Promptfoo-compatible hook name: `beforeAll`, `beforeEach`,
  `afterEach`, or `afterAll`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "script:|extensions:" path/to/evals
```

### Compatibility Notes

`workspace.hooks` and `target.hooks` use snake_case lifecycle keys such as
`before_all`; top-level `extensions` use Promptfoo-compatible camel-case hook
suffixes in `file://...:beforeAll`.

## Repository Entries Are Provenance Only

### v4.42.4 Shape

v4.42.4 documented `workspace.repos[].repo`, `commit`, `base_commit`,
`ancestor`, and `sparse` as repo provenance. Treat `base_commit` as a legacy
authoring alias during migration; normalize it to `commit` instead of carrying
it forward. The v4.42.4 parser rejected some acquisition fields such as
`source`, `checkout`, and `clone`.

### Current Shape

Current parser continues to keep acquisition out of eval YAML and additionally
rejects `type`, `resolve`, and `resolver`:

```yaml
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: abc123def
      ancestor: 1
      sparse:
        - packages/core
```

### Migration Steps

- `workspace.repos[].source` -> `workspace.repos[].repo`.
- `workspace.repos[].checkout.ref` or similar -> `commit`.
- `workspace.repos[].base_commit` -> `commit`.
- `workspace.repos[].clone.sparse` -> top-level `sparse`.
- Remove `type`, `resolve`, and `resolver` from repo entries.
- Configure acquisition policy in repo resolver/project config, not in eval
  YAML.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "source:|checkout:|clone:|base_commit:|type:|resolve:|resolver:" path/to/evals
```

Inspect `type:` matches manually because grader entries still use `type`.

### Compatibility Notes

`repos[].path` remains valid and means the target directory inside the
materialized workspace. It is not the removed local `workspace.path`.
Current eval YAML accepts a single checkout pin field, `commit`, so workers
should not preserve a second spelling in examples or generated evals.

## Target And Runtime Separation

### v4.42.4 Shape

v4.42.4 docs selected targets under `execution` and used `name` in target
objects:

```yaml
execution:
  target: azure-base
  targets:
    - baseline
    - name: with-skills
      use_target: default
      hooks:
        before_each:
          command: ["setup-plugins.sh", "skills"]
```

v4.42.4 `.agentv/targets.yaml` examples also used `name` and provider settings
as top-level target fields:

```yaml
targets:
  - name: azure-base
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}
```

### Current Shape

Current eval YAML uses top-level `target` or `targets`. Target references use
the target `id`; `provider` names the backend or adapter kind:

```yaml
target: azure-base

targets:
  - id: with-skills
    provider: codex-cli
    runtime: host
    config:
      command: ["codex", "exec", "--json"]
    hooks:
      before_each:
        command: ["setup-plugins.sh", "skills"]
```

Current `.agentv/targets.yaml` uses `id` and nests provider settings under
`config`:

```yaml
targets:
  - id: azure-base
    provider: azure
    runtime: host
    config:
      endpoint: "{{ env.AZURE_OPENAI_ENDPOINT }}"
      api_key: "{{ env.AZURE_OPENAI_API_KEY }}"
      model: "{{ env.AZURE_DEPLOYMENT_NAME }}"
```

### Migration Steps

- Eval YAML: `execution.target` -> top-level `target`.
- Eval YAML: `execution.targets` -> top-level `targets`.
- Eval target object `name` -> `id`.
- If an eval-local target object has provider configuration, include a concrete
  `provider`; `id` is AgentV's stable target identity and `provider` names the
  backend or adapter kind.
- Targets file: rename `name` to `id`, move provider-specific settings into
  `config`, and rewrite environment references from `${{ NAME }}` to
  `{{ env.NAME }}`.
- Remove `use_target`; current authored target definitions must resolve to
  concrete provider objects.
- Keep supported AgentV target extensions such as `grader_target`,
  `fallback_targets`, `workers`, and `batch_requests` as top-level fields on
  target objects.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
bun apps/cli/src/cli.ts validate .agentv/targets.yaml
rg -n "execution:|name:|use_target:|\\$\\{\\{|endpoint:|api_key:|model:" path/to/evals .agentv/targets.yaml
```

Inspect `name:`, top-level provider fields, and `${{ ... }}` matches manually
because grader names, non-target YAML, and historical examples can still use
similar strings legitimately.

### Compatibility Notes

Do not put target selection in test cases when migrating. Split
target-specific cases into separate eval suites, use tags/filters, or run the
same eval with different `--target` values.

## Grader Type And Rubric Shape Changes

### v4.42.4 Shape

v4.42.4 docs used:

```yaml
assertions:
  - type: rubrics
    criteria:
      - id: accuracy
        outcome: Correctly identifies the denied party
        weight: 5

  - type: code-grader
    command: ["python", "check.py"]
```

v4.42.4 accepted snake_case grader types such as `is_json`.

### Current Shape

Current authored grader types are kebab-case. Semantic rubric grading uses
plain assertion strings or `llm-rubric`:

```yaml
assert:
  - type: llm-rubric
    value:
      - id: accuracy
        outcome: Correctly identifies the denied party
        weight: 5

  - type: script
    command: ["python", "check.py"]
```

### Migration Steps

- `type: rubrics` or `type: rubric` -> `type: llm-rubric`.
- `criteria:` / `rubrics:` / `rubric_item:` under `llm-rubric` ->
  `value:`.
- `type: g-eval` -> `type: llm-rubric`.
- `type: code-grader`, `code-judge`, `code_grader`, or `code_judge` ->
  `type: script`.
- `type: llm_judge` or `llm_grader` -> `type: llm-rubric`.
- Convert multi-word snake_case deterministic types to kebab-case:
  `is_json` -> `is-json`, `contains_all` -> `contains-all`,
  `starts_with` -> `starts-with`, and so on.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "type: (rubrics|rubric|g-eval|code-grader|code-judge|code_grader|code_judge|llm_judge|llm_grader|.*_.*)" path/to/evals
```

### Compatibility Notes

Current `grader-parser.ts` contains replacement hints for several removed type
names, but current schema and generated references are stricter than v4.42.4.
Migrate authored YAML instead of relying on parser leniency.

Script grader output still returns JSON with an `assertions` array; do not
rename grader output to `assert`.

## Prompt File Paths And `file://`

### v4.42.4 Shape

v4.42.4 LLM grader docs allowed both:

```yaml
assertions:
  - type: llm-rubric
    prompt: ./graders/correctness.md
  - type: llm-rubric
    prompt: file://graders/correctness.md
```

### Current Shape

Current LLM grader docs keep the same prompt path behavior:

```yaml
assert:
  - type: llm-rubric
    prompt: ./graders/correctness.md
  - type: llm-rubric
    prompt: file://graders/correctness.md
```

Other current file-reference surfaces are stricter:

```yaml
extensions:
  - file://scripts/setup.mjs:beforeAll

default_test: file://defaults.yaml

tests:
  - file://cases.yaml
```

### Migration Steps

- Do not add `file://` to ordinary `prompt: ./path.md` only for migration; the
  current prompt resolver still treats path-like strings as file references.
- Keep `file://` when you need explicit file-reference resolution.
- Add `file://` for top-level `extensions` entries.
- Use `file://` or `ref://` for `default_test` string references.
- In `tests` arrays, use `file://...` for file include entries. A top-level
  `tests: ./cases.yaml` string remains accepted for raw case files.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "prompt:|extensions:|default_test:|file://" path/to/evals
```

### Compatibility Notes

This is partly a non-breaking area: v4.42.4 and current docs both allow
relative prompt paths. The breaking part is the newer surfaces that require
`file://`, especially `extensions`.

## Imports, Raw Cases, And Suite Ownership

### v4.42.4 Shape

v4.42.4 eval files used `tests` for inline cases or external raw case files:

```yaml
name: my-eval
execution:
  target: default
tests: ./cases.yaml
```

The external file contained raw case rows.

### Current Shape

Current eval YAML accepts inline `tests`, `tests: ./cases.yaml`, and field-local
file refs for raw case data. Run multiple full eval suites directly with CLI
selection and tags:

```yaml
prompts: file://../prompts/refund.yaml
default_test: file://../defaults/refund.yaml
tests:
  - file://../cases/refund-smoke.cases.yaml
  - id: local-edge-case
    vars:
      question: Can a final-sale item be refunded after damage in transit?
    assert:
      - Explains the final-sale exception
```

### Migration Steps

- Keep `tests: ./cases.yaml` when the file is a raw case array, JSONL, CSV,
  directory, glob, or script-backed dataset.
- Use `tests: file://...` or string entries inside `tests` for raw rows that run
  in the parent suite context.
- Run full eval suites directly with CLI multi-file selection and tags. Do not
  add wrapper-suite import semantics.
- Use `prompts: file://...`, `default_test: file://...`, and
  `environment: file://...` to share reusable config locally at the field that
  consumes it.
- Use `run:` on individual tests only for scoped overrides: `threshold`,
  `repeat`, `timeout_seconds`, and `budget_usd`.

### Verification

```bash
bun apps/cli/src/cli.ts validate path/to/eval.eval.yaml
rg -n "include:|tests:" path/to/evals
```

### Compatibility Notes

`eval_cases` and `evalcases` have been removed from authored eval YAML. Migrate
them to `tests` before validating or running the suite. The current convention is
that runnable suites use `*.eval.yaml`; reusable raw case files commonly use
`*.cases.yaml` or JSONL.

## Result Artifact Path Changes Are Not Eval YAML Migrations

v4.42.4 docs described local run workspaces under
`.agentv/results/runs/<experiment>/<run-id>/`. Current docs describe v2 run
workspaces under `.agentv/results/<run_id>/`, with experiment metadata stored
in `summary.json` / rows rather than inferred from the path.

Within each run bundle, the per-run index is `.internal/index.jsonl` and
`summary.json` points to it with `index_path`. Per-sample execution folders are
named `sample-N`; use row fields such as `sample_index` and `retry_index` for
semantics. New writers emit `metrics.json` for duration, tokens, cost,
execution, and trajectory data; they do not emit `timing.json`, `timing_path`,
or nested `metrics.timing`.

Do not edit eval YAML just to chase result artifact path changes. Migrate only
authored fields that the eval parser reads. Use:

```bash
bun apps/cli/src/cli.ts results validate path/to/run-dir
```

for existing run artifacts.
