---
name: agentv-eval-builder
description: Create and maintain AgentV YAML evaluation files for testing AI agent performance. Use this skill when creating new eval files, adding tests, or configuring evaluators.
---

# AgentV Eval Builder

Comprehensive docs: https://agentv.dev

## Quick Start

```yaml
description: Example eval
execution:
  target: default

tests:
  - id: greeting
    criteria: Friendly greeting
    input: "Say hello"
    expected_output: "Hello! How can I help you?"
    assert:
      - type: rubrics
        criteria:
          - Greeting is friendly and warm
          - Offers to help
```

## Eval File Structure

**Required:** `tests` (array or string path)
**Optional:** `name`, `description`, `version`, `author`, `tags`, `license`, `requires`, `execution`, `dataset`, `workspace`, `assert`, `input`

**Test fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `criteria` | yes | What the response should accomplish |
| `input` / `input` | yes | Input to the agent |
| `expected_output` / `expected_output` | no | Gold-standard reference answer |
| `assert` | no | Evaluators: assertions, rubrics, judges |
| `rubrics` | no | **Deprecated** — use `assert: [{type: rubrics, criteria: [...]}]` instead |
| `execution` | no | Per-case execution overrides |
| `workspace` | no | Per-case workspace config (overrides suite-level) |
| `metadata` | no | Arbitrary key-value pairs passed to setup/teardown scripts |
| `conversation_id` | no | Thread grouping |

**Shorthand aliases:**
- `input` (string) expands to `[{role: "user", content: "..."}]`
- `expected_output` (string/object) expands to `[{role: "assistant", content: ...}]`
- Canonical `input` / `expected_output` take precedence when both present

**Message format:** `{role, content}` where role is `system`, `user`, `assistant`, or `tool`
**Content types:** inline text, `{type: "file", value: "./path.md"}`
**File paths:** relative from eval file dir, or absolute with `/` prefix from repo root
**File handling by provider type:** LLM providers receive file content inlined in XML tags. Agent providers receive a preread block with `file://` URIs and must read files themselves. See [Coding Agents > Prompt format](https://agentv.dev/targets/coding-agents#prompt-format).

**JSONL format:** One test per line as JSON. Optional `.yaml` sidecar for shared defaults. See `examples/features/basic-jsonl/`.

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

## Suite-level Input

Prepend shared input messages to every test (like suite-level `assert`). Avoids repeating the same prompt file in each test:

```yaml
input:
  - role: user
    content:
      - type: file
        value: ./system-prompt.md

tests: ./cases.yaml

# cases.yaml — each test only needs its own query
# - id: test-1
#   criteria: ...
#   input: "User question here"
```

Effective input: `[...suite input, ...test input]`. Skipped when `execution.skip_defaults: true`.
Accepts same formats as test `input` (string or message array).

## Tests as String Path

Point `tests` to an external file instead of inlining:

```yaml
name: my-eval
description: My evaluation suite
tests: ./cases.yaml           # relative to eval file dir
```

The external file can be YAML (array of test objects) or JSONL.

## Assert Field

`assert` defines evaluators at the suite level or per-test level. It is the canonical field for all evaluators (replaces `execution.evaluators`):

```yaml
# Suite-level (appended to every test)
assert:
  - type: is-json
    required: true
  - type: contains
    value: "status"

tests:
  - id: test-1
    criteria: Returns JSON
    input: Get status
    # Per-test assert (runs before suite-level)
    assert:
      - type: equals
        value: '{"status": "ok"}'
```

`execution.evaluators` is deprecated. When both `assert` and `execution.evaluators` are present, `assert` takes precedence.

## How `criteria` and `assert` Interact

`criteria` is a **data field** — it describes what the response should accomplish. It is **not** an evaluator. How it gets evaluated depends on whether `assert` is present:

| Scenario | What happens | Warning? |
|----------|-------------|----------|
| `criteria` + **no `assert`** | Implicit `llm-judge` runs automatically against `criteria` | No |
| `criteria` + **`assert` with only deterministic evaluators** (contains, regex, etc.) | Only declared evaluators run. `criteria` is **not evaluated**. | Yes — warns that no evaluator will consume criteria |
| `criteria` + **`assert` with a judge** (llm-judge, code-judge, agent-judge, rubrics) | Declared evaluators run. Judges receive `criteria` as input. | No |

### No assert → implicit llm-judge

The simplest path. `criteria` is automatically evaluated by the default `llm-judge`:

```yaml
tests:
  - id: simple-eval
    criteria: Assistant correctly explains the bug and proposes a fix
    input: "Debug this function..."
    # No assert → default llm-judge evaluates against criteria
```

### assert present → no implicit judge

When `assert` is defined, **only the declared evaluators run**. If you want an LLM judge alongside deterministic checks, declare it explicitly:

```yaml
tests:
  - id: mixed-eval
    criteria: Response is helpful and mentions the fix
    input: "Debug this function..."
    assert:
      - type: llm-judge        # must be explicit when assert is present
      - type: contains
        value: "fix"
```

**Common mistake:** defining `criteria` with only deterministic evaluators. The criteria will be ignored and a warning is emitted:

```yaml
tests:
  - id: bad-example
    criteria: Gives a thoughtful answer    # ⚠ NOT evaluated — no judge in assert
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
    # Warning: criteria is defined but no evaluator in assert will evaluate it.
```

## Required Gates

Any evaluator can be marked `required` to enforce a minimum score:

```yaml
assert:
  - type: contains
    value: "DENIED"
    required: true          # must score >= 0.8 (default)
  - type: rubrics
    required: 0.6           # must score >= 0.6 (custom threshold)
    criteria:
      - id: accuracy
        outcome: Identifies the denied party
        weight: 5.0
```

If a required evaluator scores below its threshold, the overall verdict is forced to `fail`.

## Workspace Setup/Teardown

Run scripts before/after each test. Define at suite level or override per case:

```yaml
workspace:
  template: ./workspace-templates/my-project
  setup:
    command: ["bun", "run", "setup.ts"]
    timeout_ms: 120000
  teardown:
    command: ["bun", "run", "teardown.ts"]

tests:
  - id: case-1
    input: Fix the bug
    criteria: Bug is fixed
    metadata:
      repo: sympy/sympy
      base_commit: "abc123"
    workspace:
      setup:
        command: ["python", "custom-setup.py"]  # overrides suite-level
```

**Lifecycle:** template copy → repo clone → setup → git baseline → agent → file changes → teardown → repo reset → cleanup
**Merge:** Case-level fields replace suite-level fields.
**Commands receive stdin JSON:** `{workspace_path, test_id, eval_run_id, case_input, case_metadata}`
**Setup failure:** aborts case. **Teardown failure:** non-fatal (warning).

### Repository Lifecycle

Clone repos into workspace automatically with bare-mirror caching:

```yaml
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
        ancestor: 1       # parent commit
      clone:
        depth: 10
  reset:
    strategy: hard         # none | hard | recreate
    after_each: true
  isolation: shared        # shared | per_test
```

- `source.type`: `git` (URL) or `local` (path)
- `checkout.resolve`: `remote` (ls-remote) or `local`
- `clone.depth`: shallow clone depth (applies to both cache and workspace)
- `clone.filter`: partial clone filter (e.g., `blob:none`)
- `clone.sparse`: sparse checkout paths array
- Cache: `~/.agentv/git-cache/`, manage with `agentv cache clean` or `agentv cache add --url <url> --from <local-path>`

See https://agentv.dev/targets/configuration/#repository-lifecycle

## Evaluator Types

Configure via `assert` array. Multiple evaluators produce a weighted average score.

### code_judge
```yaml
- name: format_check
  type: code-judge
  command: [uv, run, validate.py]
  cwd: ./scripts          # optional working directory
  target: {}              # optional: enable LLM target proxy (max_calls: 50)
```
Contract: stdin JSON -> stdout JSON `{score, hits, misses, reasoning}`
Input includes: `question`, `criteria`, `answer`, `reference_answer`, `output`, `trace`, `token_usage`, `cost_usd`, `duration_ms`, `start_time`, `end_time`, `file_changes`, `workspace_path`, `config`
When `workspace_template` is configured, `workspace_path` is the absolute path to the workspace dir (also available as `AGENTV_WORKSPACE_PATH` env var). Use this for functional grading (e.g., running `npm test` in the workspace).
See docs at https://agentv.dev/evaluators/code-judges/

### llm_judge
```yaml
- name: quality
  type: llm-judge
  prompt: ./prompts/eval.md     # markdown template or command config
  model: gpt-5-chat            # optional model override
  config:                       # passed to prompt templates as context.config
    strictness: high
```
Variables: `{{question}}`, `{{criteria}}`, `{{answer}}`, `{{reference_answer}}`, `{{input}}`, `{{expected_output}}`, `{{output}}`, `{{file_changes}}`
- Markdown templates: use `{{variable}}` syntax
- TypeScript templates: use `definePromptTemplate(fn)` from `@agentv/eval`, receives context object with all variables + `config`

### composite
```yaml
- name: gate
  type: composite
  assert:
    - name: safety
      type: llm-judge
      prompt: ./safety.md
    - name: quality
      type: llm-judge
  aggregator:
    type: weighted_average
    weights: { safety: 0.3, quality: 0.7 }
```
Aggregator types: `weighted_average`, `all_or_nothing`, `minimum`, `maximum`, `safety_gate`
- `safety_gate`: fails immediately if the named gate evaluator scores below threshold (default 1.0)

### tool_trajectory
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

### field_accuracy
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

### token_usage
```yaml
- name: tokens
  type: token-usage
  max_total_tokens: 4000
```

### execution_metrics
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
Score is proportional: `hits / (hits + misses)`. Missing data counts as a miss.

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

### is_json
```yaml
- type: is-json
  required: true
```
Binary check: is the output valid JSON?

### rubrics
```yaml
- type: rubrics
  criteria:
    - id: accuracy
      outcome: Correctly identifies the denied party
      weight: 5.0
    - id: reasoning
      outcome: Provides clear reasoning
      weight: 3.0
```
LLM-judged structured evaluation with weighted criteria. Criteria items support `id`, `outcome`, `weight`, and `required` fields.

### rubrics (inline, deprecated)
Top-level `rubrics:` field is deprecated. Use `type: rubrics` under `assert` instead.
See `references/rubric-evaluator.md` for score-range mode and scoring formula.

## Execution Error Tolerance

Control how the runner handles execution errors (infrastructure failures, not quality failures):

```yaml
execution:
  fail_on_error: false    # never halt (default)
  # fail_on_error: true   # halt on first execution error
```

When halted, remaining tests get `executionStatus: 'execution_error'` with `failureReasonCode: 'error_threshold_exceeded'`.

## CLI Commands

```bash
# Run evaluation (requires API keys)
agentv eval <file.yaml> [--test-id <id>] [--target <name>] [--dry-run]

# Run with trace file (human-readable JSONL)
agentv eval <file.yaml> --trace-file traces/eval.jsonl

# Run with OTLP JSON file (importable by OTel backends)
agentv eval <file.yaml> --otel-file traces/eval.otlp.json

# Agent-orchestrated evals (no API keys needed)
agentv prompt eval <file.yaml>                                      # orchestration overview
agentv prompt eval input <file.yaml> --test-id <id>                 # task input JSON (file paths, not embedded content)
agentv prompt eval judge <file.yaml> --test-id <id> --answer-file f # judge prompts / code judge results

# Re-run only execution errors from a previous output
agentv eval <file.yaml> --retry-errors <previous-output.jsonl>

# Validate eval file
agentv validate <file.yaml>

# Compare results — N-way matrix from combined JSONL
agentv compare <combined-results.jsonl>
agentv compare <combined-results.jsonl> --baseline <target>                   # CI regression gate
agentv compare <combined-results.jsonl> --baseline <target> --candidate <target>  # pairwise
agentv compare <results1.jsonl> <results2.jsonl>                              # two-file pairwise

# Generate rubrics from criteria
agentv generate rubrics <file.yaml> [--target <name>]
```

## Code Judge SDK

Use `@agentv/eval` to build custom evaluators in TypeScript/JavaScript:

### defineAssertion (recommended for custom checks)
```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer, trace }) => ({
  pass: answer.length > 0 && (trace?.eventCount ?? 0) <= 10,
  reasoning: 'Checks content exists and is efficient',
}));
```

Assertions support both `pass: boolean` and `score: number` (0-1). If only `pass` is given, score is 1 (pass) or 0 (fail).

### defineCodeJudge (full control)
```typescript
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ trace, answer }) => ({
  score: trace?.eventCount <= 5 ? 1.0 : 0.5,
  hits: ['Efficient tool usage'],
  misses: [],
}));
```

Both are used via `type: code-judge` in YAML with `command: [bun, run, judge.ts]`.

### Convention-Based Discovery

Place assertion files in `.agentv/assertions/` — they auto-register by filename:

```
.agentv/assertions/word-count.ts  →  type: word-count
.agentv/assertions/sentiment.ts   →  type: sentiment
```

No `command:` needed in YAML — just use `type: <filename>`.

## Programmatic API

Use `evaluate()` from `@agentv/core` to run evals as a library:

```typescript
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
});
console.log(`${summary.passed}/${summary.total} passed`);
```

Supports inline tests (no YAML) or file-based via `specFile`.

## defineConfig

Type-safe project configuration in `agentv.config.ts`:

```typescript
import { defineConfig } from '@agentv/core';

export default defineConfig({
  execution: { workers: 5, maxRetries: 2 },
  output: { format: 'jsonl', dir: './results' },
  limits: { maxCostUsd: 10.0 },
});
```

Auto-discovered from project root. Validated with Zod.

## Scaffold Commands

```bash
agentv create assertion <name>  # → .agentv/assertions/<name>.ts
agentv create eval <name>       # → evals/<name>.eval.yaml + .cases.jsonl
```

## Schemas

- Eval file: `references/eval-schema.json`
- Config: `references/config-schema.json`
