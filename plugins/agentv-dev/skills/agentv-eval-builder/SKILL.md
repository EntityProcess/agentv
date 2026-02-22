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
**Optional:** `name`, `description`, `version`, `author`, `tags`, `license`, `requires`, `execution`, `dataset`, `workspace`, `assert`

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
  - type: is_json
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
    script: ["bun", "run", "setup.ts"]
    timeout_ms: 120000
  teardown:
    script: ["bun", "run", "teardown.ts"]

tests:
  - id: case-1
    input: Fix the bug
    criteria: Bug is fixed
    metadata:
      repo: sympy/sympy
      base_commit: "abc123"
    workspace:
      setup:
        script: ["python", "custom-setup.py"]  # overrides suite-level
```

**Lifecycle:** template copy → setup → git baseline → agent → file changes → teardown → cleanup
**Merge:** Case-level fields replace suite-level fields.
**Scripts receive stdin JSON:** `{workspace_path, test_id, eval_run_id, case_input, case_metadata}`
**Setup failure:** aborts case. **Teardown failure:** non-fatal (warning).
See https://agentv.dev/targets/configuration/#workspace-setupteardown

## Evaluator Types

Configure via `assert` array. Multiple evaluators produce a weighted average score.

### code_judge
```yaml
- name: format_check
  type: code_judge
  script: uv run validate.py
  cwd: ./scripts          # optional working directory
  target: {}              # optional: enable LLM target proxy (max_calls: 50)
```
Contract: stdin JSON -> stdout JSON `{score, hits, misses, reasoning}`
Input includes: `question`, `criteria`, `answer`, `reference_answer`, `output`, `trace`, `file_changes`, `workspace_path`, `config`
When `workspace_template` is configured, `workspace_path` is the absolute path to the workspace dir (also available as `AGENTV_WORKSPACE_PATH` env var). Use this for functional grading (e.g., running `npm test` in the workspace).
See docs at https://agentv.dev/evaluators/code-judges/

### llm_judge
```yaml
- name: quality
  type: llm_judge
  prompt: ./prompts/eval.md     # markdown template or script config
  model: gpt-5-chat            # optional model override
  config:                       # passed to script templates as context.config
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
      type: llm_judge
      prompt: ./safety.md
    - name: quality
      type: llm_judge
  aggregator:
    type: weighted_average
    weights: { safety: 0.3, quality: 0.7 }
```
Aggregator types: `weighted_average`, `all_or_nothing`, `minimum`, `maximum`, `safety_gate`
- `safety_gate`: fails immediately if the named gate evaluator scores below threshold (default 1.0)

### tool_trajectory
```yaml
- name: tool_check
  type: tool_trajectory
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
  type: field_accuracy
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
  type: token_usage
  max_total_tokens: 4000
```

### execution_metrics
```yaml
- name: efficiency
  type: execution_metrics
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
- type: is_json
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

# Validate eval file
agentv validate <file.yaml>

# Compare results between runs
agentv compare <results1.jsonl> <results2.jsonl>

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

Both are used via `type: code_judge` in YAML with `script: bun run judge.ts`.

## Schemas

- Eval file: `references/eval-schema.json`
- Config: `references/config-schema.json`
