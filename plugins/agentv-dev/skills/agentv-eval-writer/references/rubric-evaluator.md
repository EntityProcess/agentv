# Rubric Evaluator

Rubrics are defined as `assertions` entries with `type: rubrics`. They support binary checklist grading and score-range analytic grading.

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | required | Must be `rubrics` |
| `criteria` | array | required | List of criterion strings or objects |
| `required` | boolean or number | - | Gate: `true` requires score >= 0.8; a number (0–1) sets a custom threshold |

### Criterion Object Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto-generated | Unique identifier |
| `outcome` | string | required* | Criterion being evaluated (*optional if `score_ranges` used) |
| `weight` | number | 1.0 | Relative importance |
| `required` | boolean | true | Failing forces verdict to 'fail' (checklist mode) |
| `required_min_score` | integer | - | Minimum 0-10 score to pass (score-range mode) |
| `score_ranges` | map or array | - | Score range definitions for analytic scoring |

## String Shorthand (Recommended)

Plain strings in `assertions` are automatically treated as rubric criteria:

```yaml
assertions:
  - Mentions divide-and-conquer approach
  - Explains partition step
  - States time complexity
```

Equivalent to the full form with `type: rubrics`. Use the full form only when you need weights, `required: false`, or `score_ranges`.

Mixed strings and objects are supported in `assertions` — strings are grouped into a single rubrics evaluator at the position of the first string:

```yaml
assertions:
  - Mentions divide-and-conquer approach  # grouped into rubrics
  - type: code-grader
    command: [check_syntax.py]
  - States time complexity                # grouped into rubrics
```

## Checklist Mode

```yaml
assertions:
  - type: rubrics
    criteria:
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

## Score-Range Mode

Shorthand map format (recommended):

```yaml
assertions:
  - type: rubrics
    criteria:
      - id: correctness
        weight: 2.0
        required_min_score: 7
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

## Scoring

**Checklist:** `score = sum(satisfied weights) / sum(all weights)`

**Score-range:** `score = weighted_average(raw_score / 10)` per criterion

## Verdicts

| Verdict | Condition |
|---------|-----------|
| `pass` | score >= 0.8 AND all gating criteria satisfied |
| `fail` | score < 0.8 OR any gating criterion failed |

Gating: checklist uses `required: true`, score-range uses `required_min_score: N`.
