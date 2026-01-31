# Rubric Evaluator

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto-generated | Unique identifier |
| `expected_outcome` | string | required* | Criterion being evaluated (*optional if `score_ranges` used) |
| `weight` | number | 1.0 | Relative importance |
| `required` | boolean | true | Failing forces verdict to 'fail' (checklist mode) |
| `required_min_score` | integer | - | Minimum 0-10 score to pass (score-range mode) |
| `score_ranges` | map or array | - | Score range definitions for analytic scoring |

`description` is a backward-compatible alias for `expected_outcome`.

## Checklist Mode

```yaml
rubrics:
  - Mentions divide-and-conquer approach
  - id: complexity
    expected_outcome: States time complexity correctly
    weight: 2.0
    required: true
  - id: examples
    expected_outcome: Includes code examples
    weight: 1.0
    required: false
```

## Score-Range Mode

Shorthand map format (recommended):

```yaml
rubrics:
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
        expected_outcome: Critical bugs
      - score_range: [3, 5]
        expected_outcome: Minor bugs
      - score_range: [6, 8]
        expected_outcome: Correct with minor issues
      - score_range: [9, 10]
        expected_outcome: Fully correct
```

Ranges must be integers 0-10, non-overlapping, covering all values 0-10.

## Scoring

**Checklist:** `score = sum(satisfied weights) / sum(all weights)`

**Score-range:** `score = weighted_average(raw_score / 10)` per criterion

## Verdicts

| Verdict | Condition |
|---------|-----------|
| `pass` | score >= 0.8 AND all gating criteria satisfied |
| `borderline` | score >= 0.6 AND all gating criteria satisfied |
| `fail` | score < 0.6 OR any gating criterion failed |

Gating: checklist uses `required: true`, score-range uses `required_min_score: N`.
