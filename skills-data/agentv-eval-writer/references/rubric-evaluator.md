# Rubric Graders

Rubrics are defined as `assert` entries with plain strings, `type: llm-rubric`, or `type: agent-rubric`. They support binary checklist grading and score-range analytic grading. Use `agent-rubric` only when the grader provider is agent-capable and should inspect workspace evidence.

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | required | Use `llm-rubric` for a structured rubric; use `agent-rubric` for Promptfoo-compatible agent-backed rubric checks; plain strings in `assert` use the same non-agent rubric path |
| `value` | array | required | List of criterion strings or objects |
| `required` | boolean or number | - | Gate: `true` requires score >= 0.8; a number (0–1) sets a custom threshold |

### Criterion Object Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto-generated | Unique identifier |
| `outcome` | string | required* | Criterion being evaluated (*optional if `score_ranges` used) |
| `operator` | string | - | Optional intent: `correctness` or `contradiction` |
| `weight` | number | 1.0 | Relative importance |
| `required` | boolean | true | Failing forces the case status to `fail` (checklist mode) |
| `min_score` | number | - | Minimum score (0–1) to pass this criterion |
| `score_ranges` | map or array | - | Score range definitions for analytic scoring |

## String Shorthand (Recommended)

Plain strings in `assert` are automatically treated as rubric criteria:

```yaml
assert:
  - Mentions divide-and-conquer approach
  - Explains partition step
  - States time complexity
```

Equivalent to the full form with `type: llm-rubric`. Use the full form only when you need weights, `required: false`, or `score_ranges`.

Mixed strings and objects are supported in `assert`: strings are grouped into a single rubric grader at the position of the first string:

```yaml
assert:
  - Mentions divide-and-conquer approach  # grouped into a rubric
  - type: script
    command: [check_syntax.py]
  - States time complexity                # grouped into a rubric
```

## Checklist Mode

```yaml
assert:
  - type: llm-rubric
    value:
      - Mentions divide-and-conquer approach
      - id: complexity
        outcome: States time complexity correctly
        weight: 2.0
        required: true
      - id: examples
        outcome: Includes code examples
        weight: 1.0
        required: false
```

### Criterion Operators

Use `operator` when outcome text should carry grading intent without embedding words like "must not contradict" in the outcome itself:

```yaml
assert:
  - type: llm-rubric
    value:
      - id: supported-fact
        operator: correctness
        outcome: States revenue increased to $10M
      - id: no-conflicting-fact
        operator: contradiction
        outcome: Revenue increased to $10M
```

- `correctness`: answer must positively support or fulfill the outcome.
- `contradiction`: answer may omit the outcome, but must not make an incompatible claim.

## Score-Range Mode

Shorthand map format (recommended):

```yaml
assert:
  - type: llm-rubric
    value:
      - id: correctness
        weight: 2.0
        min_score: 0.7
        score_ranges:
          0: Critical bugs
          3: Minor bugs
          6: Correct with minor issues
          9: Fully correct
```

Map keys are lower bounds (0-10). Each range extends from its key to (next key - 1), with the last extending to 10. Must start at 0.

Array format is also accepted:

```yaml
    score_ranges:
      - score_range: [0, 2]
        outcome: Critical bugs
      - score_range: [3, 5]
        outcome: Minor bugs
      - score_range: [6, 8]
        outcome: Correct with minor issues
      - score_range: [9, 10]
        outcome: Fully correct
```

Ranges must be integers 0-10, non-overlapping, covering all values 0-10.

## Agent Rubric Mode

`agent-rubric` accepts the same `value`, `provider`, `max_steps`, `required`, and
`min_score` fields as `llm-rubric`, but the resolved grader provider must be
agent-capable:

```yaml
assert:
  - type: agent-rubric
    provider: codex-grader
    value: Inspect the workspace and verify the claimed files exist.
```

AgentV asks the grader agent to write a verdict JSON file shaped like
`{"pass": boolean, "score": number, "reason": string}`. The score must be a
finite 0-1 value; invalid verdict files fail closed.

## Scoring

**Checklist:** `score = sum(satisfied weights) / sum(all weights)`

**Score-range:** `score = weighted_average(raw_score / 10)` per criterion

## Verdicts

| Verdict | Condition |
|---------|-----------|
| `pass` | score >= 0.8 AND all gating criteria satisfied |
| `fail` | score < 0.8 OR any gating criterion failed |

Gating: checklist uses `required: true`, score-range uses `min_score: N` (0–1 scale).
