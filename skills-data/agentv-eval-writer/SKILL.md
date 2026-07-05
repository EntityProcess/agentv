---
name: agentv-eval-writer
description: >-
  Write, edit, review, and validate AgentV EVAL.yaml / .eval.yaml evaluation files.
  Use when asked to create new eval files, update or fix existing ones, add or remove test cases,
  configure graders (`llm-rubric`, `script`), review whether an eval is correct or complete,
  convert between EVAL.yaml and evals.json using `agentv convert`, or generate eval test cases
  from chat transcripts (markdown conversation or JSON messages).
  Do NOT use for creating SKILL.md files, writing skill definitions, or running evals —
  running and benchmarking belongs to agentv-bench.
---

# AgentV Eval Writer

Comprehensive docs: https://agentv.dev
Promptfoo parity matrix: https://agentv.dev/docs/reference/promptfoo-parity/

## Authoring Principle

Treat YAML as the canonical portable model. Prefer authoring `.eval.yaml` / `EVAL.yaml` first, then use TypeScript helpers, Python scripts, or executable graders only when they lower to the same fields or when the evaluation logic must actually run code.

Eval files define what is tested and how it runs: prompts, datasets, assertions,
task fixtures, top-level `target`, and suite run controls. Use field-local file
refs such as `tests: file://...`, `prompts: file://...`, `default_test:
file://...`, and `environment: file://...`. String-valued `tests` and string
entries inside `tests[]` are raw-case refs for direct paths, directories, and
globs. Run several full eval suites directly with CLI multi-file selection and
tags. Use scoped `run:` on individual tests only for `threshold`, `repeat`,
`timeout_seconds`, and legacy `budget_usd`; keep target selection at top-level
`target` or CLI `--target`, put suite budget caps under
`evaluate_options.budget_usd`, authored concurrency under
`evaluate_options.max_concurrency`, suite repeat policy under
`evaluate_options.repeat`, coding-agent testbed setup under `environment`,
provider environment overrides under `env`, and lifecycle hooks under
`extensions`.

Use `@agentv/sdk` for TypeScript helper imports. Do not use `@agentv/eval` for new evals, examples, scaffolds, or skill guidance; it was a deprecated compatibility package and has been removed from this repository.

## Authoring Checklist

- Put grading criteria in `assert`, not in test-level `criteria`. Plain assertion strings become an `llm-rubric` grader.
- Prefer plain assertion strings for semantic checks when the default rubric grader can judge them. Use `type: llm-rubric` for structured criteria, custom prompts, custom grader targets, or assertion-level transforms, and `type: script` when grading must execute code.
- Write `expected_output` as a golden/reference answer the target could have produced. Do not write criteria, scoring instructions, or "the agent should..." rubric prose there.
- For historical or repo-state evals, materialize the repo through a pinned `environment` setup recipe. Mentioning a SHA only in prompt prose is not enough because the agent needs an actual checkout to inspect.

## Evaluation Types

AgentV evaluations measure **execution quality** — whether your agent or skill produces correct output when invoked.

For **trigger quality** (whether the right skill is triggered for the right prompts), see the [Evaluation Types guide](https://agentv.dev/guides/evaluation-types/). Do not use execution eval configs (`EVAL.yaml`, `evals.json`) for trigger evaluation — these are distinct concerns requiring different tooling and methodologies.

## Starting from evals.json?

If the project already has an Agent Skills `evals.json` file, use it as a starting point instead of writing YAML from scratch:

```bash
# Convert evals.json to AgentV EVAL YAML
agentv convert evals.json

# Run directly without converting (all commands accept evals.json)
agentv eval evals.json
```

The converter maps `prompt` → `input`, `expected_output` → `expected_output`, and Agent Skills `assertions` → AgentV `assert` (`llm-rubric` checks), and resolves `files[]` paths. The generated YAML includes TODO comments for AgentV features to add (workspace setup, script graders, rubrics, required gates).

After converting, enhance the YAML with AgentV-specific capabilities shown below.

## From Chat Transcript

Convert a chat conversation into eval test cases without starting from scratch.

**Input formats:**

Markdown conversation:
```
User: How do I reset my password?
Assistant: Go to Settings > Security > Reset Password...
```

JSON messages:
```json
[{"role": "user", "content": "How do I reset my password?"},
 {"role": "assistant", "content": "Go to Settings > Security > Reset Password..."}]
```

**Select exchanges that make good test cases:**
- Factual Q&A — verifiable answers
- Task completion — user requests an action, agent performs it
- Edge cases — unusual inputs, error handling, boundary conditions
- Multi-turn reasoning — exchanges where earlier context matters

**Skip:** greetings, one-word acknowledgments, repeated exchanges

**Multi-turn format** (when context from prior turns matters):
```yaml
prompts:
  - - role: user
      content: "My name is Alice"
    - role: assistant
      content: "Nice to meet you, Alice!"
    - role: user
      content: "What's my name?"

tests:
  - id: multi-turn-context
    expected_output: "Your name is Alice."
    assert:
      - Correctly recalls the user's name from earlier in the conversation
```

**Guidelines:** preserve exact wording in `expected_output`; aim for 5–15 tests per transcript; pick exchanges that test different capabilities.

## Quick Start

```yaml
description: Example eval
target: default

prompts:
  - "{{ prompt }}"

tests:
  - id: greeting
    vars:
      prompt: "Say hello"
    expected_output: "Hello! How can I help you?"
    assert:
      - Greeting is friendly and warm
      - Offers to help
```

## Eval File Structure

**Required:** `tests` (array or string raw-case path) or `scenarios`
**Optional:** `name`, `description`, `experiment`, `version`, `author`, `tags`, `license`, `requires`, `target`, `targets`, `prompts`, `default_test`, `timeout_seconds`, `evaluate_options`, `threshold`, `suite`, `environment`, `env`, `extensions`, `assert`

**Test fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `vars` | yes when the prompt needs row data | Prompt-template variables for this row |
| `expected_output` | no | Gold-standard reference answer (string shorthand or full message array) |
| `assert` | yes | Graders: deterministic checks, `llm-rubric` checks, script graders, or plain string rubric criteria |
| `execution` | no | Per-case grader/default overrides such as `skip_defaults`; target selection belongs in top-level `target` or CLI `--target` |
| `environment` | no | Per-case coding-agent testbed config (overrides suite-level) |
| `metadata` | no | Arbitrary key-value pairs passed to setup/teardown scripts |
| `conversation_id` | no | Thread grouping |

## Prompt Templates and Vars

Use top-level `prompts` plus `tests[].vars` for the Promptfoo-compatible canonical
input shape. Shared data defaults belong in `default_test.vars`; per-test
`vars` override those defaults by key. AgentV renders every prompt with each
test's merged vars, then expands the run across prompts, targets, tests, and
repeat attempts.

```yaml
description: Prompt matrix example
target: default

prompts:
  - id: support-chat
    label: Support chat
    file: ./prompts/support-chat.json
  - id: terse
    label: Terse
    prompt: "Answer for {{ audience }} in one sentence: {{ question }}"

default_test:
  vars:
    audience: users
    category: support

tests:
  - id: password-reset
    vars:
      question: How do I reset my password?
    expected_output: Password reset guidance
    assert:
      - Gives correct password reset guidance
  - id: admin-access
    vars:
      audience: admins
      question: How do I revoke a user's access?
    expected_output: Access revocation guidance
    assert:
      - Gives safe access revocation guidance
```

Prompt templates can use `{{ name }}` or `{{ vars.name }}` placeholders. Use
top-level names when matching Promptfoo-style prompt templates; use
`{{ vars.name }}` when explicit namespacing is clearer.

Do not author direct input fields in normal eval YAML. `tests[].input` and
top-level `input` are removed; write simple task text as a prompt template such
as `"{{ input }}"` or `"{{ vars.input }}"` with
`tests[].vars.input: "Summarize X"`.

`input_files` is also direct-input convenience sugar. In prompt-template suites,
model file-backed context as vars containing file paths or `file://` references,
then render those vars from the prompt template next to the input.

**Shorthand forms:**
- Prompt entries can be strings, message arrays, file references, or prompt objects.
- Put chat/system/user messages in `prompts`, not in `tests[].input`.
- `expected_output` (string/object) expands to `[{role: "assistant", content: ...}]`
- Use these canonical field names on disk; keep the wire format `snake_case`

**Message format:** `{role, content}` where role is `system`, `user`, `assistant`, or `tool`
**Content types:** inline text, `{type: "file", value: "./path.md"}`
**File paths:** relative from eval file dir, or absolute with `/` prefix from repo root
**File handling by provider type:** LLM providers receive file content inlined in XML tags. Agent providers receive a preread block with `file://` URIs and must read files themselves. See [Coding Agents > Prompt format](https://agentv.dev/targets/coding-agents#prompt-format).

**JSONL format:** One test per line as JSON. Optional `.yaml` sidecar for shared defaults. See `examples/features/basic-jsonl/`.

**Environment variables:** Use `{{ env.VAR }}` templates in authored config. Missing vars resolve to empty string. Works in eval files, external case files, and environment configs. `.env` files are loaded automatically.

## Output Transforms

Use Promptfoo-compatible `transform` when the target output needs shaping before
grading. Common cases include converting a `ContentFile` such as an `.xlsx`
spreadsheet into text before an `llm-rubric` grader runs.

```yaml
prompts:
  - "{{ input }}"

default_test:
  options:
    transform: file://scripts/transforms/xlsx-to-csv.ts

tests:
  - id: spreadsheet-output
    vars:
      input: Generate the spreadsheet report
    assert:
      - Output contains the transformed spreadsheet text including the revenue rows
```

Transform placement:

- `default_test.options.transform` applies to every test unless overridden.
- `tests[].options.transform` overrides the inherited default transform for one test.
- Assertion-level `transform` applies only to that grader, after the test/default transform.

Do not author `preprocessors` or deprecated Promptfoo `postprocess` in current
eval YAML. Use `transform` at the point that needs the shaped output.

## Metadata

When `name` is present, the suite is parsed as a metadata-bearing eval:

```yaml
name: export-screening        # required, lowercase/hyphens, max 64 chars
description: Evaluates export control screening accuracy
version: "1.0"
author: acme-compliance
tags: [compliance, agents]
license: Apache-2.0
requires:
  agentv: ">=0.30.0"
```

## Shared Prompt Context

Put shared prompt instructions in top-level `prompts` and shared data in
`default_test.vars`:

```yaml
prompts:
  - - role: system
      content: |
        Read AGENTS.md before answering.
        Explain tradeoffs clearly.
    - role: user
      content: "{{ question }}"

tests: ./cases.yaml

# cases.yaml — each raw row supplies vars.question, or a compatibility input row
# - id: test-1
#   assert:
#     - ...
#   vars:
#     question: "User question here"
```

## Tests as String Path

Point `tests` to an external file instead of inlining:

```yaml
name: my-eval
description: My evaluation suite
tests: ./cases.yaml           # relative to eval file dir
```

The external file can be YAML (array of test objects) or JSONL.

## Assert Field

`assert` defines graders at the suite level or per-test level. It is the canonical authored field for all graders:

```yaml
# Mix exact checks with rubric shorthand when both matter.
assert:
  - type: is-json
    required: true
  - type: contains
    value: "status"
  - Correctly answers the user's question
  - Explains the reasoning clearly

tests:
  - id: test-1
    input: Get status
    assert:
      - type: equals
        value: '{"status": "ok"}'
      - Explains what the status means
```

Plain strings in `assert` are rubric criteria and are the preferred shape for
qualitative agent behavior. Use deterministic assertions (`contains`, `regex`,
`is-json`, `equals`) only for exact machine-verifiable outputs, and script graders
when the check must inspect files, run commands, or validate structured state.
Do not add a separate test-level `criteria` field. Legacy evals that still use
`criteria` without explicit `assert` are loaded as a plain-string assertion for
compatibility, but new evals should author the assertion directly.

For repo-state evals, combine a pinned checkout, a golden answer, and assertion
shorthand:

```yaml
workspace:
  repos:
    - path: ./agentv
      repo: https://github.com/EntityProcess/agentv.git
      commit: 5e3c8f46d80fe66b1a75659e4fd94e38a7e09215

tests:
  - id: verification-learning-capture
    input: |
      The eval harness has prepared ./agentv at the commit before the
      verification guidance was added.

      Decide what durable repo change should be made and explain why.
    expected_output: |
      The durable repo change is to update .agents/verification.md with the
      reusable verification workflow lessons. AGENTS.md already routes this
      class of work to .agents/verification.md, so no extra AGENTS.md edit is
      needed unless that routing is missing.
    assert:
      - The answer recommends updating .agents/verification.md rather than leaving the learning only in PR comments or private evidence.
      - The answer uses the pinned ./agentv checkout to verify the AGENTS.md routing.
      - The answer preserves the historical commit SHA as context.
```

## Assertions and Reference Data

When `assert` is defined, **only the declared graders run**. For
semantic checks, add plain rubric strings. If you need a custom LLM prompt or
grader target, declare `llm-rubric` explicitly:

```yaml
prompts:
  - "{{ prompt }}"

tests:
  - id: mixed-eval
    vars:
      prompt: "Debug this function..."
    assert:
      - Explains why the bug happens
      - type: contains
        value: "fix"
```

`expected_output` is passive reference data. It is available to graders through
`{{expected_output}}` and the script stdin payload, but it does not create an
implicit LLM grading call by itself.

**Common mistake:** putting rubric prose in `expected_output` instead of an
assertion:

```yaml
prompts:
  - "{{ prompt }}"

tests:
  - id: bad-example
    vars:
      prompt: "What is 2+2?"
    expected_output: The assistant should explain why the answer is 4. # reference answer field, not a grader
```

Write this as:

```yaml
prompts:
  - "{{ prompt }}"

tests:
  - id: good-example
    vars:
      prompt: "What is 2+2?"
    expected_output: "4"
    assert:
      - The answer is 4 and explains the arithmetic briefly
```

## Required Gates

Any grader can be marked `required` to enforce a minimum score:

```yaml
assert:
  - type: contains
    value: "DENIED"
    required: true          # must score >= 0.8 (default)
  - type: llm-rubric
    required: true
    min_score: 0.6          # must score >= 0.6 (custom threshold)
    value:
      - id: accuracy
        outcome: Identifies the denied party
        weight: 5.0
```

If a required grader scores below its threshold, the overall verdict is forced to `fail`.

## Environment Setup/Teardown

Run scripts before/after each test. Define at suite level or override per case:

```yaml
environment:
  type: host
  workdir: ./repo
  setup:
    command: ["bun", "run", "setup.ts"]
    args:
      repo: sympy/sympy
      commit: "abc123"
extensions:
  - file://scripts/teardown.mjs:afterAll

tests:
  - id: case-1
    input: Fix the bug
    metadata:
      source_repo: sympy/sympy
      source_commit: "abc123"
```

**Lifecycle:** environment setup → lifecycle extensions → target setup → agent → grading → teardown extensions → cleanup
**Merge:** Case-level environment fields replace suite-level fields.
**Commands receive stdin JSON:** `{workspace_path, test_id, eval_run_id, case_input, case_metadata}`
**Setup failure:** aborts case. **Teardown failure:** non-fatal (warning).
For SWE-bench-style evals, put operational checkout state under
`environment` setup args; treat `metadata.source_commit` as informational only.
A SHA in the prompt or metadata without a matching environment setup recipe is
not an operational checkout.

### Environment Lifecycle

Describe coding-agent testbeds with `environment`. Reusable recipes should live
in field-local files and be loaded with `environment: file://...`:

```yaml
environment: file://.agentv/environments/repo.yaml
```

```yaml
# .agentv/environments/repo.yaml
type: host
workdir: ./repo
setup:
  command: ./scripts/materialize-repo.sh
  args:
    repo: https://github.com/org/repo.git
    commit: main
    ancestor: 1
```

- `type`: `host` or `docker`
- `workdir`: path the target and graders should use
- `setup`: command and args for repository/testbed materialization
- Top-level `env`: provider/eval environment overrides
- `extensions`: lifecycle hooks such as `beforeAll`, `beforeEach`, `afterEach`, and `afterAll`

## Grader Types

Configure via the `assert` array. Multiple graders produce a weighted average score.

### script
```yaml
- name: format_check
  type: script
  command: [uv, run, validate.py]
  cwd: ./scripts          # optional working directory
  target: {}              # optional: enable LLM target proxy (max_calls: 50)
```
Contract: stdin JSON -> stdout JSON `{score, assertions: [{text, passed, evidence?}], reasoning}`
Raw stdin uses snake_case and includes: `input`, `expected_output`, `output` (final answer string), `messages`, `trace`, `trace_summary`, `token_usage`, `cost_usd`, `duration_ms`, `start_time`, `end_time`, `file_changes`, `workspace_path`, `config`
SDK handlers receive the same payload in camelCase: `expectedOutput`, `traceSummary`, `tokenUsage`, `costUsd`, `durationMs`, `startTime`, `endTime`, `fileChanges`, `workspacePath`.
When a workspace is configured, `workspace_path` is the absolute path to the workspace dir (also available as `AGENTV_WORKSPACE_PATH` env var). Use this for functional grading (e.g., running `npm test` in the workspace).
For deterministic workspace checks that fit normal Vitest `expect(...)` tests, prefer a plain verifier file and the built-in adapter:
```yaml
- name: welcome_banner
  type: script
  command: [agentv, eval, graders/welcome-banner.test.ts]
```
AgentV infers the Vitest adapter for `*.test.ts`, `*.spec.ts`, and Vercel-style `EVAL.ts` files. Use the explicit `agentv eval vitest` subcommand only when you need adapter flags such as `--cwd`, `--in-workspace`, or `--vitest-command`.
See the Script Graders docs for the full stdin/stdout contract.

### llm-rubric
```yaml
- name: quality
  type: llm-rubric
  prompt: ./prompts/eval.md     # markdown template or command config
  target: grader_gpt_5_mini     # optional: override the grader target for this grader
  model: gpt-5-chat            # optional model override
  config:                       # passed to prompt templates as context.config
    strictness: high
```
Variables: `{{criteria}}`, `{{input}}`, `{{expected_output}}`, `{{output}}`, `{{metadata}}`, `{{metadata_json}}`, `{{rubrics}}`, `{{rubrics_json}}`, `{{file_changes}}`, `{{tool_calls}}`
- Markdown templates: use `{{variable}}` syntax
- TypeScript templates: use `definePromptTemplate(fn)` from `@agentv/sdk`, receives context object with all variables + `config`
- Use `target:` to run different `llm-rubric` graders against different named LLM targets in the same eval (useful for grader panels / ensembles)

### assert-set
```yaml
- metric: gate
  type: assert-set
  threshold: 0.7
  config:
    shared_setting: enabled
  assert:
    - metric: safety
      type: llm-rubric
      prompt: ./safety.md
      weight: 0.3
    - metric: quality
      type: llm-rubric
      weight: 0.7
```
Use `assert-set` for Promptfoo-aligned assertion grouping. Without `threshold`, the set passes only when every nonzero-weight child assertion passes. With `threshold`, the weighted aggregate score determines the set verdict. Parent `config` is inherited by children, and child `config` keys override parent keys. Do not use `type: composite`; AgentV rejects it.

### tool-trajectory
```yaml
- name: tool_check
  type: tool-trajectory
  mode: any_order            # any_order | in_order | exact
  minimums:                  # for any_order
    knowledgeSearch: 2
  expected:                  # for in_order/exact
    - tool: knowledgeSearch
      args: { query: "search term" }   # partial deep equality match
    - tool: documentRetrieve
      args: any                        # any arguments accepted
      max_duration_ms: 5000            # per-tool latency assertion
    - tool: summarize                  # omit args to skip argument checking
```
`tool-trajectory` is an AgentV-specific extension over AgentV-normalized transcripts. Do not use Promptfoo `trajectory:*`, `tool-call-f1`, `skill-used`, or `trace-*` names; AgentV rejects those until their trace semantics are implemented directly.

### field-accuracy
```yaml
- name: fields
  type: field-accuracy
  match_type: exact          # exact | date | numeric_tolerance
  numeric_tolerance: 0.01    # for numeric_tolerance match_type
  aggregation: weighted_average  # weighted_average | all_or_nothing
```
Compares `output` fields against `expected_output` fields.

### latency
```yaml
- name: speed
  type: latency
  max_ms: 5000
```

### cost
```yaml
- name: budget
  type: cost
  max_usd: 0.10
```

### token-usage
```yaml
- name: tokens
  type: token-usage
  max_total_tokens: 4000
```

### execution-metrics
```yaml
- name: efficiency
  type: execution-metrics
  max_tool_calls: 10        # Maximum tool invocations
  max_llm_calls: 5          # Maximum LLM calls (assistant messages)
  max_tokens: 5000          # Maximum total tokens (input + output)
  max_cost_usd: 0.05        # Maximum cost in USD
  max_duration_ms: 30000    # Maximum execution duration
  target_exploration_ratio: 0.6   # Target ratio of read-only tool calls
  exploration_tolerance: 0.2      # Tolerance for ratio check (default: 0.2)
```
Declarative threshold-based checks on execution metrics. Only specified thresholds are checked.
Score is proportional: `passed / total` assertions. Missing data counts as a failed assertion.

### contains
```yaml
- type: contains
  value: "DENIED"
  required: true
```
Binary check: does output contain the substring? Name auto-generated if omitted.

### regex
```yaml
- type: regex
  value: "\\d{3}-\\d{2}-\\d{4}"
```
Binary check: does output match the regex pattern?

### equals
```yaml
- type: equals
  value: "42"
```
Binary check: does output exactly equal the value (both trimmed)?

### is-json
```yaml
- type: is-json
  required: true
```
Binary check: is the output valid JSON?

### llm-rubric
```yaml
- Correctly identifies the denied party
- Provides clear reasoning
```
LLM-judged structured evaluation. Plain strings are the preferred shorthand.
Use `type: llm-rubric` when you need weighted criteria, `required: false`,
`min_score`, or score ranges. Rubric items support `id`,
`outcome`, `weight`, and `required` fields.
Use optional `operator: correctness` for positive support checks or `operator: contradiction` for guard criteria where omission is acceptable but incompatible claims fail.

See `references/rubric-grader.md` for score-range mode and scoring formula.

## Suite-Level Quality Threshold

Set a minimum mean score for the eval suite. If the mean quality score falls below the threshold, the CLI exits with code 1 — useful for CI/CD quality gates. Use `evaluate_options.repeat` when each case should be attempted more than once.

```yaml
evaluate_options:
  repeat:
    count: 3
    strategy: pass_any
    early_exit: false
threshold: 0.8
```

CLI flag `--threshold 0.8` overrides the YAML value. Must be a number between 0 and 1. Mean score is computed from quality results only (execution errors excluded).

The threshold also controls JUnit XML pass/fail: tests with scores below the threshold are marked as `<failure>`. When no threshold is set, JUnit defaults to 0.5.

## CLI Commands

```bash
# Run evaluation (requires API keys)
agentv eval <file.yaml> [--test-id <id>] [--target <name>] [--threshold <0-1>]

# Run with OTLP JSON file (importable by OTel backends)
agentv eval <file.yaml> --otel-file traces/eval.otlp.json

# Record live target output for later target substitution
agentv eval <file.yaml> --target live_agent --record-replay fixtures/target-output.jsonl
agentv eval <file.yaml> --target replay_agent

# Run a single assertion in isolation (no API keys needed)
agentv eval assert <grader-name> --agent-output "..." --agent-input "..."

# Import agent transcripts for offline grading
agentv import claude --session-id <uuid>

# Re-run only execution errors from a previous run
agentv eval <file.yaml> --retry-errors .agentv/results/default/<timestamp>/index.jsonl

# Validate eval file
agentv validate <file.yaml>

# Compare completed runs
agentv results compare \
  .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl
agentv results combine \
  .agentv/results/default/<baseline-timestamp> \
  .agentv/results/default/<candidate-timestamp> \
  .agentv/results/default/<third-target-timestamp> \
  --output .agentv/results/default/combined
agentv results compare .agentv/results/default/combined/index.jsonl
agentv results compare \
  .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl \
  --json

# Author assertions directly in the eval file
# Prefer simple assertions when they fit the criteria; use deterministic or LLM-based graders when needed
agentv validate <file.yaml>
```

**Replay targets:** Add `provider: replay`, `fixtures: <jsonl>`, and `source_target: <live target label>` in `.agentv/targets.yaml`. Optional `suite`, `eval_path`, and `variant` tighten lookup. The eval YAML and graders stay unchanged; replay only substitutes recorded target output, and graders run fresh.

## TypeScript SDK Helpers

Use `@agentv/sdk` as the public lightweight SDK package for TypeScript/JavaScript helpers. SDK helpers must stay AgentV-native and lower to YAML/runtime contracts rather than introducing a second eval vocabulary.

### YAML-aligned eval authoring
```typescript
import { defineEval, graders } from '@agentv/sdk';

export default defineEval({
  name: 'helper-suite',
  target: 'default',
  // The SDK helper lowers this to evaluate_options.repeat in generated YAML.
  repeat: {
    count: 3,
    strategy: 'pass_any',
    earlyExit: false,
  },
  threshold: 0.8,
  tests: [
    {
      id: 'json-answer',
      input: 'Return a JSON answer with a status field.',
      assert: [
        graders.json({ name: 'valid-json', required: true }),
        graders.regex(/"status"\s*:/, { name: 'status-key' }),
      ],
    },
  ],
});
```

The `graders` catalog returns ordinary `assert` entries such as `type: is-json`, `type: regex`, `type: llm-rubric`, and `type: script`. `defineEval()` lowers camelCase TypeScript fields such as `expectedOutput`, `inputFiles`, and `maxSteps` to canonical snake_case YAML/runtime keys.

If adapting Braintrust `scores` or DeepEval metrics, write small AgentV helper factories that return `graders.*` configs:

```typescript
import { graders } from '@agentv/sdk';

export function ragFaithfulness() {
  return graders.llmRubric(undefined, {
    name: 'rag-faithfulness',
    target: 'grader-target',
    prompt: 'Grade whether the answer is supported by the retrieved context.',
  });
}
```

Use the helper in `assert: [ragFaithfulness()]`; do not create new YAML terms like `scores`.

### defineAssertion (recommended for reusable custom assertions)
```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/sdk';

export default defineAssertion(({ output, trace }) => {
  const finalOutput = output ?? '';
  return {
    pass: finalOutput.length > 0 && (trace?.eventCount ?? 0) <= 10,
    reasoning: 'Checks content exists and is efficient',
  };
});
```

Assertions support both `pass: boolean` and `score: number` (0-1). If only `pass` is given, score is 1 (pass) or 0 (fail).

Use `defineAssertion()` when you want a reusable assertion type discovered from `.agentv/assertions/` and referenced by filename as `type: <name>`. This follows Promptfoo's normal eval terminology: custom logic is an assertion, with Promptfoo using fixed assertion types such as `javascript`, `python`, `ruby`, and `webhook`. AgentV extends that model by allowing arbitrary discovered assertion type names.

### defineScriptGrader (full control)
```typescript
#!/usr/bin/env bun
import { defineScriptGrader } from '@agentv/sdk';

export default defineScriptGrader(({ output, trace }) => {
  const finalOutput = output ?? '';
  return {
    score: finalOutput.length > 0 && (trace?.eventCount ?? 0) <= 5 ? 1.0 : 0.5,
    assert: [
      { text: 'Output is not empty', passed: finalOutput.length > 0 },
      { text: 'Efficient tool usage', passed: (trace?.eventCount ?? 0) <= 5 },
    ],
  };
});
```

Use `defineScriptGrader()` when the custom component is a command-backed grader with explicit score control, custom assertion-result arrays, workspace commands, or LLM calls through a grader target. `defineScriptGrader()` scripts are referenced in YAML with `type: script` and `command: [bun, run, grader.ts]`. Plain Vitest workspace verifier files can use `command: [agentv, eval, graders/check.test.ts]`.

### Convention-Based Discovery

Place assertion files in `.agentv/assertions/` — they auto-register by filename:

```
.agentv/assertions/min-words.ts  →  type: min-words
.agentv/assertions/sentiment.ts   →  type: sentiment
```

No `command:` needed in YAML — just use `type: <filename>`.

## Programmatic API

Use `evaluate()` from `@agentv/core` to run evals as a library when you need application-level control. Keep YAML as the default portable surface; use `specFile` to point at existing evals and inline `tests` only when the definition belongs in code.

```typescript
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      expectedOutput: 'Hello there!',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
});
console.log(`${summary.passed}/${summary.total} passed`);
```

Programmatic API notes:

- Inline programmatic tests use `assert`, not `assertions`.
- Use camelCase in TypeScript (`expectedOutput`, `beforeAll`, `budgetUsd`).
- In YAML, use `evaluate_options.max_concurrency` for authored eval concurrency; reserve `workers` for project/target runtime config.
- When bridging from Python, generate canonical YAML/JSONL or call the CLI; there is no separate first-party Python authoring SDK.

Supports inline tests or file-based usage via `specFile`.

## defineConfig

Type-safe project configuration in `agentv.config.ts`:

```typescript
import { defineConfig } from '@agentv/core';

export default defineConfig({
  execution: { workers: 5, maxRetries: 2 },
  output: { dir: './results' },
  limits: { maxCostUsd: 10.0 },
});
```

Auto-discovered from project root. Validated with Zod.

## Scaffold Commands

```bash
agentv create assertion <name>  # → .agentv/assertions/<name>.ts
agentv create eval <name>       # → evals/<name>.eval.yaml + .cases.jsonl
```

## Skill Improvement Workflow

For a complete guide to iterating on skills using evaluations — writing scenarios, running baselines, comparing results, and improving — see the [Skill Improvement Workflow](https://agentv.dev/guides/skill-improvement-workflow/) guide.
## Observability Export

AgentV exports observability data via OpenTelemetry:

- `agentv eval <file.yaml> --otel-file traces/eval.otlp.json` writes a post-run OTLP JSON file that external systems such as Opik can ingest.
- `agentv eval <file.yaml> --export-otel --otel-backend <name>` streams live traces when a built-in or local resolver exists.

Do not invent a separate Opik-specific eval surface. Keep the eval definition in YAML and route observability through OTLP export.

## Schemas

- Eval file: `references/eval.schema.json`
- Config: `references/config.schema.json`

## Accessing reference files

To load a specific reference without pulling the entire skill into context:

```bash
agentv skills get agentv-eval-writer --ref eval.schema.json
```

Or resolve the skill directory and read files directly:

```bash
cat $(agentv skills path agentv-eval-writer)/references/eval.schema.json
```

Use `--full` to retrieve every file in the skill at once.
