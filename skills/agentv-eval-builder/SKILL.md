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
    rubrics:
      - Greeting is friendly and warm
      - Offers to help
```

## Eval File Structure

**Required:** `tests` (array)
**Optional:** `description`, `execution`, `dataset`, `workspace`

**Test fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `criteria` | yes | What the response should accomplish |
| `input` / `input_messages` | yes | Input to the agent |
| `expected_output` / `expected_messages` | no | Gold-standard reference answer |
| `rubrics` | no | Inline evaluation criteria |
| `execution` | no | Per-case execution overrides |
| `workspace` | no | Per-case workspace config (overrides suite-level) |
| `metadata` | no | Arbitrary key-value pairs passed to setup/teardown scripts |
| `conversation_id` | no | Thread grouping |

**Shorthand aliases:**
- `input` (string) expands to `[{role: "user", content: "..."}]`
- `expected_output` (string/object) expands to `[{role: "assistant", content: ...}]`
- Canonical `input_messages` / `expected_messages` take precedence when both present

**Message format:** `{role, content}` where role is `system`, `user`, `assistant`, or `tool`
**Content types:** inline text, `{type: "file", value: "./path.md"}`
**File paths:** relative from eval file dir, or absolute with `/` prefix from repo root

**JSONL format:** One test per line as JSON. Optional `.yaml` sidecar for shared defaults. See `examples/features/basic-jsonl/`.

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
**Scripts receive stdin JSON:** `{workspace_path, eval_case_id, eval_run_id, case_input, case_metadata}`
**Setup failure:** aborts case. **Teardown failure:** non-fatal (warning).
See https://agentv.dev/targets/configuration/#workspace-setupteardown

## Evaluator Types

Configure via `execution.evaluators` array. Multiple evaluators produce a weighted average score.

### code_judge
```yaml
- name: format_check
  type: code_judge
  script: uv run validate.py
  cwd: ./scripts          # optional working directory
  target: {}              # optional: enable LLM target proxy (max_calls: 50)
```
Contract: stdin JSON -> stdout JSON `{score, hits, misses, reasoning}`
Input includes: `question`, `criteria`, `candidate_answer`, `reference_answer`, `output_messages`, `trace_summary`, `file_changes`, `workspace_path`, `config`
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
Variables: `{{question}}`, `{{criteria}}`, `{{candidate_answer}}`, `{{reference_answer}}`, `{{input_messages}}`, `{{expected_messages}}`, `{{output_messages}}`, `{{file_changes}}`
- Markdown templates: use `{{variable}}` syntax
- TypeScript templates: use `definePromptTemplate(fn)` from `@agentv/eval`, receives context object with all variables + `config`

### composite
```yaml
- name: gate
  type: composite
  evaluators:
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
Compares `output_messages` fields against `expected_messages` fields.

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

### rubric (inline)
```yaml
rubrics:
  - Simple string criterion
  - id: weighted
    criteria: Detailed criterion
    weight: 2.0
    required: true
```
See `references/rubric-evaluator.md` for score-range mode and scoring formula.

## CLI Commands

```bash
# Run evaluation (requires API keys)
agentv run <file.yaml> [--eval-id <id>] [--target <name>] [--dry-run]

# Run with trace persistence (writes to .agentv/traces/)
agentv run <file.yaml> --trace

# Agent-orchestrated evals (no API keys needed)
agentv prompt <file.yaml>                                      # orchestration overview
agentv prompt input <file.yaml> --eval-id <id>                 # task input JSON (file paths, not embedded content)
agentv prompt judge <file.yaml> --eval-id <id> --answer-file f # judge prompts / code judge results

# Validate eval file
agentv validate <file.yaml>

# Compare results between runs
agentv compare <results1.jsonl> <results2.jsonl>

# Generate rubrics from criteria
agentv generate rubrics <file.yaml> [--target <name>]
```

## Schemas

- Eval file: `references/eval-schema.json`
- Config: `references/config-schema.json`
