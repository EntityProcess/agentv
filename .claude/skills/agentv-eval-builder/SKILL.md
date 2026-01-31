---
name: agentv-eval-builder
description: Create and maintain AgentV YAML evaluation files for testing AI agent performance. Use this skill when creating new eval files, adding eval cases, or configuring evaluators.
---

# AgentV Eval Builder

Comprehensive docs: https://agentv.dev

## Quick Start

```yaml
description: Example eval
execution:
  target: default

evalcases:
  - id: greeting
    expected_outcome: Friendly greeting
    input: "Say hello"
    expected_output: "Hello! How can I help you?"
    rubrics:
      - Greeting is friendly and warm
      - Offers to help
```

## Eval File Structure

**Required:** `evalcases` (array)
**Optional:** `description`, `execution`, `dataset`

**Eval case fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `expected_outcome` | yes | What the response should accomplish |
| `input_messages` / `input` | yes | Input to the agent |
| `expected_messages` / `expected_output` | no | Gold-standard reference answer |
| `rubrics` | no | Inline evaluation criteria |
| `execution` | no | Per-case execution overrides |
| `conversation_id` | no | Thread grouping |

**Shorthand aliases:**
- `input` (string) expands to `[{role: "user", content: "..."}]`
- `expected_output` (string/object) expands to `[{role: "assistant", content: ...}]`
- Canonical `input_messages` / `expected_messages` take precedence when both present

**Message format:** `{role, content}` where role is `system`, `user`, `assistant`, or `tool`
**Content types:** inline text, `{type: "file", value: "./path.md"}`
**File paths:** relative from eval file dir, or absolute with `/` prefix from repo root

**JSONL format:** One eval case per line as JSON. Optional `.yaml` sidecar for shared defaults. See `examples/features/basic-jsonl/`.

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
See `references/custom-evaluators.md` for templates.

### llm_judge
```yaml
- name: quality
  type: llm_judge
  prompt: ./prompts/eval.md     # markdown template or script config
  model: gpt-5-chat            # optional model override
```
Variables: `{{question}}`, `{{expected_outcome}}`, `{{candidate_answer}}`, `{{reference_answer}}`, `{{input_messages}}`, `{{expected_messages}}`, `{{output_messages}}`

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

### tool_trajectory
```yaml
- name: tool_check
  type: tool_trajectory
  mode: any_order            # any_order | in_order | exact
  minimums:                  # for any_order
    knowledgeSearch: 2
  expected:                  # for in_order/exact
    - tool: knowledgeSearch
    - tool: documentRetrieve
```

### field_accuracy
```yaml
- name: fields
  type: field_accuracy
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

### rubric (inline)
```yaml
rubrics:
  - Simple string criterion
  - id: weighted
    expected_outcome: Detailed criterion
    weight: 2.0
    required: true
```
See `references/rubric-evaluator.md` for score-range mode and scoring formula.

## CLI Commands

```bash
# Run evaluation
bun agentv eval <file.yaml> [--eval-id <id>] [--target <name>] [--dry-run]

# Validate eval file
bun agentv validate <file.yaml>

# Compare results between runs
bun agentv compare <results1.jsonl> <results2.jsonl>

# Generate rubrics from expected_outcome
bun agentv generate rubrics <file.yaml> [--target <name>]
```

## Schemas

- Eval file: `references/eval-schema.json`
- Config: `references/config-schema.json`
